"""
Backtest on the test-window ensemble predictions.

Strategy (long/short/flat): positions ∈ {-1, 0, +1} based on calibrated
per-ticker thresholds (τ_long, τ_short).
  prob_up > τ_long  → +1 (long)
  prob_up < τ_short → -1 (short)
  otherwise         →  0 (flat)

Costs: 5 bps per unit of position change.
  e.g. -1 → +1 costs 2 × cost_per_trade.

Outputs:
  data/backtest.png         — equity curves grid
  data/backtest_report.json — per-ticker Sharpe, DrawDown, HitRate, vs B&H
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict, List

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from evaluate import load_ensemble, predict_ensemble
from dataset import SplitConfig, BuiltSplit, load_all_raw, build_split, HORIZONS

BASE_DIR        = Path(__file__).parent.parent
DATA_DIR        = BASE_DIR / "data"
THRESHOLDS_PATH = BASE_DIR / "models" / "thresholds.json"

THRESHOLD = 0.5   # fallback default (replaced by calibrated per-ticker thresholds)
COST_BPS  = 5.0   # cost per unit of position change (bps)


def _sharpe(daily_rets: np.ndarray, ann: int = 252) -> float:
    if daily_rets.std() < 1e-9:
        return 0.0
    return float(np.mean(daily_rets) / np.std(daily_rets) * np.sqrt(ann))


def _max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / (peak + 1e-9)
    return float(dd.min())


def _hit_rate(signal: np.ndarray, actual_ret: np.ndarray) -> float:
    active_days = signal != 0
    if active_days.sum() == 0:
        return float("nan")
    correct = np.sign(actual_ret[active_days]) == np.sign(signal[active_days])
    return float(np.mean(correct.astype(float)))


def calibrate_thresholds(
    models: list,
    split: BuiltSplit,
    device: torch.device,
    cost_bps: float = COST_BPS,
) -> dict[str, dict]:
    """2D grid-search (τ_long, τ_short) per ticker on val set to maximise Sharpe.

    Returns and persists {ticker: {"long": τ_l, "short": τ_s}} to
    models/thresholds.json.
    """
    horizon_idx = 1  # calibrate on h5 signal (better IC than h1)
    ens_pred = predict_ensemble(models, split.x_val, split.t_val, device)
    prob_up = ens_pred.prob_up[:, horizon_idx]
    y_val = split.y_val.numpy()[:, horizon_idx]
    t_ids = split.t_val.numpy()
    cost_per_trade = cost_bps / 10_000

    tau_long_grid  = np.arange(0.50, 0.70, 0.02)
    tau_short_grid = np.arange(0.38, 0.52, 0.02)

    thresholds: dict[str, dict] = {}
    for ti, ticker in enumerate(split.ticker_list):
        mask = t_ids == ti
        if mask.sum() < 30:
            thresholds[ticker] = {"long": 0.55, "short": 0.45}
            continue
        pu = prob_up[mask]
        yr = y_val[mask]
        best_sh = -1e9
        best_tl, best_ts = 0.55, 0.45
        for tl in tau_long_grid:
            for ts in tau_short_grid:
                if ts >= tl:
                    continue
                sig = np.where(pu > tl, 1, np.where(pu < ts, -1, 0)).astype(float)
                prev = np.roll(sig, 1); prev[0] = 0.0
                trades = np.abs(sig - prev)
                strat = sig * yr - trades * cost_per_trade
                sh = _sharpe(strat)
                if sh > best_sh:
                    best_sh = sh
                    best_tl, best_ts = float(tl), float(ts)
        thresholds[ticker] = {"long": best_tl, "short": best_ts}

    THRESHOLDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(THRESHOLDS_PATH, "w") as f:
        json.dump(thresholds, f, indent=2)
    print(f"  Thresholds → {THRESHOLDS_PATH}")
    return thresholds


def _load_thresholds() -> dict:
    if not THRESHOLDS_PATH.exists():
        return {}
    with open(THRESHOLDS_PATH) as f:
        data = json.load(f)
    # Support legacy format {ticker: float} from old single-threshold files
    out = {}
    for k, v in data.items():
        if isinstance(v, dict):
            out[k] = v
        else:
            out[k] = {"long": float(v), "short": 1.0 - float(v)}
    return out


def _make_signal(prob_up: np.ndarray, tau_long: float, tau_short: float) -> np.ndarray:
    return np.where(prob_up > tau_long, 1, np.where(prob_up < tau_short, -1, 0)).astype(float)


def run_backtest(threshold: float = THRESHOLD, cost_bps: float = COST_BPS):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    models, _ = load_ensemble(device)
    cfg = SplitConfig()
    raw, market = load_all_raw(cfg)
    split = build_split(cfg, raw, market)

    print(f"\nTest samples: {len(split.x_test):,}  |  cost={cost_bps}bps")

    if THRESHOLDS_PATH.exists():
        ticker_thresholds = _load_thresholds()
        print(f"  Loaded thresholds from {THRESHOLDS_PATH}")
    else:
        print("  Calibrating thresholds on val set...")
        ticker_thresholds = calibrate_thresholds(models, split, device, cost_bps)

    ens_pred = predict_ensemble(models, split.x_test, split.t_test, device)
    pred_hq = ens_pred.quantiles
    horizon_idx = 1  # h5: best IC of the model
    prob_up = ens_pred.prob_up[:, horizon_idx]
    y = split.y_test.numpy()

    ticker_list = split.ticker_list
    n_tickers = len(ticker_list)
    t_ids = split.t_test.numpy()

    results: List[Dict] = []
    h = HORIZONS[horizon_idx]

    n_cols = 4
    n_rows = int(np.ceil(n_tickers / n_cols))
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(4 * n_cols, 3 * n_rows))
    axes = axes.flatten()
    cost_per_trade = cost_bps / 10_000

    for ti, ticker in enumerate(ticker_list):
        mask = t_ids == ti
        if mask.sum() < 30:
            axes[ti].set_visible(False)
            continue

        thr = ticker_thresholds.get(ticker, {"long": threshold, "short": 1.0 - threshold})
        tau_l = thr["long"]
        tau_s = thr["short"]
        pu = prob_up[mask]
        actual = y[mask, horizon_idx]

        signal = _make_signal(pu, tau_l, tau_s)
        prev_signal = np.roll(signal, 1)
        prev_signal[0] = 0.0
        trades = np.abs(signal - prev_signal)

        strat_ret = signal * actual - trades * cost_per_trade
        bh_ret = actual

        equity_strat = np.cumprod(1 + strat_ret)
        equity_bh    = np.cumprod(1 + bh_ret)

        res = {
            "ticker":      ticker,
            "is_holdout":  ticker in cfg.holdout_tickers,
            "n_days":      int(mask.sum()),
            "sharpe":      _sharpe(strat_ret),
            "max_dd":      _max_drawdown(equity_strat),
            "hit_rate":    _hit_rate(signal, actual),
            "total_ret":   float(equity_strat[-1] - 1),
            "bh_ret":      float(equity_bh[-1] - 1),
            "beats_bh":    bool(equity_strat[-1] > equity_bh[-1]),
            "long_frac":   float((signal == 1).mean()),
            "short_frac":  float((signal == -1).mean()),
            "tau_long":    tau_l,
            "tau_short":   tau_s,
        }
        results.append(res)

        ax = axes[ti]
        ax.plot(equity_strat, label="Strategy", linewidth=1.2)
        ax.plot(equity_bh,    label="Buy & Hold", linewidth=1.0, alpha=0.7)
        tag = "HOLDOUT" if res["is_holdout"] else ""
        ax.set_title(
            f"{ticker} {tag}\nSharpe={res['sharpe']:.2f}  DD={res['max_dd']:.1%}  "
            f"L={res['long_frac']:.0%}/S={res['short_frac']:.0%}",
            fontsize=7,
        )
        ax.legend(fontsize=6)
        ax.tick_params(labelsize=6)

    for j in range(n_tickers, len(axes)):
        axes[j].set_visible(False)

    plt.suptitle(
        f"Backtest — h={h}d  L/S/F strategy  cost={cost_bps}bps",
        fontsize=10, y=1.01,
    )
    plt.tight_layout()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    plot_path = DATA_DIR / "backtest.png"
    plt.savefig(plot_path, dpi=100, bbox_inches="tight")
    plt.close()
    print(f"  Equity plot → {plot_path}")

    beats = sum(r["beats_bh"] for r in results)
    avg_sharpe = np.mean([r["sharpe"] for r in results])
    print(f"\n  Beats B&H: {beats}/{len(results)}  |  Avg Sharpe: {avg_sharpe:.2f}")
    for r in results:
        tag = "[HOLD]" if r["is_holdout"] else ""
        print(
            f"  {r['ticker']:6s}{tag}  Sharpe={r['sharpe']:5.2f}  "
            f"DD={r['max_dd']:5.1%}  HitRate={r['hit_rate']:.2f}  "
            f"ret={r['total_ret']:+.1%} vs B&H {r['bh_ret']:+.1%}  "
            f"beats={'✓' if r['beats_bh'] else '✗'}  "
            f"L={r['long_frac']:.0%}/S={r['short_frac']:.0%}"
        )

    out_path = DATA_DIR / "backtest_report.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  Report → {out_path}")

    save_equity_curves(split, ticker_thresholds, ens_pred, threshold, cost_bps)

    return results


def save_equity_curves(split, ticker_thresholds, ens_pred, threshold=THRESHOLD, cost_bps=COST_BPS):
    """Save per-ticker equity curves to data/equity_curves.json."""
    prob_up = ens_pred.prob_up[:, 1]  # h5
    y = split.y_test.numpy()
    ticker_list = split.ticker_list
    t_ids = split.t_test.numpy()
    cost_per_trade = cost_bps / 10_000
    horizon_idx = 1

    curves = {}
    for ti, ticker in enumerate(ticker_list):
        mask = t_ids == ti
        if mask.sum() < 2:
            continue
        thr = ticker_thresholds.get(ticker, {"long": threshold, "short": 1.0 - threshold})
        pu = prob_up[mask]
        actual = y[mask, horizon_idx]
        signal = _make_signal(pu, thr["long"], thr["short"])
        prev_signal = np.roll(signal, 1); prev_signal[0] = 0.0
        trades = np.abs(signal - prev_signal)
        strat_ret = signal * actual - trades * cost_per_trade
        equity_strat = np.cumprod(1 + strat_ret).tolist()
        equity_bh = np.cumprod(1 + actual).tolist()
        dates = split.dates_test[mask].tolist() if hasattr(split, 'dates_test') and split.dates_test is not None else list(range(len(equity_strat)))
        curves[ticker] = {
            "dates":    [str(d) for d in dates],
            "strategy": [round(v, 6) for v in equity_strat],
            "buy_hold": [round(v, 6) for v in equity_bh],
        }

    eq_path = DATA_DIR / "equity_curves.json"
    with open(eq_path, "w") as f:
        json.dump(curves, f)
    print(f"  Equity curves → {eq_path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=THRESHOLD)
    parser.add_argument("--cost-bps", type=float, default=COST_BPS)
    args = parser.parse_args()
    run_backtest(args.threshold, args.cost_bps)
