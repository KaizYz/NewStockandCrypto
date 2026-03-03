# API Integration Guide - Complete Technical Documentation

## 📊 Overview

This document provides comprehensive guidance on integrating external APIs for the StockandCrypto platform, covering data sources, authentication, error handling, and failover strategies.

### Supported APIs

**Primary Data Sources:**
1. **Binance API** - Cryptocurrency real-time & historical data
2. **Yahoo Finance** - US equity market data
3. **Alpha Vantage** - Backup data source with technical indicators
4. **AkShare** - Chinese A-share market data
5. **CoinGecko** - Cryptocurrency market cap & metadata

---

## 🔑 API Configuration

### Environment Variables

```python
# .env file
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret

ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key

COINGECKO_API_KEY=your_coingecko_api_key  # Optional (free tier available)

# Rate Limiting
API_RATE_LIMIT_ENABLED=true
API_MAX_RETRIES=3
API_RETRY_DELAY_SECONDS=1
```

### Configuration File

```python
# configs/api_config.yaml

binance:
  base_url: "https://api.binance.com"
  websocket_url: "wss://stream.binance.com:9443/ws"
  rate_limit:
    requests_per_minute: 1200
    orders_per_second: 50
  timeout_seconds: 10

yahoo_finance:
  base_url: "https://query1.finance.yahoo.com"
  rate_limit:
    requests_per_minute: 2000
  timeout_seconds: 30

alpha_vantage:
  base_url: "https://www.alphavantage.co/query"
  rate_limit:
    requests_per_minute: 5  # Free tier: 5 calls/min
    requests_per_day: 500   # Free tier: 500 calls/day
  timeout_seconds: 15

akshare:
  rate_limit:
    requests_per_minute: 30
  timeout_seconds: 20

coingecko:
  base_url: "https://api.coingecko.com/api/v3"
  rate_limit:
    requests_per_minute: 10  # Free tier
  timeout_seconds: 15
```

---

## 📡 Binance API Integration

### 1. REST API

**Authentication:**
```python
import hmac
import hashlib
import time
import requests
from urllib.parse import urlencode

class BinanceAPI:
    def __init__(self, api_key, api_secret):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api.binance.com"
        self.headers = {"X-MBX-APIKEY": self.api_key}
    
    def _sign_request(self, params):
        """Sign request with HMAC SHA256"""
        params['timestamp'] = int(time.time() * 1000)
        query_string = urlencode(params)
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            query_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        params['signature'] = signature
        return params
    
    def _request(self, method, endpoint, params=None, signed=False):
        """Make HTTP request with retry logic"""
        url = f"{self.base_url}{endpoint}"
        
        if params is None:
            params = {}
        
        if signed:
            params = self._sign_request(params)
        
        for attempt in range(3):
            try:
                if method == "GET":
                    response = requests.get(url, params=params, headers=self.headers, timeout=10)
                elif method == "POST":
                    response = requests.post(url, params=params, headers=self.headers, timeout=10)
                
                response.raise_for_status()
                return response.json()
            
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)  # Exponential backoff
        
        return None
```

**Market Data Endpoints:**
```python
class BinanceAPI:
    # ... (previous code)
    
    def get_klines(self, symbol, interval="1h", limit=500):
        """Get candlestick data
        
        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            interval: Kline interval (1m, 5m, 15m, 1h, 4h, 1d)
            limit: Number of candles (max 1000)
        
        Returns:
            List of klines: [open_time, open, high, low, close, volume, ...]
        """
        endpoint = "/api/v3/klines"
        params = {
            "symbol": symbol,
            "interval": interval,
            "limit": limit
        }
        return self._request("GET", endpoint, params)
    
    def get_ticker_price(self, symbol):
        """Get current price for symbol"""
        endpoint = "/api/v3/ticker/price"
        params = {"symbol": symbol}
        return self._request("GET", endpoint, params)
    
    def get_24h_ticker(self, symbol):
        """Get 24h price change statistics"""
        endpoint = "/api/v3/ticker/24hr"
        params = {"symbol": symbol}
        return self._request("GET", endpoint, params)
    
    def get_exchange_info(self):
        """Get exchange information (symbols, precision, limits)"""
        endpoint = "/api/v3/exchangeInfo"
        return self._request("GET", endpoint)
```

