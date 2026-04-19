"""
Training entry point for the stock-predictor ensemble.

Usage:
    python -m src.train --model lstm_v2 --seed 1
    python -m src.train --model patchtst --seed 2

RTX 5070 (Blackwell, sm_120) notes:
  * bfloat16 AMP is preferred over float16 on Blackwell — more numerically stable.
  * torch.compile requires PyTorch >= 2.6 for sm_120 support.
  * 12 GB VRAM comfortably handles batch 1024 with seq_len 90, F=25, hidden 192.
"""
import argparse
import os
import sys
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from torch.optim.swa_utils import AveragedModel, SWALR, update_bn
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(__file__))
from dataset import (
    SplitConfig,
    MultiTickerDataset,
    BuiltSplit,
    load_all_raw,
    build_split,
    N_HORIZONS,
    N_FEATURES,
)
from losses import (
    MultiHorizonPinballLoss,
    DirectionAwarePinballLoss,
    SharpeLoss,
    CompositeLoss,
)
from models.lstm_v2 import LSTMv2
from models.patchtst import PatchTST

# ── Hyper-parameters ─────────────────────────────────────────────────────────

EPOCHS        = 200
BATCH_SIZE    = 1024
LEARNING_RATE = 1e-4
WEIGHT_DECAY  = 2e-2
PATIENCE      = 40
GRAD_CLIP     = 1.0
SEQ_LEN       = 90
MASK_RATIO    = 0.15   # fraction of time steps randomly zeroed during training

BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENSEMBLE_DIR  = os.path.join(BASE_DIR, "models", "ensemble")
DATA_DIR      = os.path.join(BASE_DIR, "data")
STATS_PATH    = os.path.join(BASE_DIR, "models", "feature_stats.json")


def _device() -> torch.device:
    if torch.cuda.is_available():
        dev = torch.device("cuda")
        name = torch.cuda.get_device_name(0)
        print(f"GPU: {name}")
        # Blackwell (RTX 50xx) advertises compute capability >= 12.0
        cc = torch.cuda.get_device_capability(0)
        if cc[0] >= 12:
            print(f"  Blackwell detected (sm_{cc[0]}{cc[1]}) — using bfloat16 AMP")
    elif torch.backends.mps.is_available():
        dev = torch.device("mps")
    else:
        dev = torch.device("cpu")
    return dev


def _amp_dtype(device: torch.device) -> torch.dtype | None:
    if device.type != "cuda":
        return None
    cc = torch.cuda.get_device_capability(0)
    # Blackwell (cc >= 12) and Ampere+ (cc >= 8) both support bfloat16 natively
    if cc[0] >= 8:
        return torch.bfloat16
    return torch.float16


def _build_model(model_name: str, n_tickers: int, device: torch.device) -> nn.Module:
    if model_name == "lstm_v2":
        m = LSTMv2(n_features=N_FEATURES, n_tickers=n_tickers)
    elif model_name == "patchtst":
        m = PatchTST(n_features=N_FEATURES, n_tickers=n_tickers, seq_len=SEQ_LEN)
    else:
        raise ValueError(f"Unknown model: {model_name!r}. Choose lstm_v2 or patchtst.")
    return m.to(device)


def _try_compile(model: nn.Module, device: torch.device) -> nn.Module:
    if device.type != "cuda":
        return model
    if sys.platform == "win32":
        print("  torch.compile() skipped (Triton not supported on Windows)")
        return model
    try:
        compiled = torch.compile(model)
        print("  torch.compile() enabled")
        return compiled
    except Exception as exc:
        print(f"  torch.compile() skipped: {exc}")
        return model


