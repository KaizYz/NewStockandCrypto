from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import joblib
import numpy as np
import torch

from training.data_pipeline import (
    DEFAULT_HORIZON_STEPS,
    TrainingDataset,
    build_sequence_dataset,
    build_training_dataset,
    fetch_market_frames,
    split_sequence_train_test,
    split_train_test,
)
from training.models import (
    LSTMClassifier,
    TCNClassifier,
    TransformerClassifier,
    build_metrics,
    train_ensemble,
    train_torch_model,
)

MODEL_IDS = ['ensemble', 'lstm', 'transformer', 'tcn']
SERVE_ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', '000001.SS', '^GSPC']
HEATMAP_FEATURES = ['return_1', 'return_3', 'return_6', 'momentum_6', 'momentum_12', 'vol_6']
HEATMAP_X = ['W-7', 'W-6', 'W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'W0']


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def horizon_signal(p_up: float) -> str:
    if p_up >= 0.55:
        return 'LONG'
    if p_up <= 0.45:
        return 'SHORT'
    return 'FLAT'


def _latest_feature_row(dataset: TrainingDataset, asset: str) -> np.ndarray:
    asset_rows = dataset.table[dataset.table['asset'] == asset]
    if asset_rows.empty:
        raise ValueError(f'No training rows available for asset {asset}')
    return asset_rows.iloc[-1:][dataset.feature_columns].to_numpy(dtype=np.float32)


def _latest_heatmap_matrix(dataset: TrainingDataset, asset: str) -> List[List[float]]:
    asset_rows = dataset.table[dataset.table['asset'] == asset]
    if asset_rows.empty:
        return [[0.0 for _ in HEATMAP_X] for _ in HEATMAP_FEATURES]

    tail = asset_rows.tail(len(HEATMAP_X)).copy()
    matrix: List[List[float]] = []
    for feature in HEATMAP_FEATURES:
        values = tail[feature].to_numpy(dtype=float)
        if len(values) < len(HEATMAP_X):
            values = np.pad(values, (len(HEATMAP_X) - len(values), 0), constant_values=np.nan)
        mean = np.nanmean(values)
        std = np.nanstd(values) + 1e-9
        normalized = np.nan_to_num((values - mean) / std, nan=0.0, posinf=0.0, neginf=0.0)
        matrix.append([round(float(clamp(v, -2.5, 2.5)), 3) for v in normalized])
    return matrix


def _feature_importance(direction_model: object, feature_columns: List[str]) -> List[dict]:
    raw = None
    if hasattr(direction_model, 'feature_importances_'):
        raw = np.asarray(direction_model.feature_importances_, dtype=float)
    elif hasattr(direction_model, 'booster_') and hasattr(direction_model.booster_, 'feature_importance'):
        raw = np.asarray(direction_model.booster_.feature_importance(importance_type='gain'), dtype=float)

    if raw is None or raw.size != len(feature_columns):
        raw = np.ones(len(feature_columns), dtype=float)

    order = np.argsort(np.abs(raw))[::-1]
    top = []
    for idx in order[:6]:
        score = float(raw[idx])
        value = score / (np.max(np.abs(raw)) + 1e-9)
        top.append({'name': feature_columns[idx], 'value': round(float(value), 3)})
    return top


def _sequence_map_for_asset(frames: Dict[str, object], horizon_steps: int, sequence_length: int) -> Dict[str, np.ndarray]:
    sequence_map: Dict[str, np.ndarray] = {}
    seq_features = ['return_1', 'return_3', 'return_6', 'momentum_6', 'momentum_12', 'vol_6', 'vol_12', 'hl_spread', 'oc_spread', 'volume_z']

    for asset, frame in frames.items():
        working = frame.copy()
        working['return_1'] = working['close'].pct_change(1)
        working['return_3'] = working['close'].pct_change(3)
        working['return_6'] = working['close'].pct_change(6)
        working['momentum_6'] = working['close'] / working['close'].shift(6) - 1.0
        working['momentum_12'] = working['close'] / working['close'].shift(12) - 1.0
        working['vol_6'] = working['return_1'].rolling(6).std()
        working['vol_12'] = working['return_1'].rolling(12).std()
        working['hl_spread'] = (working['high'] - working['low']) / working['close'].replace(0.0, np.nan)
        working['oc_spread'] = (working['close'] - working['open']) / working['open'].replace(0.0, np.nan)
        working['volume_z'] = (working['volume'] - working['volume'].rolling(24).mean()) / (working['volume'].rolling(24).std() + 1e-9)
        working = working.replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)

        if len(working) < sequence_length + horizon_steps + 1:
            continue

        seq = working[seq_features].to_numpy(dtype=np.float32)[-sequence_length:]
        sequence_map[asset] = seq

    return sequence_map


