from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import threading
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
import requests

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

DEFAULT_HORIZON_STEPS = {
    "1H": 1,
    "4H": 4,
    "1D": 24,
    "3D": 72,
}

INTRADAY_HORIZONS = {"1H", "4H"}
DAILY_HORIZONS = {"1D", "3D"}

DEFAULT_CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
DEFAULT_INDEX_SYMBOLS = ["000001.SS", "^DJI", "^NDX", "^GSPC"]

REPO_ROOT = Path(__file__).resolve().parents[2]
SP500_SNAPSHOT_PATH = REPO_ROOT / "web" / "assets" / "sp500-constituents.json"
CSI300_SNAPSHOT_PATH = REPO_ROOT / "web" / "assets" / "csi300-constituents.json"


@dataclass
class TrainingDataset:
    table: pd.DataFrame
    feature_columns: List[str]


@dataclass
class SequenceDataset:
    x: np.ndarray
    y: np.ndarray
    meta: pd.DataFrame


@dataclass(frozen=True)
class AssetJob:
    canonical: str
    provider: str
    asset_class: str
    candidates: Sequence[str]


@dataclass
class HorizonFramesResult:
    frames: Dict[str, pd.DataFrame]
    coverage: Dict[str, int]
    warnings: List[str]
    diagnostics: Dict[str, Dict[str, object]]


@dataclass(frozen=True)
class TrainingWindowConfig:
    start_crypto: str
    start_index_intraday: str
    start_index_daily: str
    start_stock: str
    end_date: str
    intraday_interval: str
    daily_interval: str
    max_workers: int
    min_bars_intraday: int
    min_bars_daily: int
    cache_dir: str
    cache_ttl_hours: int
    request_rate_limit: float


class RateLimiter:
    """Simple thread-safe token spacing rate limiter."""

    def __init__(self, requests_per_second: float) -> None:
        self.requests_per_second = max(0.1, float(requests_per_second))
        self.min_interval = 1.0 / self.requests_per_second
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def wait(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                if now >= self._next_allowed:
                    self._next_allowed = now + self.min_interval
                    return
                sleep_sec = self._next_allowed - now
            time.sleep(min(sleep_sec, 0.25))


_REQUEST_CACHE_DIR: Optional[Path] = None
_REQUEST_CACHE_TTL_SEC: float = 7 * 24 * 3600.0
_REQUEST_RATE_LIMITER: Optional[RateLimiter] = None


def configure_request_runtime(*, cache_dir: str, cache_ttl_hours: int, requests_per_second: float) -> None:
    global _REQUEST_CACHE_DIR, _REQUEST_CACHE_TTL_SEC, _REQUEST_RATE_LIMITER
    base = Path(cache_dir).expanduser().resolve()
    base.mkdir(parents=True, exist_ok=True)
    _REQUEST_CACHE_DIR = base
    _REQUEST_CACHE_TTL_SEC = max(1.0, float(cache_ttl_hours) * 3600.0)
    _REQUEST_RATE_LIMITER = RateLimiter(requests_per_second)


def _safe_float(value: object) -> Optional[float]:
    parsed = None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def parse_boundary(boundary: str, *, is_end: bool = False) -> datetime:
    raw = str(boundary).strip().lower()
    if raw == "now":
        return datetime.now(timezone.utc)

    parsed = datetime.fromisoformat(str(boundary))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)

    if is_end:
        return parsed
    return parsed


def interval_to_seconds(interval: str) -> int:
    normalized = str(interval).strip().lower()
    if normalized == "1h":
        return 3600
    if normalized == "4h":
        return 4 * 3600
    if normalized == "1d":
        return 24 * 3600
    raise ValueError(f"Unsupported interval: {interval}")


