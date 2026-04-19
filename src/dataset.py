"""
Multi-ticker, multi-horizon time-series dataset.

Targets: log-returns at horizons {1, 5, 20} days  →  y shape (N, 3).
Sequence length: 90 trading days (default).
Ticker identity is provided as a per-sample integer index for ticker-embedding.

Split rules (enforced here to prevent leakage):
  * Train:   dates in [train_start, train_end]
  * Val:     dates in (train_end,  val_end]
  * Test:    dates in (val_end,    test_end]
  * HOLDOUT tickers: only appear in VAL and TEST; never in TRAIN.

FeatureNormalizer.fit() is called on TRAIN slices only. This module never
touches val/test when fitting stats.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

from data_fetcher import DataFetcher
from features import (
    FEATURE_COLUMNS,
    N_FEATURES,
    SECTOR_ETF,
    DEFAULT_SECTOR,
    FeatureNormalizer,
    build_raw_features,
)


HORIZONS: Tuple[int, ...] = (1, 5, 20)
N_HORIZONS = len(HORIZONS)


# ── Config ───────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SplitConfig:
    train_start: str = "2019-01-01"
    train_end:   str = "2023-12-31"
    val_end:     str = "2024-12-31"
    test_end:    str = "2025-12-31"
    sequence_len: int = 90
    # Tickers seen during training (+ val + test).
    train_tickers: Tuple[str, ...] = (
        # Tech (XLK)
        "AAPL", "MSFT", "NVDA", "GOOGL", "ADBE", "CRM", "ORCL", "INTC",
        "AMD", "QCOM", "TXN", "AVGO", "AMAT", "NOW", "PANW", "CRWD",
        "NET", "DDOG", "TEAM", "WDAY", "SNOW", "IBM",
        # Communication (XLC)
        "META", "NFLX", "T", "VZ", "CMCSA", "DIS",
        # Consumer Discretionary (XLY)
        "AMZN", "TSLA", "HD", "MCD", "SBUX", "NKE", "TGT", "LOW",
        "F", "GM", "BKNG", "ABNB", "UBER",
        # Finance (XLF)
        "JPM", "BAC", "GS", "V", "MS", "C", "WFC", "AXP", "BLK", "BRK-B", "SCHW",
        # Healthcare (XLV)
        "JNJ", "UNH", "PFE", "MRK", "ABBV", "LLY", "AMGN", "GILD",
        "ISRG", "MDT", "REGN", "VRTX",
        # Consumer Staples (XLP)
        "PG", "PEP", "COST", "CL", "MDLZ",
        # Energy (XLE)
        "XOM", "CVX", "COP", "SLB", "EOG", "MPC", "VLO",
        # Industrials (XLI)
        "BA", "GE", "CAT", "DE", "HON", "RTX", "LMT", "UPS", "FDX",
        # Materials (XLB)
        "LIN", "APD", "SHW", "FCX", "NEM",
        # Utilities (XLU)
        "NEE", "DUK", "SO", "AEP",
        # Real Estate (XLRE)
        "PLD", "AMT", "EQIX",
        # Broad & sector ETFs (mapped to SPY in SECTOR_ETF)
        "SPY", "QQQ", "IWM", "DIA",
        "XLK", "XLV", "XLF", "XLE", "XLY", "XLC", "XLI", "XLB", "XLP", "XLU",
    )
    # Never seen in training — only appear in val/test to measure generalization.
    holdout_tickers: Tuple[str, ...] = (
        "KO", "WMT", "MA",        # staples + finance (original)
        "MRVL", "ZS",             # tech
        "CVS",                    # healthcare
        "PSX",                    # energy
        "SNAP",                   # communication
        "CCI",                    # real estate
    )

    @property
    def all_tickers(self) -> Tuple[str, ...]:
        return tuple(self.train_tickers) + tuple(self.holdout_tickers)


# ── Raw data loading ─────────────────────────────────────────────────────────

def _fetch_one(ticker: str, start: str, end: str) -> pd.DataFrame:
    f = DataFetcher(ticker, start, end)
    f.fetch_data()
    return f.data


def load_all_raw(
    cfg: SplitConfig,
) -> Tuple[Dict[str, pd.DataFrame], Dict[str, pd.DataFrame]]:
    """Fetch OHLCV for all tickers + market-context series.

    Returns (per-ticker raw OHLCV, market dict with keys 'SPY', 'VIX', sector-ETFs).
    """
    start = cfg.train_start
    end = cfg.test_end
    raw: Dict[str, pd.DataFrame] = {}
    for t in cfg.all_tickers:
        print(f"  [{t}] fetch {start} → {end}")
        raw[t] = _fetch_one(t, start, end)

    # Market context
    market: Dict[str, pd.DataFrame] = {}
    for m in ["SPY", "^VIX"] + sorted({SECTOR_ETF.get(t, DEFAULT_SECTOR) for t in cfg.all_tickers}):
        key = "VIX" if m == "^VIX" else m
        if key in market:
            continue
        print(f"  [market:{m}] fetch")
        try:
            market[key] = _fetch_one(m, start, end)
        except Exception as exc:
            print(f"    [market:{m}] failed — zero-fill will be used  ({exc})")
            market[key] = pd.DataFrame()
    return raw, market


def _sector_frame(ticker: str, market: Dict[str, pd.DataFrame]) -> Optional[pd.DataFrame]:
    sec = SECTOR_ETF.get(ticker, DEFAULT_SECTOR)
    return market.get(sec)


# ── Build per-ticker feature+target frame ────────────────────────────────────

def build_ticker_frame(
    ticker: str,
    ohlcv: pd.DataFrame,
    market: Dict[str, pd.DataFrame],
) -> pd.DataFrame:
    """Return a DataFrame indexed by date with feature columns + target columns
    'y_h1', 'y_h5', 'y_h20' (log-returns)."""
    feats = build_raw_features(
        ohlcv, ticker,
        spy=market.get("SPY"),
        vix=market.get("VIX"),
        sector=_sector_frame(ticker, market),
    )
    close = ohlcv["Close"].astype(float)
    for h in HORIZONS:
        feats[f"y_h{h}"] = np.log(close.shift(-h) / close)
    return feats


# ── Split & sequence building ────────────────────────────────────────────────

def _slice(df: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    return df.loc[(df.index >= start) & (df.index <= end)]


def _build_sequences(
    feats: np.ndarray,           # (T, F)
    targets: np.ndarray,          # (T, H)
    ticker_idx: int,
    seq_len: int,
    max_horizon: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Windowed sequences. We require seq_len history + max_horizon future for targets."""
    T = feats.shape[0]
    max_i = T - max_horizon          # last valid t where all horizons are defined
    start_i = seq_len                 # earliest t with full history
    if max_i <= start_i:
        return (np.empty((0, seq_len, feats.shape[1]), dtype=np.float32),
                np.empty((0, targets.shape[1]), dtype=np.float32),
                np.empty((0,), dtype=np.int64))
    n = max_i - start_i
    x = np.stack([feats[i - seq_len:i] for i in range(start_i, max_i)], axis=0)
    y = targets[start_i:max_i]
    tid = np.full((n,), ticker_idx, dtype=np.int64)
    # drop rows with non-finite targets
    mask = np.isfinite(y).all(axis=1)
    return x[mask].astype(np.float32), y[mask].astype(np.float32), tid[mask]