**Example Usage:**
```python
# Initialize API
api = BinanceAPI(api_key, api_secret)

# Get BTC/USDT klines
klines = api.get_klines("BTCUSDT", interval="1h", limit=500)

# Parse klines
import pandas as pd
df = pd.DataFrame(klines, columns=[
    'open_time', 'open', 'high', 'low', 'close', 'volume',
    'close_time', 'quote_volume', 'trades', 'taker_buy_base',
    'taker_buy_quote', 'ignore'
])

df['open_time'] = pd.to_datetime(df['open_time'], unit='ms')
df['close_time'] = pd.to_datetime(df['close_time'], unit='ms')

for col in ['open', 'high', 'low', 'close', 'volume']:
    df[col] = df[col].astype(float)
```

### 2. WebSocket Integration

**Real-time Price Streaming:**
```python
import asyncio
import websockets
import json

class BinanceWebSocket:
    def __init__(self, symbol, callback):
        self.symbol = symbol.lower()
        self.callback = callback
        self.ws_url = f"wss://stream.binance.com:9443/ws/{self.symbol}@kline_1h"
        self.running = False
    
    async def connect(self):
        """Connect to Binance WebSocket"""
        self.running = True
        
        while self.running:
            try:
                async with websockets.connect(self.ws_url) as ws:
                    print(f"Connected to Binance WebSocket for {self.symbol}")
                    
                    while self.running:
                        message = await ws.recv()
                        data = json.loads(message)
                        
                        # Parse kline data
                        kline = data['k']
                        parsed_data = {
                            'symbol': kline['s'],
                            'interval': kline['i'],
                            'open_time': kline['t'],
                            'close_time': kline['T'],
                            'open': float(kline['o']),
                            'high': float(kline['h']),
                            'low': float(kline['l']),
                            'close': float(kline['c']),
                            'volume': float(kline['v']),
                            'is_closed': kline['x']
                        }
                        
                        # Call callback function
                        await self.callback(parsed_data)
            
            except Exception as e:
                print(f"WebSocket error: {e}, reconnecting in 5s...")
                await asyncio.sleep(5)
    
    async def close(self):
        """Close WebSocket connection"""
        self.running = False

# Usage example
async def handle_kline(data):
    """Process incoming kline data"""
    print(f"{data['symbol']} @ {data['close']} (Volume: {data['volume']})")
    
    # Update features
    # Generate prediction
    # Push to frontend

async def main():
    ws = BinanceWebSocket("BTCUSDT", handle_kline)
    await ws.connect()

# Run WebSocket
# asyncio.run(main())
```

**Multi-Stream WebSocket:**
```python
class BinanceMultiStream:
    def __init__(self, symbols, callback):
        self.symbols = [s.lower() for s in symbols]
        self.callback = callback
        
        # Build stream URL
        streams = [f"{s}@kline_1h" for s in self.symbols]
        self.ws_url = f"wss://stream.binance.com:9443/stream?streams={'/'.join(streams)}"
    
    async def connect(self):
        """Connect to multi-stream WebSocket"""
        async with websockets.connect(self.ws_url) as ws:
            print(f"Connected to {len(self.symbols)} streams")
            
            while True:
                message = await ws.recv()
                data = json.loads(message)
                
                # Extract stream data
                stream_data = data['data']
                kline = stream_data['k']
                
                parsed = {
                    'symbol': kline['s'],
                    'close': float(kline['c']),
                    'volume': float(kline['v']),
                    'is_closed': kline['x']
                }
                
                await self.callback(parsed)

# Usage
symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
multi_ws = BinanceMultiStream(symbols, handle_kline)
```

---

## 📈 Yahoo Finance Integration

### 1. Using yfinance Library

```python
import yfinance as yf
import pandas as pd

class YahooFinanceAPI:
    def __init__(self):
        self.cache = {}
        self.cache_timeout = 3600  # 1 hour
    
    def get_historical_data(self, symbol, period="5y", interval="1d"):
        """Get historical market data
        
        Args:
            symbol: Stock symbol (e.g., "AAPL", "^GSPC")
            period: Time period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)
            interval: Data interval (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)
        
        Returns:
            DataFrame with OHLCV data
        """
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval)
        
        # Clean data
        df = df.reset_index()
        df.columns = df.columns.str.lower()
        df = df.rename(columns={'date': 'datetime'})
        
        return df
    
    def get_index_constituents(self, index_symbol):
        """Get index constituents (approximation)
        
        Note: Yahoo Finance doesn't provide direct constituent data.
        Use manual lists or other data sources.
        """
        # For S&P 500, use Wikipedia
        if index_symbol == "^GSPC":
            url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
            tables = pd.read_html(url)
            df = tables[0]
            return df['Symbol'].tolist()
        
        # For Nasdaq 100
        elif index_symbol == "^NDX":
            url = "https://www.slickcharts.com/nasdaq100"
            tables = pd.read_html(url)
            df = tables[0]
            return df['Symbol'].tolist()
        
        return None
    
    def get_market_cap(self, symbol):
        """Get market capitalization"""
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return info.get('marketCap', None)
    
    def get_pe_ratio(self, symbol):
        """Get P/E ratio"""
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return info.get('trailingPE', None)
```

