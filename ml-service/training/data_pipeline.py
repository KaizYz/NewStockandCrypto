from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List

import numpy as np
import pandas as pd
import requests

BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines'
YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}'

ASSET_SOURCES = {
    'BTCUSDT': {'provider': 'binance', 'symbol': 'BTCUSDT'},
    'ETHUSDT': {'provider': 'binance', 'symbol': 'ETHUSDT'},
    'SOLUSDT': {'provider': 'binance', 'symbol': 'SOLUSDT'},
    '^GSPC': {'provider': 'yahoo', 'symbol': '^GSPC'},
    '^DJI': {'provider': 'yahoo', 'symbol': '^DJI'},
    '^NDX': {'provider': 'yahoo', 'symbol': '^NDX'},
    '000001.SS': {'provider': 'yahoo', 'symbol': '000001.SS'},
}

DEFAULT_HORIZON_STEPS = {
    '1H': 1,
    '4H': 4,
    '1D': 24,
    '3D': 72,
}


@dataclass
class TrainingDataset:
    table: pd.DataFrame
    feature_columns: List[str]


@dataclass
class SequenceDataset:
    x: np.ndarray
    y: np.ndarray
    meta: pd.DataFrame


def _ensure_utc_index(df: pd.DataFrame) -> pd.DataFrame:
    copy_df = df.copy()
    copy_df['timestamp'] = pd.to_datetime(copy_df['timestamp'], utc=True)
    copy_df = copy_df.sort_values('timestamp').drop_duplicates('timestamp')
    copy_df = copy_df.set_index('timestamp')
    return copy_df


def fetch_binance_klines(symbol: str, interval: str = '1h', limit: int = 1000) -> pd.DataFrame:
    response = requests.get(
        BINANCE_KLINES_URL,
        params={'symbol': symbol, 'interval': interval, 'limit': limit},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list) or not payload:
        raise ValueError(f'Binance returned empty kline payload for {symbol}')

    rows = []
    for item in payload:
        rows.append(
            {
                'timestamp': datetime.fromtimestamp(item[0] / 1000, tz=timezone.utc),
                'open': float(item[1]),
                'high': float(item[2]),
                'low': float(item[3]),
                'close': float(item[4]),
                'volume': float(item[5]),
            }
        )
    return _ensure_utc_index(pd.DataFrame(rows)).reset_index()


def fetch_yahoo_chart(symbol: str, interval: str = '1h', range_window: str = '60d') -> pd.DataFrame:
    url = YAHOO_CHART_URL.format(symbol=symbol)
    response = requests.get(url, params={'interval': interval, 'range': range_window, 'includePrePost': 'true'}, timeout=12)
    response.raise_for_status()
    payload = response.json()

    result = (payload.get('chart') or {}).get('result') or []
    if not result:
        raise ValueError(f'Yahoo returned empty chart result for {symbol}')

    first = result[0]
    ts = first.get('timestamp') or []
    quote = ((first.get('indicators') or {}).get('quote') or [{}])[0]
    opens = quote.get('open') or []
    highs = quote.get('high') or []
    lows = quote.get('low') or []
    closes = quote.get('close') or []
    volumes = quote.get('volume') or []

    rows = []
    for idx in range(min(len(ts), len(closes))):
        close_value = closes[idx]
        if close_value is None:
            continue
        rows.append(
            {
                'timestamp': datetime.fromtimestamp(int(ts[idx]), tz=timezone.utc),
                'open': float(opens[idx]) if opens[idx] is not None else float(close_value),
                'high': float(highs[idx]) if highs[idx] is not None else float(close_value),
                'low': float(lows[idx]) if lows[idx] is not None else float(close_value),
                'close': float(close_value),
                'volume': float(volumes[idx]) if idx < len(volumes) and volumes[idx] is not None else 0.0,
            }
        )

    if not rows:
        raise ValueError(f'Yahoo chart has no usable rows for {symbol}')

    return _ensure_utc_index(pd.DataFrame(rows)).reset_index()


def fetch_market_frames() -> Dict[str, pd.DataFrame]:
    frames: Dict[str, pd.DataFrame] = {}
    for asset, config in ASSET_SOURCES.items():
        provider = config['provider']
        symbol = config['symbol']
        if provider == 'binance':
            frame = fetch_binance_klines(symbol)
        else:
            frame = fetch_yahoo_chart(symbol)

        frame = frame.sort_values('timestamp').reset_index(drop=True)
        frame['asset'] = asset
        frames[asset] = frame

    return frames


