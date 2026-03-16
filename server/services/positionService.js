// ========================================
// StockandCrypto - Position Service
// Backend service for position management
// ========================================

const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://odvelrdzdbnbfjuqrbtl.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_sC7xCGB5GqtQwxV-zT35yQ_4vfRSF4p';

class PositionService {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false
      }
    });
  }

  // ==================== POSITIONS ====================

  /**
   * Get all open positions for a user
   */
  async getOpenPositions(userId) {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get single position by ID
   */
  async getPosition(positionId) {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('id', positionId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a new position
   */
  async openPosition(userId, positionData) {
    const {
      symbol,
      market = 'crypto',
      side = 'long',
      entryPrice,
      quantity,
      leverage = 1,
      notes = null,
      exchange = null
    } = positionData;

    if (!symbol || !entryPrice || !quantity) {
      throw new Error('Symbol, entry price, and quantity are required');
    }

    const costBasis = entryPrice * quantity;
    const marginUsed = costBasis / leverage;

    const position = {
      user_id: userId,
      symbol: symbol.toUpperCase(),
      market,
      side,
      entry_price: entryPrice,
      current_price: entryPrice,
      quantity,
      remaining_qty: quantity,
      cost_basis: costBasis,
      current_value: costBasis,
      leverage,
      margin_used: marginUsed,
      notes,
      exchange,
      status: 'open'
    };

    const { data, error } = await this.supabase
      .from('positions')
      .insert(position)
      .select()
      .single();

    if (error) throw error;

    // Log history
    await this.logHistory(data.id, 'open', null, quantity, entryPrice, quantity, 0, 'manual');

    return data;
  }

  /**
   * Add to existing position (DCA)
   */
  async addToPosition(positionId, addPrice, addQuantity) {
    const position = await this.getPosition(positionId);
    if (position.status !== 'open') {
      throw new Error('Position is not open');
    }

    const previousQty = position.remaining_qty;
    const newQty = previousQty + addQuantity;

    // Calculate new average entry price
    const totalCost = (position.entry_price * position.quantity) + (addPrice * addQuantity);
    const totalQty = position.quantity + addQuantity;
    const newEntryPrice = totalCost / totalQty;
    const newCostBasis = totalCost;

    const { data, error } = await this.supabase
      .from('positions')
      .update({
        entry_price: newEntryPrice,
        quantity: totalQty,
        remaining_qty: newQty,
        cost_basis: newCostBasis,
        current_value: newQty * position.current_price,
        updated_at: new Date().toISOString()
      })
      .eq('id', positionId)
      .select()
      .single();

    if (error) throw error;

    // Log history
    await this.logHistory(positionId, 'add', previousQty, newQty, addPrice, addQuantity, 0, 'dca');

    return data;
  }

  /**
   * Reduce or close a position
   */
  async reducePosition(positionId, closeQuantity, closePrice, reason = 'manual') {
    const position = await this.getPosition(positionId);
    if (position.status !== 'open') {
      throw new Error('Position is not open');
    }

    const previousQty = position.remaining_qty;
    const actualCloseQty = Math.min(closeQuantity, previousQty);
    const newRemainingQty = previousQty - actualCloseQty;
    const isFullClose = newRemainingQty <= 0;

    // Calculate realized P&L
    let realizedPnl = 0;
    if (position.side === 'long') {
      realizedPnl = (closePrice - position.entry_price) * actualCloseQty;
    } else {
      realizedPnl = (position.entry_price - closePrice) * actualCloseQty;
    }

    // Calculate total realized P&L for the position
    const totalRealizedPnl = (position.realized_pnl || 0) + realizedPnl;

    const updateData = {
      remaining_qty: newRemainingQty,
      current_price: closePrice,
      current_value: newRemainingQty * closePrice,
      realized_pnl: totalRealizedPnl,
      updated_at: new Date().toISOString()
    };

    if (isFullClose) {
      updateData.status = 'closed';
      updateData.closed_at = new Date().toISOString();
      updateData.current_value = 0;
    }

    const { data, error } = await this.supabase
      .from('positions')
      .update(updateData)
      .eq('id', positionId)
      .select()
      .single();

    if (error) throw error;

    // Log history
    await this.logHistory(
      positionId,
      isFullClose ? 'close' : 'reduce',
      previousQty,
      newRemainingQty,
      closePrice,
      actualCloseQty,
      realizedPnl,
      reason
    );

    // Update portfolio stats
    await this.updatePortfolioStats(position.user_id);

    return {
      position: data,
      realizedPnl,
      isClosed: isFullClose
    };
  }

  /**
   * Update position current price (called by price feed)
   */
  async updatePrice(positionId, currentPrice) {
    const position = await this.getPosition(positionId);
    if (position.status !== 'open') return;

    let unrealizedPnl = 0;
    let unrealizedPnlPct = 0;

    if (position.side === 'long') {
      unrealizedPnl = (currentPrice - position.entry_price) * position.remaining_qty;
      unrealizedPnlPct = ((currentPrice - position.entry_price) / position.entry_price) * 100;
    } else {
      unrealizedPnl = (position.entry_price - currentPrice) * position.remaining_qty;
      unrealizedPnlPct = ((position.entry_price - currentPrice) / position.entry_price) * 100;
    }

    const currentValue = currentPrice * position.remaining_qty;

    await this.supabase
      .from('positions')
      .update({
        current_price: currentPrice,
        current_value: currentValue,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_pct: unrealizedPnlPct,
        updated_at: new Date().toISOString()
      })
      .eq('id', positionId);
  }

  /**
   * Batch update prices for multiple positions
   */
  async batchUpdatePrices(symbol, currentPrice) {
    const { data: positions, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('symbol', symbol)
      .eq('status', 'open');

    if (error || !positions) return;

    for (const position of positions) {
      await this.updatePrice(position.id, currentPrice);
    }
  }

  // ==================== HISTORY ====================

  /**
   * Log position history
   */
  async logHistory(positionId, action, previousQty, newQty, price, quantity, realizedPnl, reason) {
    await this.supabase
      .from('position_history')
      .insert({
        position_id: positionId,
        action,
        previous_qty: previousQty,
        new_qty: newQty,
        price,
        quantity,
        realized_pnl: realizedPnl || 0,
        reason
      });
  }

  /**
   * Get position history
   */
  async getHistory(positionId, limit = 50) {
    const { data, error } = await this.supabase
      .from('position_history')
      .select('*')
      .eq('position_id', positionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // ==================== PORTFOLIO STATS ====================

  /**
   * Update portfolio snapshot
   */
  async updatePortfolioStats(userId) {
    const positions = await this.getOpenPositions(userId);

    const totalValue = positions.reduce((sum, p) => sum + (p.current_value || p.cost_basis), 0);
    const totalCost = positions.reduce((sum, p) => sum + p.cost_basis, 0);
    const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

    // Get today's snapshot
    const today = new Date().toISOString().split('T')[0];
    const { data: existingSnapshot } = await this.supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('user_id', userId)
      .gte('timestamp', today)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (existingSnapshot) {
      // Update existing snapshot
      await this.supabase
        .from('portfolio_snapshots')
        .update({
          positions_value: totalValue,
          total_equity: totalValue,
          open_positions: positions.length
        })
        .eq('id', existingSnapshot.id);
    } else {
      // Create new snapshot
      await this.supabase
        .from('portfolio_snapshots')
        .insert({
          user_id: userId,
          total_equity: totalValue,
          cash_balance: 0,
          positions_value: totalValue,
          daily_pnl: unrealizedPnl,
          open_positions: positions.length
        });
    }
  }

  /**
   * Get portfolio history
   */
  async getPortfolioHistory(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('user_id', userId)
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Calculate performance metrics
   */
  async getPerformanceMetrics(userId) {
    // Get closed positions
    const { data: closedPositions, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    if (!closedPositions || closedPositions.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        totalRealizedPnl: 0
      };
    }

    const wins = closedPositions.filter(p => (p.realized_pnl || 0) > 0);
    const losses = closedPositions.filter(p => (p.realized_pnl || 0) < 0);
    const totalWins = wins.reduce((sum, p) => sum + p.realized_pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p.realized_pnl, 0));

    return {
      totalTrades: closedPositions.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: closedPositions.length > 0 ? (wins.length / closedPositions.length * 100).toFixed(2) : 0,
      avgWin: wins.length > 0 ? totalWins / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
      profitFactor: totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : 'N/A',
      totalRealizedPnl: closedPositions.reduce((sum, p) => sum + (p.realized_pnl || 0), 0)
    };
  }

  // ==================== RISK METRICS ====================

  /**
   * Calculate risk metrics for a position with stop orders
   */
  calculateRiskMetrics(position, stopLoss = null, takeProfit = null) {
    const entryPrice = position.entry_price;
    const currentPrice = position.current_price || entryPrice;
    const quantity = position.remaining_qty;

    let maxLoss = 0;
    let maxGain = 0;
    let stopLossDistance = 0;
    let takeProfitDistance = 0;

    if (stopLoss) {
      if (position.side === 'long') {
        stopLossDistance = entryPrice - stopLoss.trigger_price;
      } else {
        stopLossDistance = stopLoss.trigger_price - entryPrice;
      }
      maxLoss = Math.abs(stopLossDistance * quantity);
    }

    if (takeProfit) {
      if (position.side === 'long') {
        takeProfitDistance = takeProfit.trigger_price - entryPrice;
      } else {
        takeProfitDistance = entryPrice - takeProfit.trigger_price;
      }
      maxGain = Math.abs(takeProfitDistance * quantity);
    }

    const riskRewardRatio = maxLoss > 0 ? maxGain / maxLoss : 0;

    return {
      stopLossDistance,
      takeProfitDistance,
      maxLoss,
      maxGain,
      riskRewardRatio,
      riskPercent: position.cost_basis > 0 ? (maxLoss / position.cost_basis * 100) : 0,
      rewardPercent: position.cost_basis > 0 ? (maxGain / position.cost_basis * 100) : 0
    };
  }
}

module.exports = PositionService;
