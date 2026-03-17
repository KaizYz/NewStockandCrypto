from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.services.mock_provider import MockProvider


@dataclass
class ProviderContext:
    mode: str
    model_version: str
    loaded_at: datetime
    provider: object


class ProviderFactory:
    def __init__(self) -> None:
        self._ctx: Optional[ProviderContext] = None

    @staticmethod
    def _close_provider(provider: object) -> None:
        closer = getattr(provider, 'close', None)
        if callable(closer):
            closer()

    def _build(self) -> ProviderContext:
        service_root = Path(__file__).resolve().parents[2]
        artifact_dir = str(Path(os.getenv('MODEL_ARTIFACT_DIR', service_root / 'artifacts' / 'latest')).resolve())
        artifact_root = Path(artifact_dir)
        render_runtime = bool(os.getenv('RENDER') or os.getenv('RENDER_EXTERNAL_URL'))
        configured_mode = str(os.getenv('MODEL_EXPLORER_MODE', '')).strip().lower()
        has_live_artifacts = (artifact_root / 'artifact_meta.json').exists() and (artifact_root / 'model_outputs.json').exists()

        mode = configured_mode or ('live' if has_live_artifacts else 'mock')
        if render_runtime and has_live_artifacts:
            mode = 'live'

        if mode == 'live':
            from app.services.live_provider import LiveProvider

            provider = LiveProvider(artifact_dir=artifact_dir)
            model_version = provider.model_version
        else:
            provider = MockProvider()
            mode = 'mock'
            model_version = provider.model_version

        return ProviderContext(
            mode=mode,
            model_version=model_version,
            loaded_at=datetime.now(timezone.utc),
            provider=provider,
        )

    def get(self) -> ProviderContext:
        if self._ctx is None:
            self._ctx = self._build()
        return self._ctx

    def reload(self) -> ProviderContext:
        if self._ctx is not None:
            self._close_provider(self._ctx.provider)
        self._ctx = self._build()
        return self._ctx


provider_factory = ProviderFactory()
