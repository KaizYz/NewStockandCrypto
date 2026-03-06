from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

FEATURE_COLUMNS = [
    "return_1",
    "return_3",
    "return_6",
    "return_12",
    "momentum_6",
    "momentum_12",
    "vol_6",
    "vol_12",
    "hl_spread",
    "oc_spread",
    "volume_z",
    "asset_id",
]

SEQUENCE_FEATURE_COLUMNS = [
    "return_1",
    "return_3",
    "return_6",
    "momentum_6",
    "momentum_12",
    "vol_6",
    "vol_12",
    "hl_spread",
    "oc_spread",
    "volume_z",
]

MODEL_COMPATIBILITY = {
    "lstm": ["1H", "4H", "1D"],
    "ensemble": ["1H", "4H", "1D", "3D"],
    "transformer": ["4H", "1D", "3D"],
    "tcn": ["1H", "4H"],
}

AUTO_SWITCH_ORDER = {
    "1H": ["1H", "4H", "1D", "3D"],
    "4H": ["4H", "1H", "1D", "3D"],
    "1D": ["1D", "4H", "3D", "1H"],
    "3D": ["3D", "1D", "4H", "1H"],
}

DEEP_MODELS = {"lstm", "transformer", "tcn"}
ENSEMBLE_MODEL = "ensemble"
DEFAULT_LOOKBACK_BARS = 64
DEFAULT_SEQUENCE_LENGTH = 32
DEFAULT_REFRESH_INTERVAL_SEC = 10


def infer_market(asset: str) -> str:
    normalized = str(asset or "").upper()
    if normalized.endswith("USDT"):
        return "CRYPTO"
    if normalized.endswith(".SS") or normalized.endswith(".SZ") or normalized.endswith(".SH"):
        return "CN"
    return "US"


def is_fallback_output(payload: dict | None) -> bool:
    if not isinstance(payload, dict):
        return True

    explanation = payload.get("explanation") or {}
    summary = str(explanation.get("summary") or "").lower()
    if "fallback forecast" in summary or "missing asset coverage" in summary:
        return True

    top_features = explanation.get("topFeatures") or []
    if top_features:
        first_name = str((top_features[0] or {}).get("name") or "").strip().lower()
        if first_name == "missing_coverage":
            return True

    reference_price = payload.get("referencePrice")
    try:
        if float(reference_price or 0.0) <= 0.0 and "live artifact forecast" not in summary:
            return True
    except (TypeError, ValueError):
        return True

    return False


def resolve_horizon(requested_horizon: str, available_horizons: Iterable[str]) -> tuple[Optional[str], Optional[str]]:
    available = {str(hz).upper() for hz in available_horizons if hz}
    normalized = str(requested_horizon or "").upper()
    order = AUTO_SWITCH_ORDER.get(normalized, [normalized])
    for candidate in order:
        if candidate in available:
            auto_switched_from = normalized if candidate != normalized else None
            return candidate, auto_switched_from
    return None, normalized or None


def available_horizons_for_asset(
    manifest: dict,
    *,
    asset: str,
    model: Optional[str] = None,
) -> List[str]:
    assets = manifest.get("assets") if isinstance(manifest, dict) else {}
    asset_payload = assets.get(asset) if isinstance(assets, dict) else {}
    horizons = asset_payload.get("horizons") if isinstance(asset_payload, dict) else {}
    output: List[str] = []
    if not isinstance(horizons, dict):
        return output

    for horizon, horizon_payload in horizons.items():
        models = horizon_payload.get("models") if isinstance(horizon_payload, dict) else {}
        if not isinstance(models, dict):
            continue
        if model:
            model_payload = models.get(model) or {}
            if bool(model_payload.get("valid")):
                output.append(str(horizon).upper())
            continue
        if any(bool((entry or {}).get("valid")) for entry in models.values()):
            output.append(str(horizon).upper())
    return output


