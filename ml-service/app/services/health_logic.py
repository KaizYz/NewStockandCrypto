from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def quality_status_from_metrics(
    direction_accuracy: float,
    interval_coverage: float,
    ece: float,
) -> tuple[str, float, float, str]:
    coverage_drop = max(0.0, (0.80 - interval_coverage) * 100.0)
    psi = min(0.35, max(0.02, abs(ece - 0.03) * 4.0 + (coverage_drop / 100.0) * 0.35))
    if direction_accuracy <= 0.01 or interval_coverage <= 0.01:
        return "IN_REVIEW", round(psi, 3), round(coverage_drop, 2), "Insufficient coverage for reliable drift evaluation."
    if psi >= 0.20 or coverage_drop >= 6.0:
        return "DRIFT_DETECTED", round(psi, 3), round(coverage_drop, 2), "Recent coverage decline exceeded drift threshold."
    if psi >= 0.12 or coverage_drop >= 3.0:
        return "IN_REVIEW", round(psi, 3), round(coverage_drop, 2), "Moderate instability detected; monitoring recommended."
    return "HEALTHY", round(psi, 3), round(coverage_drop, 2), "Stable error profile and healthy interval coverage."


def runtime_status(
    *,
    last_update_at: Optional[datetime],
    refresh_interval_sec: int,
    session_state: str,
    last_error: Optional[str],
) -> tuple[str, Optional[float], Optional[float], str]:
    normalized_session = str(session_state or "PAUSED").upper()
    now = datetime.now(timezone.utc)
    if last_update_at is None:
        reason = last_error or "No runtime snapshot is available yet."
        return "UNAVAILABLE", None, None, reason

    age_sec = max(0.0, (now - last_update_at.astimezone(timezone.utc)).total_seconds())
    if normalized_session == "CLOSED":
        if last_error:
            return "DEGRADED", round(age_sec, 1), round(age_sec, 1), "Market closed; serving last session snapshot with recent feed errors."
        return "LIVE", round(age_sec, 1), round(age_sec, 1), "Market closed; serving last session snapshot."

    if last_error and age_sec <= refresh_interval_sec * 2:
        return "DEGRADED", round(age_sec, 1), round(age_sec, 1), f"Recent feed error: {last_error}"
    if age_sec <= refresh_interval_sec * 2:
        return "LIVE", round(age_sec, 1), round(age_sec, 1), "Realtime worker is refreshing normally."
    if age_sec <= refresh_interval_sec * 6:
        return "STALE", round(age_sec, 1), round(age_sec, 1), "Serving the latest successful runtime snapshot."
    return "DEGRADED", round(age_sec, 1), round(age_sec, 1), "Runtime snapshot is lagging behind refresh expectations."
