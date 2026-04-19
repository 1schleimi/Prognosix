"""
LSTM-v2: LSTM + LayerNorm residuals + additive attention + ticker embedding.

Output: tuple((B, H, Q), (B, H))  — quantiles and direction logits.
"""
import torch
import torch.nn as nn

from losses import N_QUANTILES, QUANTILES
from dataset import N_HORIZONS


class _LSTMBlock(nn.Module):
    """Single LSTM layer wrapped with pre-norm and residual projection."""

    def __init__(self, input_size: int, hidden_size: int, dropout: float):
        super().__init__()
        self.norm = nn.LayerNorm(input_size)
        self.lstm = nn.LSTM(input_size, hidden_size, batch_first=True)
        self.drop = nn.Dropout(dropout)
        self.proj = nn.Linear(hidden_size, input_size) if hidden_size != input_size else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, D)
        residual = x
        out, _ = self.lstm(self.norm(x))     # (B, T, H)
        out = self.drop(out)
        out = self.proj(out)                 # (B, T, D)
        return out + residual


class _AdditiveAttention(nn.Module):
    def __init__(self, hidden_size: int):
        super().__init__()
        self.score = nn.Linear(hidden_size, 1, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        w = torch.softmax(self.score(x), dim=1)  # (B, T, 1)
        return (w * x).sum(dim=1)                # (B, H)


class LSTMv2(nn.Module):
    """
    Args:
        n_features:     number of input features per time step
        n_tickers:      vocabulary size for ticker embedding
        embed_dim:      ticker embedding dimension (concatenated to input)
        hidden_size:    LSTM hidden units
        num_layers:     number of stacked LSTM blocks
        dropout:        dropout rate
        num_horizons:   number of forecast horizons
        num_quantiles:  number of quantile outputs per horizon
    """

    def __init__(
        self,
        n_features:    int   = 25,
        n_tickers:     int   = 20,
        embed_dim:     int   = 16,
        hidden_size:   int   = 96,
        num_layers:    int   = 1,
        dropout:       float = 0.45,
        num_horizons:  int   = N_HORIZONS,
        num_quantiles: int   = N_QUANTILES,
    ):
        super().__init__()
        self.embed_dim = embed_dim
        self.num_horizons = num_horizons
        self.num_quantiles = num_quantiles

        self.ticker_emb = nn.Embedding(n_tickers, embed_dim)
        in_dim = n_features + embed_dim

        # LSTM blocks with residual (first block: in_dim -> hidden_size)
        self.input_proj = nn.Linear(in_dim, hidden_size)
        self.blocks = nn.ModuleList([
            _LSTMBlock(hidden_size, hidden_size, dropout)
            for _ in range(num_layers)
        ])
        self.attention = _AdditiveAttention(hidden_size)

        self.head = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout / 2),
            nn.Linear(hidden_size // 2, num_horizons * num_quantiles),
        )
        self.dir_head = nn.Linear(hidden_size, num_horizons)

    def forward(
        self, x: torch.Tensor, ticker_idx: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        x:          (B, T, F)
        ticker_idx: (B,)
        returns:    (quantiles (B, H, Q), direction_logits (B, H))
        """
        B, T, _ = x.shape
        emb = self.ticker_emb(ticker_idx).unsqueeze(1).expand(-1, T, -1)  # (B, T, E)
        x = torch.cat([x, emb], dim=-1)                                    # (B, T, F+E)
        x = self.input_proj(x)                                             # (B, T, D)
        for block in self.blocks:
            x = block(x)
        ctx = self.attention(x)                                            # (B, D)
        out = self.head(ctx)                                               # (B, H*Q)
        quantiles = out.view(B, self.num_horizons, self.num_quantiles)
        dir_logits = self.dir_head(ctx)                                    # (B, H)
        return quantiles, dir_logits


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    model = LSTMv2(n_features=25, n_tickers=20)
    x = torch.randn(8, 90, 25)
    t = torch.randint(0, 20, (8,))
    quantiles, dir_logits = model(x, t)
    print(f"Input: {tuple(x.shape)}  Ticker: {tuple(t.shape)}")
    print(f"quantiles: {tuple(quantiles.shape)}  (expected (8, {N_HORIZONS}, {N_QUANTILES}))")
    print(f"dir_logits: {tuple(dir_logits.shape)}  (expected (8, {N_HORIZONS}))")
    params = sum(p.numel() for p in model.parameters())
    print(f"Params: {params:,}")
