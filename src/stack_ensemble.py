"""
Stacking script: fit per-model weights on validation predictions.

Run AFTER training all checkpoints:
    python -m src.stack_ensemble

Outputs:
    models/ensemble_weights.json  — {"quantile_weights": [...], "direction_weights": [...]}

Algorithm:
  - Load all M checkpoints, generate val predictions (M, N_val, H, Q) and (M, N_val, H).
  - For quantile weights: Non-negative Ridge on P50 (h=1) -> y_val, then L1-normalize.
  - For direction weights: IC (Spearman rank correlation) between prob_up (h=1) and
    sign(y_val), clipped to [0, inf) and L1-normalized. Avoids a second sklearn fit.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge

sys.path.insert(0, os.path.dirname(__file__))
from evaluate import load_ensemble, predict_ensemble, WEIGHTS_PATH
from dataset import SplitConfig, load_all_raw, build_split

BASE_DIR = Path(__file__).parent.parent


def _ic(pred: np.ndarray, true: np.ndarray) -> float:
    mask = np.isfinite(pred) & np.isfinite(true)
    if mask.sum() < 10:
        return 0.0
    return float(spearmanr(pred[mask], true[mask]).statistic)


def compute_stacking_weights(
    models: list,
    split,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (quantile_weights, direction_weights) both of shape (M,)."""
    M = len(models)
    N = split.x_val.size(0)

    all_p50 = []   # (M, N)
    all_pu  = []   # (M, N)

    for model in models:
        from evaluate import EnsemblePred
        # predict one model at a time by wrapping it in a single-model list
        pred = predict_ensemble([model], split.x_val, split.t_val, device)
        all_p50.append(pred.quantiles[:, 0, 1])  # h=1 P50
        all_pu.append(pred.prob_up[:, 0])         # h=1 prob_up

    y_val = split.y_val.numpy()[:, 0]  # h=1 actual returns

    # ── quantile weights via Non-Negative Ridge ──
    X_q = np.stack(all_p50, axis=1)  # (N, M)
    ridge = Ridge(alpha=1.0, fit_intercept=False)
    ridge.fit(X_q, y_val)
    q_weights = np.clip(ridge.coef_, 0, None).astype(np.float32)
    q_sum = q_weights.sum()
    if q_sum < 1e-9:
        q_weights = np.ones(M, dtype=np.float32) / M
    else:
        q_weights /= q_sum

    # ── direction weights via val IC ──
    d_ics = np.array([_ic(pu, (y_val > 0).astype(float)) for pu in all_pu])
    d_weights = np.clip(d_ics, 0, None).astype(np.float32)
    d_sum = d_weights.sum()
    if d_sum < 1e-9:
        d_weights = np.ones(M, dtype=np.float32) / M
    else:
        d_weights /= d_sum

    return q_weights, d_weights


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print("\n── Loading ensemble ──")
    models, meta = load_ensemble(device)
    M = len(models)
    print(f"  {M} checkpoints loaded")

    print("\n── Rebuilding val split ──")
    cfg = SplitConfig()
    raw, market = load_all_raw(cfg)
    split = build_split(cfg, raw, market)
    print(f"  val samples: {len(split.x_val):,}")

    print("\n── Computing stacking weights ──")
    q_weights, d_weights = compute_stacking_weights(models, split, device)

    for i, info in enumerate(meta):
        print(f"  {info['model']} seed={info['seed']}  "
              f"q_weight={q_weights[i]:.4f}  d_weight={d_weights[i]:.4f}")

    WEIGHTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    blob = {
        "quantile_weights": q_weights.tolist(),
        "direction_weights": d_weights.tolist(),
        "model_paths": [info["path"] for info in meta],
    }
    with open(WEIGHTS_PATH, "w") as f:
        json.dump(blob, f, indent=2)
    print(f"\n  Ensemble weights → {WEIGHTS_PATH}")


if __name__ == "__main__":
    main()