def train(
    model_name: str,
    seed: int,
    split: BuiltSplit,
    device: torch.device,
    loss_choice: str = "direction",
) -> str:
    """Train one model and return checkpoint path."""
    torch.manual_seed(seed)
    np.random.seed(seed)

    n_tickers = len(split.ticker_list)
    model = _build_model(model_name, n_tickers, device)
    model = _try_compile(model, device)

    amp_dtype = _amp_dtype(device)
    use_amp = amp_dtype is not None
    scaler = torch.amp.GradScaler("cuda", enabled=(amp_dtype == torch.float16))

    # loss_choice is passed as function argument
    if loss_choice == "pinball":
        criterion = MultiHorizonPinballLoss()
        _needs_dir = False
    elif loss_choice == "sharpe":
        criterion = CompositeLoss(pinball_w=1.0, sharpe_w=0.5, cross_w=0.1)
        _needs_dir = True
    else:  # "direction" — default, backward-compatible
        criterion = DirectionAwarePinballLoss()
        _needs_dir = True

    def _compute_loss(quantiles, dir_logits, yb):
        if _needs_dir:
            return criterion(quantiles, dir_logits, yb)
        return criterion(quantiles, yb)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY,
        fused=(device.type == "cuda"),
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=EPOCHS, eta_min=1e-6
    )
    SWA_TRIGGER = PATIENCE // 2   # start SWA after this many epochs without improvement
    swa_model = AveragedModel(model)
    swa_scheduler = SWALR(optimizer, swa_lr=1e-5, anneal_epochs=5)
    swa_active = False

    pin = device.type == "cuda"
    n_workers = min(4, os.cpu_count() or 1)
    train_dl = DataLoader(
        MultiTickerDataset(split.x_train, split.y_train, split.t_train),
        batch_size=BATCH_SIZE, shuffle=True,
        num_workers=n_workers, pin_memory=pin, persistent_workers=n_workers > 0,
    )
    val_dl = DataLoader(
        MultiTickerDataset(split.x_val, split.y_val, split.t_val),
        batch_size=BATCH_SIZE * 2, shuffle=False,
        num_workers=n_workers, pin_memory=pin, persistent_workers=n_workers > 0,
    )

    print(f"\nTraining {model_name} seed={seed} | "
          f"train={len(split.x_train):,}  val={len(split.x_val):,} | "
          f"AMP={'bf16' if amp_dtype == torch.bfloat16 else ('fp16' if use_amp else 'off')}")

    best_val = float("inf")
    best_state: dict | None = None
    no_improve = 0
    train_losses, val_losses = [], []

    for epoch in range(1, EPOCHS + 1):
        model.train()
        ep_loss = 0.0
        for xb, tb, yb in train_dl:
            xb = xb.to(device, non_blocking=True)
            tb = tb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            xb = xb + 0.02 * torch.randn_like(xb)
            # Random time masking: zero out MASK_RATIO of time steps per sample
            mask = torch.rand(xb.size(0), xb.size(1), 1, device=xb.device) > MASK_RATIO
            xb = xb * mask
            with torch.autocast(device_type=device.type,
                                dtype=amp_dtype or torch.float32,
                                enabled=use_amp):
                quantiles, dir_logits = model(xb, tb)
                loss = _compute_loss(quantiles, dir_logits, yb)
            if amp_dtype == torch.float16:
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
                optimizer.step()
            ep_loss += loss.item() * len(xb)
        ep_loss /= len(split.x_train)

        model.eval()
        vl_loss = 0.0
        with torch.no_grad():
            for xb, tb, yb in val_dl:
                xb = xb.to(device, non_blocking=True)
                tb = tb.to(device, non_blocking=True)
                yb = yb.to(device, non_blocking=True)
                with torch.autocast(device_type=device.type,
                                    dtype=amp_dtype or torch.float32,
                                    enabled=use_amp):
                    quantiles, dir_logits = model(xb, tb)
                    vl_loss += criterion(quantiles, dir_logits, yb).item() * len(xb)
        vl_loss /= len(split.x_val)

        train_losses.append(ep_loss)
        val_losses.append(vl_loss)

        improved = vl_loss < best_val - 1e-8
        if improved:
            best_val = vl_loss
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
            swa_active = False   # reset SWA if model improves again
        else:
            no_improve += 1

        # Activate SWA once plateau starts, keep running until early stop
        if not swa_active and no_improve >= SWA_TRIGGER:
            swa_active = True
            print(f"\n  SWA activated at epoch {epoch} (no_improve={no_improve})")

        if swa_active:
            swa_model.update_parameters(model)
            swa_scheduler.step()
        else:
            scheduler.step()

        if epoch % 10 == 0 or epoch == 1:
            lr = optimizer.param_groups[0]["lr"]
            phase_tag = " [SWA]" if swa_active else f"  patience={no_improve}/{PATIENCE}"
            flag = " ✓" if improved else ""
            print(f"  Epoch {epoch:3d}/{EPOCHS}  train={ep_loss:.5f}  "
                  f"val={vl_loss:.5f}  lr={lr:.2e}{phase_tag}{flag}")

        if no_improve >= PATIENCE:
            print(f"\n  Early stop at epoch {epoch}  (best val={best_val:.5f})")
            break

    # Finalize SWA: update BatchNorm statistics, then use swa_model weights
    print("\n  Updating SWA BatchNorm stats …")
    update_bn(train_dl, swa_model, device=device)
    swa_state = {
        k.replace("module.", "", 1).replace("_orig_mod.", "", 1): v.cpu().clone()
        for k, v in swa_model.state_dict().items()
        if not k.startswith("n_averaged")
    }
    try:
        model.load_state_dict(swa_state)
        print("  SWA weights applied.")
    except Exception as e:
        print(f"  SWA load failed ({e}), falling back to best checkpoint.")
        if best_state:
            cleaned = {k.replace("_orig_mod.", "", 1): v for k, v in best_state.items()}
            model.load_state_dict(cleaned)
            print(f"  Restored best weights (val={best_val:.5f})")

    # Save checkpoint
    os.makedirs(ENSEMBLE_DIR, exist_ok=True)
    ckpt_path = os.path.join(ENSEMBLE_DIR, f"{model_name}_seed{seed}.pth")
    torch.save({
        "model_name":   model_name,
        "seed":         seed,
        "model_state":  model.state_dict(),
        "n_features":   N_FEATURES,
        "n_tickers":    n_tickers,
        "ticker_list":  split.ticker_list,
        "seq_len":      SEQ_LEN,
        "best_val":     best_val,
        "train_losses": train_losses,
        "val_losses":   val_losses,
    }, ckpt_path)
    print(f"  Checkpoint → {ckpt_path}")

    # Loss plot
    _plot_losses(train_losses, val_losses, model_name, seed)
    return ckpt_path


