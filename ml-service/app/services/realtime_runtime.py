from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
import requests
import torch

from app.services.health_logic import runtime_status
from training.data_pipeline import _build_features
from training.models import LSTMClassifier, TCNClassifier, TransformerClassifier
from training.runtime_manifest import (
    AUTO_SWITCH_ORDER,
    DEFAULT_LOOKBACK_BARS,
    DEFAULT_REFRESH_INTERVAL_SEC,
    DEFAULT_SEQUENCE_LENGTH,
    DEEP_MODELS,
    ENSEMBLE_MODEL,
    FEATURE_COLUMNS,
    MODEL_COMPATIBILITY,
    SEQUENCE_FEATURE_COLUMNS,
    available_horizons_for_asset,
    infer_market,
    resolve_horizon,
)

HEATMAP_FEATURES = ["return_1", "return_3", "return_6", "momentum_6", "momentum_12", "vol_6"]
HEATMAP_X = ["W-7", "W-6", "W-5", "W-4", "W-3", "W-2", "W-1", "W0"]
RUNTIME_BLEND_WEIGHTS = {
    "lstm": 0.40,
    "ensemble": 0.30,
    "transformer": 0.20,
    "tcn": 0.10,
}
US_INDEX_SERIES_KEYS = {"^DJI": "dow", "^NDX": "nasdaq100", "^GSPC": "sp500", "^SPX": "sp500"}
CN_INDEX_SERIES_KEYS = {"000001.SS": "sse", "000001.SH": "sse", "000300.SH": "csi300"}


