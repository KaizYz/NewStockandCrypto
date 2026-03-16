// ========================================
// StockandCrypto - Price Feed Service
// Real-time price updates for trigger engine
// ========================================

const WebSocket = require('ws');
const axios = require('axios');

class PriceFeedService {
  constructor(positionService, stopOrderService) {
    this.positionService = positionService;
    this.stopOrderService = stopOrderService;
    
    this.subscriptions = new Map(); // symbol -> Set of positionIds
    this.priceCache = new Map(); // symbol -> { price, timestamp }
    this.wsConnections = new Map(); // exchange -> WebSocket
    
    this.checkInterval = null;
    this.pollInterval = null;
  }

  // ==================== BINANCE WEBSOCKET ====================

  /**
   * Connect to Binance WebSocket for real-time prices
   */
  connectBinance(symbols = []) {
    if (symbols.length === 0) {
      console.log('No symbols to subscribe to Binance');
      return;
    }

    // Binance uses lowercase symbols for WebSocket
    const streams = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    console.log(`📡 Connecting to Binance WebSocket for: ${symbols.join(', ')}`);

    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('✅ Binance WebSocket connected');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.data) {
          const ticker = message.data;
          const symbol = ticker.s; // BTCUSDT
          const price = parseFloat(ticker.c); // Current price

          this.handlePriceUpdate(symbol, price);
        }
      } catch (error) {
        console.error('Binance message parse error:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('Binance WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('Binance WebSocket closed, reconnecting in 5s...');
      setTimeout(() => this.connectBinance(symbols), 5000);
    });

    this.wsConnections.set('binance', ws);
  }

  /**
   * Connect to Binance US WebSocket (for US users)
   */
  connectBinanceUS(symbols = []) {
    if (symbols.length === 0) return;

    const streams = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');
    const wsUrl = `wss://stream.binance.us:9443/stream?streams=${streams}`;

    console.log(`📡 Connecting to Binance US WebSocket for: ${symbols.join(', ')}`);

    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('✅ Binance US WebSocket connected');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.data) {
          const ticker = message.data;
          const symbol = ticker.s;
          const price = parseFloat(ticker.c);

          this.handlePriceUpdate(symbol, price);
        }
      } catch (error) {
        console.error('Binance US message parse error:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('Binance US WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('Binance US WebSocket closed, reconnecting in 5s...');
      setTimeout(() => this.connectBinanceUS(symbols), 5000);
    });

    this.wsConnections.set('binanceUS', ws);
  }

  // ==================== OKX WEBSOCKET ====================

  /**
   * Connect to OKX WebSocket for real-time prices
   */
  connectOKX(symbols = []) {
    if (symbols.length === 0) return;

    console.log(`📡 Connecting to OKX WebSocket for: ${symbols.join(', ')}`);

    const ws = new WebSocket('wss://ws.okx.com/ws/v5/public');

    ws.on('open', () => {
      console.log('✅ OKX WebSocket connected');
      
      // Subscribe to tickers
      const subscribeMsg = {
        op: 'subscribe',
        args: symbols.map(s => ({
          channel: 'tickers',
          instId: s // BTC-USDT
        }))
      };
      ws.send(JSON.stringify(subscribeMsg));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.data && message.arg && message.arg.channel === 'tickers') {
          for (const ticker of message.data) {
            const symbol = ticker.instId.replace('-', ''); // BTC-USDT -> BTCUSDT
            const price = parseFloat(ticker.last);
            this.handlePriceUpdate(symbol, price);
          }
        }
      } catch (error) {
        console.error('OKX message parse error:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('OKX WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('OKX WebSocket closed, reconnecting in 5s...');
      setTimeout(() => this.connectOKX(symbols), 5000);
    });

    this.wsConnections.set('okx', ws);
  }

  // ==================== REST API POLLING ====================

  /**
   * Fetch price from Binance REST API (fallback)
   */
  async fetchBinancePrice(symbol) {
    try {
      const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      return parseFloat(response.data.price);
    } catch (error) {
      console.error(`Failed to fetch ${symbol} from Binance:`, error.message);
      return null;
    }
  }

  /**
   * Fetch price from CoinGecko (fallback)
   */
  async fetchCoinGeckoPrice(coinId) {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      return response.data[coinId]?.usd || null;
    } catch (error) {
      console.error(`Failed to fetch ${coinId} from CoinGecko:`, error.message);
      return null;
    }
  }

  // ==================== PRICE UPDATE HANDLING ====================

  /**
   * Handle price update from WebSocket or polling
   */
  async handlePriceUpdate(symbol, price) {
    // Cache the price
    this.priceCache.set(symbol, {
      price,
      timestamp: Date.now()
    });

    // Update position prices in database
    await this.positionService.batchUpdatePrices(symbol, price);

    // Check stop orders
    const triggeredOrders = await this.stopOrderService.checkStopOrdersForSymbol(symbol, price);

    if (triggeredOrders.length > 0) {
      console.log(`🔔 ${triggeredOrders.length} stop order(s) triggered for ${symbol}`);
    }
  }

  /**
   * Get cached price
   */
  getCachedPrice(symbol) {
    const data = this.priceCache.get(symbol);
    return data ? data.price : null;
  }

  /**
   * Get all cached prices
   */
  getAllCachedPrices() {
    const prices = {};
    for (const [symbol, data] of this.priceCache) {
      prices[symbol] = data.price;
    }
    return prices;
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize price feed service
   */
  async initialize() {
    console.log('🔄 Initializing Price Feed Service...');

    // Get all symbols from open positions
    const symbols = await this.getActivePositionSymbols();
    
    if (symbols.length > 0) {
      // Connect to WebSockets
      this.connectBinance(symbols);
    }

    // Start polling as backup
    this.startPolling(symbols);

    console.log(`✅ Price Feed Service initialized (${symbols.length} symbols)`);
  }

  /**
   * Get all symbols from open positions
   */
  async getActivePositionSymbols() {
    const { data: positions, error } = await this.positionService.supabase
      .from('positions')
      .select('symbol')
      .eq('status', 'open');

    if (error || !positions) return [];

    // Unique symbols
    return [...new Set(positions.map(p => p.symbol))];
  }

  /**
   * Start polling for prices (backup)
   */
  startPolling(symbols, intervalMs = 10000) {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(async () => {
      for (const symbol of symbols) {
        // Skip if we have recent WebSocket data
        const cached = this.priceCache.get(symbol);
        if (cached && Date.now() - cached.timestamp < 5000) {
          continue;
        }

        // Poll REST API
        const price = await this.fetchBinancePrice(symbol);
        if (price) {
          await this.handlePriceUpdate(symbol, price);
        }
      }
    }, intervalMs);

    console.log(`🔄 Price polling started (${intervalMs}ms interval)`);
  }

  /**
   * Stop all connections
   */
  stop() {
    // Close WebSocket connections
    for (const [exchange, ws] of this.wsConnections) {
      console.log(`Closing ${exchange} WebSocket...`);
      ws.close();
    }
    this.wsConnections.clear();

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log('🛑 Price Feed Service stopped');
  }

  // ==================== SUBSCRIPTION MANAGEMENT ====================

  /**
   * Subscribe to price updates for a symbol
   */
  subscribe(symbol, positionId) {
    if (!this.subscriptions.has(symbol)) {
      this.subscriptions.set(symbol, new Set());
    }
    this.subscriptions.get(symbol).add(positionId);
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribe(symbol, positionId) {
    const subs = this.subscriptions.get(symbol);
    if (subs) {
      subs.delete(positionId);
      if (subs.size === 0) {
        this.subscriptions.delete(symbol);
      }
    }
  }

  /**
   * Get price for a symbol (with fallback)
   */
  async getPrice(symbol) {
    // Try cache first
    const cached = this.getCachedPrice(symbol);
    if (cached) return cached;

    // Fetch from REST API
    const price = await this.fetchBinancePrice(symbol);
    if (price) {
      this.priceCache.set(symbol, { price, timestamp: Date.now() });
    }

    return price;
  }
}

module.exports = PriceFeedService;