**Example Usage:**
```python
# Initialize
yf_api = YahooFinanceAPI()

# Get S&P 500 historical data
sp500 = yf_api.get_historical_data("^GSPC", period="5y", interval="1d")
print(sp500.head())

# Get Apple stock data
aapl = yf_api.get_historical_data("AAPL", period="2y", interval="1d")

# Get real-time price
aapl_ticker = yf.Ticker("AAPL")
current_price = aapl_ticker.history(period="1d")['Close'].iloc[-1]
```

### 2. Batch Data Fetching

```python
import asyncio
import aiohttp

class YahooFinanceAsync:
    """Async Yahoo Finance API client"""
    
    async def fetch_batch_prices(self, symbols):
        """Fetch prices for multiple symbols concurrently"""
        
        async def fetch_one(session, symbol):
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
            params = {"interval": "1d", "range": "1d"}
            
            async with session.get(url, params=params) as response:
                data = await response.json()
                
                try:
                    quote = data['chart']['result'][0]['meta']
                    return {
                        'symbol': symbol,
                        'price': quote['regularMarketPrice'],
                        'currency': quote['currency']
                    }
                except (KeyError, IndexError):
                    return {'symbol': symbol, 'error': 'Data not found'}
        
        async with aiohttp.ClientSession() as session:
            tasks = [fetch_one(session, symbol) for symbol in symbols]
            results = await asyncio.gather(*tasks)
        
        return results

# Usage
async def get_all_prices():
    yf_async = YahooFinanceAsync()
    symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]
    prices = await yf_async.fetch_batch_prices(symbols)
    
    for p in prices:
        if 'error' not in p:
            print(f"{p['symbol']}: ${p['price']:.2f}")

# asyncio.run(get_all_prices())
```

---

## 🔷 Alpha Vantage Integration

### 1. REST API Client

```python
import requests
import time
from datetime import datetime

class AlphaVantageAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://www.alphavantage.co/query"
        self.last_request_time = 0
        self.min_request_interval = 12  # 5 calls/min = 12s between calls
    
    def _rate_limit(self):
        """Apply rate limiting"""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self.last_request_time = time.time()
    
    def _request(self, params):
        """Make API request with rate limiting"""
        self._rate_limit()
        
        params['apikey'] = self.api_key
        
        response = requests.get(self.base_url, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        # Check for API errors
        if 'Error Message' in data:
            raise ValueError(f"API Error: {data['Error Message']}")
        
        if 'Note' in data:
            # Rate limit exceeded
            print(f"Rate limit note: {data['Note']}")
            time.sleep(60)  # Wait 1 minute
            return self._request(params)
        
        return data
    
    def get_daily_prices(self, symbol, outputsize="full"):
        """Get daily price data
        
        Args:
            symbol: Stock symbol (e.g., "AAPL")
            outputsize: "compact" (last 100 data points) or "full"
        
        Returns:
            DataFrame with daily prices
        """
        params = {
            "function": "TIME_SERIES_DAILY",
            "symbol": symbol,
            "outputsize": outputsize
        }
        
        data = self._request(params)
        
        # Parse time series
        time_series = data['Time Series (Daily)']
        
        df = pd.DataFrame.from_dict(time_series, orient='index')
        df.index = pd.to_datetime(df.index)
        df.columns = [col.split('. ')[1] for col in df.columns]
        df = df.astype(float)
        df = df.sort_index()
        
        return df
    
    def get_intraday(self, symbol, interval="5min"):
        """Get intraday price data
        
        Args:
            symbol: Stock symbol
            interval: Time interval (1min, 5min, 15min, 30min, 60min)
        
        Returns:
            DataFrame with intraday prices
        """
        params = {
            "function": "TIME_SERIES_INTRADAY",
            "symbol": symbol,
            "interval": interval,
            "outputsize": "full"
        }
        
        data = self._request(params)
        
        key = f"Time Series ({interval})"
        time_series = data[key]
        
        df = pd.DataFrame.from_dict(time_series, orient='index')
        df.index = pd.to_datetime(df.index)
        df.columns = [col.split('. ')[1] for col in df.columns]
        df = df.astype(float)
        df = df.sort_index()
        
        return df
    
    def get_technical_indicator(self, symbol, indicator, **kwargs):
        """Get technical indicator
        
        Args:
            symbol: Stock symbol
            indicator: Indicator name (SMA, EMA, RSI, MACD, etc.)
            **kwargs: Indicator-specific parameters
        
        Returns:
            DataFrame with indicator values
        """
        params = {
            "function": indicator,
            "symbol": symbol
        }
        params.update(kwargs)
        
        data = self._request(params)
        
        # Parse technical indicator data
        # Structure varies by indicator
        return data
```

