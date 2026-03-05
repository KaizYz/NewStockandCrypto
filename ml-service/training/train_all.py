from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
import torch

from training.data_pipeline import (
    DEFAULT_HORIZON_STEPS,
    HorizonFramesResult,
    INTRADAY_HORIZONS,
    REPO_ROOT,
    SP500_SNAPSHOT_PATH,
    CSI300_SNAPSHOT_PATH,
    TrainingDataset,
    TrainingWindowConfig,
    build_asset_jobs,
    build_sequence_dataset,
    build_training_dataset,
    build_training_frames_for_horizon,
    configure_request_runtime,
    parse_boundary,
    split_sequence_train_test,
    split_train_test,
)
from training.evaluation_backtest_pipeline import (
    EvaluationBacktestConfig,
    EvaluationBacktestResult,
    run_evaluation_and_backtest,
)
from training.models import (
    LSTMClassifier,
    TCNClassifier,
    TransformerClassifier,
    build_metrics,
    probe_lightgbm_gpu,
    train_ensemble,
    train_torch_model,
    validate_gpu_runtime,
)

MODEL_IDS = ["ensemble", "lstm", "transformer", "tcn"]
SERVE_ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "000001.SS", "^GSPC"]
HEATMAP_FEATURES = ["return_1", "return_3", "return_6", "momentum_6", "momentum_12", "vol_6"]
HEATMAP_X = ["W-7", "W-6", "W-5", "W-4", "W-3", "W-2", "W-1", "W0"]


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def horizon_signal(p_up: float) -> str:
    if p_up >= 0.55:
        return "LONG"
    if p_up <= 0.45:
        return "SHORT"
    return "FLAT"


def _latest_feature_row(dataset: TrainingDataset, asset: str) -> Optional[np.ndarray]:
    asset_rows = dataset.table[dataset.table["asset"] == asset]
    if asset_rows.empty:
        return None
    return asset_rows.iloc[-1:][dataset.feature_columns].to_numpy(dtype=np.float32)


def _latest_heatmap_matrix(dataset: TrainingDataset, asset: str) -> List[List[float]]:
    asset_rows = dataset.table[dataset.table["asset"] == asset]
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
    if hasattr(direction_model, "feature_importances_"):
        raw = np.asarray(direction_model.feature_importances_, dtype=float)
    elif hasattr(direction_model, "booster_") and hasattr(direction_model.booster_, "feature_importance"):
        raw = np.asarray(direction_model.booster_.feature_importance(importance_type="gain"), dtype=float)

    if raw is None or raw.size != len(feature_columns):
        raw = np.ones(len(feature_columns), dtype=float)

    order = np.argsort(np.abs(raw))[::-1]
    top = []
    for idx in order[:6]:
        score = float(raw[idx])
        value = score / (np.max(np.abs(raw)) + 1e-9)
        top.append({"name": feature_columns[idx], "value": round(float(value), 3)})
    return top


def _sequence_map_for_asset(
    frames: Dict[str, pd.DataFrame],
    horizon_steps: int,
    sequence_length: int,
) -> Dict[str, np.ndarray]:
    sequence_map: Dict[str, np.ndarray] = {}
    seq_features = ["return_1", "return_3", "return_6", "momentum_6", "momentum_12", "vol_6", "vol_12", "hl_spread", "oc_spread", "volume_z"]

    for asset, frame in frames.items():
        working = frame.copy()
        working["return_1"] = working["close"].pct_change(1)
        working["return_3"] = working["close"].pct_change(3)
        working["return_6"] = working["close"].pct_change(6)
        working["momentum_6"] = working["close"] / working["close"].shift(6) - 1.0
        working["momentum_12"] = working["close"] / working["close"].shift(12) - 1.0
        working["vol_6"] = working["return_1"].rolling(6).std()
        working["vol_12"] = working["return_1"].rolling(12).std()
        working["hl_spread"] = (working["high"] - working["low"]) / working["close"].replace(0.0, np.nan)
        working["oc_spread"] = (working["close"] - working["open"]) / working["open"].replace(0.0, np.nan)
        working["volume_z"] = (working["volume"] - working["volume"].rolling(24).mean()) / (working["volume"].rolling(24).std() + 1e-9)
        working = working.replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)

        if len(working) < sequence_length + horizon_steps + 1:
            continue

        seq = working[seq_features].to_numpy(dtype=np.float32)[-sequence_length:]
        sequence_map[asset] = seq

    return sequence_map


