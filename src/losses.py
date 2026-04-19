"""
Pinball (quantile) loss for multi-horizon probabilistic forecasting.

Model output shape: (B, H, Q)  where H = num horizons, Q = num quantiles.
Target shape:       (B, H)
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


QUANTILES = (0.1, 0.5, 0.9)
N_QUANTILES = len(QUANTILES)


class MultiHorizonPinballLoss(nn.Module):
    """Average pinball loss across all horizons and quantiles.

    Args:
        quantiles: ascending sequence in (0, 1), default (0.1, 0.5, 0.9).
        horizon_weights: optional per-horizon weights (e.g. down-weight far horizon).
    """
    def __init__(
        self,
        quantiles: tuple[float, ...] = QUANTILES,
        horizon_weights: tuple[float, ...] | None = None,
    ):
        super().__init__()
        q = torch.tensor(quantiles, dtype=torch.float32)   # (Q,)
        self.register_buffer("q", q)
        if horizon_weights is not None:
            hw = torch.tensor(horizon_weights, dtype=torch.float32)
            hw = hw / hw.sum()
        else:
            hw = None
        self.horizon_weights = hw

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """
        pred:   (B, H, Q)
        target: (B, H)
        """
        B, H, Q = pred.shape
        y = target.unsqueeze(-1)           # (B, H, 1)
        err = y - pred                      # (B, H, Q)
        q = self.q.view(1, 1, Q)           # (1, 1, Q)
        # Pinball: τ·max(e,0) + (1-τ)·max(-e,0)
        loss = torch.where(err >= 0, q * err, (q - 1) * err)  # (B, H, Q)
        # mean over batch and quantiles
        loss = loss.mean(dim=0).mean(dim=-1)    # (H,)
        if self.horizon_weights is not None:
            hw = self.horizon_weights.to(loss.device)
            return (loss * hw).sum()
        return loss.mean()


def _multi_horizon_pinball(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Functional pinball, returns scalar. pred: (B,H,Q), target: (B,H)."""
    B, H, Q = pred.shape
    q = torch.tensor([0.1, 0.5, 0.9], dtype=pred.dtype, device=pred.device).view(1, 1, Q)
    err = target.unsqueeze(-1) - pred
    loss = torch.where(err >= 0, q * err, (q - 1) * err)
    return loss.mean()


class DirectionAwarePinballLoss(nn.Module):
    """Pinball + directional BCE on explicit logits + quantile-crossing penalty.

    Expects model forward to return (quantiles, direction_logits):
        quantiles:        (B, H, Q)
        direction_logits: (B, H)   raw logits from the direction head
    target: (B, H)

    h1_dir_boost up-weights the first horizon (most relevant for trading signal).
    """

    def __init__(
        self,
        dir_weight: float = 0.3,
        cross_weight: float = 0.1,
        h1_dir_boost: float = 1.0,
    ):
        super().__init__()
        self.dir_weight = dir_weight
        self.cross_weight = cross_weight
        self.h1_dir_boost = h1_dir_boost

    def forward(
        self,
        quantiles: torch.Tensor,
        dir_logits: torch.Tensor,
        target: torch.Tensor,
    ) -> torch.Tensor:
        """
        quantiles:  (B, H, Q)
        dir_logits: (B, H)
        target:     (B, H)
        """
        H = quantiles.shape[1]
        pinball = _multi_horizon_pinball(quantiles, target)

        dir_target = (target > 0).float()
        dir_loss = F.binary_cross_entropy_with_logits(
            dir_logits, dir_target, reduction="none"
        )  # (B, H)
        boost = torch.ones(H, dtype=quantiles.dtype, device=quantiles.device)
        boost[0] = self.h1_dir_boost
        dir_loss = (dir_loss * boost).mean()

        # Quantile ordering: P10 <= P50 <= P90
        cross = (
            F.relu(quantiles[..., 0] - quantiles[..., 1]).mean()
            + F.relu(quantiles[..., 1] - quantiles[..., 2]).mean()
        )

        return pinball + self.dir_weight * dir_loss + self.cross_weight * cross


