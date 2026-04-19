"""
Feature engineering + robust normalization for multi-ticker time-series.

Design:
  * Features are returns-based and stationary => no per-ticker MinMax on levels.
  * Normalization stats (median / IQR, per-feature, GLOBAL across train tickers)
    are fitted ONLY on the training slice, then applied to val/test.
  * Market-context features (SPY return, VIX level/delta, sector ETF return)
    are aligned to the ticker's trading calendar.

Public API:
  build_raw_features(df, ticker)            -> pd.DataFrame (one row per trading day)
  FeatureNormalizer.fit(frames)             -> stats dict {col: (median, iqr)}
  FeatureNormalizer.transform(df)           -> np.ndarray (T, F)
  FEATURE_COLUMNS                            -> ordered list of feature names
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd


# ── Ticker → sector-ETF mapping (for sector-return feature) ──
SECTOR_ETF: Dict[str, str] = {
    # Tech
    "AAPL": "XLK", "MSFT": "XLK", "NVDA": "XLK", "GOOGL": "XLK",
    "ADBE": "XLK", "CRM":  "XLK", "ORCL": "XLK", "INTC":  "XLK",
    "AMD":  "XLK", "QCOM": "XLK", "TXN":  "XLK", "AVGO":  "XLK",
    "AMAT": "XLK", "NOW":  "XLK", "PANW": "XLK", "CRWD":  "XLK",
    "NET":  "XLK", "DDOG": "XLK", "TEAM": "XLK", "WDAY":  "XLK",
    "SNOW": "XLK", "IBM":  "XLK", "MRVL": "XLK", "ZS":    "XLK",
    # Communication
    "META": "XLC", "NFLX": "XLC", "T":    "XLC", "VZ":    "XLC",
    "CMCSA":"XLC", "DIS":  "XLC", "SNAP": "XLC",
    # Consumer Discretionary
    "AMZN": "XLY", "TSLA": "XLY", "HD":   "XLY", "MCD":   "XLY",
    "SBUX": "XLY", "NKE":  "XLY", "TGT":  "XLY", "LOW":   "XLY",
    "F":    "XLY", "GM":   "XLY", "BKNG": "XLY", "ABNB":  "XLY",
    "UBER": "XLY",
    # Finance
    "JPM":   "XLF", "BAC":  "XLF", "GS":   "XLF", "V":    "XLF",
    "MS":    "XLF", "C":    "XLF", "WFC":  "XLF", "AXP":  "XLF",
    "BLK":   "XLF", "BRK-B":"XLF", "SCHW": "XLF", "MA":   "XLF",
    # Healthcare
    "JNJ":  "XLV", "UNH":  "XLV", "PFE":  "XLV", "MRK":  "XLV",
    "ABBV": "XLV", "LLY":  "XLV", "AMGN": "XLV", "GILD": "XLV",
    "ISRG": "XLV", "MDT":  "XLV", "REGN": "XLV", "VRTX": "XLV",
    "CVS":  "XLV",
    # Consumer Staples
    "PG":   "XLP", "PEP":  "XLP", "COST": "XLP", "CL":   "XLP",
    "MDLZ": "XLP", "KO":   "XLP", "WMT":  "XLP",
    # Energy
    "XOM":  "XLE", "CVX":  "XLE", "COP":  "XLE", "SLB":  "XLE",
    "EOG":  "XLE", "MPC":  "XLE", "VLO":  "XLE", "PSX":  "XLE",
    # Industrials
    "BA":   "XLI", "GE":   "XLI", "CAT":  "XLI", "DE":   "XLI",
    "HON":  "XLI", "RTX":  "XLI", "LMT":  "XLI", "UPS":  "XLI",
    "FDX":  "XLI",
    # Materials
    "LIN":  "XLB", "APD":  "XLB", "SHW":  "XLB", "FCX":  "XLB",
    "NEM":  "XLB",
    # Utilities
    "NEE":  "XLU", "DUK":  "XLU", "SO":   "XLU", "AEP":  "XLU",
    # Real Estate
    "PLD":  "XLRE", "AMT": "XLRE", "EQIX": "XLRE", "CCI": "XLRE",
    # ETFs map to SPY so the sector-return column is always defined.
    "SPY": "SPY", "QQQ": "SPY", "IWM": "SPY", "DIA": "SPY",
    "XLK": "SPY", "XLV": "SPY", "XLF": "SPY", "XLE": "SPY",
    "XLY": "SPY", "XLC": "SPY", "XLI": "SPY", "XLB": "SPY",
    "XLP": "SPY", "XLU": "SPY",
}
DEFAULT_SECTOR = "SPY"


FEATURE_COLUMNS: List[str] = [
    # price-derived (already stationary)
    "ret_1d",
    "ret_2d",
    "ret_3d",
    "ret_5d",
    "ret_10d",
    "hl_range",       # (high-low)/close
    "oc_gap",         # (close-open)/close
    # volume
    "log_vol",        # log(volume+1)
    "vol_ratio",      # volume / 20d-EMA
    # volatility
    "rv_10d",         # realized vol of 1d returns, 10-day rolling std
    "rv_20d",
    "atr_14",         # ATR(14) / close
    # trend / momentum
    "rsi_14",         # /100
    "macd_hist",      # normalized by close
    "ema_diff",       # (EMA20 - EMA50)/close
    "bb_pos",         # Bollinger position in [-1, 1]
    # market context
    "spy_ret_1d",
    "spy_ret_5d",
    "vix_level",      # /100
    "vix_delta",      # d(VIX)
    "sector_ret_1d",
    # regime / cross-sectional
    "spy_ret_20d",
    "spy_above_ma200",
    "vix_level_ma20",
    "vix_z20",
    "rv_ratio",
    "rel_strength_spy",
    "sector_rs",
    # calendar (already in [-1, 1] — NOT normalized)
    "dow_sin",
    "dow_cos",
    "moy_sin",
    "moy_cos",
]

N_FEATURES = len(FEATURE_COLUMNS)

# Calendar features and binary flags already bounded — skip normalization.
SKIP_NORM = {"dow_sin", "dow_cos", "moy_sin", "moy_cos", "spy_above_ma200"}


# ── Raw feature computation ──────────────────────────────────────────────────

def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    ag = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    al = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = ag / al.replace(0, 1e-9)
    return 100.0 - 100.0 / (1.0 + rs)


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def build_raw_features(
    df: pd.DataFrame,
    ticker: str,
    spy: Optional[pd.DataFrame] = None,
    vix: Optional[pd.DataFrame] = None,
    sector: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Compute RAW (unnormalized) feature matrix for one ticker.

    Market-context frames (spy, vix, sector) are OHLCV DataFrames indexed by date.
    Missing market frames yield zero-valued market features (reasonable fallback).
    """
    close = df["Close"].astype(float)
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    opn = df["Open"].astype(float)
    vol = df["Volume"].astype(float)

    out = pd.DataFrame(index=df.index)

    out["ret_1d"] = np.log(close / close.shift(1))
    out["ret_2d"] = np.log(close / close.shift(2))
    out["ret_3d"] = np.log(close / close.shift(3))
    out["ret_5d"] = np.log(close / close.shift(5))
    out["ret_10d"] = np.log(close / close.shift(10))

    safe_close = close.replace(0, np.nan)
    out["hl_range"] = (high - low) / safe_close
    out["oc_gap"] = (close - opn) / safe_close

    out["log_vol"] = np.log1p(vol)
    vol_ema20 = vol.ewm(span=20, adjust=False).mean().replace(0, np.nan)
    out["vol_ratio"] = vol / vol_ema20

    ret1 = out["ret_1d"]
    out["rv_10d"] = ret1.rolling(10, min_periods=5).std()
    out["rv_20d"] = ret1.rolling(20, min_periods=10).std()
    out["atr_14"] = _atr(high, low, close) / safe_close

    out["rsi_14"] = _rsi(close, 14) / 100.0

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    out["macd_hist"] = (macd - signal) / safe_close

    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()
    out["ema_diff"] = (ema20 - ema50) / safe_close

    bb_mid = close.rolling(20, min_periods=10).mean()
    bb_std = close.rolling(20, min_periods=10).std()
    out["bb_pos"] = ((close - bb_mid) / (2 * bb_std)).clip(-3, 3)

    # ── market context ──
    def _market_ret(frame: Optional[pd.DataFrame], n: int) -> pd.Series:
        if frame is None or frame.empty:
            return pd.Series(0.0, index=df.index)
        c = frame["Close"].astype(float).reindex(df.index).ffill()
        return np.log(c / c.shift(n))

    out["spy_ret_1d"] = _market_ret(spy, 1)
    out["spy_ret_5d"] = _market_ret(spy, 5)

    if vix is not None and not vix.empty:
        v = vix["Close"].astype(float).reindex(df.index).ffill()
        out["vix_level"] = v / 100.0
        out["vix_delta"] = v.diff() / 100.0
    else:
        out["vix_level"] = 0.0
        out["vix_delta"] = 0.0

    out["sector_ret_1d"] = _market_ret(sector, 1)

    # ── regime / cross-sectional ──
    out["spy_ret_20d"] = _market_ret(spy, 20)

    if spy is not None and not spy.empty:
        spy_close = spy["Close"].astype(float).reindex(df.index).ffill()
        spy_ma200 = spy_close.rolling(200, min_periods=100).mean()
        out["spy_above_ma200"] = (spy_close > spy_ma200).astype(float)
    else:
        out["spy_above_ma200"] = 0.5

    if vix is not None and not vix.empty:
        v = vix["Close"].astype(float).reindex(df.index).ffill()
        out["vix_level_ma20"] = v.rolling(20, min_periods=10).mean() / 100.0
        vix_roll_std = v.rolling(20, min_periods=10).std().replace(0, np.nan)
        out["vix_z20"] = ((v - v.rolling(20, min_periods=10).mean()) / vix_roll_std).clip(-4, 4)
    else:
        out["vix_level_ma20"] = 0.0
        out["vix_z20"] = 0.0

    rv10 = out["rv_10d"]
    rv20 = out["rv_20d"].replace(0, np.nan)
    out["rv_ratio"] = (rv10 / rv20).clip(0, 4)

    ret_20d_ticker = np.log(close / close.shift(20))
    spy_ret_20d_series = _market_ret(spy, 20)
    out["rel_strength_spy"] = ret_20d_ticker - spy_ret_20d_series

    ret_5d_ticker = out["ret_5d"]
    sector_ret_5d = _market_ret(sector, 5)
    out["sector_rs"] = ret_5d_ticker - sector_ret_5d

    # calendar
    dow = df.index.dayofweek.to_numpy()
    moy = df.index.month.to_numpy() - 1
    out["dow_sin"] = np.sin(2 * np.pi * dow / 5.0)
    out["dow_cos"] = np.cos(2 * np.pi * dow / 5.0)
    out["moy_sin"] = np.sin(2 * np.pi * moy / 12.0)
    out["moy_cos"] = np.cos(2 * np.pi * moy / 12.0)

    # replace inf, forward/backward-fill small NaN runs from rolling windows
    out = out.replace([np.inf, -np.inf], np.nan)
    out = out.ffill().fillna(0.0)

    # order matches FEATURE_COLUMNS
    return out[FEATURE_COLUMNS]


