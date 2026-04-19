"""
Improved StockPredictor:
  - Multi-feature LSTM (input_size=7)
  - Additive attention over all hidden states
  - Deeper FC head with GELU
  - Larger default capacity: hidden=256, layers=4
"""
import torch
import torch.nn as nn


class _Attention(nn.Module):
    """Single-head additive attention over LSTM hidden states."""
    def __init__(self, hidden_size: int):
        super().__init__()
        self.score = nn.Linear(hidden_size, 1, bias=False)

    def forward(self, lstm_out: torch.Tensor) -> torch.Tensor:
        # lstm_out: (B, T, H)
        scores  = self.score(lstm_out)          # (B, T, 1)
        weights = torch.softmax(scores, dim=1)  # (B, T, 1)
        return (weights * lstm_out).sum(dim=1)  # (B, H)


class StockPredictor(nn.Module):
    def __init__(
        self,
        input_size:    int   = 7,
        hidden_size:   int   = 256,
        num_layers:    int   = 4,
        output_size:   int   = 1,
        dropout:       float = 0.3,
        use_attention: bool  = True,
    ):
        super().__init__()
        self.hidden_size   = hidden_size
        self.num_layers    = num_layers
        self.use_attention = use_attention

        self.lstm = nn.LSTM(
            input_size, hidden_size, num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.attention = _Attention(hidden_size) if use_attention else None
        self.dropout   = nn.Dropout(dropout)
        self.head      = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout / 2),
            nn.Linear(hidden_size // 2, output_size),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B = x.size(0)
        h0 = torch.zeros(self.num_layers, B, self.hidden_size, device=x.device)
        c0 = torch.zeros(self.num_layers, B, self.hidden_size, device=x.device)
        out, _ = self.lstm(x, (h0, c0))           # (B, T, H)

        if self.attention is not None:
            ctx = self.attention(out)              # (B, H)
        else:
            ctx = out[:, -1, :]                    # (B, H)

        ctx = self.dropout(ctx)
        return self.head(ctx)                      # (B, 1)


if __name__ == "__main__":
    from data_fetcher import N_FEATURES
    model = StockPredictor(input_size=N_FEATURES)
    x     = torch.randn(32, 90, N_FEATURES)
    out   = model(x)
    print(f"Input : {x.shape}")
    print(f"Output: {out.shape}")
    print(f"Params: {sum(p.numel() for p in model.parameters()):,}")
