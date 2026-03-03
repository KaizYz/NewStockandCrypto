from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import requests

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

BINANCE_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price?symbol={symbol}'
YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m&includePrePost=true'


@dataclass
class ArtifactBundle:
    model_version: str
    outputs: Dict[str, Dict[str, Dict[str, dict]]]
    generated_at: str


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

        model_version = str(meta_payload.get('model_version') or 'live-artifact')
        outputs = outputs_payload.get('outputs')
        if not isinstance(outputs, dict) or not outputs:
            raise ValueError('model_outputs.json has no outputs map.')

        self._bundle = ArtifactBundle(
            model_version=model_version,
            outputs=outputs,
            generated_at=str(outputs_payload.get('generatedAt') or datetime.now(timezone.utc).isoformat()),
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

    def _apply_realtime_adjustment(self, payload: dict, asset: str) -> dict:
        prediction = dict(payload.get('prediction') or {})
        reference_price = self._safe_float(payload.get('referencePrice'))
        if reference_price is None or reference_price <= 0:
            return payload

        current_price = self._fetch_current_price(asset)
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
        return HeatmapResponse(
            meta=self._meta(),
            xLabels=list(heatmap.get('xLabels') or []),
            yLabels=list(heatmap.get('yLabels') or []),
            matrix=list(heatmap.get('matrix') or []),
        )

    def performance(self, model: str, asset: str, horizon: str) -> PerformanceResponse:
        payload = self._lookup(model, asset, horizon)
        return PerformanceResponse(meta=self._meta(), performance=self._parse_performance(payload.get('performance') or {}))

    def health(self) -> Dict[str, str]:
        self._load_artifacts()
        return {
            'provider': 'live',
            'artifactDir': str(self.artifact_dir),
            'loadedAt': self._loaded_at.isoformat(),
            'generatedAt': self._bundle.generated_at if self._bundle else 'unknown',
        }
