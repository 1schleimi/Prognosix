"""
Split Conformal Prediction calibration for quantile intervals.

Fits on val-set residuals (no data leakage), then shrinks/expands the
P10–P90 bands at inference time to hit the target 80% coverage.

Usage:
    # After evaluate.py runs, calibration is saved automatically.
    # To run standalone:
    python -m src.conformal
"""
from __future__ import annotations

import json
import numpy as np
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
CAL_PATH = BASE_DIR / "models" / "conformal_cal.json"

TARGET_COVERAGE = 0.80   # P10–P90 should cover 80%


class ConformalCalibrator:
    """Per-horizon symmetric conformal calibration for [q10, q90] intervals.

    Nonconformity score: s_i = max(q10_i - y_i,  y_i - q90_i)
      positive  → y outside band (nonconforming)
      negative  → y inside band

    The conformal offset q_hat is the (1-alpha) quantile of {s_i}.
    At test time: adjusted interval = [q10 - q_hat, q90 + q_hat].
    If q_hat < 0 the bands are shrunk (over-covering → our case).
    """

    def __init__(self, target_coverage: float = TARGET_COVERAGE):
        self.target_coverage = target_coverage
        self.offsets: dict[str, float] = {}

    def fit(
        self,
        pred_hq: np.ndarray,   # (N, H, Q)  Q=3: P10, P50, P90
        y: np.ndarray,         # (N, H)
        horizons: list[int],
    ) -> "ConformalCalibrator":
        n = len(y)
        alpha = 1.0 - self.target_coverage
        for hi, h in enumerate(horizons):
            q10 = pred_hq[:, hi, 0]
            q90 = pred_hq[:, hi, 2]
            scores = np.maximum(q10 - y[:, hi], y[:, hi] - q90)
            level = min(np.ceil((n + 1) * (1 - alpha)) / n, 1.0)
            self.offsets[f"h{h}"] = float(np.quantile(scores, level))
        return self

    def apply(self, q10: float, q90: float, horizon: int) -> tuple[float, float]:
        """Return calibrated (q10, q90) for a single forecast."""
        offset = self.offsets.get(f"h{horizon}", 0.0)
        return q10 - offset, q90 + offset

    def apply_batch(
        self, pred_hq: np.ndarray, horizons: list[int]
    ) -> np.ndarray:
        """Return calibrated pred_hq (N, H, Q) in-place copy."""
        out = pred_hq.copy()
        for hi, h in enumerate(horizons):
            offset = self.offsets.get(f"h{h}", 0.0)
            out[:, hi, 0] -= offset   # P10
            out[:, hi, 2] += offset   # P90
        return out

    def save(self, path: Path = CAL_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(
                {"offsets": self.offsets, "target_coverage": self.target_coverage},
                f, indent=2,
            )
        print(f"  Conformal calibration → {path}")
        for k, v in self.offsets.items():
            direction = "shrink" if v < 0 else "expand"
            print(f"    {k}: offset={v:+.5f}  ({direction} bands)")

    @classmethod
    def load(cls, path: Path = CAL_PATH) -> "ConformalCalibrator":
        with open(path) as f:
            blob = json.load(f)
        c = cls(target_coverage=blob.get("target_coverage", TARGET_COVERAGE))
        c.offsets = blob["offsets"]
        return c

    @classmethod
    def load_or_none(cls, path: Path = CAL_PATH) -> "ConformalCalibrator | None":
        if not path.exists():
            return None
        return cls.load(path)


if __name__ == "__main__":
    import os, sys
    sys.path.insert(0, os.path.dirname(__file__))
    import torch
    from dataset import SplitConfig, load_all_raw, build_split, HORIZONS
    from evaluate import load_ensemble, predict_ensemble

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print("\n── Loading ensemble ──")
    models, _ = load_ensemble(device)

    print("\n── Rebuilding val split ──")
    cfg = SplitConfig()
    raw, market = load_all_raw(cfg)
    split = build_split(cfg, raw, market)

    print("\n── Val inference ──")
    val_pred = predict_ensemble(models, split.x_val, split.t_val, device)
    y_val = split.y_val.numpy()

    print("\n── Fitting conformal calibration ──")
    cal = ConformalCalibrator()
    cal.fit(val_pred.quantiles, y_val, HORIZONS)
    cal.save()
