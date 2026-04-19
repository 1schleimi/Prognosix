"""
Baselines for multi-horizon log-return forecasting.

All baselines implement the same interface:
    predict(close_series) -> np.ndarray (T, H)

where T is the number of target dates and H = number of horizons (1, 5, 20).
They return point predictions only (no quantile spread), so when used in
evaluate.py all three quantile columns receive the same value.

Baselines:
  - Persistence: r = 0 (random-walk; any non-zero return is unexpected)
  - DriftMean:   r = rolling mean of recent 1d returns, scaled by horizon
  - EMATrend:    sign(EMA20 - EMA50) * tiny_bias per horizon
  - ARIMA:       statsmodels ARIMA(1,0,1) fitted on train window, recursive 1-step
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from typing import Tuple


HORIZONS: Tuple[int, ...] = (1, 5, 20)


def _log_returns(close: pd.Series) -> pd.Series:
    return np.log(close / close.shift(1)).fillna(0.0)


class Persistence:
    """Predict zero return (random-walk null hypothesis)."""

    name = "Persistence (r=0)"

    def predict(self, close: pd.Series) -> np.ndarray:
        T = len(close)
        return np.zeros((T, len(HORIZONS)), dtype=np.float32)


class DriftMean:
    """Predict rolling mean of 1d returns, scaled by horizon."""

    name = "Drift (rolling mean)"

    def __init__(self, window: int = 20):
        self.window = window

    def predict(self, close: pd.Series) -> np.ndarray:
        r = _log_returns(close)
        drift = r.rolling(self.window, min_periods=1).mean().to_numpy()
        out = np.stack([drift * h for h in HORIZONS], axis=1)
        return out.astype(np.float32)


class EMATrend:
    """Trend signal: sign(EMA20 - EMA50) scaled by long-run avg return."""

    name = "EMA Trend"

    def predict(self, close: pd.Series) -> np.ndarray:
        ema20 = close.ewm(span=20, adjust=False).mean()
        ema50 = close.ewm(span=50, adjust=False).mean()
        r = _log_returns(close)
        mu = r.mean()
        signal = np.sign((ema20 - ema50).to_numpy()) * abs(mu)
        out = np.stack([signal * h for h in HORIZONS], axis=1)
        return out.astype(np.float32)


class ARIMABaseline:
    """statsmodels ARIMA(1,0,1) on 1d log-returns.

    Train on `train_n` observations, then recursively predict 1-step ahead
    for the rest. Multi-horizon predictions are naive-scaled from 1d.
    """

    name = "ARIMA(1,0,1)"

    def __init__(self, train_n: int = 1000):
        self.train_n = train_n

    def predict(self, close: pd.Series) -> np.ndarray:
        try:
            from statsmodels.tsa.arima.model import ARIMA
        except ImportError:
            print("  [ARIMA] statsmodels not installed — returning zeros")
            return np.zeros((len(close), len(HORIZONS)), dtype=np.float32)

        r = _log_returns(close).to_numpy()
        T = len(r)
        preds_1d = np.zeros(T, dtype=np.float64)
        train_n = min(self.train_n, T // 2)

        for t in range(train_n, T):
            window = r[max(0, t - 500): t]
            try:
                m = ARIMA(window, order=(1, 0, 1)).fit()
                preds_1d[t] = m.forecast(steps=1)[0]
            except Exception:
                preds_1d[t] = r[t - 1]

        out = np.stack([preds_1d * h for h in HORIZONS], axis=1)
        return out.astype(np.float32)


ALL_BASELINES = [Persistence(), DriftMean(), EMATrend()]
# ARIMABaseline is slow; include only when explicitly requested.


if __name__ == "__main__":
    import sys
    sys.path.insert(0, __file__.rsplit("/", 2)[0] + "/src")
    from data_fetcher import DataFetcher

    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    f = DataFetcher(ticker, "2022-01-01", "2024-01-01")
    f.fetch_data()
    close = f.data["Close"]

    actual = np.stack([
        np.log(close.shift(-h) / close).to_numpy()
        for h in HORIZONS
    ], axis=1)[:-max(HORIZONS)]

    for bl in ALL_BASELINES + [ARIMABaseline(train_n=300)]:
        pred = bl.predict(close)[:-max(HORIZONS)]
        mae = np.nanmean(np.abs(pred - actual), axis=0)
        signs_ok = np.nanmean((np.sign(pred) == np.sign(actual)).astype(float), axis=0)
        print(f"\n{bl.name}")
        for i, h in enumerate(HORIZONS):
            print(f"  h={h:2d}d  MAE={mae[i]:.4f}  DirAcc={signs_ok[i]:.3f}")
