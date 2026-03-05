from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd
import requests

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
from training.backtest import SimpleBacktest

BINANCE_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price?symbol={symbol}'
YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m&includePrePost=true'
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


@dataclass
class ArtifactBundle:
    model_version: str
    outputs: Dict[str, Dict[str, Dict[str, dict]]]
    generated_at: str
    metrics: Dict[str, Dict[str, dict]]
    meta: Dict[str, object]
    evaluation_summary: Dict[str, object]
    backtest_summary: Dict[str, object]
    evaluation_folds_df: pd.DataFrame
    evaluation_assets_df: pd.DataFrame
    backtest_trades_df: pd.DataFrame
    backtest_equity_df: pd.DataFrame
    backtest_inputs_df: pd.DataFrame


class LiveProvider:
    def __init__(self, artifact_dir: str) -> None:
        self.artifact_dir = Path(artifact_dir)
        self._bundle: Optional[ArtifactBundle] = None
        self._loaded_at = datetime.now(timezone.utc)
        self._mtime_guard: float = 0.0
        self._load_artifacts(force=True)

    def _load_artifacts(self, force: bool = False) -> None:
        outputs_path = self.artifact_dir / 'model_outputs.json'
        meta_path = self.artifact_dir / 'artifact_meta.json'
        metrics_path = self.artifact_dir / 'metrics.json'
        evaluation_summary_path = self.artifact_dir / 'evaluation_summary.json'
        backtest_summary_path = self.artifact_dir / 'backtest_summary.json'
        evaluation_folds_path = self.artifact_dir / 'evaluation_folds.parquet'
        evaluation_assets_path = self.artifact_dir / 'evaluation_assets.parquet'
        backtest_trades_path = self.artifact_dir / 'backtest_trades.parquet'
        backtest_equity_path = self.artifact_dir / 'backtest_equity.parquet'
        backtest_inputs_path = self.artifact_dir / 'backtest_inputs.parquet'
        if not outputs_path.exists() or not meta_path.exists():
            raise FileNotFoundError(
                f'Missing live artifacts under {self.artifact_dir}. ' 
                'Expected artifact_meta.json and model_outputs.json.'
            )

        newest_mtime = max(outputs_path.stat().st_mtime, meta_path.stat().st_mtime)
        if not force and newest_mtime <= self._mtime_guard:
            return

        with outputs_path.open('r', encoding='utf-8') as fp:
            outputs_payload = json.load(fp)
        with meta_path.open('r', encoding='utf-8') as fp:
            meta_payload = json.load(fp)
        metrics_payload: Dict[str, Dict[str, dict]] = {}
        if metrics_path.exists():
            with metrics_path.open('r', encoding='utf-8') as fp:
                loaded_metrics = json.load(fp)
            if isinstance(loaded_metrics, dict):
                metrics_payload = loaded_metrics

        evaluation_summary_payload: Dict[str, object] = {}
        if evaluation_summary_path.exists():
            with evaluation_summary_path.open('r', encoding='utf-8') as fp:
                loaded = json.load(fp)
            if isinstance(loaded, dict):
                evaluation_summary_payload = loaded

        backtest_summary_payload: Dict[str, object] = {}
        if backtest_summary_path.exists():
            with backtest_summary_path.open('r', encoding='utf-8') as fp:
                loaded = json.load(fp)
            if isinstance(loaded, dict):
                backtest_summary_payload = loaded

        def _read_parquet(path: Path) -> pd.DataFrame:
            if not path.exists():
                return pd.DataFrame()
            try:
                return pd.read_parquet(path)
            except Exception:
                return pd.DataFrame()

        evaluation_folds_df = _read_parquet(evaluation_folds_path)
        evaluation_assets_df = _read_parquet(evaluation_assets_path)
        backtest_trades_df = _read_parquet(backtest_trades_path)
        backtest_equity_df = _read_parquet(backtest_equity_path)
        backtest_inputs_df = _read_parquet(backtest_inputs_path)

        model_version = str(meta_payload.get('model_version') or 'live-artifact')
        outputs = outputs_payload.get('outputs')
        if not isinstance(outputs, dict) or not outputs:
            raise ValueError('model_outputs.json has no outputs map.')

        self._bundle = ArtifactBundle(
            model_version=model_version,
            outputs=outputs,
            generated_at=str(outputs_payload.get('generatedAt') or datetime.now(timezone.utc).isoformat()),
            metrics=metrics_payload,
            meta=meta_payload if isinstance(meta_payload, dict) else {},
            evaluation_summary=evaluation_summary_payload,
            backtest_summary=backtest_summary_payload,
            evaluation_folds_df=evaluation_folds_df,
            evaluation_assets_df=evaluation_assets_df,
            backtest_trades_df=backtest_trades_df,
            backtest_equity_df=backtest_equity_df,
            backtest_inputs_df=backtest_inputs_df,
        )
        self._loaded_at = datetime.now(timezone.utc)
        self._mtime_guard = newest_mtime

    @property
    def model_version(self) -> str:
        self._load_artifacts()
        if not self._bundle:
            return 'live-unavailable'
        return self._bundle.model_version

    def _meta(self) -> MetaPayload:
        return MetaPayload(mode='live', modelVersion=self.model_version, timestamp=datetime.now(timezone.utc))

    def _lookup(self, model: str, asset: str, horizon: str) -> dict:
        self._load_artifacts()
        if not self._bundle:
            raise RuntimeError('Live artifact bundle is not available.')
        try:
            return self._bundle.outputs[model][asset][horizon]
        except KeyError as exc:
            raise KeyError(f'No live payload for {model}/{asset}/{horizon}') from exc

    @staticmethod
    def _safe_float(value: object) -> Optional[float]:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        if math.isfinite(parsed):
            return parsed
        return None

    def _fetch_current_price(self, asset: str) -> Optional[float]:
        if asset.endswith('USDT'):
            url = BINANCE_PRICE_URL.format(symbol=asset)
            response = requests.get(url, timeout=4)
            response.raise_for_status()
            payload = response.json()
            return self._safe_float(payload.get('price'))

        url = YAHOO_CHART_URL.format(symbol=asset)
        response = requests.get(url, timeout=6)
        response.raise_for_status()
        payload = response.json()
        result = (payload.get('chart') or {}).get('result') or []
        if not result:
            return None
        first = result[0]
        meta_price = self._safe_float((first.get('meta') or {}).get('regularMarketPrice'))
        if meta_price is not None:
            return meta_price

        closes = (((first.get('indicators') or {}).get('quote') or [{}])[0]).get('close') or []
        for raw in reversed(closes):
            parsed = self._safe_float(raw)
            if parsed is not None:
                return parsed
        return None

    @staticmethod
    def _normalize_quantiles(q10: float, q50: float, q90: float) -> tuple[float, float, float]:
        ordered = sorted([q10, q50, q90])
        return ordered[0], ordered[1], ordered[2]

    def _apply_realtime_adjustment(self, payload: dict, asset: str, current_price: Optional[float] = None) -> dict:
        prediction = dict(payload.get('prediction') or {})
        reference_price = self._safe_float(payload.get('referencePrice'))
        if reference_price is None or reference_price <= 0:
            return payload

        current_price = current_price if current_price is not None else self._fetch_current_price(asset)
        if current_price is None:
            return payload

        delta = (current_price - reference_price) / reference_price
        adjust = max(-0.08, min(0.08, math.tanh(delta * 15.0) * 0.08))

        p_up = self._safe_float(prediction.get('pUp')) or 0.5
        q10 = self._safe_float(prediction.get('q10')) or -0.01
        q50 = self._safe_float(prediction.get('q50')) or 0.0
        q90 = self._safe_float(prediction.get('q90')) or 0.01

        p_up = max(0.01, min(0.99, p_up + adjust))
        q50 = q50 + delta * 0.25
        q10 = q10 + delta * 0.18
        q90 = q90 + delta * 0.32
        q10, q50, q90 = self._normalize_quantiles(q10, q50, q90)

        if p_up >= 0.55:
            signal = 'LONG'
        elif p_up <= 0.45:
            signal = 'SHORT'
        else:
            signal = 'FLAT'

        prediction.update(
            {
                'pUp': round(p_up, 3),
                'q10': round(q10, 4),
                'q50': round(q50, 4),
                'q90': round(q90, 4),
                'intervalWidth': round(q90 - q10, 4),
                'confidence': round(max(0.0, min(1.0, 0.5 + abs(p_up - 0.5) * 1.7)), 3),
                'signal': signal,
            }
        )

        adjusted = dict(payload)
        adjusted['prediction'] = prediction
        adjusted['currentPrice'] = current_price
        adjusted['referencePrice'] = reference_price
        adjusted['liveDeltaPct'] = round(delta * 100.0, 4)
        return adjusted

    @staticmethod
    def _parse_features(raw_features: List[dict]) -> List[FeatureContribution]:
        features: List[FeatureContribution] = []
        for item in raw_features or []:
            features.append(
                FeatureContribution(
                    name=str(item.get('name') or 'unknown_feature'),
                    value=float(item.get('value') or 0.0),
                )
            )
        return features

    @staticmethod
    def _parse_performance(raw: dict) -> PerformancePayload:
        return PerformancePayload(
            directionAccuracy=float(raw.get('directionAccuracy') or 0.0),
            brierScore=float(raw.get('brierScore') or 0.0),
            ece=float(raw.get('ece') or 0.0),
            intervalCoverage=float(raw.get('intervalCoverage') or 0.0),
        )

    @staticmethod
    def _scale(matrix: List[List[float]]) -> tuple[float, float]:
        flat = [value for row in matrix for value in row]
        if not flat:
            return -1.0, 1.0
        max_abs = max(abs(value) for value in flat) or 1.0
        return -max_abs, max_abs

    @staticmethod
    def _state_matrix(matrix: List[List[float]]) -> List[List[float]]:
        derived: List[List[float]] = []
        for row in matrix:
            derived.append([round(max(-1.0, min(1.0, value * 1.4)), 3) for value in row])
        return derived

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

    def _metric_for(self, model: str, horizon: str, payload: dict) -> PerformancePayload:
        self._load_artifacts()
        if self._bundle:
            model_metrics = self._bundle.metrics.get(model, {}) if isinstance(self._bundle.metrics, dict) else {}
            horizon_metrics = model_metrics.get(horizon, {}) if isinstance(model_metrics, dict) else {}
            if isinstance(horizon_metrics, dict) and horizon_metrics:
                return self._parse_performance(horizon_metrics)
        return self._parse_performance(payload.get('performance') or {})

    def _aggregate_heatmap(self, asset: str, horizon: str) -> dict:
        x_labels: List[str] = []
        y_labels: List[str] = []
        matrices: List[List[List[float]]] = []
        for model_id in MODEL_KEYS:
            payload = self._lookup(model_id, asset, horizon)
            heatmap = payload.get('heatmap') or {}
            model_x = list(heatmap.get('xLabels') or [])
            model_y = list(heatmap.get('yLabels') or [])
            model_matrix = list(heatmap.get('matrix') or [])
            if not model_x or not model_y or not model_matrix:
                continue
            if not x_labels:
                x_labels = model_x
            if not y_labels:
                y_labels = model_y
            if model_x == x_labels and model_y == y_labels:
                matrices.append(model_matrix)

        if not x_labels or not y_labels or not matrices:
            return {'xLabels': ['W0'], 'yLabels': ['missing_coverage'], 'matrix': [[0.0]]}

        merged: List[List[float]] = []
        for row_idx in range(len(y_labels)):
            row: List[float] = []
            for col_idx in range(len(x_labels)):
                values: List[float] = []
                for matrix in matrices:
                    try:
                        values.append(float(matrix[row_idx][col_idx]))
                    except Exception:
                        values.append(0.0)
                row.append(round(sum(values) / len(values), 6))
            merged.append(row)
        return {'xLabels': x_labels, 'yLabels': y_labels, 'matrix': merged}

    def predict(self, model: str, asset: str, horizon: str) -> PredictResponse:
        payload = self._lookup(model, asset, horizon)
        payload = self._apply_realtime_adjustment(payload, asset)

        pred = payload.get('prediction') or {}
        explanation = payload.get('explanation') or {}

        return PredictResponse(
            meta=self._meta(),
            prediction=PredictionPayload(
                pUp=float(pred.get('pUp') or 0.5),
                q10=float(pred.get('q10') or -0.01),
                q50=float(pred.get('q50') or 0.0),
                q90=float(pred.get('q90') or 0.01),
                intervalWidth=float(pred.get('intervalWidth') or 0.02),
                confidence=float(pred.get('confidence') or 0.5),
                signal=str(pred.get('signal') or 'FLAT'),
            ),
            explanation=ExplanationPayload(
                summary=str(explanation.get('summary') or 'Live artifact explanation unavailable.'),
                topFeatures=self._parse_features(explanation.get('topFeatures') or []),
            ),
            performance=self._parse_performance(payload.get('performance') or {}),
        )

    def heatmap(self, model: str, asset: str, horizon: str) -> HeatmapResponse:
        payload = self._lookup(model, asset, horizon)
        heatmap = payload.get('heatmap') or {}
        matrix = list(heatmap.get('matrix') or [])
        scale_min, scale_max = self._scale(matrix)
        return HeatmapResponse(
            meta=MetaPayload(
                mode='live',
                modelVersion=self.model_version,
                timestamp=datetime.now(timezone.utc),
                scaleMin=round(scale_min, 6),
                scaleMax=round(scale_max, 6),
                stateSource='local_derived_proxy',
            ),
            xLabels=list(heatmap.get('xLabels') or []),
            yLabels=list(heatmap.get('yLabels') or []),
            matrix=matrix,
            stateMatrix=self._state_matrix(matrix),
        )

    def heatmap_scoped(self, model: str, asset: str, horizon: str, scope: str = 'local') -> HeatmapResponse:
        if scope == 'global':
            merged = self._aggregate_heatmap(asset, horizon)
            matrix = list(merged.get('matrix') or [])
            scale_min, scale_max = self._scale(matrix)
            return HeatmapResponse(
                meta=MetaPayload(
                    mode='live',
                    modelVersion=self.model_version,
                    timestamp=datetime.now(timezone.utc),
                    scaleMin=round(scale_min, 6),
                    scaleMax=round(scale_max, 6),
                    stateSource='global_aggregate_proxy',
                ),
                xLabels=list(merged.get('xLabels') or []),
                yLabels=list(merged.get('yLabels') or []),
                matrix=matrix,
                stateMatrix=self._state_matrix(matrix),
            )
        return self.heatmap(model, asset, horizon)

    def performance(self, model: str, asset: str, horizon: str) -> PerformanceResponse:
        payload = self._lookup(model, asset, horizon)
        return PerformanceResponse(meta=self._meta(), performance=self._parse_performance(payload.get('performance') or {}))

    def insights(self, asset: str, horizon: str) -> InsightsResponse:
        current_price = self._fetch_current_price(asset)
        predictions: Dict[str, PredictionPayload] = {}
        performances: Dict[str, PerformancePayload] = {}
        top_features: Dict[str, List[FeatureContribution]] = {}

        for model_id in MODEL_KEYS:
            base_payload = self._lookup(model_id, asset, horizon)
            adjusted_payload = self._apply_realtime_adjustment(base_payload, asset, current_price=current_price)
            pred = adjusted_payload.get('prediction') or {}
            predictions[model_id] = PredictionPayload(
                pUp=float(pred.get('pUp') or 0.5),
                q10=float(pred.get('q10') or -0.01),
                q50=float(pred.get('q50') or 0.0),
                q90=float(pred.get('q90') or 0.01),
                intervalWidth=float(pred.get('intervalWidth') or 0.02),
                confidence=float(pred.get('confidence') or 0.5),
                signal=str(pred.get('signal') or 'FLAT'),
            )
            performances[model_id] = self._metric_for(model_id, horizon, adjusted_payload)
            top_features[model_id] = self._parse_features((adjusted_payload.get('explanation') or {}).get('topFeatures') or [])

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

        lead = top_features.get('ensemble') or []
        leader = lead[0].name if lead else 'volatility_score'
        ensemble_payload = EnsemblePayload(
            enabled=True,
            fusedPrediction=fused,
            blend=[EnsembleBlendItem(model=model_id, weight=weight) for model_id, weight in ENSEMBLE_WEIGHTS.items()],
            explanation=(
                'Ensemble boosts confidence by averaging divergent views; '
                f'{leader} remains the dominant driver.'
            ),
            disagreementScore=round(disagreement, 3),
        )

        comparison: List[ModelComparisonItem] = []
        health: Dict[str, ModelHealthPayload] = {}
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

    @staticmethod
    def _clean_numeric_payload(payload: Dict[str, object]) -> Dict[str, object]:
        cleaned: Dict[str, object] = {}
        for key, value in payload.items():
            if isinstance(value, (int, float, np.integer, np.floating)):
                cleaned[key] = float(value) if math.isfinite(float(value)) else 0.0
            else:
                cleaned[key] = value
        return cleaned

    def evaluation_summary(
        self,
        model: Optional[str] = None,
        asset: Optional[str] = None,
        horizon: Optional[str] = None,
    ) -> EvaluationSummaryResponse:
        self._load_artifacts()
        if not self._bundle:
            return EvaluationSummaryResponse(meta=self._meta(), records=[])

        raw = self._bundle.evaluation_summary or {}
        horizons = raw.get("horizons") if isinstance(raw, dict) else {}
        records: List[EvaluationSummaryItem] = []
        allowed_pairs: Optional[set[tuple[str, str]]] = None
        if asset and not self._bundle.evaluation_assets_df.empty:
            filtered = self._bundle.evaluation_assets_df[self._bundle.evaluation_assets_df["asset"] == asset]
            allowed_pairs = {(str(row["model"]), str(row["horizon"])) for _, row in filtered.iterrows()}

        if isinstance(horizons, dict):
            for hz, payload in horizons.items():
                if horizon and str(hz).upper() != str(horizon).upper():
                    continue
                model_rows = payload.get("models") if isinstance(payload, dict) else []
                if not isinstance(model_rows, list):
                    continue
                for row in model_rows:
                    if not isinstance(row, dict):
                        continue
                    model_id = str(row.get("model") or "")
                    if model and model_id != model:
                        continue
                    if allowed_pairs is not None and (model_id, str(hz)) not in allowed_pairs:
                        continue
                    records.append(
                        EvaluationSummaryItem(
                            model=model_id,
                            horizon=str(row.get("horizon") or hz),
                            sampleCount=int(row.get("sampleCount") or 0),
                            direction={k: float(v) for k, v in (row.get("direction") or {}).items()},
                            calibration=dict(row.get("calibration") or {}),
                            optimalThreshold={k: float(v) for k, v in (row.get("optimalThreshold") or {}).items()},
                            magnitude={k: float(v) for k, v in (row.get("magnitude") or {}).items()},
                            coverage={k: float(v) for k, v in (row.get("coverage") or {}).items()},
                            benchmark={k: str(v) for k, v in (row.get("benchmark") or {}).items()},
                        )
                    )
        return EvaluationSummaryResponse(meta=self._meta(), records=records)

    def evaluation_folds(
        self,
        model: Optional[str] = None,
        asset: Optional[str] = None,
        horizon: Optional[str] = None,
        limit: int = 2000,
    ) -> EvaluationFoldsResponse:
        self._load_artifacts()
        if not self._bundle or self._bundle.evaluation_folds_df.empty:
            return EvaluationFoldsResponse(meta=self._meta(), rows=[])
        df = self._bundle.evaluation_folds_df.copy()
        if model:
            df = df[df["model"] == model]
        if horizon:
            df = df[df["horizon"] == horizon]
        if asset and "asset" in df.columns:
            df = df[df["asset"] == asset]
        df = df.head(max(1, int(limit)))
        rows = [self._clean_numeric_payload(record) for record in df.to_dict(orient="records")]
        return EvaluationFoldsResponse(meta=self._meta(), rows=rows)

    def backtest_summary(
        self,
        model: Optional[str] = None,
        asset: Optional[str] = None,
        horizon: Optional[str] = None,
    ) -> BacktestSummaryResponse:
        self._load_artifacts()
        if not self._bundle:
            return BacktestSummaryResponse(meta=self._meta(), rows=[])
        payload = self._bundle.backtest_summary or {}
        rows = payload.get("results") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            rows = []
        filtered: List[Dict[str, object]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if model and str(row.get("model")) != model:
                continue
            if asset and str(row.get("asset")) != asset:
                continue
            if horizon and str(row.get("horizon")).upper() != str(horizon).upper():
                continue
            filtered.append(self._clean_numeric_payload(row))
        return BacktestSummaryResponse(meta=self._meta(), rows=filtered)

    def backtest_detail(self, model: str, asset: str, horizon: str) -> BacktestDetailResponse:
        summary_rows = self.backtest_summary(model=model, asset=asset, horizon=horizon).rows
        summary = summary_rows[0] if summary_rows else {}

        self._load_artifacts()
        if not self._bundle:
            return BacktestDetailResponse(meta=self._meta(), summary=summary, trades=[], equity=[])

        trades_df = self._bundle.backtest_trades_df
        if not trades_df.empty:
            trades_df = trades_df[
                (trades_df["model"] == model) & (trades_df["asset"] == asset) & (trades_df["horizon"] == horizon)
            ]
        equity_df = self._bundle.backtest_equity_df
        if not equity_df.empty:
            equity_df = equity_df[
                (equity_df["model"] == model) & (equity_df["asset"] == asset) & (equity_df["horizon"] == horizon)
            ]

        trades = [self._clean_numeric_payload(record) for record in trades_df.to_dict(orient="records")] if not trades_df.empty else []
        equity = [self._clean_numeric_payload(record) for record in equity_df.to_dict(orient="records")] if not equity_df.empty else []
        return BacktestDetailResponse(meta=self._meta(), summary=summary, trades=trades, equity=equity)

    def backtest_run(
        self,
        model: str,
        asset: str,
        horizon: str,
        params: Dict[str, object],
    ) -> BacktestRunResponse:
        self._load_artifacts()
        if not self._bundle:
            raise RuntimeError("Live artifact bundle unavailable.")
        runtime_policy = self._bundle.meta.get("runtime_backtest") if isinstance(self._bundle.meta, dict) else {}
        if isinstance(runtime_policy, dict) and not bool(runtime_policy.get("allow_runtime_backtest", True)):
            raise RuntimeError("Runtime backtest is disabled by artifact policy.")

        defaults = self._bundle.backtest_summary.get("defaults") if isinstance(self._bundle.backtest_summary, dict) else {}
        merged = dict(defaults or {})
        merged.update(params or {})
        merged["model"] = model
        merged["asset"] = asset
        merged["horizon"] = horizon
        key = hashlib.sha1(json.dumps(merged, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        cache_dir = self.artifact_dir / "backtest_runtime_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / f"{key}.json"
        if cache_file.exists():
            with cache_file.open("r", encoding="utf-8") as fp:
                cached = json.load(fp)
            return BacktestRunResponse(
                meta=self._meta(),
                cacheKey=key,
                summary=dict(cached.get("summary") or {}),
                trades=list(cached.get("trades") or []),
                equity=list(cached.get("equity") or []),
            )

        inputs = self._bundle.backtest_inputs_df
        if inputs.empty:
            detail = self.backtest_detail(model=model, asset=asset, horizon=horizon)
            payload = {"summary": detail.summary, "trades": detail.trades, "equity": detail.equity}
            with cache_file.open("w", encoding="utf-8") as fp:
                json.dump(payload, fp, indent=2)
            return BacktestRunResponse(meta=self._meta(), cacheKey=key, summary=detail.summary, trades=detail.trades, equity=detail.equity)

        subset = inputs[(inputs["model"] == model) & (inputs["asset"] == asset) & (inputs["horizon"] == horizon)].copy()
        if subset.empty:
            detail = self.backtest_detail(model=model, asset=asset, horizon=horizon)
            payload = {"summary": detail.summary, "trades": detail.trades, "equity": detail.equity}
            with cache_file.open("w", encoding="utf-8") as fp:
                json.dump(payload, fp, indent=2)
            return BacktestRunResponse(meta=self._meta(), cacheKey=key, summary=detail.summary, trades=detail.trades, equity=detail.equity)

        subset["timestamp"] = pd.to_datetime(subset["timestamp"], utc=True, errors="coerce")
        subset = subset.dropna(subset=["timestamp"]).sort_values("timestamp")
        prices = pd.DataFrame(
            {
                "open": subset["open"].to_numpy(dtype=float),
                "high": subset["high"].to_numpy(dtype=float),
                "low": subset["low"].to_numpy(dtype=float),
                "close": subset["close"].to_numpy(dtype=float),
            },
            index=subset["timestamp"],
        )
        signals = pd.DataFrame(
            {
                "signal": subset["signal"].to_numpy(),
                "confidence": subset["confidence"].to_numpy(dtype=float),
            },
            index=subset["timestamp"],
        )

        engine = SimpleBacktest(
            initial_capital=float(merged.get("initial_capital", 100000.0)),
            commission_rate=float(merged.get("commission_rate", 0.001)),
            slippage_rate=float(merged.get("slippage_rate", 0.0005)),
            position_sizing=str(merged.get("position_sizing", "fixed_fraction")),
            risk_per_trade=float(merged.get("risk_per_trade", 0.02)),
            max_position_size=float(merged.get("max_position_size", 0.10)),
            bars_per_year=(24 * 365 if horizon in {"1H", "4H"} else 252),
        )
        result = engine.run_backtest(
            prices=prices,
            signals=signals,
            stop_loss_pct=float(merged.get("stop_loss_pct", 0.02)),
            take_profit_pct=float(merged.get("take_profit_pct", 0.04)),
            take_profit_2_pct=float(merged.get("take_profit_2_pct", 0.08)),
            confidence_threshold=float(merged.get("confidence_threshold", 0.55)),
        )
        summary = self._clean_numeric_payload(result.metrics)
        trades = [self._clean_numeric_payload(record) for record in result.trades_frame().to_dict(orient="records")] if result.trades else []
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
        equity = [self._clean_numeric_payload(record) for record in equity_df.to_dict(orient="records")]

        with cache_file.open("w", encoding="utf-8") as fp:
            json.dump({"summary": summary, "trades": trades, "equity": equity}, fp, indent=2)
        return BacktestRunResponse(meta=self._meta(), cacheKey=key, summary=summary, trades=trades, equity=equity)

    def health(self) -> Dict[str, str]:
        self._load_artifacts()
        return {
            'provider': 'live',
            'artifactDir': str(self.artifact_dir),
            'loadedAt': self._loaded_at.isoformat(),
            'generatedAt': self._bundle.generated_at if self._bundle else 'unknown',
            'hasEvaluation': str(bool(self._bundle and self._bundle.evaluation_summary)),
            'hasBacktest': str(bool(self._bundle and self._bundle.backtest_summary)),
        }
