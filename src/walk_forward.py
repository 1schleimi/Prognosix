"""
Rolling Walk-Forward Backtest.

Splits the test window (2024-07 → 2025-12) into 6 sequential 3-month buckets.
For each bucket thresholds are calibrated on the preceding 6 months (or val set
for bucket 0), then the strategy is evaluated on that bucket.

No re-training — uses the already-trained ensemble checkpoints.

Outputs:
  data/walk_forward_report.json — per-bucket + aggregated metrics
  data/walk_forward.png         — heatmap of per-bucket/per-ticker Sharpe
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch

sys.path.insert(0, os.path.dirname(__file__))
from evaluate import load_ensemble, predict_ensemble
from dataset import SplitConfig, BuiltSplit, load_all_raw, build_split, HORIZONS
from backtest import _sharpe, _max_drawdown, _hit_rate, _make_signal, COST_BPS

BASE_DIR  = Path(__file__).parent.parent
DATA_DIR  = BASE_DIR / "data"

# 3-month buckets within the test window
BUCKETS: list[tuple[str, str]] = [
    ("2024-07-01", "2024-09-30"),
    ("2024-10-01", "2024-12-31"),
    ("2025-01-01", "2025-03-31"),
    ("2025-04-01", "2025-06-30"),
    ("2025-07-01", "2025-09-30"),
    ("2025-10-01", "2025-12-31"),
]
BUCKET_LABELS = ["2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]


def _calibrate_on_window(
    prob_up: np.ndarray,
    y_ret: np.ndarray,
    t_ids: np.ndarray,
    ticker_list: list[str],
    cost_bps: float = COST_BPS,
) -> dict[str, dict]:
    """2D grid over (τ_long, τ_short) maximising Sharpe on the given window."""
    tau_long_grid  = np.arange(0.50, 0.66, 0.02)
    tau_short_grid = np.arange(0.35, 0.51, 0.02)
    cost_per_trade = cost_bps / 10_000

    thresholds: dict[str, dict] = {}
    for ti, ticker in enumerate(ticker_list):
        mask = t_ids == ti
        if mask.sum() < 20:
            thresholds[ticker] = {"long": 0.55, "short": 0.45}
            continue
        pu = prob_up[mask]
        yr = y_ret[mask]
        best_sh = -1e9
        best_tl, best_ts = 0.55, 0.45
        for tl in tau_long_grid:
            for ts in tau_short_grid:
                if ts >= tl:
                    continue
                sig = np.where(pu > tl, 1, np.where(pu < ts, -1, 0)).astype(float)
                prev = np.roll(sig, 1); prev[0] = 0.0
                strat = sig * yr - np.abs(sig - prev) * cost_per_trade
                sh = _sharpe(strat)
                if sh > best_sh:
                    best_sh = sh
                    best_tl, best_ts = float(tl), float(ts)
        thresholds[ticker] = {"long": best_tl, "short": best_ts}
    return thresholds


def _eval_bucket(
    prob_up_h1: np.ndarray,
    y_ret: np.ndarray,
    t_ids: np.ndarray,
    dates: np.ndarray,
    ticker_list: list[str],
    thresholds: dict[str, dict],
    bucket_start: str,
    bucket_end: str,
    cost_bps: float = COST_BPS,
) -> dict:
    """Evaluate one bucket given pre-calibrated thresholds. Returns per-ticker stats."""
    cost_per_trade = cost_bps / 10_000
    d_start = np.datetime64(bucket_start, "D")
    d_end   = np.datetime64(bucket_end,   "D")
    bucket_mask = (dates >= d_start) & (dates <= d_end)

    results: dict[str, dict] = {}
    for ti, ticker in enumerate(ticker_list):
        mask = bucket_mask & (t_ids == ti)
        if mask.sum() < 5:
            results[ticker] = None
            continue
        thr = thresholds.get(ticker, {"long": 0.55, "short": 0.45})
        pu = prob_up_h1[mask]
        actual = y_ret[mask]
        signal = _make_signal(pu, thr["long"], thr["short"])
        prev = np.roll(signal, 1); prev[0] = 0.0
        strat_ret = signal * actual - np.abs(signal - prev) * cost_per_trade
        bh_ret = actual
        eq_s = np.cumprod(1 + strat_ret)
        eq_b = np.cumprod(1 + bh_ret)
        results[ticker] = {
            "sharpe":     _sharpe(strat_ret),
            "hit_rate":   _hit_rate(signal, actual),
            "long_frac":  float((signal == 1).mean()),
            "short_frac": float((signal == -1).mean()),
            "total_ret":  float(eq_s[-1] - 1),
            "bh_ret":     float(eq_b[-1] - 1),
            "beats_bh":   bool(eq_s[-1] > eq_b[-1]),
            "n_days":     int(mask.sum()),
        }
    return results


def run_walk_forward(cost_bps: float = COST_BPS):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print("\n── Loading ensemble ──")
    models, meta = load_ensemble(device)

    print("\n── Building split ──")
    cfg = SplitConfig()
    raw, market = load_all_raw(cfg)
    split = build_split(cfg, raw, market)

    if split.dates_test is None or len(split.dates_test) == 0:
        raise RuntimeError("split.dates_test is empty — rebuild split after dataset.py update.")

    print(f"  test samples: {len(split.x_test):,}  val: {len(split.x_val):,}")

    print("\n── Running ensemble inference on full test set ──")
    ens_test = predict_ensemble(models, split.x_test, split.t_test, device)
    prob_up_test = ens_test.prob_up[:, 0]
    y_test  = split.y_test.numpy()[:, 0]
    t_ids_test = split.t_test.numpy()
    dates_test = split.dates_test

    print("\n── Running ensemble inference on val set ──")
    ens_val = predict_ensemble(models, split.x_val, split.t_val, device)
    prob_up_val = ens_val.prob_up[:, 0]
    y_val = split.y_val.numpy()[:, 0]
    t_ids_val = split.t_val.numpy()
    dates_val = split.dates_val

    ticker_list = split.ticker_list
    bucket_reports = []

    for bi, (b_start, b_end) in enumerate(BUCKETS):
        label = BUCKET_LABELS[bi]
        print(f"\n── Bucket {bi}: {label} ──")

        # Calibration window
        if bi == 0:
            # Use val set (Jan–Jun 2024) for calibration of first bucket
            cal_pu = prob_up_val
            cal_yr = y_val
            cal_t  = t_ids_val
            cal_label = "val (Jan–Jun 2024)"
        else:
            # Use previous bucket samples from test set as calibration
            prev_start, prev_end = BUCKETS[bi - 1]
            d_ps = np.datetime64(prev_start, "D")
            d_pe = np.datetime64(prev_end,   "D")
            cal_mask = (dates_test >= d_ps) & (dates_test <= d_pe)
            cal_pu = prob_up_test[cal_mask]
            cal_yr = y_test[cal_mask]
            cal_t  = t_ids_test[cal_mask]
            cal_label = BUCKET_LABELS[bi - 1]

        print(f"  Calibration window: {cal_label}  ({len(cal_pu)} samples)")
        thresholds = _calibrate_on_window(cal_pu, cal_yr, cal_t, ticker_list, cost_bps)

        ticker_stats = _eval_bucket(
            prob_up_test, y_test, t_ids_test, dates_test,
            ticker_list, thresholds, b_start, b_end, cost_bps,
        )

        valid = [v for v in ticker_stats.values() if v is not None]
        if valid:
            sharpes  = [v["sharpe"]  for v in valid]
            beats    = sum(v["beats_bh"] for v in valid)
            avg_sh   = float(np.mean(sharpes))
            med_sh   = float(np.median(sharpes))
            avg_hr   = float(np.mean([v["hit_rate"] for v in valid if not np.isnan(v["hit_rate"])]))
        else:
            avg_sh = med_sh = avg_hr = float("nan")
            beats = 0

        bucket_reports.append({
            "bucket":       label,
            "start":        b_start,
            "end":          b_end,
            "cal_window":   cal_label,
            "avg_sharpe":   avg_sh,
            "median_sharpe": med_sh,
            "avg_hit_rate": avg_hr,
            "beats_bh":     beats,
            "n_tickers":    len(valid),
            "per_ticker":   ticker_stats,
        })
        print(f"  avg_sharpe={avg_sh:.2f}  median={med_sh:.2f}  "
              f"beats_bh={beats}/{len(valid)}  avg_hr={avg_hr:.3f}")

    # Aggregate over buckets
    agg_sharpes = [b["avg_sharpe"] for b in bucket_reports if not np.isnan(b["avg_sharpe"])]
    report = {
        "aggregate": {
            "mean_avg_sharpe":   float(np.mean(agg_sharpes)) if agg_sharpes else float("nan"),
            "median_avg_sharpe": float(np.median(agg_sharpes)) if agg_sharpes else float("nan"),
            "n_buckets":         len(bucket_reports),
        },
        "buckets": bucket_reports,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    report_path = DATA_DIR / "walk_forward_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n  Report → {report_path}")

    _plot(bucket_reports, ticker_list)
    return report


def _plot(bucket_reports: list, ticker_list: list[str]):
    n_buckets = len(bucket_reports)
    n_tickers = len(ticker_list)

    sharpe_matrix = np.full((n_buckets, n_tickers), float("nan"))
    for bi, br in enumerate(bucket_reports):
        for ti, ticker in enumerate(ticker_list):
            v = br["per_ticker"].get(ticker)
            if v is not None:
                sharpe_matrix[bi, ti] = v["sharpe"]

    fig, ax = plt.subplots(figsize=(max(12, n_tickers * 0.7), 4))
    vmax = np.nanpercentile(np.abs(sharpe_matrix), 95)
    im = ax.imshow(
        sharpe_matrix,
        aspect="auto",
        cmap="RdYlGn",
        vmin=-vmax,
        vmax=vmax,
        interpolation="nearest",
    )
    ax.set_xticks(range(n_tickers))
    ax.set_xticklabels(ticker_list, rotation=45, ha="right", fontsize=8)
    ax.set_yticks(range(n_buckets))
    ax.set_yticklabels(BUCKET_LABELS, fontsize=8)
    ax.set_title("Walk-Forward Sharpe (annualised) per Bucket × Ticker", fontsize=10)
    plt.colorbar(im, ax=ax, label="Sharpe")

    for bi in range(n_buckets):
        for ti in range(n_tickers):
            val = sharpe_matrix[bi, ti]
            if np.isfinite(val):
                ax.text(ti, bi, f"{val:.1f}", ha="center", va="center", fontsize=6,
                        color="black")

    plt.tight_layout()
    plot_path = DATA_DIR / "walk_forward.png"
    plt.savefig(plot_path, dpi=100, bbox_inches="tight")
    plt.close()
    print(f"  Plot → {plot_path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--cost-bps", type=float, default=COST_BPS)
    args = parser.parse_args()
    run_walk_forward(args.cost_bps)