**Example Usage:**
```python
# Initialize
av_api = AlphaVantageAPI(api_key)

# Get Apple daily prices
aapl_daily = av_api.get_daily_prices("AAPL", outputsize="compact")
print(aapl_daily.head())

# Get intraday data
aapl_intraday = av_api.get_intraday("AAPL", interval="5min")

# Get SMA indicator
sma = av_api.get_technical_indicator("AAPL", "SMA", interval="daily", time_period=20)
```

### 2. Fallback Strategy

```python
class DataFetcherWithFallback:
    """Data fetcher with automatic fallback to backup sources"""
    
    def __init__(self, primary_source, backup_sources):
        self.primary = primary_source
        self.backups = backup_sources
        self.failure_counts = {}
    
    def get_data(self, symbol, **kwargs):
        """Get data with fallback"""
        
        # Try primary source
        try:
            return self.primary.get_data(symbol, **kwargs)
        except Exception as e:
            print(f"Primary source failed: {e}")
            self.failure_counts['primary'] = self.failure_counts.get('primary', 0) + 1
        
        # Try backup sources
        for i, backup in enumerate(self.backups):
            try:
                print(f"Trying backup source {i+1}...")
                return backup.get_data(symbol, **kwargs)
            except Exception as e:
                print(f"Backup {i+1} failed: {e}")
                self.failure_counts[f'backup_{i+1}'] = self.failure_counts.get(f'backup_{i+1}', 0) + 1
        
        # All sources failed
        raise RuntimeError(f"All data sources failed for {symbol}")

# Usage
primary = YahooFinanceAPI()
backup1 = AlphaVantageAPI(alpha_vantage_key)
backup2 = BinanceAPI(binace_key, binance_secret)

fetcher = DataFetcherWithFallback(primary, [backup1, backup2])
data = fetcher.get_data("AAPL", period="1y")
```

---

## 🇨🇳 AkShare Integration

### Chinese A-Share Market Data

```python
import akshare as ak
import pandas as pd

class AkShareAPI:
    """AkShare API for Chinese A-share market data"""
    
    def __init__(self):
        self.cache = {}
    
    def get_index_daily(self, symbol="sh000001"):
        """Get index daily data
        
        Args:
            symbol: Index symbol (sh000001=SSE, sz399001=SZSE)
        
        Returns:
            DataFrame with index data
        """
        df = ak.stock_zh_index_daily(symbol=symbol)
        
        # Rename columns
        df = df.rename(columns={
            'date': 'datetime',
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        })
        
        df['datetime'] = pd.to_datetime(df['datetime'])
        df = df.set_index('datetime').sort_index()
        
        return df
    
    def get_stock_daily(self, symbol="000001"):
        """Get individual stock daily data
        
        Args:
            symbol: Stock symbol (e.g., "000001" for Ping An Bank)
        
        Returns:
            DataFrame with stock data
        """
        df = ak.stock_zh_a_hist(symbol=symbol, period="daily", adjust="qfq")
        
        # Rename columns
        df = df.rename(columns={
            '日期': 'datetime',
            '开盘': 'open',
            '最高': 'high',
            '最低': 'low',
            '收盘': 'close',
            '成交量': 'volume',
            '成交额': 'amount'
        })
        
        df['datetime'] = pd.to_datetime(df['datetime'])
        df = df.set_index('datetime').sort_index()
        
        return df
    
    def get_realtime_quotes(self):
        """Get realtime quotes for all A-shares"""
        df = ak.stock_zh_a_spot_em()
        
        # Select relevant columns
        df = df[['代码', '名称', '最新价', '涨跌幅', '成交量', '成交额']]
        df.columns = ['symbol', 'name', 'price', 'change_pct', 'volume', 'amount']
        
        return df
    
    def get_constituent_stocks(self, index_name="沪深300"):
        """Get index constituent stocks"""
        if index_name == "沪深300":
            df = ak.index_stock_cons_weight_csindex(symbol="000300")
            return df[['成分券代码', '成分券名称', '权重']].values.tolist()
        elif index_name == "上证50":
            df = ak.index_stock_cons_weight_csindex(symbol="000016")
            return df[['成分券代码', '成分券名称', '权重']].values.tolist()
        
        return None

# Usage
ak_api = AkShareAPI()

# Get SSE Composite index
sse_index = ak_api.get_index_daily("sh000001")

# Get individual stock
pingan = ak_api.get_stock_daily("000001")

# Get CSI 300 constituents
csi300_stocks = ak_api.get_constituent_stocks("沪深300")
```

