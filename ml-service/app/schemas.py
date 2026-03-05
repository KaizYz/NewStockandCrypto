from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class MetaPayload(BaseModel):
    mode: str
    modelVersion: str
    timestamp: datetime
    scaleMin: Optional[float] = None
    scaleMax: Optional[float] = None
    stateSource: Optional[str] = None


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
    stateMatrix: Optional[List[List[float]]] = None


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


class EnsembleBlendItem(BaseModel):
    model: str
    weight: float


class EnsemblePayload(BaseModel):
    enabled: bool
    fusedPrediction: PredictionPayload
    blend: List[EnsembleBlendItem]
    explanation: str
    disagreementScore: float


class ModelHealthPayload(BaseModel):
    status: str
    psi: float
    coverageDropPct: float
    reason: str


class ModelComparisonItem(BaseModel):
    model: str
    directionAccuracy: float
    brierScore: float
    ece: float
    intervalCoverage: float
    inferenceMs: float
    trainingMinutes: float
    latencySource: str
    trainingTimeSource: str


class InsightsResponse(BaseModel):
    meta: MetaPayload
    ensemble: EnsemblePayload
    compatibility: Dict[str, List[str]]
    health: Dict[str, ModelHealthPayload]
    comparison: List[ModelComparisonItem]


class EvaluationSummaryItem(BaseModel):
    model: str
    horizon: str
    sampleCount: int
    direction: Dict[str, float]
    calibration: Dict[str, Any]
    optimalThreshold: Dict[str, float]
    magnitude: Dict[str, float]
    coverage: Dict[str, float]
    benchmark: Dict[str, str]


class EvaluationSummaryResponse(BaseModel):
    meta: MetaPayload
    records: List[EvaluationSummaryItem]


class EvaluationFoldsResponse(BaseModel):
    meta: MetaPayload
    rows: List[Dict[str, Any]]


class BacktestSummaryResponse(BaseModel):
    meta: MetaPayload
    rows: List[Dict[str, Any]]


class BacktestDetailResponse(BaseModel):
    meta: MetaPayload
    summary: Dict[str, Any]
    trades: List[Dict[str, Any]]
    equity: List[Dict[str, Any]]


class BacktestRunRequest(BaseModel):
    model: str
    asset: str
    horizon: str
    initial_capital: float = 100000.0
    commission_rate: float = 0.001
    slippage_rate: float = 0.0005
    position_sizing: str = "fixed_fraction"
    risk_per_trade: float = 0.02
    max_position_size: float = 0.10
    confidence_threshold: float = 0.55
    stop_loss_pct: float = 0.02
    take_profit_pct: float = 0.04
    take_profit_2_pct: float = 0.08


class BacktestRunResponse(BaseModel):
    meta: MetaPayload
    cacheKey: str
    summary: Dict[str, Any]
    trades: List[Dict[str, Any]]
    equity: List[Dict[str, Any]]
