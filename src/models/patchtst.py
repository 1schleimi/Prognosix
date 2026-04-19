"""
PatchTST-lite: channel-independent patch tokenization + Transformer encoder.

Reference: Nie et al. "A Time Series is Worth 64 Words" (ICLR 2023).
This is a lightweight implementation adapted for multi-horizon quantile output.

Output: tuple((B, H, Q), (B, H))  — quantiles and direction logits.
"""
import math

import torch
import torch.nn as nn

from losses import N_QUANTILES
from dataset import N_HORIZONS


class _PatchEmbedding(nn.Module):
    """Split each feature channel into non-overlapping patches, project to d_model."""

    def __init__(self, seq_len: int, patch_len: int, stride: int, d_model: int, n_features: int):
        super().__init__()
        self.patch_len = patch_len
        self.stride = stride
        self.n_patches = (seq_len - patch_len) // stride + 1
        self.n_features = n_features
        # channel-independent: one shared linear across features
        self.proj = nn.Linear(patch_len, d_model)
        self.norm = nn.LayerNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, T, F) → (B*F, n_patches, d_model)"""
        B, T, F = x.shape
        x = x.permute(0, 2, 1)   # (B, F, T)
        patches = x.unfold(2, self.patch_len, self.stride)  # (B, F, n_patches, patch_len)
        B2, F2, P, PL = patches.shape
        patches = patches.reshape(B2 * F2, P, PL)           # (B*F, n_patches, patch_len)
        out = self.norm(self.proj(patches))                  # (B*F, n_patches, d_model)
        return out


class _TransformerBlock(nn.Module):
    def __init__(self, d_model: int, n_heads: int, ff_dim: int, dropout: float):
        super().__init__()
        self.attn = nn.MultiheadAttention(d_model, n_heads, dropout=dropout, batch_first=True)
        self.ff = nn.Sequential(
            nn.Linear(d_model, ff_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(ff_dim, d_model),
        )
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Pre-norm
        r = x
        x2, _ = self.attn(self.norm1(x), self.norm1(x), self.norm1(x))
        x = r + self.drop(x2)
        x = x + self.drop(self.ff(self.norm2(x)))
        return x


class PatchTST(nn.Module):
    """
    Args:
        n_features:     input feature dimension
        n_tickers:      ticker vocabulary size
        embed_dim:      ticker embedding dim (appended as extra channel)
        seq_len:        input sequence length
        patch_len:      patch length in time steps
        stride:         stride between patches
        d_model:        Transformer hidden dim
        n_heads:        attention heads
        n_layers:       Transformer blocks
        ff_mult:        feed-forward multiplier (ff_dim = d_model * ff_mult)
        dropout:        dropout rate
        num_horizons:   forecast horizons
        num_quantiles:  quantile outputs per horizon
    """

    def __init__(
        self,
        n_features:    int   = 25,
        n_tickers:     int   = 20,
        embed_dim:     int   = 16,
        seq_len:       int   = 90,
        patch_len:     int   = 10,
        stride:        int   = 5,
        d_model:       int   = 64,
        n_heads:       int   = 4,
        n_layers:      int   = 2,
        ff_mult:       int   = 2,
        dropout:       float = 0.40,
        num_horizons:  int   = N_HORIZONS,
        num_quantiles: int   = N_QUANTILES,
    ):
        super().__init__()
        self.n_features = n_features
        self.embed_dim = embed_dim
        self.num_horizons = num_horizons
        self.num_quantiles = num_quantiles

        # Ticker embedding is concatenated as an extra "feature channel"
        # before patching, so effective features = n_features + 1
        # (the embedding is broadcast across time as a constant channel).
        eff_features = n_features + 1   # +1 because embedding → scalar per time step via proj
        self.ticker_emb = nn.Embedding(n_tickers, embed_dim)
        self.ticker_proj = nn.Linear(embed_dim, 1)  # embed → scalar channel

        self.patch_emb = _PatchEmbedding(seq_len, patch_len, stride, d_model, eff_features)
        n_patches = self.patch_emb.n_patches

        # Learnable positional embedding
        self.pos_emb = nn.Parameter(torch.zeros(1, n_patches, d_model))
        nn.init.trunc_normal_(self.pos_emb, std=0.02)

        self.encoder = nn.Sequential(*[
            _TransformerBlock(d_model, n_heads, d_model * ff_mult, dropout)
            for _ in range(n_layers)
        ])
        self.norm = nn.LayerNorm(d_model)

        # Aggregate patches (mean) then head
        in_dim = d_model * eff_features  # channel-independent → concat across channels
        self.head = nn.Sequential(
            nn.Linear(in_dim, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, num_horizons * num_quantiles),
        )
        self.dir_head = nn.Linear(in_dim, num_horizons)

    def forward(
        self, x: torch.Tensor, ticker_idx: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        x:          (B, T, F)
        ticker_idx: (B,)
        returns:    (quantiles (B, H, Q), direction_logits (B, H))
        """
        B, T, F = x.shape

        # Append ticker as extra channel (constant across time)
        emb = self.ticker_emb(ticker_idx)       # (B, embed_dim)
        emb_scalar = self.ticker_proj(emb)       # (B, 1)
        extra = emb_scalar.unsqueeze(1).expand(-1, T, -1)  # (B, T, 1)
        x = torch.cat([x, extra], dim=-1)        # (B, T, F+1)

        eff_F = x.shape[-1]
        patches = self.patch_emb(x)              # (B*eff_F, n_patches, d_model)
        patches = patches + self.pos_emb

        for layer in self.encoder:
            patches = layer(patches)
        patches = self.norm(patches)             # (B*eff_F, n_patches, d_model)

        # mean-pool over patches
        ctx = patches.mean(dim=1)               # (B*eff_F, d_model)
        ctx = ctx.view(B, eff_F, -1)            # (B, eff_F, d_model)
        ctx = ctx.reshape(B, -1)                # (B, eff_F * d_model)

        out = self.head(ctx)                    # (B, H*Q)
        quantiles = out.view(B, self.num_horizons, self.num_quantiles)
        dir_logits = self.dir_head(ctx)         # (B, H)
        return quantiles, dir_logits


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    model = PatchTST(n_features=25, n_tickers=20)
    x = torch.randn(8, 90, 25)
    t = torch.randint(0, 20, (8,))
    quantiles, dir_logits = model(x, t)
    print(f"Input: {tuple(x.shape)}  Ticker: {tuple(t.shape)}")
    print(f"quantiles: {tuple(quantiles.shape)}  (expected (8, {N_HORIZONS}, {N_QUANTILES}))")
    print(f"dir_logits: {tuple(dir_logits.shape)}  (expected (8, {N_HORIZONS}))")
    params = sum(p.numel() for p in model.parameters())
    print(f"Params: {params:,}")
