"""
DataFetcher — OHLCV downloader.

The primary API for the new multi-horizon model is:
    fetch_data()           → populates self.data (raw OHLCV DataFrame)
    prepare_for_inference  → deprecated; kept for legacy compatibility only

New pipeline (src/features.py, src/dataset.py) handles all feature engineering
and normalization without data leakage.
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
import torch
import os

N_FEATURES = 9

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com",
}


def _macd_norm(close: pd.Series) -> pd.Series:
    ema12  = close.ewm(span=12, adjust=False).mean()
    ema26  = close.ewm(span=26, adjust=False).mean()
    macd   = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist   = (macd - signal) / close.replace(0, 1e-9)
    return (hist.clip(-0.05, 0.05) / 0.05 + 1) / 2   # → [0, 1]


def _atr_norm(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = tr.ewm(span=period, adjust=False).mean()
    return (atr / close.replace(0, 1e-9)).clip(0, 0.10) / 0.10   # → [0, 1]


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    ag = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    al = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = ag / al.replace(0, 1e-9)
    return 100.0 - 100.0 / (1.0 + rs)


class DataFetcher:
    def __init__(self, ticker, start_date, end_date, sequence_length=90):
        self.ticker          = ticker.upper()
        self.start_date      = start_date
        self.end_date        = end_date
        self.sequence_length = sequence_length

        self.close_scaler = MinMaxScaler(feature_range=(0, 1))
        self.scaler       = self.close_scaler   # backward-compat alias

        self.data   = None   # raw OHLCV DataFrame
        self._mat   = None   # normalised feature matrix (N, N_FEATURES)

    # ── public API ────────────────────────────────────────────────────────────

    def fetch_data(self):
        """Fetch OHLCV. Falls back to synthetic GBM if all live sources fail."""
        df = self._try_yahoo_direct()
        if df is None:
            df = self._try_yfinance()
        if df is None:
            print(f"  All live sources failed for {self.ticker} – using synthetic GBM.")
            df = self._synthetic_gbm()

        self.data = df
        print(f"  {self.ticker}: {len(self.data)} rows  "
              f"({self.data.index[0].date()} … {self.data.index[-1].date()})")
        return self.data

    def preprocess_data(self):
        """Compute features, fit close scaler, build LSTM sequences.
        Returns (X, y) tensors shaped (N, seq_len, N_FEATURES) and (N,)."""
        if self.data is None:
            self.fetch_data()

        mat = self._build_feature_matrix()    # sets self._mat & self.close_scaler
        x, y = [], []
        for i in range(self.sequence_length, len(mat)):
            x.append(mat[i - self.sequence_length : i])
            y.append(mat[i, 0])               # target = next normalised close

        x, y = np.array(x), np.array(y)
        return (
            torch.tensor(x, dtype=torch.float32),
            torch.tensor(y, dtype=torch.float32),
        )

    def get_last_sequence(self):
        """Return the final sequence tensor (1, seq_len, N_FEATURES).
        Requires preprocess_data() or prepare_for_inference() to have been called."""
        if self._mat is None:
            raise RuntimeError("Call preprocess_data() or prepare_for_inference() first.")
        last = self._mat[-self.sequence_length :]
        return torch.tensor(last[np.newaxis], dtype=torch.float32)

    def prepare_for_inference(self):
        """Convenience wrapper: fetch → preprocess → return (x_input, last_close)."""
        self.fetch_data()
        self.preprocess_data()
        last_close = float(self.data["Close"].iloc[-1])
        x_input    = self.get_last_sequence()
        return x_input, last_close

    # ── internals ─────────────────────────────────────────────────────────────

    def _build_feature_matrix(self):
        df    = self.data
        close = df["Close"].astype(float)
        high  = df["High"].astype(float)
        low   = df["Low"].astype(float)
        opn   = df["Open"].astype(float)
        vol   = df["Volume"].astype(float)

        # --- derived series ---
        ret1d     = close.pct_change().clip(-0.15, 0.15).fillna(0.0)
        hl_ratio  = ((high - low) / close.replace(0, 1e-9)).clip(0, 0.20)
        oc_ratio  = ((close - opn) / close.replace(0, 1e-9)).clip(-0.10, 0.10)
        vol_ma20  = vol.rolling(20, min_periods=1).mean().replace(0, 1e-9)
        vol_ratio = (vol / vol_ma20).clip(0, 5) / 5.0
        rsi14     = _rsi(close, 14) / 100.0
        ema20     = close.ewm(span=20, adjust=False).mean()
        ema50     = close.ewm(span=50, adjust=False).mean()
        ema_diff  = ((ema20 - ema50) / close.replace(0, 1e-9)).clip(-0.10, 0.10) + 0.10
        macd_f    = _macd_norm(close)
        atr_f     = _atr_norm(high, low, close)

        feat = pd.DataFrame({
            "close":     close,
            "ret1d":     ret1d,
            "hl_ratio":  hl_ratio,
            "oc_ratio":  oc_ratio,
            "vol_ratio": vol_ratio,
            "rsi14":     rsi14,
            "ema_diff":  ema_diff,
            "macd":      macd_f,
            "atr":       atr_f,
        }).dropna()

        # fit & transform close column
        close_vals = feat["close"].values.reshape(-1, 1)
        self.close_scaler.fit(close_vals)
        self.scaler = self.close_scaler

        mat = np.column_stack([
            self.close_scaler.transform(close_vals).ravel(),
            feat["ret1d"].values,
            feat["hl_ratio"].values,
            feat["oc_ratio"].values,
            feat["vol_ratio"].values,
            feat["rsi14"].values,
            feat["ema_diff"].values,
            feat["macd"].values,
            feat["atr"].values,
        ]).astype(np.float32)

        self._mat = mat
        return mat

    # ── data sources ──────────────────────────────────────────────────────────

    def _try_yahoo_direct(self):
        try:
            import requests

            start_ts = int(pd.Timestamp(self.start_date).timestamp())
            end_ts   = int(pd.Timestamp(self.end_date).timestamp())
            url = (
                f"https://query2.finance.yahoo.com/v8/finance/chart/{self.ticker}"
                f"?period1={start_ts}&period2={end_ts}&interval=1d"
            )
            r = requests.get(url, headers=_HEADERS, timeout=15)
            r.raise_for_status()
            payload = r.json()

            result     = payload["chart"]["result"][0]
            timestamps = result["timestamp"]
            q          = result["indicators"]["quote"][0]
            ac         = result["indicators"]["adjclose"][0]["adjclose"]

            rows = []
            for i, ts in enumerate(timestamps):
                o, h, l, c, a = (
                    q["open"][i], q["high"][i], q["low"][i],
                    q["close"][i], ac[i],
                )
                v = q.get("volume", [None] * len(timestamps))[i]
                if None in (o, h, l, c, a):
                    continue
                ratio = a / c if c else 1.0
                rows.append({
                    "Date":   pd.Timestamp(ts, unit="s"),
                    "Open":   o * ratio,
                    "High":   h * ratio,
                    "Low":    l * ratio,
                    "Close":  a,
                    "Volume": int(v) if v is not None else 0,
                })

            if not rows:
                raise ValueError("empty response")

            df = (pd.DataFrame(rows)
                    .dropna(subset=["Close"])
                    .set_index("Date")
                    .sort_index())
            df.index = df.index.tz_localize(None)

            print(f"[yahoo-direct] {self.ticker}: OK – {len(df)} rows")
            return df

        except Exception as e:
            print(f"[yahoo-direct] {self.ticker}: failed – {e}")
            return None

    def _try_yfinance(self):
        try:
            import yfinance as yf

            t  = yf.Ticker(self.ticker)
            df = t.history(start=self.start_date, end=self.end_date, auto_adjust=True)
            if df.empty:
                raise ValueError("empty")
            df.index = pd.to_datetime(df.index).tz_localize(None)
            df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
            print(f"[yfinance] {self.ticker}: OK – {len(df)} rows")
            return df

        except Exception as e:
            print(f"[yfinance] {self.ticker}: failed – {e}")
            return None

    def _synthetic_gbm(self):
        seed  = sum(ord(c) for c in self.ticker)
        rng   = np.random.default_rng(seed)
        dates = pd.bdate_range(self.start_date, self.end_date)
        n     = len(dates)
        S0    = 50.0 + (seed % 450)
        mu, sig = 0.0003, 0.015

        rets   = rng.normal(mu, sig, n)
        closes = S0 * np.exp(np.cumsum(rets))
        opens  = closes * (1 + rng.normal(0, 0.003, n))
        highs  = np.maximum(opens, closes) * (1 + np.abs(rng.normal(0, 0.005, n)))
        lows   = np.minimum(opens, closes) * (1 - np.abs(rng.normal(0, 0.005, n)))
        vols   = (rng.integers(1_000_000, 50_000_000, n)).astype(float)

        return pd.DataFrame(
            {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": vols},
            index=dates,
        )


if __name__ == "__main__":
    for t in ["AAPL", "NVDA", "MSFT"]:
        f = DataFetcher(t, "2022-01-01", "2024-01-01")
        x, y = f.preprocess_data()
        print(f"{t}  X:{x.shape}  y:{y.shape}  last_close:{f.data['Close'].iloc[-1]:.2f}\n")
