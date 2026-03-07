# StockandCrypto

**AI-Powered Multi-Market Forecasting & Trading Decision Platform**

An end-to-end quantitative trading system featuring LSTM+Attention models for direction probability, price movement magnitude, and confidence interval prediction across cryptocurrency, Chinese A-shares, and US equity markets.

[![Model v3.2](https://img.shields.io/badge/Model-v3.2-blue)]()
[![PyTorch](https://img.shields.io/badge/PyTorch-LSTM%2BAttention-orange)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()

---

## Overview

StockandCrypto provides real-time market data visualization, AI-powered predictions, and trading signal generation with drift detection and model explainability. The platform supports:

- **Multi-Market Coverage**: Crypto (BTC/ETH/SOL + Top 50), CN A-shares (SSE + CSI 300), US Equities (Dow 30, Nasdaq 100, S&P 500)
- **Multi-Horizon Forecasting**: Hourly (1h/2h/4h) and daily (1d/3d/7d) predictions
- **Triple Prediction Task**: Direction probability + launch window + magnitude quantiles (q10/q50/q90)
- **Live Data Integration**: Real-time quotes with session-aware tracking and market phase detection
- **Explainable AI**: Feature importance heatmaps and SHAP-based model interpretation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Frontend (HTML/CSS/JS)                   │
│   Dashboard • Charts • Real-time Updates • Responsive Design    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Unified Server (Node.js)                      │
│   Static Files • API Gateway • Caching • Session Management     │
│                        Port 9000 (default)                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  ML Service      │ │  External APIs   │ │  Data Sources    │
│  (FastAPI/UV)    │ │  Binance         │ │  Yahoo Finance   │
│  Port 8000       │ │  EastMoney       │ │  Stooq           │
│                  │ │  CoinGecko       │ │  AkShare         │
│  • Predictions   │ │                  │ │                  │
│  • Model Catalog │ │                  │ │                  │
│  • Heatmaps      │ │                  │ │                  │
│  • Performance   │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## Features

### Market Modules

| Module | Description | Data Source |
|--------|-------------|-------------|
| **Crypto** | BTC/ETH/SOL + Top 100 altcoins (excluding stablecoins) | Binance API |
| **CN Equity** | Shanghai Composite + CSI 300 constituents | EastMoney API |
| **US Equity** | Dow Jones, Nasdaq 100, S&P 500 with 500 constituents | Yahoo Finance |

### Prediction Outputs

- **Direction Probability**: P(UP) / P(DOWN) with confidence score
- **Launch Window**: W0/W1/W2/W3 probability distribution across time windows
- **Magnitude Quantiles**: q10 (bearish), q50 (median), q90 (bullish) price movement estimates
- **Trading Signal**: LONG / SHORT / FLAT with position sizing and risk limits

### UI Components

- Real-time sparkline charts with session-aware rendering
- Interactive prediction cards with confidence rings
- Sortable/filterable data tables with pagination
- Market session phase tracking (Pre-market, Regular, After-hours, Closed)
- Dark theme with glassmorphism effects

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | HTML5, CSS3 (Custom Properties), Vanilla JavaScript, Chart.js |
| **Backend** | Node.js (Unified Server), Express-style routing |
| **ML Service** | Python 3.12, FastAPI, Uvicorn, PyTorch, LightGBM |
| **Data Processing** | Pandas, NumPy, scikit-learn |
| **Data Sources** | Binance API, Yahoo Finance, EastMoney, CoinGecko |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+ (for ML service)
- Git

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/stockandcrypto.git
cd stockandcrypto
```

### 2. Start Unified Server

```bash
# Install dependencies (if package.json exists)
npm install

# Start server on port 9000
node unified-server.js

# Or with custom port/host
PORT=8080 HOST=0.0.0.0 node unified-server.js
```

### 3. Start ML Service (Optional)

```bash
cd ml-service

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# or: .venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Start in mock mode (for UI testing)
MODEL_EXPLORER_MODE=mock uvicorn app.main:app --host 127.0.0.1 --port 8000

# Or start with live models
MODEL_EXPLORER_MODE=live MODEL_ARTIFACT_DIR=artifacts/latest uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 4. Access Dashboard

Open browser: `http://localhost:9000`

---

## Project Structure

```
stockandcrypto/
├── unified-server.js       # Main Node.js server (API + static files)
├── web/                    # Frontend assets
│   ├── index.html          # Landing page
│   ├── crypto.html         # Crypto market dashboard
│   ├── cn-equity.html      # Chinese A-shares dashboard
│   ├── us-equity.html      # US equity dashboard
│   ├── model-explorer.html # AI model explorer
│   ├── backtest-lab.html   # Backtesting interface
│   ├── session-*.html      # Session forecast pages
│   ├── css/
│   │   ├── style.css       # Core styles
│   │   ├── components.css  # UI components
│   │   └── ui-enhancements.css  # Advanced effects
│   ├── js/
│   │   ├── api.js          # API client
│   │   ├── utils.js        # Utility functions
│   │   ├── us-equity.js    # US equity logic
│   │   ├── cn-equity.js    # CN equity logic
│   │   ├── crypto.js       # Crypto logic
│   │   └── ui-enhancements.js  # UI enhancements
│   └── assets/
│       ├── sp500-constituents.json   # S&P 500 stocks
│       └── csi300-constituents.json  # CSI 300 stocks
├── ml-service/             # ML prediction service
│   ├── app/
│   │   ├── main.py         # FastAPI app
│   │   ├── routes/         # API routes
│   │   └── services/       # Model providers
│   ├── training/           # Training scripts
│   ├── artifacts/          # Model artifacts
│   └── requirements.txt    # Python dependencies
├── docs/                   # Documentation
│   ├── PROJECT_TECHNICAL_SUMMARY.md
│   ├── MODEL_TRAINING_GUIDE.md
│   └── ...
├── logs/                   # Server logs
└── memory/                 # Development notes
```

---

## API Endpoints

### Market Data

| Endpoint | Description |
|----------|-------------|
| `GET /api/crypto/prices` | Crypto prices (BTC/ETH/SOL) |
| `GET /api/crypto/prediction/:symbol` | Crypto prediction |
| `GET /api/cn-equity/prices` | CN equity prices with pagination |
| `GET /api/cn-equity/prediction/:code` | CN index prediction |
| `GET /api/us-equity/indices` | US indices snapshot (Dow/Nasdaq/S&P) |
| `GET /api/us-equity/prices` | S&P 500 constituents |
| `GET /api/us-equity/prediction/:symbol` | US index/stock prediction |

### ML Service

| Endpoint | Description |
|----------|-------------|
| `GET /api/model-explorer/health` | Service health check |
| `GET /api/model-explorer/v1/catalog/models` | Available models |
| `GET /api/model-explorer/v1/catalog/assets` | Tradeable assets |
| `POST /api/model-explorer/v1/predict` | Generate prediction |
| `GET /api/model-explorer/v1/explain/heatmap` | Feature importance |

---

## Configuration

### Environment Variables

```bash
# Unified Server
PORT=9000                    # Server port
HOST=127.0.0.1              # Bind address
API_HOST=127.0.0.1          # Backend API host
API_PORT=5001               # Backend API port
MODEL_EXPLORER_HOST=127.0.0.1
MODEL_EXPLORER_PORT=8000

# Cache TTL (milliseconds)
CRYPTO_CACHE_TTL_MS=9000
CN_CACHE_TTL_MS=9000
US_CACHE_TTL_MS=9000
US_INDEX_FAST_CACHE_TTL_MS=5000

# ML Service
MODEL_EXPLORER_MODE=mock    # mock | live
MODEL_ARTIFACT_DIR=artifacts/latest
```

---

## Model Training

Train models with GPU acceleration:

```bash
cd ml-service

# Full multi-model training
python -m training.train_all \
    --artifact-dir artifacts/latest \
    --epochs 20 \
    --gpu-id 0 \
    --gpu-strict

# Fetch data only (no training)
python -m training.train_all \
    --start-crypto 2020-01-01 \
    --start-index-daily 2010-01-01 \
    --end-date now \
    --fetch-only
```

See [docs/MODEL_TRAINING_GUIDE.md](docs/MODEL_TRAINING_GUIDE.md) for details.

---

## Screenshots

### US Equity Dashboard

Real-time S&P 500 tracking with live predictions:

- Live indices (Dow/Nasdaq/S&P) with sparkline trends
- Prediction panel with P(UP), confidence, and quantile forecasts
- Sortable constituent table with sector filtering

### Model Explorer

AI model catalog and prediction interface:

- Multi-horizon predictions (1H/4H/1D/3D)
- Feature importance heatmaps
- Historical performance metrics

---

## Disclaimer

**This project is for educational and research purposes only.**

- NOT intended for actual trading
- Predictions are simulations with inherent uncertainty
- Always conduct your own research before making investment decisions
- Past performance does not guarantee future results

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Acknowledgments

- [Chart.js](https://www.chartjs.org/) - Interactive charts
- [FastAPI](https://fastapi.tiangolo.com/) - ML service framework
- [LightGBM](https://lightgbm.readthedocs.io/) - Gradient boosting
- [Binance API](https://binance-docs.github.io/apidocs/) - Crypto data
- [Yahoo Finance](https://finance.yahoo.com/) - Equity data
- [EastMoney](https://www.eastmoney.com/) - CN market data