def manifest_entry(
    *,
    artifact_dir: Path,
    model_id: str,
    asset: str,
    horizon: str,
    payload: dict | None,
    generated_at: str,
    sequence_length: int,
    asset_id: Optional[int],
) -> dict:
    horizon_dir = artifact_dir / "models" / horizon
    model_path = horizon_dir / ("ensemble.joblib" if model_id == ENSEMBLE_MODEL else f"{model_id}.pt")
    model_exists = model_path.exists()
    artifact_output_valid = not is_fallback_output(payload)
    requires_asset_id = model_id == ENSEMBLE_MODEL

    valid = False
    reason = "missing_checkpoint"
    if not model_exists:
        valid = False
        reason = "missing_checkpoint"
    elif requires_asset_id:
        valid = artifact_output_valid and asset_id is not None
        if not artifact_output_valid:
            reason = "fallback_output"
        elif asset_id is None:
            reason = "missing_asset_id"
        else:
            reason = "ready"
    else:
        # Sequence models can run from live features even when the artifact output
        # for a specific asset was missing during export.
        valid = True
        reason = "ready" if artifact_output_valid else "checkpoint_only_runtime"

    return {
        "valid": bool(valid),
        "artifactOutputValid": bool(artifact_output_valid),
        "reason": reason,
        "market": infer_market(asset),
        "lookbackBars": DEFAULT_LOOKBACK_BARS,
        "sequenceLength": int(sequence_length) if model_id in DEEP_MODELS else None,
        "featureColumns": list(SEQUENCE_FEATURE_COLUMNS if model_id in DEEP_MODELS else FEATURE_COLUMNS),
        "assetId": int(asset_id) if asset_id is not None else None,
        "requiresAssetId": requires_asset_id,
        "modelPath": str(model_path.resolve()) if model_exists else str(model_path),
        "generatedAt": generated_at,
        "runtimeSource": "artifact_manifest",
    }


def build_runtime_manifest(
    *,
    artifact_dir: Path,
    outputs: Dict[str, Dict[str, Dict[str, dict]]],
    meta: Dict[str, object],
    sequence_length: int = DEFAULT_SEQUENCE_LENGTH,
    asset_id_map: Optional[Dict[str, Dict[str, int]]] = None,
) -> dict:
    generated_at = str(meta.get("training_timestamp") or datetime.now(timezone.utc).isoformat())
    assets = list(meta.get("assets") or [])
    horizons = list(meta.get("horizons") or [])
    models = list(meta.get("models") or [])
    manifest_assets: Dict[str, dict] = {}
    asset_id_map = asset_id_map or {}

    for asset in assets:
        horizon_payloads: Dict[str, dict] = {}
        for horizon in horizons:
            model_payloads: Dict[str, dict] = {}
            available_models: List[str] = []
            for model_id in models:
                payload = (((outputs.get(model_id) or {}).get(asset) or {}).get(horizon) or {})
                asset_id = (asset_id_map.get(horizon) or {}).get(asset)
                entry = manifest_entry(
                    artifact_dir=artifact_dir,
                    model_id=model_id,
                    asset=asset,
                    horizon=horizon,
                    payload=payload,
                    generated_at=generated_at,
                    sequence_length=sequence_length,
                    asset_id=asset_id,
                )
                model_payloads[model_id] = entry
                if entry["valid"]:
                    available_models.append(model_id)

            horizon_payloads[horizon] = {
                "availableModels": available_models,
                "models": model_payloads,
            }

        manifest_assets[asset] = {
            "market": infer_market(asset),
            "availableHorizons": available_horizons_for_asset(
                {"assets": {asset: {"horizons": horizon_payloads}}},
                asset=asset,
            ),
            "horizons": horizon_payloads,
        }

    return {
        "generatedAt": generated_at,
        "modelVersion": str(meta.get("model_version") or "unknown"),
        "refreshIntervalSec": int(DEFAULT_REFRESH_INTERVAL_SEC),
        "assets": manifest_assets,
    }
