from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.schemas import (
    AssetCatalogResponse,
    AssetCatalogItem,
    BacktestDetailResponse,
    BacktestRunRequest,
    BacktestRunResponse,
    BacktestSummaryResponse,
    EvaluationFoldsResponse,
    EvaluationSummaryResponse,
    HealthResponse,
    InsightsResponse,
    ModelCatalogItem,
    ModelCatalogResponse,
    PerformanceResponse,
    PredictRequest,
    PredictResponse,
    HeatmapResponse,
)
from app.services.model_registry import ASSETS, MODELS, normalize_asset, normalize_horizon, normalize_model
from app.services.provider_factory import provider_factory

router = APIRouter()


@router.get('/health', response_model=HealthResponse)
def health() -> HealthResponse:
    ctx = provider_factory.get()
    details = ctx.provider.health()
    return HealthResponse(
        ok=True,
        mode=ctx.mode,
        modelVersion=ctx.model_version,
        loadedAt=ctx.loaded_at,
        details=details,
    )


@router.post('/v1/admin/reload', response_model=HealthResponse)
def reload_provider() -> HealthResponse:
    ctx = provider_factory.reload()
    details = ctx.provider.health()
    return HealthResponse(
        ok=True,
        mode=ctx.mode,
        modelVersion=ctx.model_version,
        loadedAt=ctx.loaded_at,
        details=details,
    )


@router.get('/v1/catalog/models', response_model=ModelCatalogResponse)
def get_models() -> ModelCatalogResponse:
    return ModelCatalogResponse(models=[ModelCatalogItem(id=model.id, label=model.label, description=model.description) for model in MODELS])


@router.get('/v1/catalog/assets', response_model=AssetCatalogResponse)
def get_assets() -> AssetCatalogResponse:
    return AssetCatalogResponse(
        assets=[
            AssetCatalogItem(symbol=asset.symbol, label=asset.label, market=asset.market, horizons=asset.horizons)
            for asset in ASSETS
        ]
    )


