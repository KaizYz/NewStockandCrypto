# Model Explorer Training and Service Runbook (Windows, GPU-Strict)

## 1. Purpose

This runbook is the single source of truth for:

- Environment setup for Model Explorer training
- GPU-strict training execution
- FastAPI service startup
- Unified gateway integration on port `9000`
- Monitoring, completion checks, and troubleshooting

All commands are written for Windows PowerShell.

---

## 2. Architecture Overview

Model Explorer has two runtime layers:

1. **ML Service (FastAPI)**  
   - Default internal address: `http://127.0.0.1:8000`
   - Provides `/health` and `/v1/*` model APIs
2. **Unified Gateway (Node.js)**  
   - Public address: `http://127.0.0.1:9000`
   - Proxies `/api/model-explorer/*` to the ML service

Frontend calls only the unified gateway.

---

## 3. Prerequisites

- NVIDIA GPU available (example: RTX 4080)
- NVIDIA driver installed (`nvidia-smi` works)
- Python 3.12 recommended for this pipeline
- PowerShell terminal

Check GPU visibility:

```powershell
nvidia-smi
```

---

## 4. One-Time Environment Setup

Run from repository root:

```powershell
cd E:\NewStockandCrypto\ml-service
```

Create a dedicated virtual environment with Python 3.12:

```powershell
& "C:\Users\youka\AppData\Roaming\uv\python\cpython-3.12.12-windows-x86_64-none\python.exe" -m venv .venv-gpu
```

If PowerShell script activation is blocked, you can skip activation and always call `.venv-gpu\Scripts\python.exe` directly.

Install dependencies:

```powershell
.\.venv-gpu\Scripts\python.exe -m pip install -U pip
.\.venv-gpu\Scripts\python.exe -m pip install -r requirements.txt
```

Install CUDA-enabled PyTorch (required for GPU-strict training):

```powershell
.\.venv-gpu\Scripts\python.exe -m pip uninstall -y torch torchvision torchaudio
.\.venv-gpu\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision torchaudio
```

Verify CUDA runtime in Python:

```powershell
.\.venv-gpu\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.version.cuda); print(torch.cuda.get_device_name(0))"
```

Expected:

- `torch.cuda.is_available()` is `True`
- `torch.version.cuda` is non-empty
- GPU name is printed

---

## 5. Start ML Service (Mock Mode for UI Validation)

From `E:\NewStockandCrypto\ml-service`:

```powershell
$env:MODEL_EXPLORER_MODE='mock'
..\ml-service\.venv-gpu\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health check:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expected `mode` is `mock`.

---

## 6. Start Unified Gateway

From repository root:

```powershell
cd E:\NewStockandCrypto
node unified-server.js
```

If port `9000` is already in use, do not start a second server process.  
Either reuse the running process or stop the existing one first.

Gateway health check for model explorer proxy:

```powershell
Invoke-WebRequest http://127.0.0.1:9000/api/model-explorer/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

---

## 7. GPU-Strict Training (Primary Workflow)

Run from `E:\NewStockandCrypto\ml-service`:

```powershell
.\.venv-gpu\Scripts\python.exe -m training.train_all `
  --artifact-dir artifacts/latest `
  --epochs 20 `
  --gpu-id 0 `
  --gpu-strict
```

Expected startup logs:

- `GPU strict mode: enabled`
- `Selected torch device: cuda:0`
- `Detected GPU: ...`
- `LightGBM GPU probe: passed ...`

If any GPU preflight check fails, training aborts by design.

---

## 8. Training Window Controls

Current policy:

- Horizons `1H/4H` use `1h` bars
- Horizons `1D/3D` use `1d` bars
- Crypto: start `2020-01-01` for all horizons
- Indices:
  - intraday start `2020-01-01`
  - daily start `2010-01-01`
- Stocks (S&P 500 + CSI 300): start `2020-01-01`

Fetch-only validation command:

```powershell
.\.venv-gpu\Scripts\python.exe -m training.train_all `
  --artifact-dir artifacts/latest `
  --start-crypto 2020-01-01 `
  --start-index-intraday 2020-01-01 `
  --start-index-daily 2010-01-01 `
  --start-stock 2020-01-01 `
  --end-date now `
  --gpu-id 0 `
  --gpu-strict `
  --fetch-only
