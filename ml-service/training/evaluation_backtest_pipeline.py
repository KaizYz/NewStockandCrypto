from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

from training.backtest import SimpleBacktest
from training.data_pipeline import build_sequence_dataset, build_training_dataset
from training.evaluation import (
    DirectionEvaluator,
    MagnitudeEvaluator,
    PurgedWalkForwardValidator,
    benchmark_grade,
    fold_records_to_dataframe,
)
from training.models import (
    LSTMClassifier,
    TCNClassifier,
    TransformerClassifier,
    train_ensemble,
    train_torch_model,
)


@dataclass
class EvaluationBacktestConfig:
    n_splits: int
    train_size: int
    test_size: int
    purge_size: int
    embargo_size: int
    expanding: bool
    sequence_length: int
    gpu_id: int
    gpu_platform_id: Optional[int]
    gpu_device_id: int
    epochs: int
    backtest_defaults: Dict[str, float]


@dataclass
class EvaluationBacktestResult:
    evaluation_summary: Dict[str, object]
    fold_metrics: pd.DataFrame
    asset_metrics: pd.DataFrame
    prediction_rows: pd.DataFrame
    backtest_summary: Dict[str, object]
    backtest_trades: pd.DataFrame
    backtest_equity: pd.DataFrame
    backtest_inputs: pd.DataFrame


def _bars_per_year(horizon: str) -> int:
    h = str(horizon).upper()
    if h in {"1H", "4H"}:
        return 24 * 365
    return 252


def _prob_to_signal(prob: float) -> str:
    if prob >= 0.55:
        return "LONG"
    if prob <= 0.45:
        return "SHORT"
    return "FLAT"