class SharpeLoss(nn.Module):
    """Differentiable negative Sharpe via soft positions (tanh of dir_logits).

    soft_position = tanh(dir_logits * scale) ∈ (-1, +1)
    strat_ret     = soft_position * y_true   (per sample per horizon)
    Sharpe per horizon = mean / (std + eps), averaged across horizons.
    Loss = -mean_horizon_sharpe  (minimise → maximise Sharpe).

    Works best with large batches (≥ 512). At batch=1024 variance is stable.

    Args:
        scale: steepness of tanh; higher → harder position (more binary).
        eps:   numerical stability term in denominator.
    """

    def __init__(self, scale: float = 5.0, eps: float = 1e-6):
        super().__init__()
        self.scale = scale
        self.eps = eps

    def forward(
        self,
        quantiles: torch.Tensor,   # (B, H, Q) — not used, kept for uniform API
        dir_logits: torch.Tensor,  # (B, H)
        target: torch.Tensor,      # (B, H)
    ) -> torch.Tensor:
        soft_pos = torch.tanh(dir_logits * self.scale)   # (B, H)
        strat_ret = soft_pos * target                     # (B, H)
        sharpe_per_h = strat_ret.mean(dim=0) / (strat_ret.std(dim=0) + self.eps)  # (H,)
        return -sharpe_per_h.mean()


class CompositeLoss(nn.Module):
    """Weighted combination of DirectionAwarePinballLoss and SharpeLoss.

    loss = pinball_w * pinball_loss + sharpe_w * sharpe_loss

    The cross_weight passed here is forwarded to the inner
    DirectionAwarePinballLoss (quantile-crossing penalty weight).
    """

    def __init__(
        self,
        pinball_w: float = 1.0,
        sharpe_w:  float = 0.5,
        cross_w:   float = 0.1,
    ):
        super().__init__()
        self.pinball_w = pinball_w
        self.sharpe_w  = sharpe_w
        self._pinball = DirectionAwarePinballLoss(cross_weight=cross_w)
        self._sharpe  = SharpeLoss()

    def forward(
        self,
        quantiles:  torch.Tensor,  # (B, H, Q)
        dir_logits: torch.Tensor,  # (B, H)
        target:     torch.Tensor,  # (B, H)
    ) -> torch.Tensor:
        l_pin = self._pinball(quantiles, dir_logits, target)
        l_sh  = self._sharpe(quantiles, dir_logits, target)
        return self.pinball_w * l_pin + self.sharpe_w * l_sh


if __name__ == "__main__":
    torch.manual_seed(0)
    B, H, Q = 1024, 3, 3
    pred = torch.randn(B, H, Q, requires_grad=True)
    tgt  = torch.randn(B, H)
    loss_fn = MultiHorizonPinballLoss()
    print(f"Pinball loss: {loss_fn(pred, tgt).item():.4f}  (expect > 0)")

    dir_logits = torch.randn(B, H, requires_grad=True)
    da_loss_fn = DirectionAwarePinballLoss()
    total = da_loss_fn(pred, dir_logits, tgt)
    total.backward()
    print(f"DirectionAwarePinball loss: {total.item():.4f}  (expect > 0, finite)")
    assert torch.isfinite(total), "loss is not finite"

    pred2      = torch.randn(B, H, Q, requires_grad=True)
    dir_logits2 = torch.randn(B, H, requires_grad=True)
    sharpe_fn = SharpeLoss()
    sl = sharpe_fn(pred2, dir_logits2, tgt)
    sl.backward()
    print(f"SharpeLoss: {sl.item():.4f}  finite={torch.isfinite(sl).item()}")
    assert torch.isfinite(sl), "SharpeLoss is not finite"

    pred3      = torch.randn(B, H, Q, requires_grad=True)
    dir_logits3 = torch.randn(B, H, requires_grad=True)
    comp_fn = CompositeLoss(pinball_w=1.0, sharpe_w=0.5, cross_w=0.1)
    cl = comp_fn(pred3, dir_logits3, tgt)
    cl.backward()
    print(f"CompositeLoss: {cl.item():.4f}  finite={torch.isfinite(cl).item()}")
    assert torch.isfinite(cl), "CompositeLoss is not finite"

    print("All loss checks passed.")