def _build_features(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.copy()
    df['return_1'] = df['close'].pct_change(1)
    df['return_3'] = df['close'].pct_change(3)
    df['return_6'] = df['close'].pct_change(6)
    df['return_12'] = df['close'].pct_change(12)
    df['momentum_6'] = df['close'] / df['close'].shift(6) - 1.0
    df['momentum_12'] = df['close'] / df['close'].shift(12) - 1.0
    df['vol_6'] = df['return_1'].rolling(6).std()
    df['vol_12'] = df['return_1'].rolling(12).std()
    df['hl_spread'] = (df['high'] - df['low']) / df['close'].replace(0.0, np.nan)
    df['oc_spread'] = (df['close'] - df['open']) / df['open'].replace(0.0, np.nan)
    df['volume_z'] = (df['volume'] - df['volume'].rolling(24).mean()) / (df['volume'].rolling(24).std() + 1e-9)

    df = df.replace([np.inf, -np.inf], np.nan)
    return df


def _asset_to_id(assets: Iterable[str]) -> Dict[str, int]:
    ordered = sorted(set(assets))
    return {asset: idx for idx, asset in enumerate(ordered)}


def build_training_dataset(frames: Dict[str, pd.DataFrame], horizon_steps: int) -> TrainingDataset:
    assets = list(frames.keys())
    id_map = _asset_to_id(assets)
    combined_rows: List[pd.DataFrame] = []

    for asset, frame in frames.items():
        df = _build_features(frame)
        df['target_return'] = df['close'].shift(-horizon_steps) / df['close'] - 1.0
        df['target_direction'] = (df['target_return'] > 0).astype(int)
        df['asset_id'] = id_map[asset]
        df['asset'] = asset
        combined_rows.append(df)

    table = pd.concat(combined_rows, axis=0, ignore_index=True)
    table = table.dropna().sort_values('timestamp').reset_index(drop=True)

    feature_columns = [
        'return_1',
        'return_3',
        'return_6',
        'return_12',
        'momentum_6',
        'momentum_12',
        'vol_6',
        'vol_12',
        'hl_spread',
        'oc_spread',
        'volume_z',
        'asset_id',
    ]

    return TrainingDataset(table=table, feature_columns=feature_columns)


def build_sequence_dataset(frames: Dict[str, pd.DataFrame], horizon_steps: int, sequence_length: int = 32) -> SequenceDataset:
    seq_features = ['return_1', 'return_3', 'return_6', 'momentum_6', 'momentum_12', 'vol_6', 'vol_12', 'hl_spread', 'oc_spread', 'volume_z']

    x_batches: List[np.ndarray] = []
    y_batches: List[np.ndarray] = []
    metas: List[dict] = []

    for asset, frame in frames.items():
        df = _build_features(frame)
        df['target_direction'] = (df['close'].shift(-horizon_steps) / df['close'] - 1.0 > 0).astype(int)
        df = df.dropna().reset_index(drop=True)
        if len(df) <= sequence_length + horizon_steps:
            continue

        values = df[seq_features].to_numpy(dtype=np.float32)
        labels = df['target_direction'].to_numpy(dtype=np.int64)
        timestamps = pd.to_datetime(df['timestamp'], utc=True)

        upper = len(df) - horizon_steps
        for idx in range(sequence_length, upper):
            x_batches.append(values[idx - sequence_length:idx])
            y_batches.append(labels[idx])
            metas.append({'asset': asset, 'timestamp': timestamps.iloc[idx].isoformat()})

    if not x_batches:
        raise ValueError('Sequence dataset is empty. Not enough rows after feature construction.')

    return SequenceDataset(
        x=np.stack(x_batches, axis=0),
        y=np.asarray(y_batches, dtype=np.int64),
        meta=pd.DataFrame(metas),
    )


def split_train_test(table: pd.DataFrame, train_ratio: float = 0.8) -> tuple[pd.DataFrame, pd.DataFrame]:
    split_idx = int(len(table) * train_ratio)
    split_idx = min(max(split_idx, 1), len(table) - 1)
    return table.iloc[:split_idx].copy(), table.iloc[split_idx:].copy()


def split_sequence_train_test(x: np.ndarray, y: np.ndarray, train_ratio: float = 0.8) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    split_idx = int(len(x) * train_ratio)
    split_idx = min(max(split_idx, 1), len(x) - 1)
    return x[:split_idx], x[split_idx:], y[:split_idx], y[split_idx:]
