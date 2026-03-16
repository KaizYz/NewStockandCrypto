// ========================================
// StockandCrypto - Position Tracking Server
// Main server file for position management API
// ========================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// Import services
const PositionService = require('./services/positionService');
const StopOrderService = require('./services/stopOrderService');
const PriceFeedService = require('./services/priceFeedService');

// Configuration
const PORT = process.env.POSITION_PORT || 3100;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://odvelrdzdbnbfjuqrbtl.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_sC7xCGB5GqtQwxV-zT35yQ_4vfRSF4p';

// Initialize Express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const positionService = new PositionService();
const stopOrderService = new StopOrderService(positionService);
const priceFeedService = new PriceFeedService(positionService, stopOrderService);

// Supabase client for auth
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ==================== AUTH MIDDLEWARE ====================

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
  }
}

// ==================== POSITION ROUTES ====================

/**
 * GET /api/positions
 * Get all open positions for current user
 */
app.get('/api/positions', authMiddleware, async (req, res) => {
  try {
    const positions = await positionService.getOpenPositions(req.user.id);
    res.json({ positions });
  } catch (error) {
    console.error('Get positions error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/positions/:id
 * Get single position
 */
app.get('/api/positions/:id', authMiddleware, async (req, res) => {
  try {
    const position = await positionService.getPosition(req.params.id);
    
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    if (position.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ position });
  } catch (error) {
    console.error('Get position error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/positions
 * Create new position
 */
app.post('/api/positions', authMiddleware, async (req, res) => {
  try {
    const position = await positionService.openPosition(req.user.id, req.body);
    res.status(201).json({ position });
  } catch (error) {
    console.error('Create position error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/positions/:id/add
 * Add to position (DCA)
 */
app.post('/api/positions/:id/add', authMiddleware, async (req, res) => {
  try {
    const { price, quantity } = req.body;
    
    if (!price || !quantity) {
      return res.status(400).json({ error: 'Price and quantity required' });
    }

    const position = await positionService.getPosition(req.params.id);
    
    if (position.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await positionService.addToPosition(req.params.id, price, quantity);
    res.json({ position: result });
  } catch (error) {
    console.error('Add to position error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/positions/:id/close
 * Close or reduce position
 */
app.post('/api/positions/:id/close', authMiddleware, async (req, res) => {
  try {
    const { price, quantity, reason } = req.body;

    const position = await positionService.getPosition(req.params.id);
    
    if (position.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const closeQty = quantity || position.remaining_qty;
    const result = await positionService.reducePosition(
      req.params.id,
      closeQty,
      price,
      reason || 'manual'
    );

    res.json({
      position: result.position,
      realizedPnl: result.realizedPnl,
      isClosed: result.isClosed
    });
  } catch (error) {
    console.error('Close position error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/positions/:id/history
 * Get position history
 */
app.get('/api/positions/:id/history', authMiddleware, async (req, res) => {
  try {
    const position = await positionService.getPosition(req.params.id);
    
    if (position.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const history = await positionService.getHistory(req.params.id);
    res.json({ history });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/positions/:id/risk
 * Get risk metrics for position
 */
app.get('/api/positions/:id/risk', authMiddleware, async (req, res) => {
  try {
    const metrics = await stopOrderService.getPositionRiskMetrics(req.params.id);
    
    if (metrics.position.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ metrics });
  } catch (error) {
    console.error('Get risk metrics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== STOP ORDER ROUTES ====================

/**
 * GET /api/stop-orders
 * Get all active stop orders
 */
app.get('/api/stop-orders', authMiddleware, async (req, res) => {
  try {
    const orders = await stopOrderService.getActiveOrders(req.user.id);
    res.json({ orders });
  } catch (error) {
    console.error('Get stop orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/stop-orders/stop-loss
 * Create stop-loss order
 */
app.post('/api/stop-orders/stop-loss', authMiddleware, async (req, res) => {
  try {
    const { positionId, triggerPrice, quantity, notes } = req.body;
    
    if (!positionId || !triggerPrice) {
      return res.status(400).json({ error: 'Position ID and trigger price required' });
    }

    const order = await stopOrderService.createStopLoss(
      req.user.id,
      positionId,
      triggerPrice,
      quantity,
      notes
    );
    
    res.status(201).json({ order });
  } catch (error) {
    console.error('Create stop-loss error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/stop-orders/take-profit
 * Create take-profit order
 */
app.post('/api/stop-orders/take-profit', authMiddleware, async (req, res) => {
  try {
    const { positionId, triggerPrice, quantity, notes } = req.body;
    
    if (!positionId || !triggerPrice) {
      return res.status(400).json({ error: 'Position ID and trigger price required' });
    }

    const order = await stopOrderService.createTakeProfit(
      req.user.id,
      positionId,
      triggerPrice,
      quantity,
      notes
    );
    
    res.status(201).json({ order });
  } catch (error) {
    console.error('Create take-profit error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/stop-orders/trailing-stop
 * Create trailing stop order
 */
app.post('/api/stop-orders/trailing-stop', authMiddleware, async (req, res) => {
  try {
    const { positionId, trailPercent, quantity, notes } = req.body;
    
    if (!positionId || !trailPercent) {
      return res.status(400).json({ error: 'Position ID and trail percent required' });
    }

    const order = await stopOrderService.createTrailingStop(
      req.user.id,
      positionId,
      trailPercent,
      quantity,
      notes
    );
    
    res.status(201).json({ order });
  } catch (error) {
    console.error('Create trailing stop error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/stop-orders/:id
 * Cancel stop order
 */
app.delete('/api/stop-orders/:id', authMiddleware, async (req, res) => {
  try {
    await stopOrderService.cancelOrder(req.user.id, req.params.id);
    res.json({ success: true, message: 'Order cancelled' });
  } catch (error) {
    console.error('Cancel stop order error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/stop-orders/:id/history
 * Get stop order history
 */
app.get('/api/stop-orders/:id/history', authMiddleware, async (req, res) => {
  try {
    const history = await stopOrderService.getOrderHistory(req.params.id);
    res.json({ history });
  } catch (error) {
    console.error('Get order history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PORTFOLIO ROUTES ====================

/**
 * GET /api/portfolio/stats
 * Get portfolio statistics
 */
app.get('/api/portfolio/stats', authMiddleware, async (req, res) => {
  try {
    const positions = await positionService.getOpenPositions(req.user.id);
    const metrics = await positionService.getPerformanceMetrics(req.user.id);

    const totalValue = positions.reduce((sum, p) => sum + (p.current_value || p.cost_basis), 0);
    const totalCost = positions.reduce((sum, p) => sum + p.cost_basis, 0);
    const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

    res.json({
      stats: {
        openPositions: positions.length,
        totalValue,
        totalCost,
        unrealizedPnl,
        unrealizedPnlPct: totalCost > 0 ? (unrealizedPnl / totalCost * 100) : 0,
        ...metrics
      }
    });
  } catch (error) {
    console.error('Get portfolio stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/history
 * Get portfolio history
 */
app.get('/api/portfolio/history', authMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const history = await positionService.getPortfolioHistory(req.user.id, days);
    res.json({ history });
  } catch (error) {
    console.error('Get portfolio history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PRICE ROUTES ====================

/**
 * GET /api/prices
 * Get all cached prices
 */
app.get('/api/prices', (req, res) => {
  const prices = priceFeedService.getAllCachedPrices();
  res.json({ prices });
});

/**
 * GET /api/prices/:symbol
 * Get price for a symbol
 */
app.get('/api/prices/:symbol', async (req, res) => {
  try {
    const price = await priceFeedService.getPrice(req.params.symbol.toUpperCase());
    res.json({ symbol: req.params.symbol, price });
  } catch (error) {
    console.error('Get price error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== HEALTH CHECK ====================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'position-tracking',
    timestamp: new Date().toISOString(),
    cachedPrices: priceFeedService.priceCache.size
  });
});

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================

async function startServer() {
  try {
    // Initialize price feed service
    await priceFeedService.initialize();

    // Start server
    app.listen(PORT, () => {
      console.log('');
      console.log('╔═══════════════════════════════════════════╗');
      console.log('║  StockandCrypto Position Tracking Server  ║');
      console.log('╠═══════════════════════════════════════════╣');
      console.log(`║  Port: ${PORT}                                ║`);
      console.log('║  Status: Running                          ║');
      console.log('╚═══════════════════════════════════════════╝');
      console.log('');
      console.log('Available endpoints:');
      console.log('  GET    /health');
      console.log('  GET    /api/positions');
      console.log('  POST   /api/positions');
      console.log('  POST   /api/positions/:id/close');
      console.log('  POST   /api/stop-orders/stop-loss');
      console.log('  POST   /api/stop-orders/take-profit');
      console.log('  POST   /api/stop-orders/trailing-stop');
      console.log('  DELETE /api/stop-orders/:id');
      console.log('  GET    /api/portfolio/stats');
      console.log('  GET    /api/prices/:symbol');
      console.log('');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down...');
      priceFeedService.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down...');
      priceFeedService.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, positionService, stopOrderService, priceFeedService };
