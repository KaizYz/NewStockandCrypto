from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    description: str


@dataclass(frozen=True)
class AssetSpec:
    symbol: str
    label: str
    market: str
    horizons: List[str]


MODELS: List[ModelSpec] = [
    ModelSpec(id='lstm', label='LSTM+Attention', description='Sequence classifier with attention pooling.'),
    ModelSpec(id='transformer', label='Transformer', description='Temporal transformer encoder for direction prediction.'),
    ModelSpec(id='ensemble', label='LightGBM Ensemble', description='Direction + quantile stack with tabular features.'),
    ModelSpec(id='tcn', label='TCN', description='Temporal convolutional classifier for short-term signal.'),
]

ASSETS: List[AssetSpec] = [
    AssetSpec(symbol='BTCUSDT', label='BTC/USDT', market='CRYPTO', horizons=['1H', '4H', '1D', '3D']),
    AssetSpec(symbol='ETHUSDT', label='ETH/USDT', market='CRYPTO', horizons=['1H', '4H', '1D', '3D']),
    AssetSpec(symbol='SOLUSDT', label='SOL/USDT', market='CRYPTO', horizons=['1H', '4H', '1D', '3D']),
    AssetSpec(symbol='000001.SS', label='SSE Composite', market='CN', horizons=['1H', '4H', '1D', '3D']),
    AssetSpec(symbol='^GSPC', label='S&P 500', market='US', horizons=['1H', '4H', '1D', '3D']),
]

MODEL_IDS = {spec.id for spec in MODELS}
ASSET_BY_SYMBOL: Dict[str, AssetSpec] = {asset.symbol: asset for asset in ASSETS}


def normalize_model(model: str) -> str:
    candidate = str(model or '').strip().lower()
    if candidate not in MODEL_IDS:
        raise ValueError(f'Unsupported model: {model}')
    return candidate


def normalize_asset(asset: str) -> str:
    candidate = str(asset or '').strip().upper()
    if candidate not in ASSET_BY_SYMBOL:
        raise ValueError(f'Unsupported asset: {asset}')
    return candidate


def normalize_horizon(horizon: str) -> str:
    candidate = str(horizon or '').strip().upper()
    if candidate not in {'1H', '4H', '1D', '3D'}:
        raise ValueError(f'Unsupported horizon: {horizon}')
    return candidate