---

## 🐛 Error Handling & Retry Logic

### Comprehensive Error Handling

```python
import time
import logging
from functools import wraps
from typing import Callable, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def retry_with_backoff(
    max_retries: int = 3,
    base_delay: float = 1.0,
    exponential_base: float = 2.0,
    exceptions: tuple = (Exception,)
):
    """Retry decorator with exponential backoff"""
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            last_exception = None
            
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                
                except exceptions as e:
                    last_exception = e
                    
                    if attempt == max_retries - 1:
                        logger.error(f"All {max_retries} retries failed for {func.__name__}")
                        raise
                    
                    delay = base_delay * (exponential_base ** attempt)
                    logger.warning(
                        f"Attempt {attempt + 1}/{max_retries} failed for {func.__name__}: {e}. "
                        f"Retrying in {delay:.1f}s..."
                    )
                    time.sleep(delay)
            
            raise last_exception
        
        return wrapper
    return decorator

# Usage
class RobustAPI:
    @retry_with_backoff(max_retries=3, base_delay=1.0, exceptions=(requests.RequestException,))
    def get_data(self, url):
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
```

### Rate Limiting

```python
import time
from collections import deque

class RateLimiter:
    """Token bucket rate limiter"""
    
    def __init__(self, rate: float, capacity: int):
        """
        Args:
            rate: Tokens added per second
            capacity: Maximum bucket capacity
        """
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.time()
        self.lock = threading.Lock()
    
    def acquire(self, tokens: int = 1):
        """Acquire tokens, blocking if necessary"""
        with self.lock:
            now = time.time()
            elapsed = now - self.last_update
            
            # Add tokens based on elapsed time
            self.tokens = min(
                self.capacity,
                self.tokens + elapsed * self.rate
            )
            self.last_update = now
            
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            
            # Calculate wait time
            deficit = tokens - self.tokens
            wait_time = deficit / self.rate
            
            time.sleep(wait_time)
            self.tokens = 0
            return True

# Usage
limiter = RateLimiter(rate=10, capacity=10)  # 10 requests per second

def make_api_call():
    limiter.acquire()
    # Make API call
    pass
```

---

## 📊 Data Quality Validation