def _request_json(
    url: str,
    *,
    params: Dict[str, object],
    timeout: int,
    retries: int = 4,
    backoff_sec: float = 1.2,
) -> object:
    cache_key = hashlib.sha1(
        json.dumps({"url": url, "params": params}, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    cache_path: Optional[Path] = None
    cached_payload: Optional[object] = None
    cache_fresh = False
    if _REQUEST_CACHE_DIR is not None:
        cache_path = _REQUEST_CACHE_DIR / f"{cache_key}.json"
        if cache_path.exists():
            try:
                with cache_path.open("r", encoding="utf-8") as fp:
                    cached_payload = json.load(fp)
                age_sec = time.time() - cache_path.stat().st_mtime
                cache_fresh = age_sec <= _REQUEST_CACHE_TTL_SEC
            except Exception:
                cached_payload = None
                cache_fresh = False

    if cached_payload is not None and cache_fresh:
        return cached_payload

    last_error: Optional[Exception] = None
    for attempt in range(retries):
        try:
            if _REQUEST_RATE_LIMITER is not None:
                _REQUEST_RATE_LIMITER.wait()
            response = requests.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
            if cache_path is not None:
                try:
                    with cache_path.open("w", encoding="utf-8") as fp:
                        json.dump(payload, fp)
                except Exception:
                    pass
            return payload
        except Exception as exc:  # pragma: no cover - network-dependent
            last_error = exc
            if attempt == retries - 1:
                break
            sleep_sec = backoff_sec * (2**attempt)
            time.sleep(min(sleep_sec, 8.0))
    if cached_payload is not None:
        return cached_payload
    raise RuntimeError(f"Request failed: {url} params={params} error={last_error}")


def _ensure_utc_timestamp(df: pd.DataFrame) -> pd.DataFrame:
    output = df.copy()
    output["timestamp"] = pd.to_datetime(output["timestamp"], utc=True, errors="coerce")
    output = output.dropna(subset=["timestamp"])
    output = output.sort_values("timestamp").drop_duplicates("timestamp")
    return output.reset_index(drop=True)


def fetch_binance_klines_range(
    symbol: str,
    *,
    interval: str,
    start_ts: datetime,
    end_ts: datetime,
) -> pd.DataFrame:
    if end_ts <= start_ts:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"])

    step_ms = interval_to_seconds(interval) * 1000
    cursor_ms = int(start_ts.timestamp() * 1000)
    end_ms = int(end_ts.timestamp() * 1000)
    rows: List[dict] = []

    while cursor_ms < end_ms:
        payload = _request_json(
            BINANCE_KLINES_URL,
            params={
                "symbol": symbol,
                "interval": interval,
                "startTime": cursor_ms,
                "endTime": end_ms,
                "limit": 1000,
            },
            timeout=12,
        )

        if not isinstance(payload, list) or not payload:
            break

        for item in payload:
            if not isinstance(item, list) or len(item) < 6:
                continue
            open_ts = int(item[0])
            rows.append(
                {
                    "timestamp": datetime.fromtimestamp(open_ts / 1000, tz=timezone.utc),
                    "open": float(item[1]),
                    "high": float(item[2]),
                    "low": float(item[3]),
                    "close": float(item[4]),
                    "volume": float(item[5]),
                }
            )

        last_open_ms = int(payload[-1][0])
        next_cursor = last_open_ms + step_ms
        if next_cursor <= cursor_ms:
            cursor_ms += step_ms
        else:
            cursor_ms = next_cursor

        if len(payload) < 1000:
            break

    if not rows:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"])
    return _ensure_utc_timestamp(pd.DataFrame(rows))


def _yahoo_chunks(start_ts: datetime, end_ts: datetime, interval: str) -> List[Tuple[datetime, datetime]]:
    if interval == "1d":
        max_days = 730
    else:
        max_days = 180

    chunks: List[Tuple[datetime, datetime]] = []
    cursor = start_ts
    while cursor < end_ts:
        nxt = min(cursor + timedelta(days=max_days), end_ts)
        chunks.append((cursor, nxt))
        cursor = nxt + timedelta(seconds=1)
    return chunks


def _parse_yahoo_chart_payload(payload: object) -> pd.DataFrame:
    result = ((payload or {}).get("chart") or {}).get("result") if isinstance(payload, dict) else None
    if not result or not isinstance(result, list):
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"])

    first = result[0] or {}
    timestamps = first.get("timestamp") or []
    quote = ((first.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    size = min(len(timestamps), len(closes))
    rows: List[dict] = []
    for idx in range(size):
        ts_raw = timestamps[idx]
        close_value = _safe_float(closes[idx])
        if ts_raw is None or close_value is None:
            continue
        open_value = _safe_float(opens[idx]) if idx < len(opens) else None
        high_value = _safe_float(highs[idx]) if idx < len(highs) else None
        low_value = _safe_float(lows[idx]) if idx < len(lows) else None
        volume_value = _safe_float(volumes[idx]) if idx < len(volumes) else None

        rows.append(
            {
                "timestamp": datetime.fromtimestamp(int(ts_raw), tz=timezone.utc),
                "open": open_value if open_value is not None else close_value,
                "high": high_value if high_value is not None else close_value,
                "low": low_value if low_value is not None else close_value,
                "close": close_value,
                "volume": volume_value if volume_value is not None else 0.0,
            }
        )

    if not rows:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"])
    return _ensure_utc_timestamp(pd.DataFrame(rows))


def fetch_yahoo_chart_range(
    symbol_candidates: Sequence[str],
    *,
    interval: str,
    start_ts: datetime,
    end_ts: datetime,
) -> Tuple[pd.DataFrame, str]:
    if end_ts <= start_ts:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"]), str(symbol_candidates[0])

    for candidate in symbol_candidates:
        frames: List[pd.DataFrame] = []
        chunks = _yahoo_chunks(start_ts, end_ts, interval)
        for chunk_start, chunk_end in chunks:
            payload = _request_json(
                YAHOO_CHART_URL.format(symbol=candidate),
                params={
                    "interval": interval,
                    "period1": int(chunk_start.timestamp()),
                    "period2": int(chunk_end.timestamp()),
                    "includePrePost": "true",
                    "events": "div,split",
                },
                timeout=14,
            )
            parsed = _parse_yahoo_chart_payload(payload)
            if not parsed.empty:
                frames.append(parsed)

        if not frames:
            continue

        merged = _ensure_utc_timestamp(pd.concat(frames, axis=0, ignore_index=True))
        if merged.empty:
            continue
        return merged, candidate

    return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"]), str(symbol_candidates[0])


def normalize_us_symbol_to_yahoo(symbol: str) -> str:
    return symbol.strip().upper().replace(".", "-")


def load_sp500_symbols(snapshot_path: Path = SP500_SNAPSHOT_PATH) -> List[str]:
    with snapshot_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    constituents = payload.get("constituents") or []
    symbols: List[str] = []
    for row in constituents:
        raw = str(row.get("symbol") or "").strip()
        if not raw:
            continue
        symbols.append(normalize_us_symbol_to_yahoo(raw))
    return sorted(set(symbols))


def normalize_cn_code_to_candidates(code: str, market: str) -> List[str]:
    code_norm = str(code).strip()
    market_norm = str(market).strip().upper()
    if market_norm == "SH":
        return [f"{code_norm}.SH", f"{code_norm}.SS"]
    if market_norm == "SZ":
        return [f"{code_norm}.SZ"]
    return [f"{code_norm}.SH", f"{code_norm}.SS", f"{code_norm}.SZ"]


def load_csi300_symbols(snapshot_path: Path = CSI300_SNAPSHOT_PATH) -> Dict[str, List[str]]:
    with snapshot_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    constituents = payload.get("constituents") or []
    symbols: Dict[str, List[str]] = {}
    for row in constituents:
        code = str(row.get("code") or "").strip()
        market = str(row.get("market") or "").strip().upper()
        if not code:
            continue
        canonical = f"{code}.{market}" if market else code
        symbols[canonical] = normalize_cn_code_to_candidates(code, market)
    return symbols


def build_asset_jobs(
    sp500_snapshot_path: Path = SP500_SNAPSHOT_PATH,
    csi300_snapshot_path: Path = CSI300_SNAPSHOT_PATH,
) -> List[AssetJob]:
    jobs: List[AssetJob] = []

    for symbol in DEFAULT_CRYPTO_SYMBOLS:
        jobs.append(AssetJob(canonical=symbol, provider="binance", asset_class="crypto", candidates=[symbol]))

    for symbol in DEFAULT_INDEX_SYMBOLS:
        if symbol == "000001.SS":
            candidates = ["000001.SS", "000001.SH"]
        else:
            candidates = [symbol]
        jobs.append(AssetJob(canonical=symbol, provider="yahoo", asset_class="index", candidates=candidates))

    for symbol in load_sp500_symbols(sp500_snapshot_path):
        jobs.append(AssetJob(canonical=symbol, provider="yahoo", asset_class="stock", candidates=[symbol]))

    for canonical, candidates in load_csi300_symbols(csi300_snapshot_path).items():
        jobs.append(AssetJob(canonical=canonical, provider="yahoo", asset_class="stock", candidates=candidates))

    return jobs


def _normalize_job_frame(
    job: AssetJob,
    frame: pd.DataFrame,
    *,
    start_ts: datetime,
    end_ts: datetime,
) -> pd.DataFrame:
    if frame.empty:
        return frame
    output = frame.copy()
    output = output[(output["timestamp"] >= start_ts) & (output["timestamp"] <= end_ts)]
    output = _ensure_utc_timestamp(output)
    output["asset"] = job.canonical
    return output


def _class_start_for_horizon(
    job: AssetJob,
    *,
    horizon: str,
    windows: TrainingWindowConfig,
) -> datetime:
    if job.asset_class == "crypto":
        return parse_boundary(windows.start_crypto)
    if job.asset_class == "index":
        if horizon in INTRADAY_HORIZONS:
            return parse_boundary(windows.start_index_intraday)
        return parse_boundary(windows.start_index_daily)
    if job.asset_class == "stock":
        return parse_boundary(windows.start_stock)
    return parse_boundary(windows.start_crypto)


def _interval_for_horizon(horizon: str, windows: TrainingWindowConfig) -> str:
    if horizon in INTRADAY_HORIZONS:
        return windows.intraday_interval
    if horizon in DAILY_HORIZONS:
        return windows.daily_interval
    raise ValueError(f"Unsupported horizon: {horizon}")


def _fetch_job_frame(
    job: AssetJob,
    *,
    interval: str,
    start_ts: datetime,
    end_ts: datetime,
) -> Tuple[pd.DataFrame, List[str]]:
    warnings: List[str] = []
    if job.provider == "binance":
        frame = fetch_binance_klines_range(job.candidates[0], interval=interval, start_ts=start_ts, end_ts=end_ts)
        return frame, warnings

    frame, used_symbol = fetch_yahoo_chart_range(job.candidates, interval=interval, start_ts=start_ts, end_ts=end_ts)
    if used_symbol != job.candidates[0]:
        warnings.append(f"{job.canonical}: fallback symbol used for Yahoo fetch -> {used_symbol}")
    return frame, warnings


def build_training_frames_for_horizon(
    horizon: str,
    *,
    jobs: Sequence[AssetJob],
    windows: TrainingWindowConfig,
) -> HorizonFramesResult:
    interval = _interval_for_horizon(horizon, windows)
    end_ts = parse_boundary(windows.end_date, is_end=True)
    min_bars = windows.min_bars_intraday if horizon in INTRADAY_HORIZONS else windows.min_bars_daily

    requested_symbols = len(jobs)
    frames: Dict[str, pd.DataFrame] = {}
    warnings: List[str] = []
    diagnostics: Dict[str, Dict[str, object]] = {}

    def _worker(job: AssetJob) -> Tuple[str, pd.DataFrame, List[str], datetime]:
        start_ts = _class_start_for_horizon(job, horizon=horizon, windows=windows)
        raw, fetch_warnings = _fetch_job_frame(job, interval=interval, start_ts=start_ts, end_ts=end_ts)
        normalized = _normalize_job_frame(job, raw, start_ts=start_ts, end_ts=end_ts)
        return job.canonical, normalized, fetch_warnings, start_ts

    with ThreadPoolExecutor(max_workers=max(1, windows.max_workers)) as pool:
        futures = {pool.submit(_worker, job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                canonical, frame, fetch_warnings, requested_start = future.result()
                warnings.extend(fetch_warnings)

                bar_count = int(len(frame))
                earliest = frame["timestamp"].min().isoformat() if not frame.empty else None
                latest = frame["timestamp"].max().isoformat() if not frame.empty else None
                dropped_reason: Optional[str] = None

                if frame.empty:
                    dropped_reason = "no_rows"
                    warnings.append(f"{canonical}: no rows loaded for horizon {horizon}.")
                elif bar_count < min_bars:
                    dropped_reason = f"insufficient_rows<{min_bars}"
                    warnings.append(
                        f"{canonical}: {bar_count} rows for horizon {horizon}, below threshold {min_bars}. Symbol dropped."
                    )
                else:
                    frames[canonical] = frame

                if earliest is not None:
                    earliest_dt = datetime.fromisoformat(str(earliest).replace("Z", "+00:00"))
                    if earliest_dt > requested_start + timedelta(days=2):
                        warnings.append(
                            f"{canonical}: earliest available timestamp {earliest_dt.isoformat()} is later than requested start {requested_start.isoformat()}."
                        )

                diagnostics[canonical] = {
                    "assetClass": job.asset_class,
                    "provider": job.provider,
                    "requestedStart": requested_start.isoformat(),
                    "loadedBars": bar_count,
                    "earliest": earliest,
                    "latest": latest,
                    "droppedReason": dropped_reason,
                }
            except Exception as exc:  # pragma: no cover - network-dependent
                warnings.append(f"{job.canonical}: fetch failed for horizon {horizon}. Error: {exc}")
                diagnostics[job.canonical] = {
                    "assetClass": job.asset_class,
                    "provider": job.provider,
                    "requestedStart": _class_start_for_horizon(job, horizon=horizon, windows=windows).isoformat(),
                    "loadedBars": 0,
                    "earliest": None,
                    "latest": None,
                    "droppedReason": "fetch_failed",
                }

    loaded_symbols = len(frames)
    dropped_symbols = requested_symbols - loaded_symbols

    coverage = {
        "requestedSymbols": requested_symbols,
        "loadedSymbols": loaded_symbols,
        "droppedSymbols": dropped_symbols,
    }
    return HorizonFramesResult(frames=frames, coverage=coverage, warnings=warnings, diagnostics=diagnostics)


def _build_features(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.copy()
    df["return_1"] = df["close"].pct_change(1)
    df["return_3"] = df["close"].pct_change(3)
    df["return_6"] = df["close"].pct_change(6)
    df["return_12"] = df["close"].pct_change(12)
    df["momentum_6"] = df["close"] / df["close"].shift(6) - 1.0
    df["momentum_12"] = df["close"] / df["close"].shift(12) - 1.0
    df["vol_6"] = df["return_1"].rolling(6).std()
    df["vol_12"] = df["return_1"].rolling(12).std()
    df["hl_spread"] = (df["high"] - df["low"]) / df["close"].replace(0.0, np.nan)
    df["oc_spread"] = (df["close"] - df["open"]) / df["open"].replace(0.0, np.nan)
    df["volume_z"] = (df["volume"] - df["volume"].rolling(24).mean()) / (df["volume"].rolling(24).std() + 1e-9)
    return df.replace([np.inf, -np.inf], np.nan)


def _asset_to_id(assets: Iterable[str]) -> Dict[str, int]:
    ordered = sorted(set(assets))
    return {asset: idx for idx, asset in enumerate(ordered)}


def build_training_dataset(frames: Dict[str, pd.DataFrame], horizon_steps: int) -> TrainingDataset:
    if not frames:
        raise ValueError("No frames available to build training dataset.")

    assets = list(frames.keys())
    id_map = _asset_to_id(assets)
    combined_rows: List[pd.DataFrame] = []

    for asset, frame in frames.items():
        df = _build_features(frame)
        df["target_return"] = df["close"].shift(-horizon_steps) / df["close"] - 1.0
        df["target_direction"] = (df["target_return"] > 0).astype(int)
        df["asset_id"] = id_map[asset]
        df["asset"] = asset
        combined_rows.append(df)

    table = pd.concat(combined_rows, axis=0, ignore_index=True)
    table = table.dropna().sort_values("timestamp").reset_index(drop=True)
    if table.empty:
        raise ValueError("Training dataset is empty after feature/label build.")

    feature_columns = [
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
    return TrainingDataset(table=table, feature_columns=feature_columns)


def build_sequence_dataset(
    frames: Dict[str, pd.DataFrame],
    horizon_steps: int,
    sequence_length: int = 32,
) -> SequenceDataset:
    if not frames:
        raise ValueError("No frames available to build sequence dataset.")

    seq_features = [
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

    x_batches: List[np.ndarray] = []
    y_batches: List[np.ndarray] = []
    metas: List[dict] = []

    for asset, frame in frames.items():
        df = _build_features(frame)
        df["target_direction"] = (df["close"].shift(-horizon_steps) / df["close"] - 1.0 > 0).astype(int)
        df = df.dropna().reset_index(drop=True)
        if len(df) <= sequence_length + horizon_steps:
            continue

        values = df[seq_features].to_numpy(dtype=np.float32)
        labels = df["target_direction"].to_numpy(dtype=np.int64)
        timestamps = pd.to_datetime(df["timestamp"], utc=True)

        upper = len(df) - horizon_steps
        for idx in range(sequence_length, upper):
            x_batches.append(values[idx - sequence_length : idx])
            y_batches.append(labels[idx])
            metas.append({"asset": asset, "timestamp": timestamps.iloc[idx].isoformat()})

    if not x_batches:
        raise ValueError("Sequence dataset is empty. Not enough rows after feature construction.")

    return SequenceDataset(
        x=np.stack(x_batches, axis=0),
        y=np.asarray(y_batches, dtype=np.int64),
        meta=pd.DataFrame(metas),
    )


def split_train_test(table: pd.DataFrame, train_ratio: float = 0.8) -> tuple[pd.DataFrame, pd.DataFrame]:
    split_idx = int(len(table) * train_ratio)
    split_idx = min(max(split_idx, 1), len(table) - 1)
    return table.iloc[:split_idx].copy(), table.iloc[split_idx:].copy()


def split_sequence_train_test(
    x: np.ndarray,
    y: np.ndarray,
    train_ratio: float = 0.8,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    split_idx = int(len(x) * train_ratio)
    split_idx = min(max(split_idx, 1), len(x) - 1)
    return x[:split_idx], x[split_idx:], y[:split_idx], y[split_idx:]