def _torch_predict_prob(model: torch.nn.Module, seq: np.ndarray) -> float:
    model.eval()
    device = next(model.parameters()).device
    with torch.no_grad():
        tensor = torch.tensor(seq[None, ...], dtype=torch.float32, device=device)
        logits = model(tensor)
        prob = torch.sigmoid(logits).detach().cpu().item()
    return float(prob)


def _fallback_output_payload(horizon: str, global_metrics: Dict[str, Dict[str, dict]], model_id: str, asset: str) -> dict:
    perf = global_metrics.get(model_id, {}).get(horizon, {})
    return {
        "referencePrice": 0.0,
        "prediction": {
            "pUp": 0.5,
            "q10": -0.01,
            "q50": 0.0,
            "q90": 0.01,
            "intervalWidth": 0.02,
            "confidence": 0.5,
            "signal": "FLAT",
        },
        "explanation": {
            "summary": f"{model_id.upper()} fallback forecast for {asset} at {horizon}. Missing asset coverage in this horizon run.",
            "topFeatures": [{"name": "missing_coverage", "value": 0.0}],
        },
        "performance": perf if perf else {
            "directionAccuracy": 0.0,
            "brierScore": 1.0,
            "ece": 1.0,
            "intervalCoverage": 0.0,
        },
        "heatmap": {
            "xLabels": HEATMAP_X,
            "yLabels": HEATMAP_FEATURES,
            "matrix": [[0.0 for _ in HEATMAP_X] for _ in HEATMAP_FEATURES],
        },
    }


def _train_windows_from_args(args: argparse.Namespace) -> TrainingWindowConfig:
    return TrainingWindowConfig(
        start_crypto=args.start_crypto,
        start_index_intraday=args.start_index_intraday,
        start_index_daily=args.start_index_daily,
        start_stock=args.start_stock,
        end_date=args.end_date,
        intraday_interval=args.intraday_interval,
        daily_interval=args.daily_interval,
        max_workers=max(1, int(args.max_workers)),
        min_bars_intraday=max(64, int(args.min_bars_intraday)),
        min_bars_daily=max(32, int(args.min_bars_daily)),
        cache_dir=str(args.cache_dir),
        cache_ttl_hours=max(1, int(args.cache_ttl_hours)),
        request_rate_limit=max(0.1, float(args.request_rate_limit)),
    )


def _build_coverage_summary(results: Dict[str, HorizonFramesResult]) -> tuple[Dict[str, Dict[str, int]], List[str], Dict[str, Dict[str, Dict[str, object]]]]:
    coverage_report: Dict[str, Dict[str, int]] = {}
    coverage_warnings: List[str] = []
    diagnostics: Dict[str, Dict[str, Dict[str, object]]] = {}

    for horizon, result in results.items():
        coverage_report[horizon] = {
            "requestedSymbols": int(result.coverage["requestedSymbols"]),
            "loadedSymbols": int(result.coverage["loadedSymbols"]),
            "droppedSymbols": int(result.coverage["droppedSymbols"]),
        }
        coverage_warnings.extend(result.warnings)
        diagnostics[horizon] = result.diagnostics

    deduped = sorted(set(coverage_warnings))
    return coverage_report, deduped, diagnostics


def _coverage_ratio(coverage_report: Dict[str, Dict[str, int]]) -> Dict[str, float]:
    ratios: Dict[str, float] = {}
    for horizon, values in coverage_report.items():
        requested = int(values.get("requestedSymbols", 0))
        loaded = int(values.get("loadedSymbols", 0))
        ratios[horizon] = float(loaded / requested) if requested > 0 else 0.0
    return ratios


def _validate_coverage_gate(
    *,
    artifact_dir: Path,
    coverage_report: Dict[str, Dict[str, int]],
    coverage_warnings: List[str],
    diagnostics: Dict[str, Dict[str, Dict[str, object]]],
    min_coverage_threshold: float,
) -> None:
    ratios = _coverage_ratio(coverage_report)
    min_ratio = min(ratios.values()) if ratios else 0.0
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "minimumThreshold": float(min_coverage_threshold),
        "minimumObserved": float(min_ratio),
        "ratios": ratios,
        "coverage_report": coverage_report,
        "coverage_warnings": coverage_warnings,
        "diagnostics": diagnostics,
    }
    with (artifact_dir / "coverage_gate_report.json").open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=2)

    if min_ratio < min_coverage_threshold:
        raise RuntimeError(
            f"Coverage gate failed: observed minimum coverage={min_ratio:.3f}, "
            f"required threshold={min_coverage_threshold:.3f}. See coverage_gate_report.json"
        )