# ── Public builder ───────────────────────────────────────────────────────────

@dataclass
class BuiltSplit:
    x_train: torch.Tensor
    y_train: torch.Tensor
    t_train: torch.Tensor
    x_val:   torch.Tensor
    y_val:   torch.Tensor
    t_val:   torch.Tensor
    x_test:  torch.Tensor
    y_test:  torch.Tensor
    t_test:  torch.Tensor
    ticker_list: List[str]            # index → ticker
    holdout_mask_val:  torch.Tensor   # bool, which val samples are from holdout tickers
    holdout_mask_test: torch.Tensor
    normalizer: FeatureNormalizer
    dates_val:  np.ndarray = None     # (N_val,) of np.datetime64, target date per sample
    dates_test: np.ndarray = None     # (N_test,) of np.datetime64, target date per sample


def build_split(
    cfg: SplitConfig,
    raw: Dict[str, pd.DataFrame],
    market: Dict[str, pd.DataFrame],
) -> BuiltSplit:
    ticker_list = list(cfg.all_tickers)
    ticker_to_idx = {t: i for i, t in enumerate(ticker_list)}
    holdout_set = set(cfg.holdout_tickers)
    max_h = max(HORIZONS)

    # Build full feature+target frame per ticker
    frames: Dict[str, pd.DataFrame] = {}
    for t in ticker_list:
        frames[t] = build_ticker_frame(t, raw[t], market)

    # Fit normalizer on TRAIN slice of TRAIN tickers ONLY
    train_slices = [
        _slice(frames[t], cfg.train_start, cfg.train_end)[FEATURE_COLUMNS]
        for t in cfg.train_tickers
    ]
    normalizer = FeatureNormalizer().fit(train_slices)

    # Now build sequences per ticker for each split
    xs_tr, ys_tr, ts_tr = [], [], []
    xs_va, ys_va, ts_va, hv, dv = [], [], [], [], []
    xs_te, ys_te, ts_te, ht, dt = [], [], [], [], []

    for t in ticker_list:
        idx = ticker_to_idx[t]
        df = frames[t]
        target_cols = [f"y_h{h}" for h in HORIZONS]

        def _pack(slice_start: str, slice_end: str):
            sl = _slice(df, slice_start, slice_end)
            if len(sl) < cfg.sequence_len + max_h + 1:
                return None
            fmat = normalizer.transform(sl[FEATURE_COLUMNS])
            tmat = sl[target_cols].to_numpy(dtype=np.float32)
            return _build_sequences(fmat, tmat, idx, cfg.sequence_len, max_h)

        is_holdout = t in holdout_set

        if not is_holdout:
            tr = _pack(cfg.train_start, cfg.train_end)
            if tr is not None:
                x, y, ti = tr
                xs_tr.append(x); ys_tr.append(y); ts_tr.append(ti)

        # Val/Test windows need enough lookback → pull seq_len back from window start
        def _back(date: str) -> str:
            return (pd.Timestamp(date) - pd.Timedelta(days=cfg.sequence_len * 2)).date().isoformat()

        va_full = _pack(_back(cfg.train_end), cfg.val_end)
        if va_full is not None:
            # Only keep sequences whose target date falls inside the val window
            x, y, ti = va_full
            # reconstruct target dates
            sl = _slice(df, _back(cfg.train_end), cfg.val_end)
            target_dates = sl.index[cfg.sequence_len: len(sl) - max_h]
            finite = np.isfinite(sl[target_cols].to_numpy()[cfg.sequence_len: len(sl) - max_h]).all(axis=1)
            target_dates = target_dates[finite]
            in_val = (target_dates > pd.Timestamp(cfg.train_end)) & (target_dates <= pd.Timestamp(cfg.val_end))
            if in_val.any():
                xs_va.append(x[in_val]); ys_va.append(y[in_val]); ts_va.append(ti[in_val])
                hv.append(np.full(in_val.sum(), is_holdout, dtype=bool))
                dv.append(target_dates[in_val].values.astype("datetime64[D]"))

        te_full = _pack(_back(cfg.val_end), cfg.test_end)
        if te_full is not None:
            x, y, ti = te_full
            sl = _slice(df, _back(cfg.val_end), cfg.test_end)
            target_dates = sl.index[cfg.sequence_len: len(sl) - max_h]
            finite = np.isfinite(sl[target_cols].to_numpy()[cfg.sequence_len: len(sl) - max_h]).all(axis=1)
            target_dates = target_dates[finite]
            in_test = (target_dates > pd.Timestamp(cfg.val_end)) & (target_dates <= pd.Timestamp(cfg.test_end))
            if in_test.any():
                xs_te.append(x[in_test]); ys_te.append(y[in_test]); ts_te.append(ti[in_test])
                ht.append(np.full(in_test.sum(), is_holdout, dtype=bool))
                dt.append(target_dates[in_test].values.astype("datetime64[D]"))

    def _cat(xs, ys, ts, masks=None):
        if not xs:
            empty_x = torch.empty((0, cfg.sequence_len, N_FEATURES), dtype=torch.float32)
            empty_y = torch.empty((0, N_HORIZONS), dtype=torch.float32)
            empty_t = torch.empty((0,), dtype=torch.long)
            empty_m = torch.empty((0,), dtype=torch.bool)
            return empty_x, empty_y, empty_t, empty_m
        x = torch.from_numpy(np.concatenate(xs, axis=0))
        y = torch.from_numpy(np.concatenate(ys, axis=0))
        t = torch.from_numpy(np.concatenate(ts, axis=0))
        m = torch.from_numpy(np.concatenate(masks, axis=0)) if masks is not None else torch.zeros(len(x), dtype=torch.bool)
        return x, y, t, m

    x_train, y_train, t_train, _ = _cat(xs_tr, ys_tr, ts_tr)
    x_val,   y_val,   t_val,   mv = _cat(xs_va, ys_va, ts_va, hv)
    x_test,  y_test,  t_test,  mt = _cat(xs_te, ys_te, ts_te, ht)

    dates_val  = np.concatenate(dv,  axis=0) if dv  else np.empty((0,), dtype="datetime64[D]")
    dates_test = np.concatenate(dt,  axis=0) if dt  else np.empty((0,), dtype="datetime64[D]")

    return BuiltSplit(
        x_train=x_train, y_train=y_train, t_train=t_train,
        x_val=x_val, y_val=y_val, t_val=t_val,
        x_test=x_test, y_test=y_test, t_test=t_test,
        ticker_list=ticker_list,
        holdout_mask_val=mv, holdout_mask_test=mt,
        normalizer=normalizer,
        dates_val=dates_val,
        dates_test=dates_test,
    )


class MultiTickerDataset(Dataset):
    def __init__(self, x: torch.Tensor, y: torch.Tensor, t: torch.Tensor):
        assert len(x) == len(y) == len(t)
        self.x = x; self.y = y; self.t = t

    def __len__(self) -> int:
        return self.x.size(0)

    def __getitem__(self, i: int):
        return self.x[i], self.t[i], self.y[i]


if __name__ == "__main__":
    cfg = SplitConfig(
        train_tickers=("AAPL", "MSFT"),
        holdout_tickers=("KO",),
    )
    raw, market = load_all_raw(cfg)
    split = build_split(cfg, raw, market)
    print(f"train: x={tuple(split.x_train.shape)}  y={tuple(split.y_train.shape)}  t={tuple(split.t_train.shape)}")
    print(f"val  : x={tuple(split.x_val.shape)}    holdout={split.holdout_mask_val.sum().item()}")
    print(f"test : x={tuple(split.x_test.shape)}   holdout={split.holdout_mask_test.sum().item()}")
    print(f"tickers: {split.ticker_list}")