@router.post('/v1/predict', response_model=PredictResponse)
def predict(payload: PredictRequest) -> PredictResponse:
    try:
        model = normalize_model(payload.model)
        asset = normalize_asset(payload.asset)
        horizon = normalize_horizon(payload.horizon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ctx = provider_factory.get()
    try:
        return ctx.provider.predict(model, asset, horizon)
    except Exception as exc:  # pragma: no cover - controlled response path
        raise HTTPException(status_code=502, detail=f'Prediction failed: {exc}') from exc


@router.get('/v1/explain/heatmap', response_model=HeatmapResponse)
def explain_heatmap(
    model: str = Query(...),
    asset: str = Query(...),
    horizon: str = Query(...),
    scope: str = Query('local'),
) -> HeatmapResponse:
    try:
        normalized_model = normalize_model(model)
        normalized_asset = normalize_asset(asset)
        normalized_horizon = normalize_horizon(horizon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    normalized_scope = str(scope or 'local').strip().lower()
    if normalized_scope not in {'local', 'global'}:
        raise HTTPException(status_code=400, detail='Unsupported scope. Use local or global.')

    ctx = provider_factory.get()
    try:
        if hasattr(ctx.provider, 'heatmap_scoped'):
            return ctx.provider.heatmap_scoped(
                normalized_model,
                normalized_asset,
                normalized_horizon,
                normalized_scope,
            )
        return ctx.provider.heatmap(normalized_model, normalized_asset, normalized_horizon, normalized_scope)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Heatmap request failed: {exc}') from exc


@router.get('/v1/performance', response_model=PerformanceResponse)
def performance(
    model: str = Query(...),
    asset: str = Query(...),
    horizon: str = Query(...),
) -> PerformanceResponse:
    try:
        normalized_model = normalize_model(model)
        normalized_asset = normalize_asset(asset)
        normalized_horizon = normalize_horizon(horizon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ctx = provider_factory.get()
    try:
        return ctx.provider.performance(normalized_model, normalized_asset, normalized_horizon)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Performance request failed: {exc}') from exc


@router.get('/v1/meta')
def service_meta() -> dict:
    ctx = provider_factory.get()
    return {
        'service': 'model-explorer',
        'mode': ctx.mode,
        'modelVersion': ctx.model_version,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


@router.get('/v1/insights', response_model=InsightsResponse)
def insights(
    asset: str = Query(...),
    horizon: str = Query(...),
) -> InsightsResponse:
    try:
        normalized_asset = normalize_asset(asset)
        normalized_horizon = normalize_horizon(horizon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ctx = provider_factory.get()
    try:
        return ctx.provider.insights(normalized_asset, normalized_horizon)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Insights request failed: {exc}') from exc


@router.get('/v1/evaluation/summary', response_model=EvaluationSummaryResponse)
def evaluation_summary(
    model: str = Query(""),
    asset: str = Query(""),
    horizon: str = Query(""),
) -> EvaluationSummaryResponse:
    normalized_model = normalize_model(model) if model else None
    normalized_asset = normalize_asset(asset) if asset else None
    normalized_horizon = normalize_horizon(horizon) if horizon else None
    ctx = provider_factory.get()
    try:
        return ctx.provider.evaluation_summary(
            model=normalized_model,
            asset=normalized_asset,
            horizon=normalized_horizon,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Evaluation summary request failed: {exc}') from exc


@router.get('/v1/evaluation/folds', response_model=EvaluationFoldsResponse)
def evaluation_folds(
    model: str = Query(""),
    asset: str = Query(""),
    horizon: str = Query(""),
    limit: int = Query(2000, ge=1, le=50000),
) -> EvaluationFoldsResponse:
    normalized_model = normalize_model(model) if model else None
    normalized_asset = normalize_asset(asset) if asset else None
    normalized_horizon = normalize_horizon(horizon) if horizon else None
    ctx = provider_factory.get()
    try:
        return ctx.provider.evaluation_folds(
            model=normalized_model,
            asset=normalized_asset,
            horizon=normalized_horizon,
            limit=int(limit),
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Evaluation folds request failed: {exc}') from exc


@router.get('/v1/backtest/summary', response_model=BacktestSummaryResponse)
def backtest_summary(
    model: str = Query(""),
    asset: str = Query(""),
    horizon: str = Query(""),
) -> BacktestSummaryResponse:
    normalized_model = normalize_model(model) if model else None
    normalized_asset = normalize_asset(asset) if asset else None
    normalized_horizon = normalize_horizon(horizon) if horizon else None
    ctx = provider_factory.get()
    try:
        return ctx.provider.backtest_summary(
            model=normalized_model,
            asset=normalized_asset,
            horizon=normalized_horizon,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Backtest summary request failed: {exc}') from exc


@router.get('/v1/backtest/detail', response_model=BacktestDetailResponse)
def backtest_detail(
    model: str = Query(...),
    asset: str = Query(...),
    horizon: str = Query(...),
) -> BacktestDetailResponse:
    normalized_model = normalize_model(model)
    normalized_asset = normalize_asset(asset)
    normalized_horizon = normalize_horizon(horizon)
    ctx = provider_factory.get()
    try:
        return ctx.provider.backtest_detail(
            model=normalized_model,
            asset=normalized_asset,
            horizon=normalized_horizon,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Backtest detail request failed: {exc}') from exc


@router.post('/v1/backtest/run', response_model=BacktestRunResponse)
def backtest_run(payload: BacktestRunRequest) -> BacktestRunResponse:
    normalized_model = normalize_model(payload.model)
    normalized_asset = normalize_asset(payload.asset)
    normalized_horizon = normalize_horizon(payload.horizon)
    ctx = provider_factory.get()
    try:
        return ctx.provider.backtest_run(
            model=normalized_model,
            asset=normalized_asset,
            horizon=normalized_horizon,
            params=payload.model_dump(),
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'Backtest run request failed: {exc}') from exc