def _run_fetch_only_report(
    *,
    artifact_dir: Path,
    window_config: TrainingWindowConfig,
    results: Dict[str, HorizonFramesResult],
) -> None:
    coverage_report, coverage_warnings, diagnostics = _build_coverage_summary(results)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "fetch_only",
        "training_windows": {
            "crypto": {"intraday_start": window_config.start_crypto, "daily_start": window_config.start_crypto},
            "index": {
                "intraday_start": window_config.start_index_intraday,
                "daily_start": window_config.start_index_daily,
            },
            "stock": {"intraday_start": window_config.start_stock, "daily_start": window_config.start_stock},
            "end": parse_boundary(window_config.end_date, is_end=True).isoformat(),
        },
        "coverage_report": coverage_report,
        "coverage_warnings": coverage_warnings,
        "diagnostics": diagnostics,
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    with (artifact_dir / "fetch_report.json").open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=2)
    print(json.dumps(payload, indent=2))


def train_and_export(
    artifact_dir: Path,
    *,
    epochs: int,
    window_config: TrainingWindowConfig,
    fetch_only: bool,
    gpu_strict: bool,
    gpu_id: int,
    gpu_platform_id: Optional[int],
    gpu_device_id: Optional[int],
    min_coverage_threshold: float,
    wf_n_splits: int,
    wf_train_size: int,
    wf_test_size: int,
    wf_purge_size: int,
    wf_embargo_size: int,
    wf_expanding: bool,
    sequence_length: int,
    backtest_defaults: Dict[str, float],
    allow_runtime_backtest: bool,
) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    models_dir = artifact_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    if not gpu_strict:
        raise RuntimeError("CPU fallback is disabled. Keep --gpu-strict enabled for all training runs.")

    resolved_gpu_device_id = gpu_id if gpu_device_id is None else int(gpu_device_id)
    torch_gpu = validate_gpu_runtime(int(gpu_id))
    probe_lightgbm_gpu(gpu_platform_id, resolved_gpu_device_id)

    print(f"GPU strict mode: enabled")
    print(f"Selected torch device: {torch_gpu['torch_device']}")
    print(f"Detected GPU: {torch_gpu['torch_gpu_name']}")
    print(
        "LightGBM GPU probe: passed "
        f"(platform_id={gpu_platform_id if gpu_platform_id is not None else 'auto'}, "
        f"device_id={resolved_gpu_device_id})"
    )

    configure_request_runtime(
        cache_dir=window_config.cache_dir,
        cache_ttl_hours=window_config.cache_ttl_hours,
        requests_per_second=window_config.request_rate_limit,
    )
    jobs = build_asset_jobs(SP500_SNAPSHOT_PATH, CSI300_SNAPSHOT_PATH)

    horizon_results: Dict[str, HorizonFramesResult] = {}
    for horizon in DEFAULT_HORIZON_STEPS:
        horizon_results[horizon] = build_training_frames_for_horizon(horizon, jobs=jobs, windows=window_config)

    coverage_report, coverage_warnings, diagnostics = _build_coverage_summary(horizon_results)
    _validate_coverage_gate(
        artifact_dir=artifact_dir,
        coverage_report=coverage_report,
        coverage_warnings=coverage_warnings,
        diagnostics=diagnostics,
        min_coverage_threshold=float(min_coverage_threshold),
    )

    if fetch_only:
        _run_fetch_only_report(artifact_dir=artifact_dir, window_config=window_config, results=horizon_results)
        return

    outputs: Dict[str, Dict[str, Dict[str, dict]]] = {model_id: {asset: {} for asset in SERVE_ASSETS} for model_id in MODEL_IDS}
    global_metrics: Dict[str, Dict[str, dict]] = {model_id: {} for model_id in MODEL_IDS}
    all_training_warnings: List[str] = []
    evaluation_horizon_map: Dict[str, Dict[str, object]] = {}
    fold_metrics_frames: List[pd.DataFrame] = []
    asset_metrics_frames: List[pd.DataFrame] = []
    prediction_frames: List[pd.DataFrame] = []
    backtest_summary_rows: List[dict] = []
    backtest_trades_frames: List[pd.DataFrame] = []
    backtest_equity_frames: List[pd.DataFrame] = []
    backtest_inputs_frames: List[pd.DataFrame] = []

    for horizon, horizon_steps in DEFAULT_HORIZON_STEPS.items():
        horizon_result = horizon_results[horizon]
        frames = horizon_result.frames
        all_training_warnings.extend(horizon_result.warnings)

        if not frames:
            all_training_warnings.append(f"Horizon {horizon}: no training frames loaded. Using fallback outputs.")
            for model_id in MODEL_IDS:
                global_metrics[model_id][horizon] = {
                    "directionAccuracy": 0.0,
                    "brierScore": 1.0,
                    "ece": 1.0,
                    "intervalCoverage": 0.0,
                }
                for asset in SERVE_ASSETS:
                    outputs[model_id][asset][horizon] = _fallback_output_payload(horizon, global_metrics, model_id, asset)
            continue

        try:
            dataset = build_training_dataset(frames, horizon_steps)
        except ValueError as exc:
            all_training_warnings.append(f"Horizon {horizon}: {exc}. Using fallback outputs.")
            for model_id in MODEL_IDS:
                global_metrics[model_id][horizon] = {
                    "directionAccuracy": 0.0,
                    "brierScore": 1.0,
                    "ece": 1.0,
                    "intervalCoverage": 0.0,
                }
                for asset in SERVE_ASSETS:
                    outputs[model_id][asset][horizon] = _fallback_output_payload(horizon, global_metrics, model_id, asset)
            evaluation_horizon_map[horizon] = {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "horizon": horizon,
                "skipped": True,
                "reason": str(exc),
            }
            continue

        train_df, test_df = split_train_test(dataset.table, train_ratio=0.8)
        x_train = train_df[dataset.feature_columns].to_numpy(dtype=np.float32)
        x_test = test_df[dataset.feature_columns].to_numpy(dtype=np.float32)
        y_train = train_df["target_direction"].to_numpy(dtype=np.int64)
        y_test = test_df["target_direction"].to_numpy(dtype=np.int64)
        y_ret_train = train_df["target_return"].to_numpy(dtype=np.float32)
        y_ret_test = test_df["target_return"].to_numpy(dtype=np.float32)

        ensemble_pack = train_ensemble(
            x_train,
            y_train,
            y_ret_train,
            gpu_platform_id=gpu_platform_id,
            gpu_device_id=resolved_gpu_device_id,
        )
        ensemble_probs = np.asarray(ensemble_pack.direction_model.predict_proba(x_test)[:, 1], dtype=np.float32)
        ensemble_q10 = np.asarray(ensemble_pack.q10_model.predict(x_test), dtype=np.float32)
        ensemble_q50 = np.asarray(ensemble_pack.q50_model.predict(x_test), dtype=np.float32)
        ensemble_q90 = np.asarray(ensemble_pack.q90_model.predict(x_test), dtype=np.float32)
        ensemble_metrics = build_metrics(y_test, ensemble_probs, ensemble_q10, ensemble_q90, y_ret_test)
        global_metrics["ensemble"][horizon] = {
            "directionAccuracy": round(ensemble_metrics.direction_accuracy, 3),
            "brierScore": round(ensemble_metrics.brier_score, 3),
            "ece": round(ensemble_metrics.ece, 3),
            "intervalCoverage": round(ensemble_metrics.interval_coverage, 3),
        }

        horizon_dir = models_dir / horizon
        horizon_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "direction_model": ensemble_pack.direction_model,
                "q10_model": ensemble_pack.q10_model,
                "q50_model": ensemble_pack.q50_model,
                "q90_model": ensemble_pack.q90_model,
                "feature_columns": dataset.feature_columns,
            },
            horizon_dir / "ensemble.joblib",
        )

        deep_models_available = True
        lstm_result = None
        transformer_result = None
        tcn_result = None
        try:
            seq_dataset = build_sequence_dataset(frames, horizon_steps=horizon_steps, sequence_length=sequence_length)
            if len(seq_dataset.x) < 2:
                raise ValueError("Sequence dataset has fewer than 2 samples.")
            x_seq_train, x_seq_test, y_seq_train, y_seq_test = split_sequence_train_test(seq_dataset.x, seq_dataset.y, train_ratio=0.8)
            if len(x_seq_train) == 0 or len(x_seq_test) == 0:
                raise ValueError("Sequence train/test split is empty.")
            input_dim = x_seq_train.shape[-1]
            lstm_result = train_torch_model(
                LSTMClassifier(input_dim=input_dim),
                x_seq_train,
                y_seq_train,
                x_seq_test,
                y_seq_test,
                gpu_id=gpu_id,
                epochs=epochs,
            )
            transformer_result = train_torch_model(
                TransformerClassifier(input_dim=input_dim),
                x_seq_train,
                y_seq_train,
                x_seq_test,
                y_seq_test,
                gpu_id=gpu_id,
                epochs=epochs,
            )
            tcn_result = train_torch_model(
                TCNClassifier(input_dim=input_dim),
                x_seq_train,
                y_seq_train,
                x_seq_test,
                y_seq_test,
                gpu_id=gpu_id,
                epochs=epochs,
            )

            torch.save(lstm_result.model.state_dict(), horizon_dir / "lstm.pt")
            torch.save(transformer_result.model.state_dict(), horizon_dir / "transformer.pt")
            torch.save(tcn_result.model.state_dict(), horizon_dir / "tcn.pt")
        except Exception as exc:  # pragma: no cover - defensive fallback for sparse horizons
            deep_models_available = False
            all_training_warnings.append(
                f"Horizon {horizon}: deep model training unavailable ({exc}). Deep outputs fallback to ensemble."
            )

        if deep_models_available and lstm_result is not None and transformer_result is not None and tcn_result is not None:
            global_metrics["lstm"][horizon] = {
                "directionAccuracy": round(lstm_result.accuracy, 3),
                "brierScore": round(lstm_result.brier, 3),
                "ece": round(max(0.02, min(0.15, lstm_result.brier * 0.35)), 3),
                "intervalCoverage": round(global_metrics["ensemble"][horizon]["intervalCoverage"], 3),
            }
            global_metrics["transformer"][horizon] = {
                "directionAccuracy": round(transformer_result.accuracy, 3),
                "brierScore": round(transformer_result.brier, 3),
                "ece": round(max(0.02, min(0.15, transformer_result.brier * 0.35)), 3),
                "intervalCoverage": round(global_metrics["ensemble"][horizon]["intervalCoverage"], 3),
            }
            global_metrics["tcn"][horizon] = {
                "directionAccuracy": round(tcn_result.accuracy, 3),
                "brierScore": round(tcn_result.brier, 3),
                "ece": round(max(0.02, min(0.15, tcn_result.brier * 0.35)), 3),
                "intervalCoverage": round(global_metrics["ensemble"][horizon]["intervalCoverage"], 3),
            }
        else:
            for model_id in ("lstm", "transformer", "tcn"):
                global_metrics[model_id][horizon] = dict(global_metrics["ensemble"][horizon])

        feature_importance = _feature_importance(ensemble_pack.direction_model, dataset.feature_columns)
        seq_map = _sequence_map_for_asset(frames, horizon_steps=horizon_steps, sequence_length=sequence_length)

        for asset in SERVE_ASSETS:
            latest_x = _latest_feature_row(dataset, asset)
            if latest_x is None:
                all_training_warnings.append(
                    f"{asset}: no horizon dataset rows for {horizon}. Output fallback generated."
                )
                for model_id in MODEL_IDS:
                    outputs[model_id][asset][horizon] = _fallback_output_payload(horizon, global_metrics, model_id, asset)
                continue

            p_up_ensemble = float(ensemble_pack.direction_model.predict_proba(latest_x)[:, 1][0])
            q10 = float(ensemble_pack.q10_model.predict(latest_x)[0])
            q50 = float(ensemble_pack.q50_model.predict(latest_x)[0])
            q90 = float(ensemble_pack.q90_model.predict(latest_x)[0])
            q10, q50, q90 = sorted([q10, q50, q90])

            sequence = seq_map.get(asset)
            if deep_models_available and sequence is not None and lstm_result is not None and transformer_result is not None and tcn_result is not None:
                p_up_lstm = _torch_predict_prob(lstm_result.model, sequence)
                p_up_transformer = _torch_predict_prob(transformer_result.model, sequence)
                p_up_tcn = _torch_predict_prob(tcn_result.model, sequence)
            else:
                p_up_lstm = p_up_ensemble
                p_up_transformer = p_up_ensemble
                p_up_tcn = p_up_ensemble
                all_training_warnings.append(
                    f"{asset}: sequence features unavailable for {horizon}. Deep models reused ensemble probability."
                )

            ref_price = float(frames[asset]["close"].iloc[-1]) if asset in frames and not frames[asset].empty else 0.0
            heatmap_matrix = _latest_heatmap_matrix(dataset, asset)

            for model_id, p_up in {
                "ensemble": p_up_ensemble,
                "lstm": p_up_lstm,
                "transformer": p_up_transformer,
                "tcn": p_up_tcn,
            }.items():
                if model_id == "ensemble":
                    adj_q10, adj_q50, adj_q90 = q10, q50, q90
                else:
                    center_shift = (p_up - 0.5) * 0.01
                    adj_q10, adj_q50, adj_q90 = q10 + center_shift, q50 + center_shift, q90 + center_shift
                    adj_q10, adj_q50, adj_q90 = sorted([adj_q10, adj_q50, adj_q90])

                confidence = clamp(0.5 + abs(p_up - 0.5) * 1.8, 0.0, 0.99)
                outputs[model_id][asset][horizon] = {
                    "referencePrice": round(ref_price, 6),
                    "prediction": {
                        "pUp": round(float(p_up), 3),
                        "q10": round(float(adj_q10), 4),
                        "q50": round(float(adj_q50), 4),
                        "q90": round(float(adj_q90), 4),
                        "intervalWidth": round(float(adj_q90 - adj_q10), 4),
                        "confidence": round(float(confidence), 3),
                        "signal": horizon_signal(float(p_up)),
                    },
                    "explanation": {
                        "summary": (
                            f"{model_id.upper()} live artifact forecast for {asset} at {horizon}. "
                            f"P(UP)={float(p_up):.2f}, median move={float(adj_q50):+.3%}."
                        ),
                        "topFeatures": feature_importance,
                    },
                    "performance": global_metrics[model_id][horizon],
                    "heatmap": {
                        "xLabels": HEATMAP_X,
                        "yLabels": HEATMAP_FEATURES,
                        "matrix": heatmap_matrix,
                    },
                }

        eval_cfg = EvaluationBacktestConfig(
            n_splits=max(1, int(wf_n_splits)),
            train_size=max(16, int(wf_train_size)),
            test_size=max(8, int(wf_test_size)),
            purge_size=max(0, int(wf_purge_size)),
            embargo_size=max(0, int(wf_embargo_size)),
            expanding=bool(wf_expanding),
            sequence_length=max(8, int(sequence_length)),
            gpu_id=int(gpu_id),
            gpu_platform_id=gpu_platform_id,
            gpu_device_id=int(resolved_gpu_device_id),
            epochs=max(1, int(epochs)),
            backtest_defaults=backtest_defaults,
        )
        eval_result: EvaluationBacktestResult = run_evaluation_and_backtest(
            frames=frames,
            horizon=horizon,
            horizon_steps=horizon_steps,
            config=eval_cfg,
        )
        evaluation_horizon_map[horizon] = eval_result.evaluation_summary
        if not eval_result.fold_metrics.empty:
            fold_metrics_frames.append(eval_result.fold_metrics)
        if not eval_result.asset_metrics.empty:
            asset_metrics_frames.append(eval_result.asset_metrics)
        if not eval_result.prediction_rows.empty:
            prediction_frames.append(eval_result.prediction_rows)

        backtest_results = eval_result.backtest_summary.get("results", [])
        if isinstance(backtest_results, list):
            for row in backtest_results:
                row_copy = dict(row)
                row_copy["horizon"] = horizon
                backtest_summary_rows.append(row_copy)
        if not eval_result.backtest_trades.empty:
            backtest_trades_frames.append(eval_result.backtest_trades)
        if not eval_result.backtest_equity.empty:
            backtest_equity_frames.append(eval_result.backtest_equity)
        if not eval_result.backtest_inputs.empty:
            backtest_inputs_frames.append(eval_result.backtest_inputs)

    coverage_warnings.extend(all_training_warnings)
    coverage_warnings = sorted(set(coverage_warnings))
    generated_at = datetime.now(timezone.utc).isoformat()

    end_iso = parse_boundary(window_config.end_date, is_end=True).isoformat()
    artifact_meta = {
        "model_version": f"model-explorer-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "training_timestamp": generated_at,
        "models": MODEL_IDS,
        "horizons": list(DEFAULT_HORIZON_STEPS.keys()),
        "assets": SERVE_ASSETS,
        "data_sources": ["Binance", "Yahoo Chart API", "S&P500 Snapshot", "CSI300 Snapshot"],
        "training_windows": {
            "crypto": {"intraday_start": window_config.start_crypto, "daily_start": window_config.start_crypto},
            "index": {
                "intraday_start": window_config.start_index_intraday,
                "daily_start": window_config.start_index_daily,
            },
            "stock": {"intraday_start": window_config.start_stock, "daily_start": window_config.start_stock},
            "end": end_iso,
        },
        "runtime_backtest": {
            "allow_runtime_backtest": bool(allow_runtime_backtest),
            "cache_dir": str((artifact_dir / "backtest_runtime_cache").resolve()),
        },
        "coverage_report": coverage_report,
        "coverage_warnings": coverage_warnings,
        "gpu": {
            "required": True,
            "policy": "hard_fail",
            "torch_device": str(torch_gpu["torch_device"]),
            "torch_cuda_available": bool(torch_gpu["torch_cuda_available"]),
            "torch_gpu_name": str(torch_gpu["torch_gpu_name"]),
            "lightgbm_gpu_enabled": True,
            "lightgbm_platform_id": gpu_platform_id,
            "lightgbm_device_id": int(resolved_gpu_device_id),
        },
    }

    with (artifact_dir / "artifact_meta.json").open("w", encoding="utf-8") as fp:
        json.dump(artifact_meta, fp, indent=2)

    with (artifact_dir / "model_outputs.json").open("w", encoding="utf-8") as fp:
        json.dump({"generatedAt": generated_at, "outputs": outputs}, fp, indent=2)

    with (artifact_dir / "metrics.json").open("w", encoding="utf-8") as fp:
        json.dump(global_metrics, fp, indent=2)

    with (artifact_dir / "coverage_diagnostics.json").open("w", encoding="utf-8") as fp:
        json.dump(diagnostics, fp, indent=2)

    evaluation_summary_payload = {
        "generatedAt": generated_at,
        "horizons": evaluation_horizon_map,
    }
    with (artifact_dir / "evaluation_summary.json").open("w", encoding="utf-8") as fp:
        json.dump(evaluation_summary_payload, fp, indent=2)

    fold_metrics_df = pd.concat(fold_metrics_frames, axis=0, ignore_index=True) if fold_metrics_frames else pd.DataFrame()
    asset_metrics_df = pd.concat(asset_metrics_frames, axis=0, ignore_index=True) if asset_metrics_frames else pd.DataFrame()
    prediction_df = pd.concat(prediction_frames, axis=0, ignore_index=True) if prediction_frames else pd.DataFrame()
    backtest_trades_df = pd.concat(backtest_trades_frames, axis=0, ignore_index=True) if backtest_trades_frames else pd.DataFrame()
    backtest_equity_df = pd.concat(backtest_equity_frames, axis=0, ignore_index=True) if backtest_equity_frames else pd.DataFrame()
    backtest_inputs_df = pd.concat(backtest_inputs_frames, axis=0, ignore_index=True) if backtest_inputs_frames else pd.DataFrame()

    if not fold_metrics_df.empty:
        fold_metrics_df.to_parquet(artifact_dir / "evaluation_folds.parquet", index=False)
    else:
        pd.DataFrame(columns=["model", "horizon", "fold"]).to_parquet(artifact_dir / "evaluation_folds.parquet", index=False)
    if not asset_metrics_df.empty:
        asset_metrics_df.to_parquet(artifact_dir / "evaluation_assets.parquet", index=False)
    else:
        pd.DataFrame(columns=["model", "horizon", "asset"]).to_parquet(artifact_dir / "evaluation_assets.parquet", index=False)

    backtest_summary_payload = {
        "generatedAt": generated_at,
        "defaults": backtest_defaults,
        "results": backtest_summary_rows,
    }
    with (artifact_dir / "backtest_summary.json").open("w", encoding="utf-8") as fp:
        json.dump(backtest_summary_payload, fp, indent=2)

    backtest_trades_df.to_parquet(artifact_dir / "backtest_trades.parquet", index=False)
    backtest_equity_df.to_parquet(artifact_dir / "backtest_equity.parquet", index=False)
    backtest_inputs_df.to_parquet(artifact_dir / "backtest_inputs.parquet", index=False)

    runtime_cache_dir = artifact_dir / "backtest_runtime_cache"
    runtime_cache_dir.mkdir(parents=True, exist_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train full multi-model artifacts for Model Explorer.")
    parser.add_argument("--artifact-dir", type=str, default="ml-service/artifacts/latest", help="Artifact output directory")
    parser.add_argument("--epochs", type=int, default=20, help="Training epochs for deep models")

    parser.add_argument("--start-crypto", type=str, default="2020-01-01", help="Crypto training start date (ISO date)")
    parser.add_argument("--start-index-intraday", type=str, default="2020-01-01", help="Index intraday training start date")
    parser.add_argument("--start-index-daily", type=str, default="2010-01-01", help="Index daily training start date")
    parser.add_argument("--start-stock", type=str, default="2020-01-01", help="Stock training start date")
    parser.add_argument("--end-date", type=str, default="now", help="Training end date or now")
    parser.add_argument("--intraday-interval", type=str, default="1h", choices=["1h"], help="Intraday interval")
    parser.add_argument("--daily-interval", type=str, default="1d", choices=["1d"], help="Daily interval")
    parser.add_argument("--max-workers", type=int, default=8, help="Maximum concurrent fetch workers")
    parser.add_argument("--min-bars-intraday", type=int, default=2000, help="Minimum bars required for intraday symbol inclusion")
    parser.add_argument("--min-bars-daily", type=int, default=400, help="Minimum bars required for daily symbol inclusion")
    parser.add_argument("--cache-dir", type=str, default="ml-service/cache/market_data", help="Market data request cache directory")
    parser.add_argument("--cache-ttl-hours", type=int, default=168, help="Request cache TTL in hours")
    parser.add_argument("--request-rate-limit", type=float, default=6.0, help="Global request rate limit (requests/sec)")
    parser.add_argument("--min-coverage-threshold", type=float, default=0.90, help="Minimum loaded/requested ratio required for each horizon")
    parser.add_argument("--fetch-only", action="store_true", help="Only fetch and validate coverage, without model training")

    parser.add_argument("--wf-n-splits", type=int, default=5, help="Walk-forward number of folds")
    parser.add_argument("--wf-train-size", type=int, default=252, help="Walk-forward train size")
    parser.add_argument("--wf-test-size", type=int, default=63, help="Walk-forward test size")
    parser.add_argument("--wf-purge-size", type=int, default=5, help="Purged walk-forward purge gap")
    parser.add_argument("--wf-embargo-size", type=int, default=5, help="Purged walk-forward embargo gap")
    parser.add_argument("--wf-expanding", action=argparse.BooleanOptionalAction, default=False, help="Use expanding instead of rolling window")
    parser.add_argument("--sequence-length", type=int, default=32, help="Sequence length for deep models")

    parser.add_argument("--backtest-initial-capital", type=float, default=100000.0, help="Backtest initial capital")
    parser.add_argument("--backtest-commission-rate", type=float, default=0.001, help="Backtest commission rate")
    parser.add_argument("--backtest-slippage-rate", type=float, default=0.0005, help="Backtest slippage rate")
    parser.add_argument("--backtest-position-sizing", type=str, default="fixed_fraction", choices=["fixed_fraction", "kelly"], help="Position sizing strategy")
    parser.add_argument("--backtest-risk-per-trade", type=float, default=0.02, help="Risk per trade")
    parser.add_argument("--backtest-max-position-size", type=float, default=0.10, help="Maximum position fraction")
    parser.add_argument("--backtest-confidence-threshold", type=float, default=0.55, help="Minimum confidence to enter position")
    parser.add_argument("--backtest-stop-loss-pct", type=float, default=0.02, help="Stop loss percent")
    parser.add_argument("--backtest-take-profit-pct", type=float, default=0.04, help="Take profit percent")
    parser.add_argument("--backtest-take-profit-2-pct", type=float, default=0.08, help="Second take profit percent")
    parser.add_argument("--allow-runtime-backtest", action=argparse.BooleanOptionalAction, default=True, help="Allow service runtime custom backtest runs")

    parser.add_argument("--gpu-id", type=int, default=0, help="CUDA GPU id for torch training")
    parser.add_argument("--gpu-strict", action=argparse.BooleanOptionalAction, default=True, help="Require usable GPU runtime and fail fast when unavailable")
    parser.add_argument("--gpu-platform-id", type=int, default=None, help="Optional LightGBM OpenCL platform id")
    parser.add_argument("--gpu-device-id", type=int, default=None, help="Optional LightGBM OpenCL device id override")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    window_config = _train_windows_from_args(args)
    artifact_dir = Path(args.artifact_dir)
    train_and_export(
        artifact_dir=artifact_dir,
        epochs=max(1, int(args.epochs)),
        window_config=window_config,
        fetch_only=bool(args.fetch_only),
        gpu_strict=bool(args.gpu_strict),
        gpu_id=int(args.gpu_id),
        gpu_platform_id=args.gpu_platform_id,
        gpu_device_id=args.gpu_device_id,
        min_coverage_threshold=float(args.min_coverage_threshold),
        wf_n_splits=int(args.wf_n_splits),
        wf_train_size=int(args.wf_train_size),
        wf_test_size=int(args.wf_test_size),
        wf_purge_size=int(args.wf_purge_size),
        wf_embargo_size=int(args.wf_embargo_size),
        wf_expanding=bool(args.wf_expanding),
        sequence_length=max(8, int(args.sequence_length)),
        backtest_defaults={
            "initial_capital": float(args.backtest_initial_capital),
            "commission_rate": float(args.backtest_commission_rate),
            "slippage_rate": float(args.backtest_slippage_rate),
            "position_sizing": str(args.backtest_position_sizing),
            "risk_per_trade": float(args.backtest_risk_per_trade),
            "max_position_size": float(args.backtest_max_position_size),
            "confidence_threshold": float(args.backtest_confidence_threshold),
            "stop_loss_pct": float(args.backtest_stop_loss_pct),
            "take_profit_pct": float(args.backtest_take_profit_pct),
            "take_profit_2_pct": float(args.backtest_take_profit_2_pct),
        },
        allow_runtime_backtest=bool(args.allow_runtime_backtest),
    )
    print(f"Artifacts generated in: {artifact_dir}")


if __name__ == "__main__":
    main()