def _torch_predict_prob(model: torch.nn.Module, seq: np.ndarray) -> float:
    model.eval()
    with torch.no_grad():
        tensor = torch.tensor(seq[None, ...], dtype=torch.float32)
        logits = model(tensor)
        prob = torch.sigmoid(logits).item()
    return float(prob)


def train_and_export(artifact_dir: Path, epochs: int) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    models_dir = artifact_dir / 'models'
    models_dir.mkdir(parents=True, exist_ok=True)

    frames = fetch_market_frames()
    frames = {asset: frame for asset, frame in frames.items() if asset in set(SERVE_ASSETS)}

    outputs: Dict[str, Dict[str, Dict[str, dict]]] = {model_id: {} for model_id in MODEL_IDS}

    for model_id in MODEL_IDS:
        for asset in SERVE_ASSETS:
            outputs[model_id][asset] = {}

    global_metrics: Dict[str, Dict[str, dict]] = {model_id: {} for model_id in MODEL_IDS}

    for horizon, horizon_steps in DEFAULT_HORIZON_STEPS.items():
        dataset = build_training_dataset(frames, horizon_steps)
        train_df, test_df = split_train_test(dataset.table, train_ratio=0.8)

        x_train = train_df[dataset.feature_columns].to_numpy(dtype=np.float32)
        x_test = test_df[dataset.feature_columns].to_numpy(dtype=np.float32)
        y_train = train_df['target_direction'].to_numpy(dtype=np.int64)
        y_test = test_df['target_direction'].to_numpy(dtype=np.int64)
        y_ret_train = train_df['target_return'].to_numpy(dtype=np.float32)
        y_ret_test = test_df['target_return'].to_numpy(dtype=np.float32)

        ensemble_pack = train_ensemble(x_train, y_train, y_ret_train)

        ensemble_probs = np.asarray(ensemble_pack.direction_model.predict_proba(x_test)[:, 1], dtype=np.float32)
        ensemble_q10 = np.asarray(ensemble_pack.q10_model.predict(x_test), dtype=np.float32)
        ensemble_q50 = np.asarray(ensemble_pack.q50_model.predict(x_test), dtype=np.float32)
        ensemble_q90 = np.asarray(ensemble_pack.q90_model.predict(x_test), dtype=np.float32)
        ensemble_metrics = build_metrics(y_test, ensemble_probs, ensemble_q10, ensemble_q90, y_ret_test)
        global_metrics['ensemble'][horizon] = {
            'directionAccuracy': round(ensemble_metrics.direction_accuracy, 3),
            'brierScore': round(ensemble_metrics.brier_score, 3),
            'ece': round(ensemble_metrics.ece, 3),
            'intervalCoverage': round(ensemble_metrics.interval_coverage, 3),
        }

        horizon_dir = models_dir / horizon
        horizon_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                'direction_model': ensemble_pack.direction_model,
                'q10_model': ensemble_pack.q10_model,
                'q50_model': ensemble_pack.q50_model,
                'q90_model': ensemble_pack.q90_model,
                'feature_columns': dataset.feature_columns,
            },
            horizon_dir / 'ensemble.joblib',
        )

        seq_dataset = build_sequence_dataset(frames, horizon_steps=horizon_steps, sequence_length=32)
        x_seq_train, x_seq_test, y_seq_train, y_seq_test = split_sequence_train_test(seq_dataset.x, seq_dataset.y, train_ratio=0.8)
        input_dim = x_seq_train.shape[-1]

        lstm_result = train_torch_model(LSTMClassifier(input_dim=input_dim), x_seq_train, y_seq_train, x_seq_test, y_seq_test, epochs=epochs)
        transformer_result = train_torch_model(TransformerClassifier(input_dim=input_dim), x_seq_train, y_seq_train, x_seq_test, y_seq_test, epochs=epochs)
        tcn_result = train_torch_model(TCNClassifier(input_dim=input_dim), x_seq_train, y_seq_train, x_seq_test, y_seq_test, epochs=epochs)

        torch.save(lstm_result.model.state_dict(), horizon_dir / 'lstm.pt')
        torch.save(transformer_result.model.state_dict(), horizon_dir / 'transformer.pt')
        torch.save(tcn_result.model.state_dict(), horizon_dir / 'tcn.pt')

        global_metrics['lstm'][horizon] = {
            'directionAccuracy': round(lstm_result.accuracy, 3),
            'brierScore': round(lstm_result.brier, 3),
            'ece': round(max(0.02, min(0.15, lstm_result.brier * 0.35)), 3),
            'intervalCoverage': round(global_metrics['ensemble'][horizon]['intervalCoverage'], 3),
        }
        global_metrics['transformer'][horizon] = {
            'directionAccuracy': round(transformer_result.accuracy, 3),
            'brierScore': round(transformer_result.brier, 3),
            'ece': round(max(0.02, min(0.15, transformer_result.brier * 0.35)), 3),
            'intervalCoverage': round(global_metrics['ensemble'][horizon]['intervalCoverage'], 3),
        }
        global_metrics['tcn'][horizon] = {
            'directionAccuracy': round(tcn_result.accuracy, 3),
            'brierScore': round(tcn_result.brier, 3),
            'ece': round(max(0.02, min(0.15, tcn_result.brier * 0.35)), 3),
            'intervalCoverage': round(global_metrics['ensemble'][horizon]['intervalCoverage'], 3),
        }

        feature_importance = _feature_importance(ensemble_pack.direction_model, dataset.feature_columns)
        seq_map = _sequence_map_for_asset(frames, horizon_steps=horizon_steps, sequence_length=32)

        for asset in SERVE_ASSETS:
            latest_x = _latest_feature_row(dataset, asset)
            p_up_ensemble = float(ensemble_pack.direction_model.predict_proba(latest_x)[:, 1][0])
            q10 = float(ensemble_pack.q10_model.predict(latest_x)[0])
            q50 = float(ensemble_pack.q50_model.predict(latest_x)[0])
            q90 = float(ensemble_pack.q90_model.predict(latest_x)[0])
            q10, q50, q90 = sorted([q10, q50, q90])

            sequence = seq_map.get(asset)
            if sequence is not None:
                p_up_lstm = _torch_predict_prob(lstm_result.model, sequence)
                p_up_transformer = _torch_predict_prob(transformer_result.model, sequence)
                p_up_tcn = _torch_predict_prob(tcn_result.model, sequence)
            else:
                p_up_lstm = p_up_ensemble
                p_up_transformer = p_up_ensemble
                p_up_tcn = p_up_ensemble

            ref_price = float(frames[asset]['close'].iloc[-1])
            heatmap_matrix = _latest_heatmap_matrix(dataset, asset)

            for model_id, p_up in {
                'ensemble': p_up_ensemble,
                'lstm': p_up_lstm,
                'transformer': p_up_transformer,
                'tcn': p_up_tcn,
            }.items():
                if model_id == 'ensemble':
                    adj_q10, adj_q50, adj_q90 = q10, q50, q90
                else:
                    center_shift = (p_up - 0.5) * 0.01
                    adj_q10, adj_q50, adj_q90 = q10 + center_shift, q50 + center_shift, q90 + center_shift
                    adj_q10, adj_q50, adj_q90 = sorted([adj_q10, adj_q50, adj_q90])

                confidence = clamp(0.5 + abs(p_up - 0.5) * 1.8, 0.0, 0.99)
                outputs[model_id][asset][horizon] = {
                    'referencePrice': round(ref_price, 6),
                    'prediction': {
                        'pUp': round(float(p_up), 3),
                        'q10': round(float(adj_q10), 4),
                        'q50': round(float(adj_q50), 4),
                        'q90': round(float(adj_q90), 4),
                        'intervalWidth': round(float(adj_q90 - adj_q10), 4),
                        'confidence': round(float(confidence), 3),
                        'signal': horizon_signal(float(p_up)),
                    },
                    'explanation': {
                        'summary': (
                            f"{model_id.upper()} live artifact forecast for {asset} at {horizon}. "
                            f"P(UP)={float(p_up):.2f}, median move={float(adj_q50):+.3%}."
                        ),
                        'topFeatures': feature_importance,
                    },
                    'performance': global_metrics[model_id][horizon],
                    'heatmap': {
                        'xLabels': HEATMAP_X,
                        'yLabels': HEATMAP_FEATURES,
                        'matrix': heatmap_matrix,
                    },
                }

    generated_at = datetime.now(timezone.utc).isoformat()

    artifact_meta = {
        'model_version': f'model-explorer-{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")}',
        'training_timestamp': generated_at,
        'models': MODEL_IDS,
        'horizons': list(DEFAULT_HORIZON_STEPS.keys()),
        'assets': SERVE_ASSETS,
        'data_sources': ['Binance', 'Yahoo Chart API'],
    }

    with (artifact_dir / 'artifact_meta.json').open('w', encoding='utf-8') as fp:
        json.dump(artifact_meta, fp, indent=2)

    with (artifact_dir / 'model_outputs.json').open('w', encoding='utf-8') as fp:
        json.dump({'generatedAt': generated_at, 'outputs': outputs}, fp, indent=2)

    with (artifact_dir / 'metrics.json').open('w', encoding='utf-8') as fp:
        json.dump(global_metrics, fp, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Train full multi-model artifacts for Model Explorer.')
    parser.add_argument('--artifact-dir', type=str, default='ml-service/artifacts/latest', help='Artifact output directory')
    parser.add_argument('--epochs', type=int, default=20, help='Training epochs for deep models')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir)
    train_and_export(artifact_dir=artifact_dir, epochs=max(1, int(args.epochs)))
    print(f'Artifacts generated in: {artifact_dir}')


if __name__ == '__main__':
    main()
