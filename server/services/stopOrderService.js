// ========================================
// StockandCrypto - Stop Order Service
// Backend service for stop-loss/take-profit management
// ========================================

const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://odvelrdzdbnbfjuqrbtl.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_sC7xCGB5GqtQwxV-zT35yQ_4vfRSF4p';

class StopOrderService {
  constructor(positionService) {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false
      }
    });
    this.positionService = positionService;
  }

  // ==================== CREATE ORDERS ====================

  /**
   * Create a stop-loss order
   */
  async createStopLoss(userId, positionId, triggerPrice, quantity = null, notes = null) {
    const position = await this.positionService.getPosition(positionId);
    if (!position || position.status !== 'open') {
      throw new Error('Position not found or not open');
    }
    if (position.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Validate trigger price
    if (position.side === 'long' && triggerPrice >= position.current_price) {
      throw new Error('Stop-loss must be below current price for long positions');
    }
    if (position.side === 'short' && triggerPrice <= position.current_price) {
      throw new Error('Stop-loss must be above current price for short positions');
    }

    // Cancel existing stop-loss orders for this position
    await this.cancelOrdersByType(positionId, 'stop_loss');

    const stopOrder = {
      position_id: positionId,
      user_id: userId,
      order_type: 'stop_loss',
      trigger_price: triggerPrice,
      trigger_type: 'price',
      quantity: quantity || position.remaining_qty,
      reduce_only: true,
      status: 'active',
      notes
    };

    const { data, error } = await this.supabase
      .from('stop_orders')
      .insert(stopOrder)
      .select()
      .single();

    if (error) throw error;

    await this.logHistory(data.id, 'created', null, data);

    return data;
  }

  /**
   * Create a take-profit order
   */
  async createTakeProfit(userId, positionId, triggerPrice, quantity = null, notes = null) {
    const position = await this.positionService.getPosition(positionId);
    if (!position || position.status !== 'open') {
      throw new Error('Position not found or not open');
    }
    if (position.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Validate trigger price
    if (position.side === 'long' && triggerPrice <= position.current_price) {
      throw new Error('Take-profit must be above current price for long positions');
    }
    if (position.side === 'short' && triggerPrice >= position.current_price) {
      throw new Error('Take-profit must be below current price for short positions');
    }

    // Cancel existing take-profit orders for this position
    await this.cancelOrdersByType(positionId, 'take_profit');

    const stopOrder = {
      position_id: positionId,
      user_id: userId,
      order_type: 'take_profit',
      trigger_price: triggerPrice,
      trigger_type: 'price',
      quantity: quantity || position.remaining_qty,
      reduce_only: true,
      status: 'active',
      notes
    };

    const { data, error } = await this.supabase
      .from('stop_orders')
      .insert(stopOrder)
      .select()
      .single();

    if (error) throw error;

    await this.logHistory(data.id, 'created', null, data);

    return data;
  }

  /**
   * Create a trailing stop order
   */
  async createTrailingStop(userId, positionId, trailPercent, quantity = null, notes = null) {
    const position = await this.positionService.getPosition(positionId);
    if (!position || position.status !== 'open') {
      throw new Error('Position not found or not open');
    }
    if (position.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    const currentPrice = position.current_price || position.entry_price;

    // Calculate initial trigger price
    let triggerPrice;
    let highestPrice = null;
    let lowestPrice = null;

    if (position.side === 'long') {
      triggerPrice = currentPrice * (1 - trailPercent / 100);
      highestPrice = currentPrice;
    } else {
      triggerPrice = currentPrice * (1 + trailPercent / 100);
      lowestPrice = currentPrice;
    }

    // Cancel existing trailing stop orders for this position
    await this.cancelOrdersByType(positionId, 'trailing_stop');

    const stopOrder = {
      position_id: positionId,
      user_id: userId,
      order_type: 'trailing_stop',
      trigger_price: triggerPrice,
      trigger_type: 'trailing',
      trail_percent: trailPercent,
      highest_price: highestPrice,
      lowest_price: lowestPrice,
      quantity: quantity || position.remaining_qty,
      reduce_only: true,
      status: 'active',
      notes
    };

    const { data, error } = await this.supabase
      .from('stop_orders')
      .insert(stopOrder)
      .select()
      .single();

    if (error) throw error;

    await this.logHistory(data.id, 'created', null, data);

    return data;
  }

  // ==================== MANAGE ORDERS ====================

  /**
   * Get all active stop orders for a user
   */
  async getActiveOrders(userId) {
    const { data, error } = await this.supabase
      .from('stop_orders')
      .select(`
        *,
        positions (
          id,
          symbol,
          side,
          entry_price,
          current_price,
          remaining_qty
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get stop orders for a specific position
   */
  async getPositionOrders(positionId) {
    const { data, error } = await this.supabase
      .from('stop_orders')
      .select('*')
      .eq('position_id', positionId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Cancel a stop order
   */
  async cancelOrder(userId, orderId) {
    const { data: order, error: fetchError } = await this.supabase
      .from('stop_orders')
      .select('*')
      .eq('id', orderId)
      .eq('status', 'active')
      .single();

    if (fetchError || !order) {
      throw new Error('Order not found or not active');
    }
    if (order.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    await this.supabase
      .from('stop_orders')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    await this.logHistory(orderId, 'cancelled', order, null);

    return { success: true, message: 'Order cancelled' };
  }

  /**
   * Cancel all orders of a specific type for a position
   */
  async cancelOrdersByType(positionId, orderType) {
    await this.supabase
      .from('stop_orders')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('position_id', positionId)
      .eq('order_type', orderType)
      .eq('status', 'active');
  }

  /**
   * Update trailing stop on price change
   */
  async updateTrailingStop(order, currentPrice) {
    const position = order.positions;

    let newTriggerPrice = order.trigger_price;
    let newHighest = order.highest_price;
    let newLowest = order.lowest_price;
    let updated = false;

    if (position.side === 'long') {
      // Trail below highest price
      if (currentPrice > order.highest_price) {
        newHighest = currentPrice;
        newTriggerPrice = currentPrice * (1 - order.trail_percent / 100);
        updated = true;
      }
    } else {
      // Trail above lowest price
      if (currentPrice < order.lowest_price) {
        newLowest = currentPrice;
        newTriggerPrice = currentPrice * (1 + order.trail_percent / 100);
        updated = true;
      }
    }

    if (updated) {
      const previousData = { ...order };

      await this.supabase
        .from('stop_orders')
        .update({
          trigger_price: newTriggerPrice,
          highest_price: newHighest,
          lowest_price: newLowest,
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id);

      await this.logHistory(order.id, 'updated', previousData, {
        trigger_price: newTriggerPrice,
        highest_price: newHighest,
        lowest_price: newLowest
      });

      return { updated: true, newTriggerPrice };
    }

    return { updated: false };
  }

  // ==================== TRIGGER ENGINE ====================

  /**
   * Check if an order should trigger
   */
  shouldTrigger(order, position, currentPrice) {
    const triggerPrice = order.trigger_price;

    switch (order.order_type) {
      case 'stop_loss':
        if (position.side === 'long') {
          return currentPrice <= triggerPrice;
        } else {
          return currentPrice >= triggerPrice;
        }

      case 'take_profit':
        if (position.side === 'long') {
          return currentPrice >= triggerPrice;
        } else {
          return currentPrice <= triggerPrice;
        }

      case 'trailing_stop':
        if (position.side === 'long') {
          return currentPrice <= triggerPrice;
        } else {
          return currentPrice >= triggerPrice;
        }

      default:
        return false;
    }
  }

  /**
   * Trigger a stop order
   */
  async triggerOrder(order, triggerPrice) {
    const position = order.positions;

    console.log(`🎯 Stop order triggered: ${order.order_type} for ${position.symbol} @ ${triggerPrice}`);

    // Mark order as triggered
    await this.supabase
      .from('stop_orders')
      .update({
        status: 'triggered',
        triggered_at: new Date().toISOString()
      })
      .eq('id', order.id);

    // Close position
    const result = await this.positionService.reducePosition(
      position.id,
      order.quantity || position.remaining_qty,
      triggerPrice,
      order.order_type
    );

    // Create notification
    await this.createNotification(order, position, triggerPrice, result.realizedPnl);

    await this.logHistory(order.id, 'triggered', order, {
      trigger_price: triggerPrice,
      realized_pnl: result.realizedPnl
    }, triggerPrice);

    return result;
  }

  /**
   * Check all active stop orders for a symbol
   */
  async checkStopOrdersForSymbol(symbol, currentPrice) {
    const { data: activeOrders, error } = await this.supabase
      .from('stop_orders')
      .select(`
        *,
        positions!inner (
          id,
          user_id,
          symbol,
          side,
          entry_price,
          current_price,
          remaining_qty
        )
      `)
      .eq('positions.symbol', symbol)
      .eq('status', 'active');

    if (error || !activeOrders) return [];

    const triggeredOrders = [];

    for (const order of activeOrders) {
      const position = order.positions;

      // Update trailing stop if needed
      if (order.order_type === 'trailing_stop') {
        await this.updateTrailingStop(order, currentPrice);
      }

      // Check if should trigger
      if (this.shouldTrigger(order, position, currentPrice)) {
        const result = await this.triggerOrder(order, currentPrice);
        triggeredOrders.push({ order, result });
      }
    }

    return triggeredOrders;
  }

  // ==================== NOTIFICATIONS ====================

  /**
   * Create notification for triggered order
   */
  async createNotification(order, position, triggerPrice, realizedPnl) {
    const orderTypeName = order.order_type.replace('_', ' ').toUpperCase();
    const pnlStr = realizedPnl >= 0 ? `+${realizedPnl.toFixed(2)}` : realizedPnl.toFixed(2);

    await this.supabase
      .from('notifications')
      .insert({
        user_id: position.user_id,
        type: 'order_triggered',
        title: `${orderTypeName} Triggered`,
        content: `Your ${order.order_type.replace('_', ' ')} for ${position.symbol} has been triggered at ${triggerPrice}. P&L: ${pnlStr}`,
        data: {
          order_id: order.id,
          position_id: position.id,
          symbol: position.symbol,
          trigger_price: triggerPrice,
          realized_pnl: realizedPnl,
          order_type: order.order_type
        }
      });
  }

  // ==================== HISTORY ====================

  /**
   * Log stop order history
   */
  async logHistory(orderId, action, previousData, newData, priceAtAction = null) {
    await this.supabase
      .from('stop_order_history')
      .insert({
        stop_order_id: orderId,
        action,
        previous_data: previousData,
        new_data: newData,
        price_at_action: priceAtAction
      });
  }

  /**
   * Get order history
   */
  async getOrderHistory(orderId) {
    const { data, error } = await this.supabase
      .from('stop_order_history')
      .select('*')
      .eq('stop_order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // ==================== RISK CALCULATIONS ====================

  /**
   * Calculate risk metrics for a position with its stop orders
   */
  async getPositionRiskMetrics(positionId) {
    const position = await this.positionService.getPosition(positionId);
    const orders = await this.getPositionOrders(positionId);

    const stopLoss = orders.find(o => o.order_type === 'stop_loss');
    const takeProfit = orders.find(o => o.order_type === 'take_profit');
    const trailingStop = orders.find(o => o.order_type === 'trailing_stop');

    const metrics = this.positionService.calculateRiskMetrics(position, stopLoss || trailingStop, takeProfit);

    return {
      ...metrics,
      position,
      stopLoss,
      takeProfit,
      trailingStop,
      hasProtection: !!(stopLoss || trailingStop)
    };
  }
}

module.exports = StopOrderService;
