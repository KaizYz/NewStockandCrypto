from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from app.services.live_provider import LiveProvider
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

    def _build(self) -> ProviderContext:
        mode = str(os.getenv('MODEL_EXPLORER_MODE', 'mock')).strip().lower()
        artifact_dir = str(os.getenv('MODEL_ARTIFACT_DIR', 'ml-service/artifacts/latest'))

        if mode == 'live':
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
        self._ctx = self._build()
        return self._ctx


provider_factory = ProviderFactory()
