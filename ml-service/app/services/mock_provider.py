from __future__ import annotations

import hashlib
import math
import random
import statistics
from datetime import datetime, timezone
from typing import Dict, List

import pandas as pd

from app.schemas import (
    BacktestDetailResponse,
    BacktestRunResponse,
    BacktestSummaryResponse,
    ExplanationPayload,
    EvaluationFoldsResponse,
    EvaluationSummaryItem,
    EvaluationSummaryResponse,
    FeatureContribution,
    HeatmapResponse,
    InsightsResponse,
    EnsemblePayload,
    EnsembleBlendItem,
    ModelComparisonItem,
    ModelHealthPayload,
    MetaPayload,
    PerformancePayload,
    PerformanceResponse,
    PredictResponse,
    PredictionPayload,
)

FEATURE_NAMES = [
    'momentum_20d',
    'volatility_score',
    'us_correlation',
    'size_factor',
    'volume_change',
    'news_sentiment',
]

WINDOW_LABELS = ['W-7', 'W-6', 'W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'W0']
MODEL_KEYS = ['lstm', 'ensemble', 'transformer', 'tcn']
ENSEMBLE_WEIGHTS = {
    'lstm': 0.40,
    'ensemble': 0.30,
    'transformer': 0.20,
    'tcn': 0.10,
}
COMPATIBILITY = {
    'lstm': ['1H', '4H', '1D'],
    'ensemble': ['1H', '4H', '1D', '3D'],
    'transformer': ['4H', '1D', '3D'],
    'tcn': ['1H', '4H'],
}
INFERENCE_MS = {
    'ensemble': 12.4,
    'lstm': 18.2,
    'transformer': 26.7,
    'tcn': 10.8,
}
TRAINING_MINUTES = {
    'ensemble': 41.0,
    'lstm': 67.0,
    'transformer': 95.0,
    'tcn': 52.0,
}


class MockProvider:
    def __init__(self) -> None:
        self.model_version = 'mock-v1'

    @staticmethod
    def _seed(model: str, asset: str, horizon: str) -> int:
        digest = hashlib.sha256(f'{model}|{asset}|{horizon}'.encode('utf-8')).hexdigest()
        return int(digest[:8], 16)

    def _meta(self) -> MetaPayload:
        return MetaPayload(mode='mock', modelVersion=self.model_version, timestamp=datetime.now(timezone.utc))

    @staticmethod
    def _status_from_metrics(direction_accuracy: float, interval_coverage: float, ece: float) -> tuple[str, float, float, str]:
        coverage_drop = max(0.0, (0.80 - interval_coverage) * 100.0)
        psi = min(0.35, max(0.02, abs(ece - 0.03) * 4.0 + (coverage_drop / 100.0) * 0.35))
        if direction_accuracy <= 0.01 or interval_coverage <= 0.01:
            return 'IN_REVIEW', round(psi, 3), round(coverage_drop, 2), 'Insufficient coverage for reliable drift evaluation.'
        if psi >= 0.20 or coverage_drop >= 6.0:
            return 'DRIFT_DETECTED', round(psi, 3), round(coverage_drop, 2), 'Recent coverage decline exceeded drift threshold.'
        if psi >= 0.12 or coverage_drop >= 3.0:
            return 'IN_REVIEW', round(psi, 3), round(coverage_drop, 2), 'Moderate instability detected; monitoring recommended.'
        return 'HEALTHY', round(psi, 3), round(coverage_drop, 2), 'Stable error profile and healthy interval coverage.'

    def _performance(self, model: str, asset: str, horizon: str) -> PerformancePayload:
        rng = random.Random(self._seed(model, asset, horizon) + 73)
        base = {
            'ensemble': 0.67,
            'lstm': 0.65,
            'transformer': 0.66,
            'tcn': 0.64,
        }.get(model, 0.63)
        direction_accuracy = max(0.5, min(0.9, base + rng.uniform(-0.015, 0.015)))
        return PerformancePayload(
            directionAccuracy=round(direction_accuracy, 3),
            brierScore=round(0.21 + (1.0 - direction_accuracy) * 0.2 + rng.uniform(-0.015, 0.015), 3),
            ece=round(0.03 + rng.uniform(0.0, 0.03), 3),
            intervalCoverage=round(0.78 + rng.uniform(0.0, 0.08), 3),
        )

    def _prediction(self, model: str, asset: str, horizon: str) -> PredictionPayload:
        rng = random.Random(self._seed(model, asset, horizon))
        p_up = max(0.2, min(0.85, 0.5 + rng.uniform(-0.18, 0.22)))
        confidence = max(0.45, min(0.98, 0.55 + abs(p_up - 0.5) * 1.1 + rng.uniform(-0.08, 0.1)))
        q50 = rng.uniform(-0.018, 0.024)
        width = rng.uniform(0.015, 0.052)
        q10 = q50 - width * 0.5
        q90 = q50 + width * 0.5

        if p_up >= 0.55:
            signal = 'LONG'
        elif p_up <= 0.45:
            signal = 'SHORT'
        else:
            signal = 'FLAT'

        return PredictionPayload(
            pUp=round(p_up, 3),
            q10=round(q10, 4),
            q50=round(q50, 4),
            q90=round(q90, 4),
            intervalWidth=round(q90 - q10, 4),
            confidence=round(confidence, 3),
            signal=signal,
        )

    def _top_features(self, model: str, asset: str, horizon: str) -> List[FeatureContribution]:
        rng = random.Random(self._seed(model, asset, horizon) + 11)
        features = []
        for name in FEATURE_NAMES:
            features.append(FeatureContribution(name=name, value=round(rng.uniform(-0.25, 0.38), 3)))
        features.sort(key=lambda item: abs(item.value), reverse=True)
        return features

    def _heatmap_matrix(self, model: str, asset: str, horizon: str) -> List[List[float]]:
        rng = random.Random(self._seed(model, asset, horizon) + 29)
        matrix: List[List[float]] = []
        for row_idx, _ in enumerate(FEATURE_NAMES):
            row: List[float] = []
            for col_idx, _ in enumerate(WINDOW_LABELS):
                raw = math.sin((row_idx + 1) * 0.9 + (col_idx + 1) * 0.35 + rng.uniform(-0.3, 0.3))
                row.append(round(raw, 3))
            matrix.append(row)
        return matrix

    @staticmethod
    def _state_matrix(matrix: List[List[float]]) -> List[List[float]]:
        derived: List[List[float]] = []
        for row in matrix:
            derived.append([round(max(-1.0, min(1.0, value * 1.4)), 3) for value in row])
        return derived

    @staticmethod
    def _scale(matrix: List[List[float]]) -> tuple[float, float]:
        flat = [value for row in matrix for value in row]
        if not flat:
            return -1.0, 1.0
        max_abs = max(abs(value) for value in flat) or 1.0
        return -max_abs, max_abs

    def predict(self, model: str, asset: str, horizon: str) -> PredictResponse:
        prediction = self._prediction(model, asset, horizon)
        top_features = self._top_features(model, asset, horizon)
        leading = top_features[0]
        explanation = ExplanationPayload(
            summary=(
                f"{model.upper()} indicates {prediction.signal} with P(UP)={prediction.pUp:.2f}. "
                f"Primary driver: {leading.name} ({leading.value:+.3f})."
            ),
            topFeatures=top_features,
        )
        return PredictResponse(
            meta=self._meta(),
            prediction=prediction,
            explanation=explanation,
            performance=self._performance(model, asset, horizon),
        )

    def heatmap(self, model: str, asset: str, horizon: str, scope: str = 'local') -> HeatmapResponse:
        if scope == 'global':
            all_matrices = [self._heatmap_matrix(model_id, asset, horizon) for model_id in MODEL_KEYS]
            matrix: List[List[float]] = []
            for row_idx in range(len(FEATURE_NAMES)):
                row: List[float] = []
                for col_idx in range(len(WINDOW_LABELS)):
                    values = [model_matrix[row_idx][col_idx] for model_matrix in all_matrices]
                    row.append(round(sum(values) / len(values), 3))
                matrix.append(row)
            state_source = 'global_aggregate_proxy'
        else:
            matrix = self._heatmap_matrix(model, asset, horizon)
            state_source = 'local_derived_proxy'

        scale_min, scale_max = self._scale(matrix)
        return HeatmapResponse(
            meta=MetaPayload(
                mode='mock',
                modelVersion=self.model_version,
                timestamp=datetime.now(timezone.utc),
                scaleMin=round(scale_min, 6),
                scaleMax=round(scale_max, 6),
                stateSource=state_source,
            ),
            xLabels=WINDOW_LABELS,
            yLabels=FEATURE_NAMES,
            matrix=matrix,
            stateMatrix=self._state_matrix(matrix),
        )

    def performance(self, model: str, asset: str, horizon: str) -> PerformanceResponse:
        return PerformanceResponse(meta=self._meta(), performance=self._performance(model, asset, horizon))

    def insights(self, asset: str, horizon: str) -> InsightsResponse:
        predictions: Dict[str, PredictionPayload] = {}
        performances: Dict[str, PerformancePayload] = {}
        for model_id in MODEL_KEYS:
            predictions[model_id] = self._prediction(model_id, asset, horizon)
            performances[model_id] = self._performance(model_id, asset, horizon)

        weighted = lambda key: sum(getattr(predictions[model_id], key) * ENSEMBLE_WEIGHTS[model_id] for model_id in MODEL_KEYS)
        p_up_values = [predictions[model_id].pUp for model_id in MODEL_KEYS]
        disagreement = min(1.0, statistics.pstdev(p_up_values) if len(p_up_values) > 1 else 0.0)
        fused_confidence = max(0.0, min(1.0, weighted('confidence') + max(0.0, 0.10 - disagreement)))

        fused_p_up = weighted('pUp')
        if fused_p_up >= 0.55:
            fused_signal = 'LONG'
        elif fused_p_up <= 0.45:
            fused_signal = 'SHORT'
        else:
            fused_signal = 'FLAT'

        fused = PredictionPayload(
            pUp=round(fused_p_up, 3),
            q10=round(weighted('q10'), 4),
            q50=round(weighted('q50'), 4),
            q90=round(weighted('q90'), 4),
            intervalWidth=round(weighted('q90') - weighted('q10'), 4),
            confidence=round(fused_confidence, 3),
            signal=fused_signal,
        )

        top = self._top_features('ensemble', asset, horizon)
        leader = top[0] if top else FeatureContribution(name='volatility_score', value=0.0)
        ensemble_payload = EnsemblePayload(
            enabled=True,
            fusedPrediction=fused,
            blend=[EnsembleBlendItem(model=model_id, weight=weight) for model_id, weight in ENSEMBLE_WEIGHTS.items()],
            explanation=(
                'Ensemble boosts confidence by averaging divergent views; '
                f'{leader.name} remains the dominant driver.'
            ),
            disagreementScore=round(disagreement, 3),
        )

        health: Dict[str, ModelHealthPayload] = {}
        comparison: List[ModelComparisonItem] = []
        for model_id in MODEL_KEYS:
            perf = performances[model_id]
            status, psi, coverage_drop, reason = self._status_from_metrics(
                perf.directionAccuracy,
                perf.intervalCoverage,
                perf.ece,
            )
            health[model_id] = ModelHealthPayload(
                status=status,
                psi=psi,
                coverageDropPct=coverage_drop,
                reason=reason,
            )
            comparison.append(
                ModelComparisonItem(
                    model=model_id,
                    directionAccuracy=round(perf.directionAccuracy, 3),
                    brierScore=round(perf.brierScore, 3),
                    ece=round(perf.ece, 3),
                    intervalCoverage=round(perf.intervalCoverage, 3),
                    inferenceMs=INFERENCE_MS[model_id],
                    trainingMinutes=TRAINING_MINUTES[model_id],
                    latencySource='estimated',
                    trainingTimeSource='estimated',
                )
            )

        return InsightsResponse(
            meta=self._meta(),
            ensemble=ensemble_payload,
            compatibility=COMPATIBILITY,
            health=health,
            comparison=comparison,
        )

    def evaluation_summary(
        self,
        model: str | None = None,
        asset: str | None = None,
        horizon: str | None = None,
    ) -> EvaluationSummaryResponse:
        selected_models = [model] if model else MODEL_KEYS
        selected_horizons = [horizon] if horizon else ["1H", "4H", "1D", "3D"]
        records: List[EvaluationSummaryItem] = []
        for model_id in selected_models:
            for hz in selected_horizons:
                perf = self._performance(model_id, asset or "BTCUSDT", hz)
                rng = random.Random(self._seed(model_id, asset or "BTCUSDT", hz) + 901)
                records.append(
                    EvaluationSummaryItem(
                        model=model_id,
                        horizon=hz,
                        sampleCount=1000 + rng.randint(0, 400),
                        direction={
                            "accuracy": perf.directionAccuracy,
                            "precision": round(max(0.0, perf.directionAccuracy - 0.015), 3),
                            "recall": round(max(0.0, perf.directionAccuracy - 0.008), 3),
                            "f1": round(max(0.0, perf.directionAccuracy - 0.01), 3),
                            "auc_roc": round(max(0.5, perf.directionAccuracy + 0.02), 3),
                            "log_loss": round(0.68 - perf.directionAccuracy * 0.55, 3),
                            "brier_score": perf.brierScore,
                            "specificity": round(max(0.0, perf.directionAccuracy - 0.012), 3),
                            "npv": round(max(0.0, perf.directionAccuracy - 0.02), 3),
                            "fpr": round(1 - perf.directionAccuracy, 3),
                            "fnr": round(1 - perf.directionAccuracy + 0.01, 3),
                            "mcc": round((perf.directionAccuracy - 0.5) * 1.7, 3),
                            "kappa": round((perf.directionAccuracy - 0.5) * 1.4, 3),
                        },
                        calibration={
                            "expected_calibration_error": perf.ece,
                            "maximum_calibration_error": round(min(1.0, perf.ece * 1.8), 3),
                            "bins": [],
                        },
                        optimalThreshold={
                            "threshold": 0.5,
                            "accuracy": perf.directionAccuracy,
                            "precision": round(max(0.0, perf.directionAccuracy - 0.015), 3),
                            "recall": round(max(0.0, perf.directionAccuracy - 0.008), 3),
                            "f1": round(max(0.0, perf.directionAccuracy - 0.01), 3),
                            "youden_j": round(perf.directionAccuracy * 2 - 1, 3),
                        },
                        magnitude={
                            "mae": round(0.012 + rng.random() * 0.006, 4),
                            "mse": round(0.0004 + rng.random() * 0.0003, 6),
                            "rmse": round(0.02 + rng.random() * 0.01, 4),
                            "r2": round(0.05 + rng.random() * 0.2, 3),
                            "mape": round(0.9 + rng.random() * 0.6, 3),
                            "smape": round(0.85 + rng.random() * 0.35, 3),
                            "direction_accuracy": perf.directionAccuracy,
                            "pearson_r": round(0.1 + rng.random() * 0.4, 3),
                            "spearman_r": round(0.1 + rng.random() * 0.4, 3),
                            "bias": round((rng.random() - 0.5) * 0.008, 5),
                            "relative_bias": round((rng.random() - 0.5) * 0.2, 3),
                        },
                        coverage={
                            "q10_coverage": 0.1,
                            "q50_coverage": 0.5,
                            "q90_coverage": 0.9,
                            "pi80_coverage": perf.intervalCoverage,
                            "mean_interval_width": round(0.02 + rng.random() * 0.01, 4),
                            "sharpness": round(0.005 + rng.random() * 0.01, 4),
                        },
                        benchmark={
                            "direction_accuracy": "good" if perf.directionAccuracy >= 0.55 else "acceptable",
                            "auc_roc": "good" if perf.directionAccuracy >= 0.55 else "acceptable",
                            "brier_score": "good" if perf.brierScore <= 0.2 else "acceptable",
                        },
                    )
                )
        return EvaluationSummaryResponse(meta=self._meta(), records=records)

    def evaluation_folds(
        self,
        model: str | None = None,
        asset: str | None = None,
        horizon: str | None = None,
        limit: int = 2000,
    ) -> EvaluationFoldsResponse:
        selected_models = [model] if model else MODEL_KEYS
        selected_horizons = [horizon] if horizon else ["1H", "4H", "1D", "3D"]
        rows: List[Dict[str, object]] = []
        for model_id in selected_models:
            for hz in selected_horizons:
                for fold in range(5):
                    perf = self._performance(model_id, asset or "BTCUSDT", hz)
                    rows.append(
                        {
                            "model": model_id,
                            "horizon": hz,
                            "asset": asset or "ALL",
                            "fold": fold,
                            "direction_accuracy": perf.directionAccuracy - 0.01 + fold * 0.002,
                            "brier_score": perf.brierScore + fold * 0.001,
                            "ece": perf.ece + fold * 0.001,
                            "interval_coverage": perf.intervalCoverage - fold * 0.002,
                            "test_samples": 200,
                        }
                    )
        return EvaluationFoldsResponse(meta=self._meta(), rows=rows[: max(1, int(limit))])

    def backtest_summary(
        self,
        model: str | None = None,
        asset: str | None = None,
        horizon: str | None = None,
    ) -> BacktestSummaryResponse:
        selected_models = [model] if model else MODEL_KEYS
        selected_assets = [asset] if asset else ["BTCUSDT", "ETHUSDT", "SOLUSDT", "000001.SS", "^GSPC"]
        selected_horizons = [horizon] if horizon else ["1H", "4H", "1D", "3D"]
        rows: List[Dict[str, object]] = []
        for model_id in selected_models:
            for symbol in selected_assets:
                for hz in selected_horizons:
                    rng = random.Random(self._seed(model_id, symbol, hz) + 444)
                    sharpe = round(0.6 + rng.random() * 1.8, 3)
                    max_dd = round(0.07 + rng.random() * 0.18, 3)
                    rows.append(
                        {
                            "model": model_id,
                            "asset": symbol,
                            "horizon": hz,
                            "total_return": round(0.04 + rng.random() * 0.34, 4),
                            "annualized_return": round(0.03 + rng.random() * 0.27, 4),
                            "volatility": round(0.09 + rng.random() * 0.22, 4),
                            "sharpe_ratio": sharpe,
                            "sortino_ratio": round(sharpe * 1.2, 3),
                            "calmar_ratio": round((0.08 + rng.random() * 0.2) / max(max_dd, 1e-6), 3),
                            "max_drawdown": max_dd,
                            "win_rate": round(0.46 + rng.random() * 0.16, 4),
                            "profit_factor": round(1.05 + rng.random() * 0.8, 3),
                            "expected_value": round(12 + rng.random() * 80, 4),
                            "total_trades": int(300 + rng.random() * 1400),
                        }
                    )
        return BacktestSummaryResponse(meta=self._meta(), rows=rows)

    def backtest_detail(self, model: str, asset: str, horizon: str) -> BacktestDetailResponse:
        summary_rows = self.backtest_summary(model=model, asset=asset, horizon=horizon).rows
        summary = summary_rows[0] if summary_rows else {}
        rng = random.Random(self._seed(model, asset, horizon) + 777)
        trades: List[Dict[str, object]] = []
        equity: List[Dict[str, object]] = []
        base = 100000.0
        value = base
        for idx in range(120):
            date = datetime.now(timezone.utc).replace(microsecond=0) - pd.Timedelta(hours=120 - idx)
            value *= 1 + (rng.random() - 0.48) * 0.006
            peak = max(base, value if idx == 0 else max(row["equity"] for row in equity))
            dd = max(0.0, (peak - value) / peak)
            equity.append(
                {
                    "timestamp": date.isoformat(),
                    "equity": round(value, 4),
                    "drawdown": round(dd, 5),
                    "rolling_sharpe": round(0.8 + rng.random() * 1.2, 4),
                }
            )
        for idx in range(40):
            entry = datetime.now(timezone.utc).replace(microsecond=0) - pd.Timedelta(hours=160 - idx * 3)
            exit_time = entry + pd.Timedelta(hours=2)
            pnl = (rng.random() - 0.45) * 220
            trades.append(
                {
                    "entry_time": entry.isoformat(),
                    "exit_time": exit_time.isoformat(),
                    "entry_price": round(100 + rng.random() * 20, 4),
                    "exit_price": round(100 + rng.random() * 20, 4),
                    "direction": "LONG" if rng.random() >= 0.45 else "SHORT",
                    "size": round(5 + rng.random() * 4, 4),
                    "entry_confidence": round(0.52 + rng.random() * 0.36, 3),
                    "pnl": round(pnl, 4),
                    "pnl_pct": round(pnl / 100000, 5),
                    "holding_period": 2,
                    "status": "CLOSED",
                }
            )
        return BacktestDetailResponse(meta=self._meta(), summary=summary, trades=trades, equity=equity)

    def backtest_run(self, model: str, asset: str, horizon: str, params: Dict[str, object]) -> BacktestRunResponse:
        detail = self.backtest_detail(model=model, asset=asset, horizon=horizon)
        digest = hashlib.sha1(
            f"{model}|{asset}|{horizon}|{str(sorted(params.items()))}".encode("utf-8")
        ).hexdigest()
        return BacktestRunResponse(
            meta=self._meta(),
            cacheKey=digest,
            summary=detail.summary,
            trades=detail.trades,
            equity=detail.equity,
        )

    def health(self) -> Dict[str, str]:
        return {
            'provider': 'mock',
            'deterministic': 'true',
            'note': 'Use this mode for quick UI validation before live artifacts are ready.',
        }
