# Model Explorer ML Service

This service powers the `model-explorer.html` page.

## Full Runbook

For full setup, GPU training, service startup, monitoring, and troubleshooting:

- [Model Explorer Training and Service Runbook](../docs/MODEL_EXPLORER_TRAINING_RUNBOOK.md)

## Modes
- `MODEL_EXPLORER_MODE=mock` (default): deterministic mock outputs for UI validation.
- `MODEL_EXPLORER_MODE=live`: load artifacts from `MODEL_ARTIFACT_DIR`.

## Run
```bash
pip install -r ml-service/requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Train (full multi-model)
```bash
python -m training.train_all \
  --artifact-dir ml-service/artifacts/latest \
  --epochs 20 \
  --gpu-id 0 \
  --gpu-strict
```

The training pipeline fetches live market data from:
- Binance (BTCUSDT/ETHUSDT/SOLUSDT)
- Yahoo Chart API (`^GSPC`, `^DJI`, `^NDX`, `000001.SS`)

## Training window controls
```bash
python -m training.train_all \
  --start-crypto 2020-01-01 \
  --start-index-intraday 2020-01-01 \
  --start-index-daily 2010-01-01 \
  --start-stock 2020-01-01 \
  --end-date now \
  --gpu-id 0 \
  --gpu-strict \
  --fetch-only
```

Notes:
- `1H/4H` horizons use `1h` bars.
- `1D/3D` horizons use `1d` bars.
- Stock universe for model fitting includes S&P 500 + CSI 300 snapshots.
- Training is GPU-strict: CUDA and LightGBM GPU probes must pass, or the run aborts.
