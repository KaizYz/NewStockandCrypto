from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from app.schemas import (
    BacktestDetailResponse,
    BacktestRunResponse,
    BacktestSummaryResponse,
    ExplanationPayload,
    EnsembleBlendItem,
    EnsemblePayload,
    EvaluationFoldsResponse,
    EvaluationSummaryItem,
    EvaluationSummaryResponse,
    FeatureContribution,
    HeatmapResponse,
    InsightsResponse,
    MetaPayload,
    ModelComparisonItem,
    ModelHealthPayload,
    PerformancePayload,
    PerformanceResponse,
    PredictResponse,
    PredictionPayload,
    RuntimeMetaPayload,
)
from app.services.health_logic import quality_status_from_metrics
from app.services.model_registry import ASSETS
from app.services.realtime_runtime import RealtimeInferenceWorker
from training.backtest import SimpleBacktest
from training.runtime_manifest import MODEL_COMPATIBILITY, build_runtime_manifest

MODEL_KEYS = ["lstm", "ensemble", "transformer", "tcn"]
INFERENCE_MS = {
    "ensemble": 12.4,
    "lstm": 18.2,
    "transformer": 26.7,
    "tcn": 10.8,
}
TRAINING_MINUTES = {
    "ensemble": 41.0,
    "lstm": 67.0,
    "transformer": 95.0,
    "tcn": 52.0,
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
    runtime_manifest: Dict[str, object]


class LiveProvider:
    def __init__(self, artifact_dir: str) -> None:
        self.artifact_dir = Path(artifact_dir)
        self._bundle: Optional[ArtifactBundle] = None
        self._loaded_at = datetime.now(timezone.utc)
        self._mtime_guard: float = 0.0
        self._worker: Optional[RealtimeInferenceWorker] = None
        self._load_artifacts(force=True)

    def close(self) -> None:
        if self._worker:
            self._worker.stop()
            self._worker = None

    def _load_artifacts(self, force: bool = False) -> None:
        outputs_path = self.artifact_dir / "model_outputs.json"
        meta_path = self.artifact_dir / "artifact_meta.json"
        metrics_path = self.artifact_dir / "metrics.json"
        evaluation_summary_path = self.artifact_dir / "evaluation_summary.json"
        backtest_summary_path = self.artifact_dir / "backtest_summary.json"
        runtime_manifest_path = self.artifact_dir / "runtime_manifest.json"
        evaluation_folds_path = self.artifact_dir / "evaluation_folds.parquet"
        evaluation_assets_path = self.artifact_dir / "evaluation_assets.parquet"
        backtest_trades_path = self.artifact_dir / "backtest_trades.parquet"
        backtest_equity_path = self.artifact_dir / "backtest_equity.parquet"
        backtest_inputs_path = self.artifact_dir / "backtest_inputs.parquet"
        if not outputs_path.exists() or not meta_path.exists():
            raise FileNotFoundError(
                f"Missing live artifacts under {self.artifact_dir}. "
                "Expected artifact_meta.json and model_outputs.json."
            )

        newest_mtime = max(outputs_path.stat().st_mtime, meta_path.stat().st_mtime)
        if runtime_manifest_path.exists():
            newest_mtime = max(newest_mtime, runtime_manifest_path.stat().st_mtime)
        if not force and newest_mtime <= self._mtime_guard:
            return

        with outputs_path.open("r", encoding="utf-8") as fp:
            outputs_payload = json.load(fp)
        with meta_path.open("r", encoding="utf-8") as fp:
            meta_payload = json.load(fp)
        metrics_payload: Dict[str, Dict[str, dict]] = {}
        if metrics_path.exists():
            with metrics_path.open("r", encoding="utf-8") as fp:
                loaded_metrics = json.load(fp)
            if isinstance(loaded_metrics, dict):
                metrics_payload = loaded_metrics

        evaluation_summary_payload: Dict[str, object] = {}
        if evaluation_summary_path.exists():
            with evaluation_summary_path.open("r", encoding="utf-8") as fp:
                loaded = json.load(fp)
            if isinstance(loaded, dict):
                evaluation_summary_payload = loaded

        backtest_summary_payload: Dict[str, object] = {}
        if backtest_summary_path.exists():
            with backtest_summary_path.open("r", encoding="utf-8") as fp:
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

        model_version = str(meta_payload.get("model_version") or "live-artifact")
        outputs = outputs_payload.get("outputs")
        if not isinstance(outputs, dict) or not outputs:
            raise ValueError("model_outputs.json has no outputs map.")

        sequence_length = int((((meta_payload.get("runtime") or {}) if isinstance(meta_payload, dict) else {}).get("sequence_length")) or 32)
        if runtime_manifest_path.exists():
            with runtime_manifest_path.open("r", encoding="utf-8") as fp:
                runtime_manifest_payload = json.load(fp)
        else:
            runtime_manifest_payload = build_runtime_manifest(
                artifact_dir=self.artifact_dir,
                outputs=outputs,
                meta=meta_payload if isinstance(meta_payload, dict) else {},
                sequence_length=sequence_length,
            )
            with runtime_manifest_path.open("w", encoding="utf-8") as fp:
                json.dump(runtime_manifest_payload, fp, indent=2)

        self._bundle = ArtifactBundle(
            model_version=model_version,
            outputs=outputs,
            generated_at=str(outputs_payload.get("generatedAt") or datetime.now(timezone.utc).isoformat()),
            metrics=metrics_payload,
            meta=meta_payload if isinstance(meta_payload, dict) else {},
            evaluation_summary=evaluation_summary_payload,
            backtest_summary=backtest_summary_payload,
            evaluation_folds_df=evaluation_folds_df,
            evaluation_assets_df=evaluation_assets_df,
            backtest_trades_df=backtest_trades_df,
            backtest_equity_df=backtest_equity_df,
            backtest_inputs_df=backtest_inputs_df,
            runtime_manifest=runtime_manifest_payload if isinstance(runtime_manifest_payload, dict) else {},
        )
        self._loaded_at = datetime.now(timezone.utc)
        self._mtime_guard = newest_mtime
        self._reset_worker()

    def _reset_worker(self) -> None:
        if not self._bundle:
            return
        if self._worker:
            self._worker.stop()
        refresh_interval_sec = int((((self._bundle.runtime_manifest.get("refreshIntervalSec")) if isinstance(self._bundle.runtime_manifest, dict) else None) or 10))
        self._worker = RealtimeInferenceWorker(
            artifact_dir=self.artifact_dir,
            manifest=self._bundle.runtime_manifest,
            outputs=self._bundle.outputs,
            refresh_interval_sec=refresh_interval_sec,
        )
        self._worker.start()

    @property
    def model_version(self) -> str:
        self._load_artifacts()
        if not self._bundle:
            return "live-unavailable"
        return self._bundle.model_version

    def _meta(self) -> MetaPayload:
        return MetaPayload(mode="live", modelVersion=self.model_version, timestamp=datetime.now(timezone.utc))

    @staticmethod
    def _safe_float(value: object) -> Optional[float]:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        if math.isfinite(parsed):
            return parsed
        return None

    @staticmethod
    def _parse_dt(value: object) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.astimezone(timezone.utc)
        raw = str(value).replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    def _lookup_output(self, model: str, asset: str, horizon: str) -> dict:
        self._load_artifacts()
        if not self._bundle:
            raise RuntimeError("Live artifact bundle is not available.")
        return (((self._bundle.outputs.get(model) or {}).get(asset) or {}).get(horizon) or {})

    @staticmethod
    def _parse_features(raw_features: List[dict]) -> List[FeatureContribution]:
        features: List[FeatureContribution] = []
        for item in raw_features or []:
            features.append(
                FeatureContribution(
                    name=str(item.get("name") or "unknown_feature"),
                    value=float(item.get("value") or 0.0),
                )
            )
        return features

    @staticmethod
    def _parse_performance(raw: dict) -> PerformancePayload:
        return PerformancePayload(
            directionAccuracy=float(raw.get("directionAccuracy") or 0.0),
            brierScore=float(raw.get("brierScore") or 0.0),
            ece=float(raw.get("ece") or 0.0),
            intervalCoverage=float(raw.get("intervalCoverage") or 0.0),
        )

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

    @staticmethod
    def _empty_prediction() -> PredictionPayload:
        return PredictionPayload(
            pUp=0.5,
            q10=-0.01,
            q50=0.0,
            q90=0.01,
            intervalWidth=0.02,
            confidence=0.0,
            signal="FLAT",
        )

    def _metric_for(self, model: str, horizon: str, payload: Optional[dict] = None) -> PerformancePayload:
        self._load_artifacts()
        if self._bundle:
            model_metrics = self._bundle.metrics.get(model, {}) if isinstance(self._bundle.metrics, dict) else {}
            horizon_metrics = model_metrics.get(horizon, {}) if isinstance(model_metrics, dict) else {}
            if isinstance(horizon_metrics, dict) and horizon_metrics:
                return self._parse_performance(horizon_metrics)
        return self._parse_performance((payload or {}).get("performance") or {})

    def _resolve_runtime_horizon(self, asset: str, horizon: str, model: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
        if not self._worker:
            return horizon, None
        return self._worker.resolve_selection(asset, horizon, model=model)

    def _runtime_snapshot(self, model: str, asset: str, horizon: str) -> Optional[dict]:
        if not self._worker:
            return None
        return self._worker.get_snapshot(model, asset, horizon)

    def _quality_health(self, horizon: str) -> Dict[str, ModelHealthPayload]:
        health: Dict[str, ModelHealthPayload] = {}
        for model_id in MODEL_KEYS:
            perf = self._metric_for(model_id, horizon)
            status, psi, coverage_drop, reason = quality_status_from_metrics(
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
        return health

    def catalog_assets(self) -> List[dict]:
        self._load_artifacts()
        rows: List[dict] = []
        for spec in ASSETS:
            available = self._worker.available_horizons(spec.symbol) if self._worker else []
            rows.append(
                {
                    "symbol": spec.symbol,
                    "label": spec.label,
                    "market": spec.market,
                    "horizons": list(spec.horizons),
                    "availableHorizons": available,
                    "runtimeEnabled": bool(available),
                }
            )
        return rows

    def predict(self, model: str, asset: str, horizon: str) -> PredictResponse:
        resolved_horizon, auto_switched_from = self._resolve_runtime_horizon(asset, horizon, model=model)
        if resolved_horizon is None:
            raise RuntimeError(f"No runtime-enabled horizon is available for {asset}/{model}.")

        snapshot = self._runtime_snapshot(model, asset, resolved_horizon)
        if not snapshot:
            raise RuntimeError(f"Runtime snapshot is unavailable for {model}/{asset}/{resolved_horizon}.")

        prediction = snapshot.get("prediction") or {}
        explanation = snapshot.get("explanation") or {}

        return PredictResponse(
            meta=self._meta(),
            prediction=PredictionPayload(
                pUp=float(prediction.get("pUp") or 0.5),
                q10=float(prediction.get("q10") or -0.01),
                q50=float(prediction.get("q50") or 0.0),
                q90=float(prediction.get("q90") or 0.01),
                intervalWidth=float(prediction.get("intervalWidth") or 0.02),
                confidence=float(prediction.get("confidence") or 0.0),
                signal=str(prediction.get("signal") or "FLAT"),
            ),
            explanation=ExplanationPayload(
                summary=str(explanation.get("summary") or "Realtime explanation unavailable."),
                topFeatures=self._parse_features(explanation.get("topFeatures") or []),
            ),
            performance=self._metric_for(model, resolved_horizon, snapshot),
            runtime=RuntimeMetaPayload(
                snapshotAt=self._parse_dt(snapshot.get("snapshotAt")),
                priceAsOf=self._parse_dt(snapshot.get("priceAsOf")),
                featureAsOf=self._parse_dt(snapshot.get("featureAsOf")),
                currentPrice=self._safe_float(snapshot.get("currentPrice")),
                autoSwitchedFrom=auto_switched_from,
                runtimeSource=str(snapshot.get("runtimeSource") or "realtime_worker"),
            ),
        )

    def heatmap(self, model: str, asset: str, horizon: str) -> HeatmapResponse:
        resolved_horizon, _ = self._resolve_runtime_horizon(asset, horizon, model=model)
        if resolved_horizon is None:
            raise RuntimeError(f"No runtime-enabled horizon is available for {asset}/{model}.")
        snapshot = self._runtime_snapshot(model, asset, resolved_horizon)
        if not snapshot:
            raise RuntimeError(f"Runtime heatmap is unavailable for {model}/{asset}/{resolved_horizon}.")
        heatmap = snapshot.get("heatmap") or {}
        matrix = list(heatmap.get("matrix") or [])
        scale_min, scale_max = self._scale(matrix)
        return HeatmapResponse(
            meta=MetaPayload(
                mode="live",
                modelVersion=self.model_version,
                timestamp=datetime.now(timezone.utc),
                scaleMin=round(scale_min, 6),
                scaleMax=round(scale_max, 6),
                stateSource="realtime_worker_local",
            ),
            xLabels=list(heatmap.get("xLabels") or []),
            yLabels=list(heatmap.get("yLabels") or []),
            matrix=matrix,
            stateMatrix=self._state_matrix(matrix),
        )

    def heatmap_scoped(self, model: str, asset: str, horizon: str, scope: str = "local") -> HeatmapResponse:
        if scope != "global":
            return self.heatmap(model, asset, horizon)

        resolved_horizon, _ = self._resolve_runtime_horizon(asset, horizon, model=model)
        if resolved_horizon is None:
            raise RuntimeError(f"No runtime-enabled horizon is available for {asset}.")

        matrices: List[List[List[float]]] = []
        x_labels: List[str] = []
        y_labels: List[str] = []
        for model_id in MODEL_KEYS:
            snapshot = self._runtime_snapshot(model_id, asset, resolved_horizon)
            heatmap = (snapshot or {}).get("heatmap") or {}
            model_matrix = list(heatmap.get("matrix") or [])
            model_x = list(heatmap.get("xLabels") or [])
            model_y = list(heatmap.get("yLabels") or [])
            if not model_matrix or not model_x or not model_y:
                continue
            if not x_labels:
                x_labels = model_x
            if not y_labels:
                y_labels = model_y
            if model_x == x_labels and model_y == y_labels:
                matrices.append(model_matrix)

        if not matrices:
            return self.heatmap(model, asset, resolved_horizon)

        merged: List[List[float]] = []
        for row_idx in range(len(y_labels)):
            row: List[float] = []
            for col_idx in range(len(x_labels)):
                values = [float(matrix[row_idx][col_idx]) for matrix in matrices]
                row.append(round(sum(values) / len(values), 6))
            merged.append(row)

        scale_min, scale_max = self._scale(merged)
        return HeatmapResponse(
            meta=MetaPayload(
                mode="live",
                modelVersion=self.model_version,
                timestamp=datetime.now(timezone.utc),
                scaleMin=round(scale_min, 6),
                scaleMax=round(scale_max, 6),
                stateSource="realtime_worker_global",
            ),
            xLabels=x_labels,
            yLabels=y_labels,
            matrix=merged,
            stateMatrix=self._state_matrix(merged),
        )

    def performance(self, model: str, asset: str, horizon: str) -> PerformanceResponse:
        resolved_horizon, _ = self._resolve_runtime_horizon(asset, horizon, model=model)
        if resolved_horizon is None:
            raise RuntimeError(f"No runtime-enabled horizon is available for {asset}/{model}.")
        return PerformanceResponse(meta=self._meta(), performance=self._metric_for(model, resolved_horizon))

    def insights(self, asset: str, horizon: str, model: Optional[str] = None) -> InsightsResponse:
        resolved_horizon, auto_switched_from = self._resolve_runtime_horizon(asset, horizon, model=model)
        target_horizon = resolved_horizon or horizon

        quality_health = self._quality_health(target_horizon)
        runtime_health = {
            model_id: self._worker.get_runtime_health(model_id, asset, target_horizon) if self._worker else {
                "status": "UNAVAILABLE",
                "sessionState": "PAUSED",
                "lastUpdateAt": None,
                "priceAgeSec": None,
                "featureAgeSec": None,
                "reason": "Realtime worker is not running.",
            }
            for model_id in MODEL_KEYS
        }

        comparison: List[ModelComparisonItem] = []
        for model_id in MODEL_KEYS:
            perf = self._metric_for(model_id, target_horizon, self._lookup_output(model_id, asset, target_horizon))
            comparison.append(
                ModelComparisonItem(
                    model=model_id,
                    directionAccuracy=round(perf.directionAccuracy, 3),
                    brierScore=round(perf.brierScore, 3),
                    ece=round(perf.ece, 3),
                    intervalCoverage=round(perf.intervalCoverage, 3),
                    inferenceMs=INFERENCE_MS[model_id],
                    trainingMinutes=TRAINING_MINUTES[model_id],
                    latencySource="estimated",
                    trainingTimeSource="estimated",
                )
            )

        fused = self._worker.fused_snapshot(asset, target_horizon) if self._worker and resolved_horizon else None
        if fused:
            fused_prediction = PredictionPayload(
                pUp=float(fused["prediction"]["pUp"]),
                q10=float(fused["prediction"]["q10"]),
                q50=float(fused["prediction"]["q50"]),
                q90=float(fused["prediction"]["q90"]),
                intervalWidth=float(fused["prediction"]["intervalWidth"]),
                confidence=float(fused["prediction"]["confidence"]),
                signal=str(fused["prediction"]["signal"]),
            )
            available_models = [entry["model"] for entry in fused["blend"]]
            explanation = (
                "Realtime ensemble is blending currently available model snapshots; "
                f"active models: {', '.join(available_models)}."
            )
            blend = [EnsembleBlendItem(model=entry["model"], weight=float(entry["weight"])) for entry in fused["blend"]]
            disagreement_score = float(fused["disagreementScore"])
        else:
            fused_prediction = self._empty_prediction()
            explanation = "Runtime unavailable for the selected asset/horizon. No live ensemble snapshot is currently available."
            blend = []
            disagreement_score = 0.0

        ensemble_payload = EnsemblePayload(
            enabled=bool(fused),
            fusedPrediction=fused_prediction,
            blend=blend,
            explanation=explanation,
            disagreementScore=round(disagreement_score, 3),
        )

        return InsightsResponse(
            meta=self._meta(),
            ensemble=ensemble_payload,
            compatibility=MODEL_COMPATIBILITY,
            health=quality_health,
            qualityHealth=quality_health,
            runtimeHealth=runtime_health,
            selection={
                "requestedAsset": asset,
                "requestedHorizon": horizon,
                "resolvedHorizon": resolved_horizon,
                "autoSwitchedFrom": auto_switched_from,
                "requestedModel": model,
            },
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
                "timestamp": [pd.Timestamp(ts).isoformat() for ts in prices.index],
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

    def health(self) -> Dict[str, object]:
        self._load_artifacts()
        worker_summary = self._worker.summary() if self._worker else {
            "workerRunning": False,
            "lastRefreshAt": None,
            "refreshIntervalSec": 10,
            "feedErrors": {},
        }
        return {
            "provider": "live",
            "artifactDir": str(self.artifact_dir),
            "loadedAt": self._loaded_at.isoformat(),
            "generatedAt": self._bundle.generated_at if self._bundle else "unknown",
            "hasEvaluation": bool(self._bundle and self._bundle.evaluation_summary),
            "hasBacktest": bool(self._bundle and self._bundle.backtest_summary),
            **worker_summary,
        }
