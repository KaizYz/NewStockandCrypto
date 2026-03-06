from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.model_explorer import router as model_explorer_router
from app.services.provider_factory import provider_factory

app = FastAPI(title='StockandCrypto Model Explorer API', version='1.0.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(model_explorer_router)


@app.on_event('shutdown')
def shutdown_runtime() -> None:
    ctx = provider_factory.get()
    closer = getattr(ctx.provider, 'close', None)
    if callable(closer):
        closer()


@app.get('/')
def root() -> dict:
    return {
        'service': 'model-explorer',
        'status': 'ok',
        'docs': '/docs',
    }
