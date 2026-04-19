"""
Ensemble evaluation on the held-out test set.

Loads all available checkpoints in models/ensemble/, averages quantile
predictions across models, then computes metrics vs baselines.

Outputs:
  data/eval_report.json   — machine-readable metrics
  data/eval_report.md     — human-readable table
  data/plots/             — per-horizon quantile-band plots, calibration chart
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, NamedTuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch

sys.path.insert(0, os.path.dirname(__file__))
from dataset import (
    SplitConfig, BuiltSplit, MultiTickerDataset,
    load_all_raw, build_split, HORIZONS, N_HORIZONS, N_FEATURES,
)
from losses import QUANTILES, N_QUANTILES
from models.lstm_v2 import LSTMv2
from models.patchtst import PatchTST
from baselines import ALL_BASELINES, ARIMABaseline
from conformal import ConformalCalibrator, CAL_PATH

BASE_DIR          = Path(__file__).parent.parent
ENSEMBLE_DIR      = BASE_DIR / "models" / "ensemble"
DATA_DIR          = BASE_DIR / "data"
PLOTS_DIR         = DATA_DIR / "plots"
STATS_PATH        = BASE_DIR / "models" / "feature_stats.json"
WEIGHTS_PATH      = BASE_DIR / "models" / "ensemble_weights.json"


class EnsemblePred(NamedTuple):
    quantiles: np.ndarray  # (N, H, Q)
    prob_up: np.ndarray    # (N, H)


# ── Ensemble loading ─────────────────────────────────────────────────────────

def _load_one(path: str, device: torch.device) -> tuple[torch.nn.Module, dict]:
    ckpt = torch.load(path, map_location=device, weights_only=False)
    name = ckpt["model_name"]
    n_tickers = ckpt["n_tickers"]
    if name == "lstm_v2":
        m = LSTMv2(n_features=ckpt["n_features"], n_tickers=n_tickers)
    elif name == "patchtst":
        m = PatchTST(n_features=ckpt["n_features"], n_tickers=n_tickers,
                     seq_len=ckpt["seq_len"])
    else:
        raise ValueError(f"Unknown model name in checkpoint: {name!r}")
    state = {k.replace("_orig_mod.", "", 1): v for k, v in ckpt["model_state"].items()}
    m.load_state_dict(state)
    m.eval().to(device)
    return m, ckpt


def load_ensemble(device: torch.device):
    paths = sorted(ENSEMBLE_DIR.glob("*.pth"))
    if not paths:
        raise FileNotFoundError(f"No checkpoints in {ENSEMBLE_DIR}. Run train_all.sh first.")
    models, meta = [], []
    for p in paths:
        m, ckpt = _load_one(str(p), device)
        models.append(m)
        meta.append({"path": str(p), "model": ckpt["model_name"],
                     "seed": ckpt["seed"], "val_loss": ckpt["best_val"]})
        print(f"  Loaded {p.name}  val={ckpt['best_val']:.5f}")
    return models, meta


# ── Inference ────────────────────────────────────────────────────────────────

def _load_ensemble_weights() -> tuple[np.ndarray | None, np.ndarray | None]:
    """Load per-model quantile and direction weights from disk; return (None, None) if absent."""
    if not WEIGHTS_PATH.exists():
        return None, None
    with open(WEIGHTS_PATH) as f:
        blob = json.load(f)
    q_w = np.array(blob["quantile_weights"], dtype=np.float32)
    d_w = np.array(blob["direction_weights"], dtype=np.float32)
    return q_w, d_w


@torch.no_grad()
def predict_ensemble(
    models: list,
    x: torch.Tensor,
    t: torch.Tensor,
    device: torch.device,
    batch: int = 2048,
) -> EnsemblePred:
    """Returns EnsemblePred(quantiles (N,H,Q), prob_up (N,H)) averaged over ensemble members.

    If models/ensemble_weights.json exists the per-model weights are applied;
    otherwise uniform averaging is used.
    """
    import torch.nn.functional as F

    N = x.size(0)
    all_q: list[np.ndarray] = []
    all_d: list[np.ndarray] = []

    for model in models:
        q_preds, d_preds = [], []
        for i in range(0, N, batch):
            xb = x[i:i+batch].to(device)
            tb = t[i:i+batch].to(device)
            q_out, d_out = model(xb, tb)
            q_preds.append(q_out.cpu().numpy())
            d_preds.append(torch.sigmoid(d_out).cpu().numpy())
        all_q.append(np.concatenate(q_preds, axis=0))   # (N, H, Q)
        all_d.append(np.concatenate(d_preds, axis=0))   # (N, H)

    q_w, d_w = _load_ensemble_weights()
    M = len(models)

    if q_w is not None and len(q_w) == M:
        q_w = q_w / q_w.sum()
        quantiles = sum(w * q for w, q in zip(q_w, all_q))
    else:
        quantiles = np.mean(all_q, axis=0)

    if d_w is not None and len(d_w) == M:
        d_w = d_w / d_w.sum()
        prob_up = sum(w * d for w, d in zip(d_w, all_d))
    else:
        prob_up = np.mean(all_d, axis=0)

    return EnsemblePred(quantiles=quantiles, prob_up=prob_up)


# ── Metrics ──────────────────────────────────────────────────────────────────

def _mae(pred, true): return float(np.nanmean(np.abs(pred - true)))
def _rmse(pred, true): return float(np.sqrt(np.nanmean((pred - true) ** 2)))
def _dir_acc(pred, true): return float(np.nanmean((np.sign(pred) == np.sign(true)).astype(float)))
def _ic(pred, true):
    from scipy.stats import spearmanr
    mask = np.isfinite(pred) & np.isfinite(true)
    if mask.sum() < 10:
        return float("nan")
    return float(spearmanr(pred[mask], true[mask]).statistic)


def _crps_from_quantiles(
    q10: np.ndarray, q50: np.ndarray, q90: np.ndarray, y: np.ndarray
) -> float:
    """Approximate CRPS from 3 quantiles via trapezoidal integration."""
    loss = (
        (0.10 - (y < q10)) * (q10 - y) +
        (0.50 - (y < q50)) * (q50 - y) +
        (0.90 - (y < q90)) * (q90 - y)
    )
    return float(np.nanmean(loss * 2))


def _coverage(q10, q90, y):
    return float(np.nanmean(((y >= q10) & (y <= q90)).astype(float)))


def compute_metrics(
    pred_hq: np.ndarray,  # (N, H, Q)
    y: np.ndarray,        # (N, H)
    label: str,
) -> Dict:
    result = {"model": label}
    for hi, h in enumerate(HORIZONS):
        y_h = y[:, hi]
        p50 = pred_hq[:, hi, 1]
        p10 = pred_hq[:, hi, 0]
        p90 = pred_hq[:, hi, 2]
        result[f"h{h}_mae"]      = _mae(p50, y_h)
        result[f"h{h}_rmse"]     = _rmse(p50, y_h)
        result[f"h{h}_dir_acc"]  = _dir_acc(p50, y_h)
        result[f"h{h}_ic"]       = _ic(p50, y_h)
        result[f"h{h}_crps"]     = _crps_from_quantiles(p10, p50, p90, y_h)
        result[f"h{h}_coverage"] = _coverage(p10, p90, y_h)
    return result


def baseline_pred_to_hq(pred_h: np.ndarray) -> np.ndarray:
    """Convert (N, H) point prediction to (N, H, Q) with same value for all Q."""
    return np.stack([pred_h] * N_QUANTILES, axis=-1)


# ── Plots ────────────────────────────────────────────────────────────────────

def _plot_bands(pred_hq, y, horizon_idx, title):
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    hi = horizon_idx
    h = HORIZONS[hi]
    n = min(300, len(y))
    x = np.arange(n)
    plt.figure(figsize=(14, 4))
    plt.fill_between(x, pred_hq[:n, hi, 0], pred_hq[:n, hi, 2],
                     alpha=0.25, label="P10–P90 band")
    plt.plot(x, pred_hq[:n, hi, 1], label="P50", linewidth=1.2)
    plt.plot(x, y[:n, hi], label="Actual", linewidth=1.0, alpha=0.8)
    plt.xlabel("Test samples (first 300)")
    plt.ylabel(f"Log-return h={h}d")
    plt.title(title)
    plt.legend()
    plt.tight_layout()
    path = PLOTS_DIR / f"band_h{h}d.png"
    plt.savefig(path, dpi=100)
    plt.close()


def _plot_calibration(pred_hq, y):
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    qs = np.linspace(0.05, 0.95, 19)
    coverages = []
    for hi in range(N_HORIZONS):
        cov_row = []
        for q in qs:
            lo = np.quantile(pred_hq[:, hi, 0], q)
            hi_ = np.quantile(pred_hq[:, hi, 2], 1 - q)
            cov_row.append(np.mean((y[:, hi] >= lo) & (y[:, hi] <= hi_)))
        coverages.append(cov_row)
    plt.figure(figsize=(6, 5))
    for i, h in enumerate(HORIZONS):
        plt.plot(qs, coverages[i], label=f"h={h}d")
    plt.plot([0, 1], [0, 1], "--", color="gray", label="perfect")
    plt.xlabel("Expected coverage"); plt.ylabel("Actual coverage")
    plt.title("Quantile calibration")
    plt.legend(); plt.tight_layout()
    plt.savefig(PLOTS_DIR / "calibration.png", dpi=100)
    plt.close()


# ── Main ─────────────────────────────────────────────────────────────────────

def evaluate(use_arima: bool = False):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print("\n── Loading ensemble ──")
    models, meta = load_ensemble(device)

    print("\n── Rebuilding test split ──")
    cfg = SplitConfig()
    raw, market = load_all_raw(cfg)
    split = build_split(cfg, raw, market)
    split.normalizer.save(str(STATS_PATH))

    print(f"  test samples: {len(split.x_test):,}  "
          f"(holdout: {split.holdout_mask_test.sum().item()})")

    print("\n── Ensemble inference ──")
    ens_pred = predict_ensemble(models, split.x_test, split.t_test, device)
    pred_hq = ens_pred.quantiles
    y = split.y_test.numpy()

    # ── Conformal calibration (fit on val, apply to test) ──
    print("\n── Conformal calibration (val set) ──")
    val_pred = predict_ensemble(models, split.x_val, split.t_val, device)
    conformal = ConformalCalibrator()
    conformal.fit(val_pred.quantiles, split.y_val.numpy(), list(HORIZONS))
    conformal.save(CAL_PATH)
    pred_hq_cal = conformal.apply_batch(pred_hq, list(HORIZONS))

    # ── Metrics table ──
    rows: List[Dict] = []

    # Ensemble (uncalibrated)
    rows.append(compute_metrics(pred_hq, y, "Ensemble"))
    # Ensemble (conformal-calibrated)
    rows.append(compute_metrics(pred_hq_cal, y, "Ensemble (conformal)"))

    # Holdout-only subset
    hm = split.holdout_mask_test.numpy().astype(bool)
    if hm.any():
        rows.append(compute_metrics(pred_hq[hm], y[hm], "Ensemble (holdout tickers)"))

    # Baselines — per-ticker sample counts from the actual split (fixes alignment bug)
    t_test_np = split.t_test.numpy()
    ticker_test_counts = [int((t_test_np == ti).sum()) for ti in range(len(split.ticker_list))]

    bl_list = ALL_BASELINES + ([ARIMABaseline(train_n=500)] if use_arima else [])
    for bl in bl_list:
        from data_fetcher import DataFetcher
        bl_preds = []
        ok = True
        for ti, ticker in enumerate(split.ticker_list):
            n_ticker = ticker_test_counts[ti]
            if n_ticker == 0:
                bl_preds.append(np.zeros((0, len(HORIZONS)), dtype=np.float32))
                continue
            try:
                f = DataFetcher(ticker, cfg.train_start, cfg.test_end)
                f.fetch_data()
                close = f.data["Close"]
                p_h = bl.predict(close)
                if len(p_h) < n_ticker:
                    ok = False
                    break
                bl_preds.append(p_h[-n_ticker:].astype(np.float32))
            except Exception:
                ok = False
                break
        if not ok or not bl_preds:
            continue
        bl_arr = np.concatenate(bl_preds, axis=0)
        if len(bl_arr) != len(y):
            continue
        rows.append(compute_metrics(
            baseline_pred_to_hq(bl_arr),
            y,
            bl.name,
        ))

    # ── Save report ──
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    report_path = DATA_DIR / "eval_report.json"
    with open(report_path, "w") as f:
        json.dump({"metrics": rows, "ensemble": meta}, f, indent=2)
    print(f"\n  Report → {report_path}")

    # Markdown table
    _print_md_table(rows)
    md_path = DATA_DIR / "eval_report.md"
    with open(md_path, "w") as f:
        f.write(_md_table_str(rows))

    # Plots
    for hi in range(N_HORIZONS):
        _plot_bands(pred_hq, y, hi, f"Ensemble — h={HORIZONS[hi]}d")
    _plot_calibration(pred_hq, y)
    print(f"  Plots → {PLOTS_DIR}")

    return rows


def _md_table_str(rows: List[Dict]) -> str:
    cols = ["model"] + [f"h{h}_{m}" for h in HORIZONS
                        for m in ["mae", "dir_acc", "crps", "coverage"]]
    header = "| " + " | ".join(cols) + " |"
    sep = "| " + " | ".join(["---"] * len(cols)) + " |"
    lines = [header, sep]
    for r in rows:
        vals = []
        for c in cols:
            v = r.get(c, "")
            if isinstance(v, float):
                v = f"{v:.4f}"
            vals.append(str(v))
        lines.append("| " + " | ".join(vals) + " |")
    return "\n".join(lines) + "\n"


def _print_md_table(rows):
    print("\n── Metrics vs Baselines ──")
    print(_md_table_str(rows))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--arima", action="store_true",
                        help="Include ARIMA baseline (slow ~10 min)")
    args = parser.parse_args()
    evaluate(use_arima=args.arima)
