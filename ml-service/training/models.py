from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import brier_score_loss

try:
    import lightgbm as lgb  # type: ignore
except Exception:  # pragma: no cover
    lgb = None

from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor


class LSTMClassifier(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 64) -> None:
        super().__init__()
        self.encoder = nn.LSTM(input_dim, hidden_dim, batch_first=True)
        self.attn = nn.Linear(hidden_dim, 1)
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.encoder(x)
        weights = torch.softmax(self.attn(out), dim=1)
        pooled = (out * weights).sum(dim=1)
        return self.head(pooled).squeeze(-1)


class TransformerClassifier(nn.Module):
    def __init__(self, input_dim: int, d_model: int = 64, n_head: int = 4, n_layers: int = 2) -> None:
        super().__init__()
        self.proj = nn.Linear(input_dim, d_model)
        encoder_layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=n_head, batch_first=True, dropout=0.1)
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.head = nn.Sequential(nn.Linear(d_model, 32), nn.ReLU(), nn.Linear(32, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.proj(x)
        out = self.encoder(x)
        pooled = out.mean(dim=1)
        return self.head(pooled).squeeze(-1)


class TCNBlock(nn.Module):
    def __init__(self, channels: int, kernel_size: int, dilation: int) -> None:
        super().__init__()
        padding = (kernel_size - 1) * dilation
        self.conv1 = nn.Conv1d(channels, channels, kernel_size, padding=padding, dilation=dilation)
        self.conv2 = nn.Conv1d(channels, channels, kernel_size, padding=padding, dilation=dilation)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        out = self.conv1(x)
        out = out[..., : x.size(-1)]
        out = self.relu(out)
        out = self.dropout(out)
        out = self.conv2(out)
        out = out[..., : x.size(-1)]
        out = self.relu(out)
        out = self.dropout(out)
        return out + residual


class TCNClassifier(nn.Module):
    def __init__(self, input_dim: int, channels: int = 64) -> None:
        super().__init__()
        self.input_proj = nn.Conv1d(input_dim, channels, kernel_size=1)
        self.blocks = nn.Sequential(
            TCNBlock(channels, kernel_size=3, dilation=1),
            TCNBlock(channels, kernel_size=3, dilation=2),
            TCNBlock(channels, kernel_size=3, dilation=4),
        )
        self.head = nn.Sequential(nn.Linear(channels, 32), nn.ReLU(), nn.Linear(32, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.transpose(1, 2)
        x = self.input_proj(x)
        x = self.blocks(x)
        pooled = x.mean(dim=-1)
        return self.head(pooled).squeeze(-1)


@dataclass
class EnsemblePack:
    direction_model: object
    q10_model: object
    q50_model: object
    q90_model: object


@dataclass
class TorchTrainResult:
    model: nn.Module
    accuracy: float
    brier: float


@dataclass
class MetricPack:
    direction_accuracy: float
    brier_score: float
    ece: float
    interval_coverage: float


def train_ensemble(x_train: np.ndarray, y_train: np.ndarray, y_return_train: np.ndarray) -> EnsemblePack:
    if lgb is not None:
        direction_model = lgb.LGBMClassifier(
            objective='binary',
            learning_rate=0.05,
            n_estimators=280,
            num_leaves=63,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
        )
        q10_model = lgb.LGBMRegressor(objective='quantile', alpha=0.1, n_estimators=260, learning_rate=0.05, random_state=42)
        q50_model = lgb.LGBMRegressor(objective='quantile', alpha=0.5, n_estimators=260, learning_rate=0.05, random_state=42)
        q90_model = lgb.LGBMRegressor(objective='quantile', alpha=0.9, n_estimators=260, learning_rate=0.05, random_state=42)
    else:
        direction_model = GradientBoostingClassifier(random_state=42)
        q10_model = GradientBoostingRegressor(loss='quantile', alpha=0.1, random_state=42)
        q50_model = GradientBoostingRegressor(loss='quantile', alpha=0.5, random_state=42)
        q90_model = GradientBoostingRegressor(loss='quantile', alpha=0.9, random_state=42)

    direction_model.fit(x_train, y_train)
    q10_model.fit(x_train, y_return_train)
    q50_model.fit(x_train, y_return_train)
    q90_model.fit(x_train, y_return_train)
    return EnsemblePack(direction_model=direction_model, q10_model=q10_model, q50_model=q50_model, q90_model=q90_model)


def _to_tensor(x: np.ndarray, y: np.ndarray, device: torch.device) -> Tuple[torch.Tensor, torch.Tensor]:
    x_t = torch.tensor(x, dtype=torch.float32, device=device)
    y_t = torch.tensor(y, dtype=torch.float32, device=device)
    return x_t, y_t


def train_torch_model(
    model: nn.Module,
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_test: np.ndarray,
    y_test: np.ndarray,
    epochs: int = 20,
    lr: float = 1e-3,
    batch_size: int = 128,
) -> TorchTrainResult:
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = model.to(device)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    x_t, y_t = _to_tensor(x_train, y_train, device)

    for _ in range(max(1, epochs)):
        model.train()
        permutation = torch.randperm(x_t.size(0), device=device)
        for start in range(0, x_t.size(0), batch_size):
            idx = permutation[start:start + batch_size]
            batch_x = x_t[idx]
            batch_y = y_t[idx]
            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        x_eval = torch.tensor(x_test, dtype=torch.float32, device=device)
        logits = model(x_eval)
        probs = torch.sigmoid(logits).detach().cpu().numpy()

    y_pred = (probs >= 0.5).astype(np.int64)
    accuracy = float((y_pred == y_test).mean())
    brier = float(brier_score_loss(y_test, probs))
    return TorchTrainResult(model=model.cpu(), accuracy=accuracy, brier=brier)


def expected_calibration_error(y_true: np.ndarray, probs: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(probs)
    if total == 0:
        return 0.0

    ece = 0.0
    for idx in range(bins):
        left, right = edges[idx], edges[idx + 1]
        mask = (probs >= left) & (probs < right if idx < bins - 1 else probs <= right)
        if not np.any(mask):
            continue
        bucket_conf = probs[mask].mean()
        bucket_acc = y_true[mask].mean()
        ece += abs(bucket_acc - bucket_conf) * (mask.sum() / total)
    return float(ece)


def build_metrics(y_true: np.ndarray, probs: np.ndarray, q10: np.ndarray, q90: np.ndarray, realized: np.ndarray) -> MetricPack:
    y_pred = (probs >= 0.5).astype(np.int64)
    accuracy = float((y_pred == y_true).mean())
    brier = float(brier_score_loss(y_true, probs))
    ece = expected_calibration_error(y_true, probs)
    coverage = float(((realized >= q10) & (realized <= q90)).mean())
    return MetricPack(
        direction_accuracy=accuracy,
        brier_score=brier,
        ece=ece,
        interval_coverage=coverage,
    )