def _flatten_direction_metrics(prefix: str, metrics: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for key, value in metrics.items():
        out[f"{prefix}{key}"] = float(value)
    return out


def _flatten_magnitude_metrics(prefix: str, metrics: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for key, value in metrics.items():
        if isinstance(value, (int, float)) and np.isfinite(float(value)):
            out[f"{prefix}{key}"] = float(value)
        else:
            out[f"{prefix}{key}"] = 0.0
    return out


def _overall_summary_record(
    model: str,
    horizon: str,
    y_true: np.ndarray,
    p_up: np.ndarray,
    realized: np.ndarray,
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
) -> Dict[str, object]:
    dir_eval = DirectionEvaluator(y_true, p_up).evaluate(threshold_metric="f1")
    mag_eval = MagnitudeEvaluator(realized, q50)
    magnitude = mag_eval.compute_all_metrics()
    coverage = mag_eval.quantile_coverage_analysis(q10, q50, q90)

    record: Dict[str, object] = {
        "model": model,
        "horizon": horizon,
        "sampleCount": int(len(y_true)),
        "direction": dir_eval.metrics,
        "calibration": dir_eval.calibration,
        "optimalThreshold": dir_eval.optimal_threshold,
        "magnitude": magnitude,
        "coverage": coverage,
        "benchmark": {
            "direction_accuracy": benchmark_grade("direction_accuracy", float(dir_eval.metrics.get("accuracy", 0.0))),
            "auc_roc": benchmark_grade("auc_roc", float(dir_eval.metrics.get("auc_roc", 0.0))),
            "brier_score": benchmark_grade("brier_score", float(dir_eval.metrics.get("brier_score", 0.0))),
        },
    }
    return record


def _asset_summary(pred_df: pd.DataFrame) -> pd.DataFrame:
    rows: List[Dict[str, object]] = []
    for (model, horizon, asset), group in pred_df.groupby(["model", "horizon", "asset"], sort=True):
        y_true = group["y_true_direction"].to_numpy(dtype=np.int64)
        p_up = group["p_up"].to_numpy(dtype=np.float64)
        realized = group["realized_return"].to_numpy(dtype=np.float64)
        q10 = group["q10"].to_numpy(dtype=np.float64)
        q50 = group["q50"].to_numpy(dtype=np.float64)
        q90 = group["q90"].to_numpy(dtype=np.float64)
        summary = _overall_summary_record(
            model=str(model),
            horizon=str(horizon),
            y_true=y_true,
            p_up=p_up,
            realized=realized,
            q10=q10,
            q50=q50,
            q90=q90,
        )
        rows.append(
            {
                "model": model,
                "horizon": horizon,
                "asset": asset,
                "sample_count": int(len(group)),
                "direction_accuracy": float(summary["direction"]["accuracy"]),
                "auc_roc": float(summary["direction"]["auc_roc"]),
                "brier_score": float(summary["direction"]["brier_score"]),
                "ece": float(summary["calibration"]["expected_calibration_error"]),
                "mce": float(summary["calibration"]["maximum_calibration_error"]),
                "mae": float(summary["magnitude"]["mae"]),
                "rmse": float(summary["magnitude"]["rmse"]),
                "r2": float(summary["magnitude"]["r2"]),
                "pi80_coverage": float(summary["coverage"]["pi80_coverage"]),
                "mean_interval_width": float(summary["coverage"]["mean_interval_width"]),
                "grade_direction_accuracy": str(summary["benchmark"]["direction_accuracy"]),
                "grade_auc_roc": str(summary["benchmark"]["auc_roc"]),
                "grade_brier_score": str(summary["benchmark"]["brier_score"]),
            }
        )
    return pd.DataFrame(rows)


def _build_return_lookup(dataset_table: pd.DataFrame) -> Dict[Tuple[str, str], float]:
    lookup: Dict[Tuple[str, str], float] = {}
    for row in dataset_table.itertuples(index=False):
        key = (str(getattr(row, "asset")), pd.Timestamp(getattr(row, "timestamp")).isoformat())
        lookup[key] = float(getattr(row, "target_return"))
    return lookup


def _build_price_lookup(frames: Dict[str, pd.DataFrame]) -> Dict[Tuple[str, str], Tuple[float, float, float, float]]:
    lookup: Dict[Tuple[str, str], Tuple[float, float, float, float]] = {}
    for asset, frame in frames.items():
        if frame.empty:
            continue
        for row in frame.itertuples(index=False):
            ts = pd.Timestamp(getattr(row, "timestamp")).isoformat()
            lookup[(asset, ts)] = (
                float(getattr(row, "open")),
                float(getattr(row, "high")),
                float(getattr(row, "low")),
                float(getattr(row, "close")),
            )
    return lookup


def _evaluate_tabular_ensemble(
    *,
    table: pd.DataFrame,
    feature_columns: List[str],
    horizon: str,
    config: EvaluationBacktestConfig,
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    fold_rows: List[Dict[str, object]] = []
    prediction_rows: List[Dict[str, object]] = []
    validator = PurgedWalkForwardValidator(
        n_splits=config.n_splits,
        train_size=config.train_size,
        test_size=config.test_size,
        purge_size=config.purge_size,
        embargo_size=config.embargo_size,
        expanding=config.expanding,
    )

    for fold, (train_idx, test_idx) in enumerate(validator.split(len(table))):
        train_df = table.iloc[train_idx].copy()
        test_df = table.iloc[test_idx].copy()

        x_train = train_df[feature_columns].to_numpy(dtype=np.float32)
        y_train = train_df["target_direction"].to_numpy(dtype=np.int64)
        y_ret_train = train_df["target_return"].to_numpy(dtype=np.float32)

        x_test = test_df[feature_columns].to_numpy(dtype=np.float32)
        y_test = test_df["target_direction"].to_numpy(dtype=np.int64)
        y_ret_test = test_df["target_return"].to_numpy(dtype=np.float32)

        pack = train_ensemble(
            x_train,
            y_train,
            y_ret_train,
            gpu_platform_id=config.gpu_platform_id,
            gpu_device_id=config.gpu_device_id,
        )

        p_up = np.asarray(pack.direction_model.predict_proba(x_test)[:, 1], dtype=np.float64)
        q10 = np.asarray(pack.q10_model.predict(x_test), dtype=np.float64)
        q50 = np.asarray(pack.q50_model.predict(x_test), dtype=np.float64)
        q90 = np.asarray(pack.q90_model.predict(x_test), dtype=np.float64)
        q_stacked = np.sort(np.vstack([q10, q50, q90]), axis=0)
        q10 = q_stacked[0]
        q50 = q_stacked[1]
        q90 = q_stacked[2]

        direction = DirectionEvaluator(y_test, p_up).evaluate(threshold_metric="f1")
        magnitude = MagnitudeEvaluator(y_ret_test, q50)
        magnitude_metrics = magnitude.compute_all_metrics()
        coverage = magnitude.quantile_coverage_analysis(q10, q50, q90)

        fold_row: Dict[str, object] = {
            "model": "ensemble",
            "horizon": horizon,
            "fold": int(fold),
            "train_samples": int(len(train_df)),
            "test_samples": int(len(test_df)),
            "ece": float(direction.calibration["expected_calibration_error"]),
            "mce": float(direction.calibration["maximum_calibration_error"]),
            **_flatten_direction_metrics("direction_", direction.metrics),
            **_flatten_magnitude_metrics("magnitude_", magnitude_metrics),
            **_flatten_magnitude_metrics("coverage_", coverage),
        }
        fold_rows.append(fold_row)

        for row, prob, lo, mid, hi in zip(test_df.itertuples(index=False), p_up, q10, q50, q90):
            prediction_rows.append(
                {
                    "model": "ensemble",
                    "horizon": horizon,
                    "fold": int(fold),
                    "asset": str(getattr(row, "asset")),
                    "timestamp": pd.Timestamp(getattr(row, "timestamp")).isoformat(),
                    "y_true_direction": int(getattr(row, "target_direction")),
                    "realized_return": float(getattr(row, "target_return")),
                    "p_up": float(prob),
                    "q10": float(lo),
                    "q50": float(mid),
                    "q90": float(hi),
                    "signal": _prob_to_signal(float(prob)),
                    "confidence": float(max(0.0, min(1.0, 0.5 + abs(float(prob) - 0.5) * 1.8))),
                    "open": float(getattr(row, "open")),
                    "high": float(getattr(row, "high")),
                    "low": float(getattr(row, "low")),
                    "close": float(getattr(row, "close")),
                }
            )
    return fold_rows, prediction_rows


def _evaluate_deep_models(
    *,
    frames: Dict[str, pd.DataFrame],
    return_lookup: Dict[Tuple[str, str], float],
    price_lookup: Dict[Tuple[str, str], Tuple[float, float, float, float]],
    horizon: str,
    horizon_steps: int,
    config: EvaluationBacktestConfig,
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    fold_rows: List[Dict[str, object]] = []
    prediction_rows: List[Dict[str, object]] = []
    seq_data = build_sequence_dataset(frames, horizon_steps=horizon_steps, sequence_length=config.sequence_length)
    validator = PurgedWalkForwardValidator(
        n_splits=config.n_splits,
        train_size=config.train_size,
        test_size=config.test_size,
        purge_size=config.purge_size,
        embargo_size=config.embargo_size,
        expanding=config.expanding,
    )

    model_specs = {
        "lstm": lambda input_dim: LSTMClassifier(input_dim=input_dim),
        "transformer": lambda input_dim: TransformerClassifier(input_dim=input_dim),
        "tcn": lambda input_dim: TCNClassifier(input_dim=input_dim),
    }

    for fold, (train_idx, test_idx) in enumerate(validator.split(len(seq_data.x))):
        x_train = seq_data.x[train_idx]
        y_train = seq_data.y[train_idx]
        x_test = seq_data.x[test_idx]
        y_test = seq_data.y[test_idx]
        meta_test = seq_data.meta.iloc[test_idx].copy().reset_index(drop=True)

        input_dim = x_train.shape[-1]
        for model_name, builder in model_specs.items():
            result = train_torch_model(
                builder(input_dim),
                x_train,
                y_train,
                x_test,
                y_test,
                gpu_id=config.gpu_id,
                epochs=config.epochs,
            )

            # Re-run inference for probabilities to keep full array.
            model = result.model
            model.eval()
            import torch

            with torch.no_grad():
                device = next(model.parameters()).device
                logits = model(torch.tensor(x_test, dtype=torch.float32, device=device))
                p_up = torch.sigmoid(logits).detach().cpu().numpy().astype(np.float64)

            # Proxy return head for deep models keeps interface parity.
            q50 = (p_up - 0.5) * 0.02
            q10 = q50 - 0.01
            q90 = q50 + 0.01

            realized_ret = np.zeros(len(meta_test), dtype=np.float64)
            for idx, meta_row in enumerate(meta_test.itertuples(index=False)):
                key = (str(getattr(meta_row, "asset")), str(getattr(meta_row, "timestamp")))
                realized_ret[idx] = float(return_lookup.get(key, 0.0))

            direction = DirectionEvaluator(y_test, p_up).evaluate(threshold_metric="f1")
            magnitude_eval = MagnitudeEvaluator(realized_ret, q50)
            magnitude_metrics = magnitude_eval.compute_all_metrics()
            coverage = magnitude_eval.quantile_coverage_analysis(q10, q50, q90)

            fold_rows.append(
                {
                    "model": model_name,
                    "horizon": horizon,
                    "fold": int(fold),
                    "train_samples": int(len(x_train)),
                    "test_samples": int(len(x_test)),
                    "ece": float(direction.calibration["expected_calibration_error"]),
                    "mce": float(direction.calibration["maximum_calibration_error"]),
                    **_flatten_direction_metrics("direction_", direction.metrics),
                    **_flatten_magnitude_metrics("magnitude_", magnitude_metrics),
                    **_flatten_magnitude_metrics("coverage_", coverage),
                }
            )

            for idx, meta_row in enumerate(meta_test.itertuples(index=False)):
                asset = str(getattr(meta_row, "asset"))
                ts = str(getattr(meta_row, "timestamp"))
                o, h, l, c = price_lookup.get((asset, ts), (0.0, 0.0, 0.0, 0.0))
                prediction_rows.append(
                    {
                        "model": model_name,
                        "horizon": horizon,
                        "fold": int(fold),
                        "asset": asset,
                        "timestamp": ts,
                        "y_true_direction": int(y_test[idx]),
                        "realized_return": float(realized_ret[idx]),
                        "p_up": float(p_up[idx]),
                        "q10": float(q10[idx]),
                        "q50": float(q50[idx]),
                        "q90": float(q90[idx]),
                        "signal": _prob_to_signal(float(p_up[idx])),
                        "confidence": float(max(0.0, min(1.0, 0.5 + abs(float(p_up[idx]) - 0.5) * 1.8))),
                        "open": float(o),
                        "high": float(h),
                        "low": float(l),
                        "close": float(c),
                    }
                )
    return fold_rows, prediction_rows


def _run_backtests(
    prediction_df: pd.DataFrame,
    *,
    horizon: str,
    defaults: Dict[str, float],
) -> Tuple[Dict[str, object], pd.DataFrame, pd.DataFrame]:
    summary_rows: List[Dict[str, object]] = []
    trades_rows: List[pd.DataFrame] = []
    equity_rows: List[pd.DataFrame] = []

    bars_per_year = _bars_per_year(horizon)
    engine = SimpleBacktest(
        initial_capital=float(defaults["initial_capital"]),
        commission_rate=float(defaults["commission_rate"]),
        slippage_rate=float(defaults["slippage_rate"]),
        position_sizing=str(defaults["position_sizing"]),
        risk_per_trade=float(defaults["risk_per_trade"]),
        max_position_size=float(defaults["max_position_size"]),
        bars_per_year=bars_per_year,
    )

    for (model, asset), group in prediction_df.groupby(["model", "asset"], sort=True):
        ordered = group.sort_values("timestamp").copy()
        if ordered.empty:
            continue

        index = pd.to_datetime(ordered["timestamp"], utc=True, errors="coerce")
        prices = pd.DataFrame(
            {
                "open": ordered["open"].to_numpy(dtype=np.float64),
                "high": ordered["high"].to_numpy(dtype=np.float64),
                "low": ordered["low"].to_numpy(dtype=np.float64),
                "close": ordered["close"].to_numpy(dtype=np.float64),
            },
            index=index,
        ).dropna()
        if prices.empty:
            continue

        signals = pd.DataFrame(
            {
                "signal": ordered["signal"].to_numpy(),
                "confidence": ordered["confidence"].to_numpy(dtype=np.float64),
                "p_up": ordered["p_up"].to_numpy(dtype=np.float64),
                "q10": ordered["q10"].to_numpy(dtype=np.float64),
                "q50": ordered["q50"].to_numpy(dtype=np.float64),
                "q90": ordered["q90"].to_numpy(dtype=np.float64),
            },
            index=index,
        ).reindex(prices.index)
        signals["signal"] = signals["signal"].fillna("FLAT")
        signals["confidence"] = signals["confidence"].fillna(0.0)

        result = engine.run_backtest(
            prices=prices,
            signals=signals,
            stop_loss_pct=float(defaults["stop_loss_pct"]),
            take_profit_pct=float(defaults["take_profit_pct"]),
            take_profit_2_pct=float(defaults["take_profit_2_pct"]),
            confidence_threshold=float(defaults["confidence_threshold"]),
        )
        metrics = result.metrics
        summary_rows.append(
            {
                "model": model,
                "horizon": horizon,
                "asset": asset,
                **{k: float(v) if isinstance(v, (int, float)) and np.isfinite(float(v)) else 0.0 for k, v in metrics.items()},
                "grade_sharpe_ratio": benchmark_grade("sharpe_ratio", float(metrics.get("sharpe_ratio", 0.0))),
                "grade_max_drawdown": benchmark_grade("max_drawdown", float(metrics.get("max_drawdown", 0.0))),
                "grade_win_rate": benchmark_grade("win_rate", float(metrics.get("win_rate", 0.0))),
                "grade_profit_factor": benchmark_grade("profit_factor", float(metrics.get("profit_factor", 0.0))),
            }
        )

        trades_df = result.trades_frame()
        if not trades_df.empty:
            trades_df["model"] = model
            trades_df["horizon"] = horizon
            trades_df["asset"] = asset
            trades_rows.append(trades_df)

        equity_df = pd.DataFrame(
            {
                "timestamp": prices.index.astype("datetime64[ns]").astype(str),
                "equity": result.equity_curve[: len(prices)],
                "drawdown": result.drawdown_curve[: len(prices)],
            }
        )
        rolling = np.asarray(result.rolling_sharpe, dtype=np.float64)
        padded = np.full(len(equity_df), np.nan, dtype=np.float64)
        if len(rolling) > 0:
            padded[1 : 1 + len(rolling)] = rolling
        equity_df["rolling_sharpe"] = padded
        equity_df["model"] = model
        equity_df["horizon"] = horizon
        equity_df["asset"] = asset
        equity_rows.append(equity_df)

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "defaults": defaults,
        "results": summary_rows,
    }
    trades_out = pd.concat(trades_rows, axis=0, ignore_index=True) if trades_rows else pd.DataFrame()
    equity_out = pd.concat(equity_rows, axis=0, ignore_index=True) if equity_rows else pd.DataFrame()
    return summary, trades_out, equity_out


def run_evaluation_and_backtest(
    *,
    frames: Dict[str, pd.DataFrame],
    horizon: str,
    horizon_steps: int,
    config: EvaluationBacktestConfig,
) -> EvaluationBacktestResult:
    dataset = build_training_dataset(frames, horizon_steps=horizon_steps)
    table = dataset.table.reset_index(drop=True)
    return_lookup = _build_return_lookup(table)
    price_lookup = _build_price_lookup(frames)

    ensemble_folds, ensemble_preds = _evaluate_tabular_ensemble(
        table=table,
        feature_columns=dataset.feature_columns,
        horizon=horizon,
        config=config,
    )
    deep_folds, deep_preds = _evaluate_deep_models(
        frames=frames,
        return_lookup=return_lookup,
        price_lookup=price_lookup,
        horizon=horizon,
        horizon_steps=horizon_steps,
        config=config,
    )

    fold_df = fold_records_to_dataframe(ensemble_folds + deep_folds)
    pred_df = pd.DataFrame(ensemble_preds + deep_preds)
    if pred_df.empty:
        raise RuntimeError(f"No prediction rows generated for evaluation/backtest at horizon {horizon}.")

    summary_records: List[Dict[str, object]] = []
    for model in sorted(set(pred_df["model"].astype(str).tolist())):
        subset = pred_df[pred_df["model"] == model]
        summary_records.append(
            _overall_summary_record(
                model=model,
                horizon=horizon,
                y_true=subset["y_true_direction"].to_numpy(dtype=np.int64),
                p_up=subset["p_up"].to_numpy(dtype=np.float64),
                realized=subset["realized_return"].to_numpy(dtype=np.float64),
                q10=subset["q10"].to_numpy(dtype=np.float64),
                q50=subset["q50"].to_numpy(dtype=np.float64),
                q90=subset["q90"].to_numpy(dtype=np.float64),
            )
        )

    evaluation_summary: Dict[str, object] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "horizon": horizon,
        "config": {
            "n_splits": config.n_splits,
            "train_size": config.train_size,
            "test_size": config.test_size,
            "purge_size": config.purge_size,
            "embargo_size": config.embargo_size,
            "expanding": config.expanding,
            "sequence_length": config.sequence_length,
        },
        "models": summary_records,
    }

    asset_df = _asset_summary(pred_df)
    backtest_summary, backtest_trades, backtest_equity = _run_backtests(pred_df, horizon=horizon, defaults=config.backtest_defaults)

    return EvaluationBacktestResult(
        evaluation_summary=evaluation_summary,
        fold_metrics=fold_df,
        asset_metrics=asset_df,
        prediction_rows=pred_df,
        backtest_summary=backtest_summary,
        backtest_trades=backtest_trades,
        backtest_equity=backtest_equity,
        backtest_inputs=pred_df.copy(),
    )