def _plot_losses(train_losses, val_losses, model_name, seed):
    os.makedirs(DATA_DIR, exist_ok=True)
    best_ep = int(np.argmin(val_losses)) + 1
    plt.figure(figsize=(12, 4))
    plt.plot(train_losses, label="Train", linewidth=1.5)
    plt.plot(val_losses, label="Val", linewidth=1.5)
    plt.axvline(best_ep - 1, color="red", linestyle="--", alpha=0.6,
                label=f"Best ep {best_ep} ({val_losses[best_ep-1]:.5f})")
    plt.xlabel("Epoch"); plt.ylabel("Pinball Loss")
    plt.title(f"{model_name} seed={seed}")
    plt.legend(); plt.tight_layout()
    path = os.path.join(DATA_DIR, f"loss_{model_name}_seed{seed}.png")
    plt.savefig(path, dpi=100)
    plt.close()
    print(f"  Loss plot → {path}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["lstm_v2", "patchtst"], default="lstm_v2")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--loss",
        choices=["pinball", "direction", "sharpe"],
        default="direction",
        help="Loss function: pinball=MultiHorizonPinball, direction=DirectionAwarePinball (default), sharpe=CompositeLoss",
    )
    parser.add_argument("--skip-fetch", action="store_true",
                        help="Reuse cached raw data (set after first run to avoid re-download)")
    args = parser.parse_args()

    device = _device()

    cfg = SplitConfig(sequence_len=SEQ_LEN)
    print(f"\n── Loading data ({'skip fetch' if args.skip_fetch else 'fetching'}) ──")
    t0 = time.time()
    raw, market = load_all_raw(cfg)
    print(f"  done in {time.time() - t0:.1f}s")

    print("\n── Building split (no leakage) ──")
    split = build_split(cfg, raw, market)
    print(f"  train={len(split.x_train):,}  val={len(split.x_val):,}  test={len(split.x_test):,}")
    print(f"  tickers={len(split.ticker_list)}  ({', '.join(split.ticker_list)})")

    # Save normalizer stats (only needs to happen once per split)
    split.normalizer.save(STATS_PATH)
    print(f"  Feature stats → {STATS_PATH}")

    print(f"\n── Training {args.model} seed={args.seed} ──")
    t1 = time.time()
    ckpt = train(args.model, args.seed, split, device, loss_choice=args.loss)
    elapsed = time.time() - t1
    print(f"\nFinished in {elapsed/60:.1f} min  →  {ckpt}")


if __name__ == "__main__":
    main()
