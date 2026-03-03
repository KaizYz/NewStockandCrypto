from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class MetaPayload(BaseModel):
    mode: str
    modelVersion: str
    timestamp: datetime


class PredictionPayload(BaseModel):
    pUp: float = Field(ge=0.0, le=1.0)
    q10: float
    q50: float
    q90: float
    intervalWidth: float
    confidence: float = Field(ge=0.0, le=1.0)
    signal: str


class FeatureContribution(BaseModel):
    name: str
    value: float


class ExplanationPayload(BaseModel):
    summary: str
    topFeatures: List[FeatureContribution]


class PerformancePayload(BaseModel):
    directionAccuracy: float
    brierScore: float
    ece: float
    intervalCoverage: float


class PredictRequest(BaseModel):
    model: str
    asset: str
    horizon: str
    as_of: Optional[datetime] = None


class PredictResponse(BaseModel):
    meta: MetaPayload
    prediction: PredictionPayload
    explanation: ExplanationPayload
    performance: PerformancePayload


class HeatmapResponse(BaseModel):
    meta: MetaPayload
    xLabels: List[str]
    yLabels: List[str]
    matrix: List[List[float]]


class PerformanceResponse(BaseModel):
    meta: MetaPayload
    performance: PerformancePayload


class HealthResponse(BaseModel):
    ok: bool
    mode: str
    modelVersion: str
    loadedAt: datetime
    details: Dict[str, str]


class ModelCatalogItem(BaseModel):
    id: str
    label: str
    description: str


class AssetCatalogItem(BaseModel):
    symbol: str
    label: str
    market: str
    horizons: List[str]


class ModelCatalogResponse(BaseModel):
    models: List[ModelCatalogItem]


class AssetCatalogResponse(BaseModel):
    assets: List[AssetCatalogItem]