# ── Robust normalization ─────────────────────────────────────────────────────

@dataclass
class FeatureNormalizer:
    """Per-feature robust z-score: (x - median) / (1.4826 * MAD).

    Stats are fitted on the CONCATENATION of the training slices of all train
    tickers. Calendar columns are passed through untouched.
    """
    stats: Dict[str, Tuple[float, float]] = field(default_factory=dict)

    def fit(self, frames: Iterable[pd.DataFrame]) -> "FeatureNormalizer":
        stacked = pd.concat(list(frames), axis=0, ignore_index=True)
        self.stats = {}
        for col in FEATURE_COLUMNS:
            if col in SKIP_NORM:
                self.stats[col] = (0.0, 1.0)
                continue
            values = stacked[col].to_numpy(dtype=np.float64)
            values = values[np.isfinite(values)]
            if values.size == 0:
                self.stats[col] = (0.0, 1.0)
                continue
            med = float(np.median(values))
            mad = float(np.median(np.abs(values - med)))
            scale = 1.4826 * mad if mad > 1e-9 else float(np.std(values) or 1.0)
            self.stats[col] = (med, max(scale, 1e-6))
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        if not self.stats:
            raise RuntimeError("FeatureNormalizer must be fitted before transform().")
        cols = []
        for col in FEATURE_COLUMNS:
            med, scale = self.stats[col]
            if col in SKIP_NORM:
                cols.append(df[col].to_numpy(dtype=np.float32))
            else:
                z = (df[col].to_numpy(dtype=np.float64) - med) / scale
                # clip for robustness to outliers at inference time
                z = np.clip(z, -6.0, 6.0).astype(np.float32)
                cols.append(z)
        return np.column_stack(cols)

    # persistence
    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"stats": {k: list(v) for k, v in self.stats.items()},
                       "columns": FEATURE_COLUMNS}, f, indent=2)

    @classmethod
    def load(cls, path: str) -> "FeatureNormalizer":
        with open(path) as f:
            blob = json.load(f)
        self = cls()
        self.stats = {k: tuple(v) for k, v in blob["stats"].items()}
        return self


# ── self-test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    from data_fetcher import DataFetcher

    f = DataFetcher("AAPL", "2015-01-01", "2018-01-01")
    f.fetch_data()
    raw = build_raw_features(f.data, "AAPL")
    print(f"Raw features shape: {raw.shape}  (expected (T, {N_FEATURES}))")
    print(raw.describe().T[["mean", "std", "min", "max"]].round(3))
    assert np.isfinite(raw.to_numpy()).all(), "non-finite in raw features"

    norm = FeatureNormalizer().fit([raw.iloc[:500]])
    z = norm.transform(raw)
    print(f"\nNormalized shape: {z.shape}  mean/std per col:")
    print(pd.DataFrame(z, columns=FEATURE_COLUMNS).describe().T[["mean", "std"]].round(3))
    assert np.isfinite(z).all(), "non-finite in normalized features"
    print("\nOK")
