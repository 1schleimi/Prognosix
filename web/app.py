"""
FastAPI backend — multi-horizon probabilistic stock predictor.

Endpoints:
  GET  /health           → health check + loaded models count
  POST /predict          → ensemble multi-horizon quantile forecast
  GET  /history/{ticker} → OHLC candlestick data
  GET  /quote/{ticker}   → live quote + market state
  GET  / (static)        → React frontend (from frontend/dist/)
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import requests as _requests
import torch
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── path setup ────────────────────────────────────────────────────────────────
WEB_DIR  = Path(__file__).parent
ROOT_DIR = WEB_DIR.parent
SRC_DIR  = ROOT_DIR / "src"
sys.path.insert(0, str(SRC_DIR))

from data_fetcher import DataFetcher
from features import (
    N_FEATURES, SECTOR_ETF, DEFAULT_SECTOR,
    FeatureNormalizer, build_raw_features,
)
from dataset import HORIZONS, N_HORIZONS
from conformal import ConformalCalibrator, CAL_PATH

ENSEMBLE_DIR       = ROOT_DIR / "models" / "ensemble"
STATS_PATH         = ROOT_DIR / "models" / "feature_stats.json"
THRESHOLDS_PATH    = ROOT_DIR / "models" / "thresholds.json"
DIST_DIR           = WEB_DIR  / "frontend" / "dist"
BACKTEST_REPORT    = ROOT_DIR / "data" / "backtest_report.json"
EQUITY_CURVES_PATH = ROOT_DIR / "data" / "equity_curves.json"

_YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com",
}
_RANGE_DAYS = {"1w": 7, "1m": 31, "3m": 92, "1y": 365, "5y": 365 * 5}

# ── globals ───────────────────────────────────────────────────────────────────
_models: list = []          # list of nn.Module
_ticker_lists: list = []    # per-model ticker lists
_normalizer: Optional[FeatureNormalizer] = None
_conformal: Optional[ConformalCalibrator] = None
_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_thresholds: dict = {}      # {ticker: {"long": τ_l, "short": τ_s}}

_TAU_LONG_DEFAULT  = 0.55
_TAU_SHORT_DEFAULT = 0.45

_backtest_report_cache: Optional[list] = None
_equity_curves_cache:   Optional[dict] = None

# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Stock Predictor — Multi-Horizon Ensemble", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ── startup ───────────────────────────────────────────────────────────────────

def _load_ensemble():
    global _models, _ticker_lists, _normalizer, _conformal, _thresholds

    # Import here to avoid circular deps at module load
    from models.lstm_v2 import LSTMv2
    from models.patchtst import PatchTST

    paths = sorted(ENSEMBLE_DIR.glob("*.pth"))
    if not paths:
        print(f"  [warn] No ensemble checkpoints in {ENSEMBLE_DIR}.")
        print(f"         Run: bash scripts/train_all.sh")
        return

    for p in paths:
        ckpt = torch.load(str(p), map_location=_device, weights_only=False)
        name = ckpt["model_name"]
        n_t  = ckpt["n_tickers"]
        n_f  = ckpt["n_features"]
        if name == "lstm_v2":
            m = LSTMv2(n_features=n_f, n_tickers=n_t)
        elif name == "patchtst":
            m = PatchTST(n_features=n_f, n_tickers=n_t, seq_len=ckpt["seq_len"])
        else:
            print(f"  [warn] Unknown model name {name!r} in {p.name} — skipping")
            continue
        state = {k.replace("_orig_mod.", "", 1): v for k, v in ckpt["model_state"].items()}
        m.load_state_dict(state)
        m.eval().to(_device)
        _models.append(m)
        _ticker_lists.append(ckpt["ticker_list"])
        print(f"  Loaded {p.name}  val={ckpt['best_val']:.5f}")

    if STATS_PATH.exists():
        _normalizer = FeatureNormalizer.load(str(STATS_PATH))
        print(f"  Feature stats loaded from {STATS_PATH}")
    else:
        print(f"  [warn] {STATS_PATH} not found — run train.py to generate stats.")

    if THRESHOLDS_PATH.exists():
        import json
        with open(THRESHOLDS_PATH) as f:
            _thresholds = json.load(f)
        print(f"  Thresholds loaded from {THRESHOLDS_PATH}")
    else:
        print(f"  [info] {THRESHOLDS_PATH} not found — using default thresholds.")

    _conformal = ConformalCalibrator.load_or_none(CAL_PATH)
    if _conformal:
        print(f"  Conformal calibration loaded (target coverage={_conformal.target_coverage:.0%})")
    else:
        print(f"  [info] No conformal calibration found — run: python -m src.evaluate")


@app.on_event("startup")
async def startup():
    _load_ensemble()


# ── inference helpers ─────────────────────────────────────────────────────────

def _fetch_raw(ticker: str, days: int = 400) -> pd.DataFrame:
    """Fetch at least `days` calendar days of OHLCV for `ticker`."""
    start = (date.today() - timedelta(days=days)).isoformat()
    end   = date.today().isoformat()
    f = DataFetcher(ticker, start, end)
    f.fetch_data()
    return f.data


def _ticker_idx(ticker: str, ticker_list: List[str]) -> int:
    try:
        return ticker_list.index(ticker.upper())
    except ValueError:
        # Unseen ticker: use index 0 as neutral fallback (SPY-like)
        return 0


@torch.no_grad()
def _ensemble_predict(
    seq: np.ndarray,      # (1, seq_len, N_FEATURES)
    ticker: str,
) -> tuple[np.ndarray, Optional[float]]:
    """Return ((H, Q) averaged over ensemble, prob_up or None)."""
    x = torch.tensor(seq, dtype=torch.float32).to(_device)  # (1, T, F)
    all_preds = []
    all_dir_probs = []
    for model, tlist in zip(_models, _ticker_lists):
        t = torch.tensor([_ticker_idx(ticker, tlist)], dtype=torch.long).to(_device)
        out = model(x, t)
        if isinstance(out, tuple):
            quant_out, dir_logits = out
            prob = float(torch.sigmoid(dir_logits).mean().cpu())
            all_dir_probs.append(prob)
            pred = quant_out.cpu().numpy()[0]
        else:
            pred = out.cpu().numpy()[0]
        all_preds.append(pred)
    mean_hq = np.mean(all_preds, axis=0)   # (H, Q)
    prob_up = float(np.mean(all_dir_probs)) if all_dir_probs else None
    return mean_hq, prob_up


def _log_ret_to_price(last_close: float, log_ret: float) -> float:
    return last_close * float(np.exp(log_ret))


def _direction_prob(p10: float, p50: float, p90: float) -> float:
    """Approximate P(return > 0) from 3 quantiles via linear interpolation."""
    if p10 >= 0:
        return 0.95
    if p90 <= 0:
        return 0.05
    if p50 >= 0:
        # zero is between p10 and p50
        span = p50 - p10
        if span < 1e-9:
            return 0.5
        frac = (p50 - 0) / span
        return 0.50 + frac * 0.40   # in [0.50, 0.90]
    else:
        # zero is between p50 and p90
        span = p90 - p50
        if span < 1e-9:
            return 0.5
        frac = (0 - p50) / span
        return 0.50 - frac * 0.40   # in [0.10, 0.50]


# ── schemas ───────────────────────────────────────────────────────────────────

class HorizonForecast(BaseModel):
    label:              str
    days:               int
    p10_ret:            float
    p50_ret:            float
    p90_ret:            float
    p10_price:          float
    p50_price:          float
    p90_price:          float
    direction:          str    # "up" | "down"
    direction_prob:     float  # 0–1
    prob_up:            float  # alias for direction_prob


class PredictRequest(BaseModel):
    ticker: str = "AAPL"


class PredictResponse(BaseModel):
    ticker:      str
    last_close:  float
    horizons:    List[HorizonForecast]
    model_count: int
    signal:      str    # "long" | "flat" | "short"
    tau_long:    float
    tau_short:   float


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": len(_models),
        "normalizer_loaded": _normalizer is not None,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if not _models or _normalizer is None:
        raise HTTPException(
            status_code=503,
            detail="Ensemble not loaded. Run bash scripts/train_all.sh first.",
        )

    ticker = req.ticker.strip().upper()

    # Need enough lookback: seq_len=90 trading days ≈ 135 calendar days,
    # plus RSI/EMA warmup, plus market-context fetch
    CAL_DAYS = 300

    try:
        # Fetch ticker + market context
        ohlcv   = _fetch_raw(ticker, days=CAL_DAYS)
        spy_df  = _fetch_raw("SPY",  days=CAL_DAYS)
        vix_df  = _fetch_raw("^VIX", days=CAL_DAYS)
        sec_sym = SECTOR_ETF.get(ticker, DEFAULT_SECTOR)
        try:
            sector_df = _fetch_raw(sec_sym, days=CAL_DAYS)
        except Exception:
            sector_df = None

        # Build features on the whole window (no future data involved at inference)
        raw_feats = build_raw_features(
            ohlcv, ticker,
            spy=spy_df,
            vix=vix_df,
            sector=sector_df,
        )
        if len(raw_feats) < 90:
            raise HTTPException(
                status_code=400,
                detail=f"Not enough history for {ticker} (got {len(raw_feats)} rows, need 90)."
            )

        feat_mat = _normalizer.transform(raw_feats)    # (T, F)
        last_seq = feat_mat[-90:][np.newaxis]           # (1, 90, F)
        last_close = float(ohlcv["Close"].iloc[-1])

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Data error: {exc}")

    try:
        pred_hq, ensemble_prob_up = _ensemble_predict(last_seq, ticker)   # (H, Q)  H=3, Q=3
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference error: {exc}")

    HORIZON_LABELS = {1: "1 Day", 5: "1 Week", 20: "1 Month"}
    horizons = []
    for hi, h in enumerate(HORIZONS):
        p10 = float(pred_hq[hi, 0])
        p50 = float(pred_hq[hi, 1])
        p90 = float(pred_hq[hi, 2])
        if _conformal:
            p10, p90 = _conformal.apply(p10, p90, h)
        if ensemble_prob_up is not None:
            dp = ensemble_prob_up
        else:
            dp = _direction_prob(p10, p50, p90)
        horizons.append(HorizonForecast(
            label=HORIZON_LABELS.get(h, f"{h}d"),
            days=h,
            p10_ret=round(p10, 5),
            p50_ret=round(p50, 5),
            p90_ret=round(p90, 5),
            p10_price=round(_log_ret_to_price(last_close, p10), 2),
            p50_price=round(_log_ret_to_price(last_close, p50), 2),
            p90_price=round(_log_ret_to_price(last_close, p90), 2),
            direction="up" if p50 >= 0 else "down",
            direction_prob=round(dp, 3),
            prob_up=round(dp, 3),
        ))

    # Signal based on 1-day prob_up and per-ticker thresholds
    ticker_thresh = _thresholds.get(ticker, {})
    tau_long  = float(ticker_thresh.get("long",  _TAU_LONG_DEFAULT))
    tau_short = float(ticker_thresh.get("short", _TAU_SHORT_DEFAULT))
    prob_up_1d = horizons[0].prob_up
    if prob_up_1d >= tau_long:
        signal = "long"
    elif prob_up_1d <= tau_short:
        signal = "short"
    else:
        signal = "flat"

    return PredictResponse(
        ticker=ticker,
        last_close=round(last_close, 2),
        horizons=horizons,
        model_count=len(_models),
        signal=signal,
        tau_long=tau_long,
        tau_short=tau_short,
    )


@app.get("/thresholds")
def get_thresholds():
    return _thresholds


def _fetch_ohlc_bars(ticker: str, days: int) -> list[dict]:
    end_ts   = int(pd.Timestamp(date.today()).timestamp())
    start_ts = int(pd.Timestamp(date.today() - timedelta(days=days)).timestamp())
    url = (
        f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?period1={start_ts}&period2={end_ts}&interval=1d"
    )
    r = _requests.get(url, headers=_YF_HEADERS, timeout=15)
    r.raise_for_status()
    payload    = r.json()
    result     = payload["chart"]["result"][0]
    timestamps = result["timestamp"]
    q          = result["indicators"]["quote"][0]
    ac         = result["indicators"]["adjclose"][0]["adjclose"]
    vols = q.get("volume", [])
    bars = []
    for i, ts in enumerate(timestamps):
        o, h, l, c, a = q["open"][i], q["high"][i], q["low"][i], q["close"][i], ac[i]
        if None in (o, h, l, c):
            continue
        ratio = (a / c) if c else 1.0
        vol   = vols[i] if i < len(vols) else None
        bars.append({
            "time":   pd.Timestamp(ts, unit="s").strftime("%Y-%m-%d"),
            "open":   round(o * ratio, 4),
            "high":   round(h * ratio, 4),
            "low":    round(l * ratio, 4),
            "close":  round(c * ratio, 4),
            "volume": int(vol) if vol is not None else 0,
        })
    return bars


@app.get("/history/{ticker}")
def history(ticker: str, range: str = Query("1m")):
    if range not in _RANGE_DAYS:
        raise HTTPException(400, detail=f"range must be one of {list(_RANGE_DAYS)}")
    try:
        bars = _fetch_ohlc_bars(ticker.upper(), _RANGE_DAYS[range])
        return {"ticker": ticker.upper(), "range": range, "data": bars}
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@app.get("/quote/{ticker}")
def quote(ticker: str):
    import time as _time
    url = (
        f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker.upper()}"
        "?range=1d&interval=1d"
    )
    try:
        r = _requests.get(url, headers=_YF_HEADERS, timeout=10)
        r.raise_for_status()
        payload = r.json()
        result  = payload["chart"]["result"][0]
        meta    = result["meta"]
        price      = meta.get("regularMarketPrice") or meta.get("previousClose", 0)
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose", price)
        change     = price - prev_close
        change_pct = (change / prev_close * 100) if prev_close else 0
        state = meta.get("marketState")
        if not state:
            now = _time.time()
            tp  = meta.get("currentTradingPeriod", {})
            reg = tp.get("regular", {})
            pre = tp.get("pre", {})
            if reg.get("start", 0) <= now < reg.get("end", 0):
                state = "REGULAR"
            elif pre.get("start", 0) <= now < reg.get("start", 0):
                state = "PRE"
            elif reg.get("end", 0) <= now < tp.get("post", {}).get("end", 0):
                state = "POST"
            else:
                state = "CLOSED"
        def _last(arr):
            for v in reversed(arr or []):
                if v is not None:
                    return v
            return None
        q_ind = result.get("indicators", {}).get("quote", [{}])[0]
        ac_ind = result.get("indicators", {}).get("adjclose", [{}])[0]
        raw_c = _last(q_ind.get("close", []))
        adj   = _last(ac_ind.get("adjclose", []))
        ratio = (adj / raw_c) if raw_c else 1.0
        ts_list = result.get("timestamp", [])
        today_ts = ts_list[-1] if ts_list else None
        return {
            "ticker":       ticker.upper(),
            "price":        round(price, 2),
            "change":       round(change, 2),
            "change_pct":   round(change_pct, 2),
            "prev_close":   round(prev_close, 2),
            "market_state": state,
            "name":         meta.get("shortName", ticker.upper()),
        }
    except Exception as e:
        raise HTTPException(400, detail=str(e))


# ── Portfolio / Backtest endpoints ───────────────────────────────────────────

@app.get("/backtest-report")
def backtest_report():
    global _backtest_report_cache
    if _backtest_report_cache is None:
        if not BACKTEST_REPORT.exists():
            return []
        import json as _json
        with open(BACKTEST_REPORT) as f:
            _backtest_report_cache = _json.load(f)
    return _backtest_report_cache


@app.get("/equity/{ticker}")
def equity(ticker: str):
    global _equity_curves_cache
    if not EQUITY_CURVES_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "equity_curves.json nicht gefunden. "
                "Führe python -m src.backtest aus, um es zu generieren."
            ),
        )
    if _equity_curves_cache is None:
        import json as _json
        with open(EQUITY_CURVES_PATH) as f:
            _equity_curves_cache = _json.load(f)
    t = ticker.upper()
    if t not in _equity_curves_cache:
        raise HTTPException(status_code=404, detail=f"Kein Equity-Verlauf für {t}.")
    return {"ticker": t, **_equity_curves_cache[t]}


# ── Static frontend ───────────────────────────────────────────────────────────

if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        # API routes are already matched above; everything else → SPA index
        idx = DIST_DIR / "index.html"
        if idx.exists():
            return FileResponse(str(idx))
        raise HTTPException(404, "Frontend not built. Run: cd web/frontend && npm run build")