```

---

## 9. How to Monitor Training Progress

### 9.1 Check active training process

```powershell
Get-CimInstance Win32_Process | ? { $_.Name -match 'python' -and $_.CommandLine -match 'training\.train_all' } | select ProcessId,CommandLine
```

### 9.2 Check GPU usage

```powershell
nvidia-smi
```

### 9.3 Check artifact updates

```powershell
Get-ChildItem artifacts/latest | Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime -First 10
```

### 9.4 Completion criteria

Training is complete when:

1. Terminal returns to prompt (`PS ...>`)
2. Log includes `Artifacts generated in: artifacts/latest`
3. Files exist:
   - `artifacts/latest/artifact_meta.json`
   - `artifacts/latest/model_outputs.json`
   - `artifacts/latest/metrics.json`

---

## 10. Avoid Duplicate Training Runs

If two training processes are running, keep one and stop the other.

List PIDs:

```powershell
Get-CimInstance Win32_Process | ? { $_.Name -match 'python' -and $_.CommandLine -match 'training\.train_all' } | select ProcessId,CommandLine
```

Stop one process (example PID `20700`):

```powershell
Stop-Process -Id 20700 -Force
```

Important: use numeric PID only, no angle brackets.

---

## 11. Switch from Mock to Live Mode

After successful training artifacts are available:

```powershell
cd E:\NewStockandCrypto\ml-service
$env:MODEL_EXPLORER_MODE='live'
$env:MODEL_ARTIFACT_DIR='E:\NewStockandCrypto\ml-service\artifacts\latest'
.\.venv-gpu\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Verify:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expected:

- `mode` is `live`
- `modelVersion` is loaded from artifacts

---

## 12. Common Errors and Fixes

### Error: `No module named 'training'`

Cause: command executed outside `ml-service` module path.  
Fix:

```powershell
cd E:\NewStockandCrypto\ml-service
.\.venv-gpu\Scripts\python.exe -m training.train_all ...
```

### Error: `GPU preflight failed: torch CUDA runtime is unavailable`

Cause: CPU-only torch build or wrong Python environment.  
Fix: install CUDA torch in `.venv-gpu` and rerun verification in Section 4.

### Error: `Activate.ps1 cannot be loaded`

Cause: PowerShell execution policy blocks scripts.  
Fix options:

1. Use direct interpreter path (recommended):  
   `.\.venv-gpu\Scripts\python.exe ...`
2. Temporary policy bypass:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```

### Error: `EADDRINUSE 127.0.0.1:9000`

Cause: gateway already running.  
Fix: reuse existing process or stop it before restart.

### Error: `/api/model-explorer/health` returns `{"error":"not_found","ok":false}`

Cause: unified server not running with model-explorer proxy route or old process version.  
Fix: restart `node unified-server.js` from repository root.

---

## 13. Git Hygiene (Do Not Commit Virtual Environment)

Ensure `ml-service/.gitignore` contains:

```gitignore
.venv-gpu/
```

If `.venv-gpu` was staged accidentally:

```powershell
cd E:\NewStockandCrypto\ml-service
git restore --staged .venv-gpu
```

Stage only intended files:

```powershell
git add README.md training/train_all.py training/models.py .gitignore
git commit -m "Enforce GPU-strict training"
```

---

## 14. Quick Command Cheat Sheet

### Start mock service

```powershell
cd E:\NewStockandCrypto\ml-service
$env:MODEL_EXPLORER_MODE='mock'
.\.venv-gpu\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Start gateway

```powershell
cd E:\NewStockandCrypto
node unified-server.js
```

### Train GPU-strict

```powershell
cd E:\NewStockandCrypto\ml-service
.\.venv-gpu\Scripts\python.exe -m training.train_all --artifact-dir artifacts/latest --epochs 20 --gpu-id 0 --gpu-strict
```

### Check active training process

```powershell
Get-CimInstance Win32_Process | ? { $_.Name -match 'python' -and $_.CommandLine -match 'training\.train_all' } | select ProcessId,CommandLine
```