```python
import pandas as pd
import numpy as np

class DataQualityValidator:
    """Validate data quality before processing"""
    
    @staticmethod
    def validate_ohlcv(df: pd.DataFrame) -> dict:
        """Validate OHLCV data"""
        
        issues = []
        
        # Check required columns
        required_cols = ['open', 'high', 'low', 'close', 'volume']
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            issues.append(f"Missing columns: {missing_cols}")
        
        # Check for missing values
        null_counts = df[required_cols].isnull().sum()
        if null_counts.any():
            issues.append(f"Null values found: {null_counts[null_counts > 0].to_dict()}")
        
        # Check OHLC relationships
        if all(col in df.columns for col in ['open', 'high', 'low', 'close']):
            invalid_high = df[df['high'] < df['low']]
            if len(invalid_high) > 0:
                issues.append(f"High < Low in {len(invalid_high)} rows")
            
            invalid_close = df[
                (df['close'] > df['high']) | 
                (df['close'] < df['low'])
            ]
            if len(invalid_close) > 0:
                issues.append(f"Close outside [low, high] in {len(invalid_close)} rows")
        
        # Check for price spikes
        if 'close' in df.columns:
            returns = df['close'].pct_change()
            spikes = df[returns.abs() > 0.3]  # >30% change
            if len(spikes) > 0:
                issues.append(f"Price spikes detected: {len(spikes)} instances")
        
        # Check volume anomalies
        if 'volume' in df.columns:
            zero_volume = df[df['volume'] == 0]
            if len(zero_volume) > 0:
                issues.append(f"Zero volume rows: {len(zero_volume)}")
        
        return {
            'is_valid': len(issues) == 0,
            'issues': issues,
            'total_rows': len(df)
        }
    
    @staticmethod
    def validate_timestamps(df: pd.DataFrame, freq: str = 'D') -> dict:
        """Validate timestamp continuity"""
        
        if 'datetime' not in df.columns and df.index.name != 'datetime':
            return {'is_valid': False, 'issues': ['No datetime column found']}
        
        dates = df.index if df.index.name == 'datetime' else df['datetime']
        
        issues = []
        
        # Check for duplicates
        duplicates = dates.duplicated()
        if duplicates.any():
            issues.append(f"Duplicate timestamps: {duplicates.sum()}")
        
        # Check for gaps
        date_range = pd.date_range(start=dates.min(), end=dates.max(), freq=freq)
        missing_dates = date_range.difference(dates)
        if len(missing_dates) > 0:
            issues.append(f"Missing dates: {len(missing_dates)}")
        
        return {
            'is_valid': len(issues) == 0,
            'issues': issues,
            'date_range': f"{dates.min()} to {dates.max()}"
        }
```

---

## 📝 API Integration Best Practices

### 1. Connection Pooling

```python
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def create_session(pool_connections=10, pool_maxsize=10, max_retries=3):
    """Create requests session with connection pooling and retry"""
    
    session = requests.Session()
    
    # Retry strategy
    retry_strategy = Retry(
        total=max_retries,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        method_whitelist=["HEAD", "GET", "OPTIONS"]
    )
    
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=pool_connections,
        pool_maxsize=pool_maxsize
    )
    
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    return session
```

### 2. Caching Strategy

```python
import hashlib
import pickle
from pathlib import Path

class APICache:
    """Simple file-based cache for API responses"""
    
    def __init__(self, cache_dir="cache", ttl_seconds=3600):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        self.ttl = ttl_seconds
    
    def _get_cache_key(self, *args, **kwargs):
        """Generate cache key from function arguments"""
        key_str = str(args) + str(sorted(kwargs.items()))
        return hashlib.md5(key_str.encode()).hexdigest()
    
    def get(self, key):
        """Get cached data if not expired"""
        cache_file = self.cache_dir / f"{key}.pkl"
        
        if cache_file.exists():
            with open(cache_file, 'rb') as f:
                data, timestamp = pickle.load(f)
                
                if time.time() - timestamp < self.ttl:
                    return data
        
        return None
    
    def set(self, key, data):
        """Cache data with timestamp"""
        cache_file = self.cache_dir / f"{key}.pkl"
        
        with open(cache_file, 'wb') as f:
            pickle.dump((data, time.time()), f)

# Usage with decorator
def cached_api_call(ttl_seconds=3600):
    cache = APICache(ttl_seconds=ttl_seconds)
    
    def decorator(func):
        def wrapper(*args, **kwargs):
            cache_key = cache._get_cache_key(func.__name__, *args, **kwargs)
            
            # Try cache first
            cached_data = cache.get(cache_key)
            if cached_data is not None:
                return cached_data
            
            # Call API
            data = func(*args, **kwargs)
            cache.set(cache_key, data)
            
            return data
        
        return wrapper
    return decorator
```

---

## 🚀 Production Deployment Checklist

- [ ] Configure API keys in environment variables
- [ ] Set up rate limiting for all API calls
- [ ] Implement retry logic with exponential backoff
- [ ] Configure connection pooling
- [ ] Set up caching for frequently accessed data
- [ ] Implement fallback data sources
- [ ] Add data quality validation
- [ ] Set up monitoring for API failures
- [ ] Configure logging for debugging
- [ ] Test WebSocket reconnection logic

---

**Last Updated:** 2026-03-03  
**Version:** 1.0  
**Status:** Production Ready  
**Next Review:** 2026-03-10