@dataclass
class AssetFeedState:
    asset: str
    market: str
    session_state: str = "PAUSED"
    last_update_at: Optional[datetime] = None
    last_error: Optional[str] = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_float(value: object, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if math.isfinite(parsed):
        return parsed
    return fallback


def _signal_from_probability(p_up: float) -> str:
    if p_up >= 0.55:
        return "LONG"
    if p_up <= 0.45:
        return "SHORT"
    return "FLAT"


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _read_json(url: str, *, timeout: int = 8) -> dict:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected payload from {url}")
    return payload


def _session_state_from_feed(market: str, phase_code: str | None) -> str:
    normalized_market = str(market or "").upper()
    phase = str(phase_code or "").upper()
    if normalized_market == "CRYPTO":
        return "OPEN"
    if normalized_market == "CN":
        if phase in {"CONTINUOUS_AM", "CONTINUOUS_PM", "CLOSE_AUCTION"}:
            return "OPEN"
        return "CLOSED"
    if normalized_market == "US":
        if phase == "REGULAR":
            return "OPEN"
        return "CLOSED"
    return "PAUSED"


def _normalize_ohlcv_frame(rows: List[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"])
    frame = pd.DataFrame(rows)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce")
    frame = frame.dropna(subset=["timestamp"]).sort_values("timestamp")
    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"])
    frame["volume"] = frame["volume"].fillna(0.0)
    return frame[["timestamp", "open", "high", "low", "close", "volume"]].drop_duplicates("timestamp").reset_index(drop=True)


def _to_price_bar_rows(series: List[dict]) -> List[dict]:
    rows: List[dict] = []
    for point in series:
        ts = point.get("ts")
        price = _safe_float(point.get("price"), fallback=float("nan"))
        if not ts or not math.isfinite(price):
            continue
        rows.append(
            {
                "timestamp": ts,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": 0.0,
            }
        )
    return rows


def _resample_to_training_interval(frame: pd.DataFrame, horizon: str) -> pd.DataFrame:
    if frame.empty:
        return frame
    rule = "1h" if str(horizon).upper() in {"1H", "4H"} else "1d"
    indexed = frame.copy().set_index("timestamp").sort_index()
    resampled = indexed.resample(rule).agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    )
    resampled = resampled.dropna(subset=["open", "high", "low", "close"]).reset_index()
    return resampled


def _runtime_top_features(feature_frame: pd.DataFrame) -> List[dict]:
    if feature_frame.empty:
        return [{"name": "runtime_unavailable", "value": 0.0}]
    latest = feature_frame.iloc[-1]
    values = []
    for name in HEATMAP_FEATURES + ["vol_12", "oc_spread", "hl_spread"]:
        raw = _safe_float(latest.get(name), fallback=0.0)
        values.append((name, raw))
    max_abs = max((abs(value) for _, value in values), default=1.0) or 1.0
    values.sort(key=lambda item: abs(item[1]), reverse=True)
    return [{"name": name, "value": round(float(value / max_abs), 3)} for name, value in values[:6]]


def _runtime_heatmap(feature_frame: pd.DataFrame) -> dict:
    if feature_frame.empty:
        return {
            "xLabels": HEATMAP_X,
            "yLabels": HEATMAP_FEATURES,
            "matrix": [[0.0 for _ in HEATMAP_X] for _ in HEATMAP_FEATURES],
        }

    tail = feature_frame.tail(len(HEATMAP_X)).copy()
    matrix: List[List[float]] = []
    for feature in HEATMAP_FEATURES:
        values = tail[feature].to_numpy(dtype=float)
        if len(values) < len(HEATMAP_X):
            values = np.pad(values, (len(HEATMAP_X) - len(values), 0), constant_values=np.nan)
        mean = np.nanmean(values)
        std = np.nanstd(values) + 1e-9
        normalized = np.nan_to_num((values - mean) / std, nan=0.0, posinf=0.0, neginf=0.0)
        matrix.append([round(float(_clamp(value, -2.5, 2.5)), 3) for value in normalized])
    return {"xLabels": HEATMAP_X, "yLabels": HEATMAP_FEATURES, "matrix": matrix}


def _generic_quantiles(feature_frame: pd.DataFrame, p_up: float) -> Tuple[float, float, float]:
    if feature_frame.empty:
        center = (p_up - 0.5) * 0.02
        width = 0.02
    else:
        latest = feature_frame.iloc[-1]
        volatility = max(abs(_safe_float(latest.get("vol_12"), 0.0)), abs(_safe_float(latest.get("vol_6"), 0.0)))
        width = _clamp(0.01 + volatility * 3.0, 0.012, 0.08)
        center = _clamp((p_up - 0.5) * max(width * 1.4, 0.02), -0.12, 0.12)
    q10 = round(float(center - width * 0.5), 4)
    q50 = round(float(center), 4)
    q90 = round(float(center + width * 0.5), 4)
    ordered = sorted([q10, q50, q90])
    return ordered[0], ordered[1], ordered[2]


class RealtimeInferenceWorker:
    def __init__(
        self,
        *,
        artifact_dir: Path,
        manifest: dict,
        outputs: Dict[str, Dict[str, Dict[str, dict]]],
        refresh_interval_sec: int = DEFAULT_REFRESH_INTERVAL_SEC,
        unified_base_url: str = "http://127.0.0.1:9000",
    ) -> None:
        self.artifact_dir = artifact_dir
        self.manifest = manifest
        self.outputs = outputs
        self.refresh_interval_sec = max(5, int(refresh_interval_sec))
        self.unified_base_url = unified_base_url.rstrip("/")
        self.state_dir = self.artifact_dir / "runtime_state"
        self.state_dir.mkdir(parents=True, exist_ok=True)

        self._stop_event = threading.Event()
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._last_refresh_at: Optional[datetime] = None
        self._feed_errors: Dict[str, str] = {}
        self._snapshots: Dict[Tuple[str, str, str], dict] = {}
        self._raw_bars_cache: Dict[str, pd.DataFrame] = {}
        self._feed_state: Dict[str, AssetFeedState] = {}

        self._ensemble_packs: Dict[str, dict] = {}
        self._deep_models: Dict[Tuple[str, str], torch.nn.Module] = {}
        self._load_model_files()
        self._load_cached_bars()

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            try:
                self.refresh_once()
            except Exception as exc:
                self._feed_errors["worker_init"] = str(exc)
            self._thread = threading.Thread(target=self._run_loop, name="RealtimeInferenceWorker", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=min(self.refresh_interval_sec, 5))

    def summary(self) -> dict:
        with self._lock:
            return {
                "workerRunning": bool(self._thread and self._thread.is_alive()),
                "lastRefreshAt": self._last_refresh_at.isoformat() if self._last_refresh_at else None,
                "refreshIntervalSec": self.refresh_interval_sec,
                "feedErrors": dict(self._feed_errors),
            }

    def available_horizons(self, asset: str, model: Optional[str] = None) -> List[str]:
        with self._lock:
            runtime_horizons = sorted(
                {
                    horizon
                    for snapshot_model, snapshot_asset, horizon in self._snapshots.keys()
                    if snapshot_asset == asset and (model is None or snapshot_model == model)
                },
                key=lambda item: AUTO_SWITCH_ORDER["1H"].index(item) if item in AUTO_SWITCH_ORDER["1H"] else 99,
            )
        if self._last_refresh_at is not None:
            return runtime_horizons
        return available_horizons_for_asset(self.manifest, asset=asset, model=model)

    def resolve_selection(self, asset: str, horizon: str, model: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
        available = self.available_horizons(asset, model=model)
        return resolve_horizon(horizon, available)

    def get_runtime_health(self, model: str, asset: str, horizon: str) -> dict:
        feed = self._feed_state.get(asset) or AssetFeedState(asset=asset, market=infer_market(asset))
        with self._lock:
            snapshot = self._snapshots.get((model, asset, horizon))
        if snapshot is None:
            updated_at = None
            status = "UNAVAILABLE"
            price_age = None
            feature_age = None
            reason = feed.last_error or "No runtime snapshot is available yet."
        else:
            status, price_age, feature_age, reason = runtime_status(
                last_update_at=snapshot.get("updated_at"),
                refresh_interval_sec=self.refresh_interval_sec,
                session_state=feed.session_state,
                last_error=snapshot.get("last_error"),
            )
            updated_at = snapshot.get("updated_at")
        return {
            "status": status,
            "sessionState": feed.session_state,
            "lastUpdateAt": updated_at.isoformat() if updated_at else None,
            "priceAgeSec": price_age,
            "featureAgeSec": feature_age,
            "reason": reason,
        }

    def get_snapshot(self, model: str, asset: str, horizon: str) -> Optional[dict]:
        with self._lock:
            snapshot = self._snapshots.get((model, asset, horizon))
            return dict(snapshot) if snapshot else None

    def comparison_models(self, asset: str, horizon: str) -> List[str]:
        with self._lock:
            found = []
            for model_id in RUNTIME_BLEND_WEIGHTS:
                if (model_id, asset, horizon) in self._snapshots:
                    found.append(model_id)
            return found

    def fused_snapshot(self, asset: str, horizon: str) -> Optional[dict]:
        available_models = self.comparison_models(asset, horizon)
        if not available_models:
            return None
        weight_total = sum(RUNTIME_BLEND_WEIGHTS[model_id] for model_id in available_models) or 1.0
        normalized = {model_id: RUNTIME_BLEND_WEIGHTS[model_id] / weight_total for model_id in available_models}
        with self._lock:
            snapshots = {model_id: dict(self._snapshots[(model_id, asset, horizon)]) for model_id in available_models}

        p_values = [snapshots[model_id]["prediction"]["pUp"] for model_id in available_models]
        disagreement = min(1.0, float(np.std(np.asarray(p_values, dtype=np.float64))) if len(p_values) > 1 else 0.0)

        def weighted(key: str) -> float:
            return float(sum(snapshots[model_id]["prediction"][key] * normalized[model_id] for model_id in available_models))

        p_up = weighted("pUp")
        confidence = _clamp(weighted("confidence") + max(0.0, 0.10 - disagreement), 0.0, 0.99)
        prediction = {
            "pUp": round(p_up, 3),
            "q10": round(weighted("q10"), 4),
            "q50": round(weighted("q50"), 4),
            "q90": round(weighted("q90"), 4),
            "intervalWidth": round(weighted("q90") - weighted("q10"), 4),
            "confidence": round(confidence, 3),
            "signal": _signal_from_probability(p_up),
        }
        return {
            "prediction": prediction,
            "blend": [{"model": model_id, "weight": round(weight, 3)} for model_id, weight in normalized.items()],
            "disagreementScore": round(disagreement, 3),
        }

    def _load_model_files(self) -> None:
        for horizon in {hz for model_map in MODEL_COMPATIBILITY.values() for hz in model_map}:
            horizon_dir = self.artifact_dir / "models" / horizon
            ensemble_path = horizon_dir / "ensemble.joblib"
            if ensemble_path.exists():
                try:
                    self._ensemble_packs[horizon] = joblib.load(ensemble_path)
                except Exception:
                    self._feed_errors[f"{horizon}:ensemble_load"] = "Failed to load ensemble checkpoint."

            if horizon_dir.exists():
                for model_id, cls in {
                    "lstm": LSTMClassifier,
                    "transformer": TransformerClassifier,
                    "tcn": TCNClassifier,
                }.items():
                    path = horizon_dir / f"{model_id}.pt"
                    if not path.exists():
                        continue
                    try:
                        model = cls(input_dim=len(SEQUENCE_FEATURE_COLUMNS))
                        state = torch.load(path, map_location="cpu")
                        model.load_state_dict(state)
                        model.eval()
                        self._deep_models[(horizon, model_id)] = model
                    except Exception:
                        self._feed_errors[f"{horizon}:{model_id}_load"] = "Failed to load deep checkpoint."

    def _cache_file(self, asset: str) -> Path:
        safe_asset = asset.replace("^", "IDX_").replace(".", "_")
        return self.state_dir / f"{safe_asset}_bars.parquet"

    def _load_cached_bars(self) -> None:
        for asset_payload in (self.manifest.get("assets") or {}).keys():
            cache_path = self._cache_file(asset_payload)
            if not cache_path.exists():
                continue
            try:
                frame = pd.read_parquet(cache_path)
                if not frame.empty:
                    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce")
                    frame = frame.dropna(subset=["timestamp"]).sort_values("timestamp").drop_duplicates("timestamp")
                    self._raw_bars_cache[asset_payload] = frame.reset_index(drop=True)
            except Exception:
                self._feed_errors[f"{asset_payload}:cache_load"] = "Failed to load persisted runtime bars."

    def _persist_raw_bars(self, asset: str, frame: pd.DataFrame) -> None:
        try:
            frame.to_parquet(self._cache_file(asset), index=False)
        except Exception:
            self._feed_errors[f"{asset}:cache_write"] = "Failed to persist runtime bars."

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.refresh_once()
            except Exception as exc:
                self._feed_errors["worker"] = str(exc)
            self._stop_event.wait(self.refresh_interval_sec)

    def refresh_once(self) -> None:
        assets = list((self.manifest.get("assets") or {}).keys())
        for asset in assets:
            self._refresh_asset(asset)
        self._last_refresh_at = _utc_now()

    def _refresh_asset(self, asset: str) -> None:
        market = infer_market(asset)
        try:
            raw_frame, session_state = self._fetch_raw_bars(asset)
            if raw_frame.empty:
                raise RuntimeError("Unified market feed returned no bars.")
            cached = self._raw_bars_cache.get(asset)
            if cached is not None and not cached.empty:
                merged = pd.concat([cached, raw_frame], axis=0, ignore_index=True)
                merged = merged.drop_duplicates("timestamp").sort_values("timestamp").reset_index(drop=True)
            else:
                merged = raw_frame
            self._raw_bars_cache[asset] = merged
            self._persist_raw_bars(asset, merged)
            self._feed_state[asset] = AssetFeedState(
                asset=asset,
                market=market,
                session_state=session_state,
                last_update_at=_utc_now(),
                last_error=None,
            )
            self._feed_errors.pop(asset, None)
        except Exception as exc:
            cached = self._raw_bars_cache.get(asset, pd.DataFrame())
            prior = self._feed_state.get(asset) or AssetFeedState(asset=asset, market=market)
            prior.last_error = str(exc)
            prior.session_state = prior.session_state if prior.last_update_at else "PAUSED"
            self._feed_state[asset] = prior
            self._feed_errors[asset] = str(exc)
            if cached.empty:
                return

        horizons = list(((self.manifest.get("assets") or {}).get(asset) or {}).get("horizons", {}).keys())
        for horizon in horizons:
            self._refresh_asset_horizon(asset, horizon)

    def _refresh_asset_horizon(self, asset: str, horizon: str) -> None:
        raw_frame = self._raw_bars_cache.get(asset)
        if raw_frame is None or raw_frame.empty:
            return
        training_frame = _resample_to_training_interval(raw_frame, horizon)
        features = _build_features(training_frame).replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)
        asset_manifest = (((self.manifest.get("assets") or {}).get(asset) or {}).get("horizons") or {}).get(horizon) or {}
        model_entries = asset_manifest.get("models") or {}

        if training_frame.empty or features.empty:
            for model_id in model_entries:
                self._mark_snapshot_error(model_id, asset, horizon, "Insufficient live bars after feature construction.")
            return

        for model_id, entry in model_entries.items():
            if not bool((entry or {}).get("valid")):
                self._mark_snapshot_error(model_id, asset, horizon, str((entry or {}).get("reason") or "Runtime disabled"))
                continue
            try:
                snapshot = self._infer_model_snapshot(
                    model=model_id,
                    asset=asset,
                    horizon=horizon,
                    training_frame=training_frame,
                    feature_frame=features,
                    entry=entry,
                )
                if snapshot is None:
                    self._mark_snapshot_error(model_id, asset, horizon, "Insufficient live warmup for runtime inference.")
                    continue
                with self._lock:
                    self._snapshots[(model_id, asset, horizon)] = snapshot
            except Exception as exc:
                self._mark_snapshot_error(model_id, asset, horizon, str(exc))

    def _mark_snapshot_error(self, model: str, asset: str, horizon: str, reason: str) -> None:
        with self._lock:
            snapshot = self._snapshots.get((model, asset, horizon))
            if snapshot:
                snapshot["last_error"] = reason
                snapshot["updated_at"] = snapshot.get("updated_at") or _utc_now()

    def _infer_model_snapshot(
        self,
        *,
        model: str,
        asset: str,
        horizon: str,
        training_frame: pd.DataFrame,
        feature_frame: pd.DataFrame,
        entry: dict,
    ) -> Optional[dict]:
        lookback = max(DEFAULT_LOOKBACK_BARS, int(entry.get("lookbackBars") or DEFAULT_LOOKBACK_BARS))
        if len(feature_frame) < lookback:
            return None

        p_up: float
        q10: float
        q50: float
        q90: float

        if model == ENSEMBLE_MODEL:
            pack = self._ensemble_packs.get(horizon)
            if pack is None:
                raise RuntimeError("Ensemble checkpoint is not loaded.")
            asset_id = entry.get("assetId")
            if asset_id is None:
                raise RuntimeError("Missing asset id for ensemble runtime inference.")
            feature_columns = list(pack.get("feature_columns") or FEATURE_COLUMNS)
            latest_row = feature_frame.iloc[-1].copy()
            latest_row["asset_id"] = int(asset_id)
            latest_x = latest_row[feature_columns].to_numpy(dtype=np.float32).reshape(1, -1)
            p_up = float(pack["direction_model"].predict_proba(latest_x)[:, 1][0])
            q10 = float(pack["q10_model"].predict(latest_x)[0])
            q50 = float(pack["q50_model"].predict(latest_x)[0])
            q90 = float(pack["q90_model"].predict(latest_x)[0])
        else:
            sequence_length = max(DEFAULT_SEQUENCE_LENGTH, int(entry.get("sequenceLength") or DEFAULT_SEQUENCE_LENGTH))
            if len(feature_frame) < sequence_length:
                return None
            sequence = feature_frame[SEQUENCE_FEATURE_COLUMNS].to_numpy(dtype=np.float32)[-sequence_length:]
            deep_model = self._deep_models.get((horizon, model))
            if deep_model is None:
                raise RuntimeError("Deep checkpoint is not loaded.")
            with torch.no_grad():
                tensor = torch.tensor(sequence[None, ...], dtype=torch.float32)
                logits = deep_model(tensor)
                p_up = float(torch.sigmoid(logits).detach().cpu().item())
            q10, q50, q90 = _generic_quantiles(feature_frame, p_up)

        ordered = sorted([q10, q50, q90])
        q10, q50, q90 = ordered[0], ordered[1], ordered[2]
        confidence = _clamp(0.5 + abs(p_up - 0.5) * 1.8, 0.0, 0.99)
        current_price = float(training_frame["close"].iloc[-1])
        top_features = _runtime_top_features(feature_frame)
        signal = _signal_from_probability(p_up)
        snapshot_at = _utc_now()
        heatmap = _runtime_heatmap(feature_frame)
        performance = (((self.outputs.get(model) or {}).get(asset) or {}).get(horizon) or {}).get("performance") or {
            "directionAccuracy": 0.0,
            "brierScore": 1.0,
            "ece": 1.0,
            "intervalCoverage": 0.0,
        }

        return {
            "asset": asset,
            "horizon": horizon,
            "model": model,
            "updated_at": snapshot_at,
            "snapshotAt": snapshot_at.isoformat(),
            "priceAsOf": pd.Timestamp(training_frame["timestamp"].iloc[-1]).isoformat(),
            "featureAsOf": pd.Timestamp(feature_frame["timestamp"].iloc[-1]).isoformat(),
            "currentPrice": round(current_price, 6),
            "runtimeSource": "realtime_worker",
            "last_error": None,
            "prediction": {
                "pUp": round(float(p_up), 3),
                "q10": round(float(q10), 4),
                "q50": round(float(q50), 4),
                "q90": round(float(q90), 4),
                "intervalWidth": round(float(q90 - q10), 4),
                "confidence": round(float(confidence), 3),
                "signal": signal,
            },
            "explanation": {
                "summary": (
                    f"{model.upper()} realtime inference for {asset} at {horizon}. "
                    f"P(UP)={p_up:.2f}, current price={current_price:.2f}, signal={signal}."
                ),
                "topFeatures": top_features,
            },
            "performance": performance,
            "heatmap": heatmap,
        }

    def _fetch_raw_bars(self, asset: str) -> Tuple[pd.DataFrame, str]:
        market = infer_market(asset)
        if market == "CRYPTO":
            payload = _read_json(f"{self.unified_base_url}/api/crypto/history/{asset}?range=7d")
            rows = [
                {
                    "timestamp": point.get("ts"),
                    "open": point.get("open"),
                    "high": point.get("high"),
                    "low": point.get("low"),
                    "close": point.get("close"),
                    "volume": point.get("volume"),
                }
                for point in (payload.get("series") or [])
            ]
            return _normalize_ohlcv_frame(rows), "OPEN"

        if market == "US":
            payload = _read_json(f"{self.unified_base_url}/api/us-equity/indices/history?range=1mo&interval=15m")
            key = US_INDEX_SERIES_KEYS.get(asset)
            if key is None:
                raise RuntimeError(f"Unsupported US runtime asset: {asset}")
            rows = _to_price_bar_rows((payload.get("series") or {}).get(key) or [])
            session_state = _session_state_from_feed(market, ((payload.get("marketSession") or {}).get("phaseCode")))
            return _normalize_ohlcv_frame(rows), session_state

        payload = _read_json(f"{self.unified_base_url}/api/cn-equity/indices/history?interval=5m&session=auto")
        key = CN_INDEX_SERIES_KEYS.get(asset)
        if key is None:
            raise RuntimeError(f"Unsupported CN runtime asset: {asset}")
        rows = _to_price_bar_rows((payload.get("series") or {}).get(key) or [])
        session_state = _session_state_from_feed(market, ((payload.get("marketSession") or {}).get("phaseCode")))
        return _normalize_ohlcv_frame(rows), session_state
