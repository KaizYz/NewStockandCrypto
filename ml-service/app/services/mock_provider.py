from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime, timezone
from typing import Dict, List

from app.schemas import (
    ExplanationPayload,
    FeatureContribution,
    HeatmapResponse,
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


class MockProvider:
    def __init__(self) -> None:
        self.model_version = 'mock-v1'

    @staticmethod
    def _seed(model: str, asset: str, horizon: str) -> int:
        digest = hashlib.sha256(f'{model}|{asset}|{horizon}'.encode('utf-8')).hexdigest()
        return int(digest[:8], 16)

    def _meta(self) -> MetaPayload:
        return MetaPayload(mode='mock', modelVersion=self.model_version, timestamp=datetime.now(timezone.utc))

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

    def heatmap(self, model: str, asset: str, horizon: str) -> HeatmapResponse:
        rng = random.Random(self._seed(model, asset, horizon) + 29)
        matrix: List[List[float]] = []
        for row_idx, _ in enumerate(FEATURE_NAMES):
            row: List[float] = []
            for col_idx, _ in enumerate(WINDOW_LABELS):
                raw = math.sin((row_idx + 1) * 0.9 + (col_idx + 1) * 0.35 + rng.uniform(-0.3, 0.3))
                row.append(round(raw, 3))
            matrix.append(row)

        return HeatmapResponse(
            meta=self._meta(),
            xLabels=WINDOW_LABELS,
            yLabels=FEATURE_NAMES,
            matrix=matrix,
        )

    def performance(self, model: str, asset: str, horizon: str) -> PerformanceResponse:
        return PerformanceResponse(meta=self._meta(), performance=self._performance(model, asset, horizon))

    def health(self) -> Dict[str, str]:
        return {
            'provider': 'mock',
            'deterministic': 'true',
            'note': 'Use this mode for quick UI validation before live artifacts are ready.',
        }
