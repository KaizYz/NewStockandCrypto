// ========================================
// StockandCrypto - Stop Order Trigger Service
// Backend service to monitor and trigger stop orders
// ========================================

const StopOrderEngine = {
    priceCache: new Map(),
    checkInterval: null,
    
    // Initialize the engine
    async init(supabaseClient) {
        this.supabase = supabaseClient;
        console.log('✅ Stop Order Engine initialized');
    },
    
    // Start monitoring
    startMonitoring(checkIntervalMs = 5000) {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        this.checkInterval = setInterval(() => {
            this.checkAllStopOrders();
        }, checkIntervalMs);
        
        console.log(`🔄 Stop Order monitoring started (${checkIntervalMs}ms interval)`);
    },
    
    // Stop monitoring
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        console.log('⏹️ Stop Order monitoring stopped');
    },
    
    // Update price cache (called by price feed)
    updatePrice(symbol, price) {
        this.priceCache.set(symbol, {
            price,
            timestamp: Date.now()
        });
    },
    
    // Check all active stop orders
    async checkAllStopOrders() {
        try {
            const { data: activeOrders, error } = await this.supabase
                .from('stop_orders')
                .select(`
                    *,
                    positions (
                        id,
                        user_id,
                        symbol,
                        side,
                        entry_price,
                        current_price,
                        remaining_qty
                    )
                `)
                .eq('status', 'active');
            
            if (error) throw error;
            
            if (!activeOrders || activeOrders.length === 0) return;
            
            for (const order of activeOrders) {
                const position = order.positions;
                if (!position) continue;
                
                // Get current price from cache
                const priceData = this.priceCache.get(position.symbol);
                if (!priceData) continue;
                
                const currentPrice = priceData.price;
                
                // Update trailing stop if needed
                if (order.order_type === 'trailing_stop') {
                    await this.updateTrailingStop(order, currentPrice);
                }
                
                // Check if order should trigger
                const shouldTrigger = this.checkTrigger(order, position, currentPrice);
                
                if (shouldTrigger) {
                    await this.triggerOrder(order, currentPrice);
                }
            }
            
        } catch (error) {
            console.error('Check stop orders error:', error);
        }
    },
    
    // Check if order should trigger
    checkTrigger(order, position, currentPrice) {
        const triggerPrice = order.trigger_price;
        
        if (order.order_type === 'stop_loss') {
            if (position.side === 'long') {
                return currentPrice <= triggerPrice;
            } else {
                return currentPrice >= triggerPrice;
            }
        }
        
        if (order.order_type === 'take_profit') {
            if (position.side === 'long') {
                return currentPrice >= triggerPrice;
            } else {
                return currentPrice <= triggerPrice;
            }
        }
        
        if (order.order_type === 'trailing_stop') {
            if (position.side === 'long') {
                return currentPrice <= triggerPrice;
            } else {
                return currentPrice >= triggerPrice;
            }
        }
        
        return false;
    },
    
    // Update trailing stop price
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
            await this.supabase
                .from('stop_orders')
                .update({
                    trigger_price: newTriggerPrice,
                    highest_price: newHighest,
                    lowest_price: newLowest,
                    updated_at: new Date().toISOString()
                })
                .eq('id', order.id);
            
            console.log(`📈 Trailing stop updated: ${position.symbol} -> ${newTriggerPrice}`);
        }
    },
    
    // Trigger the stop order
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
        
        // Calculate realized P&L
        let realizedPnl = 0;
        if (position.side === 'long') {
            realizedPnl = (triggerPrice - position.entry_price) * position.remaining_qty;
        } else {
            realizedPnl = (position.entry_price - triggerPrice) * position.remaining_qty;
        }
        
        // Close position
        await this.supabase
            .from('positions')
            .update({
                status: 'closed',
                closed_at: new Date().toISOString(),
                current_price: triggerPrice,
                current_value: 0,
                remaining_qty: 0,
                realized_pnl: position.realized_pnl + realizedPnl,
                updated_at: new Date().toISOString()
            })
            .eq('id', position.id);
        
        // Log history
        await this.supabase
            .from('position_history')
            .insert({
                position_id: position.id,
                action: 'close',
                previous_qty: position.remaining_qty,
                new_qty: 0,
                price: triggerPrice,
                quantity: position.remaining_qty,
                realized_pnl: realizedPnl,
                reason: order.order_type
            });
        
        // Create notification
        await this.supabase
            .from('notifications')
            .insert({
                user_id: position.user_id,
                type: 'order_triggered',
                title: `${order.order_type.replace('_', ' ').toUpperCase()} Triggered`,
                content: `Your ${order.order_type} for ${position.symbol} has been triggered at ${triggerPrice}. P&L: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}`,
                data: {
                    order_id: order.id,
                    position_id: position.id,
                    symbol: position.symbol,
                    trigger_price: triggerPrice,
                    realized_pnl: realizedPnl
                }
            });
        
        console.log(`✅ Position closed: ${position.symbol}, P&L: ${realizedPnl}`);
        
        return { triggered: true, realizedPnl };
    }
};

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StopOrderEngine;
}

// Browser global
if (typeof window !== 'undefined') {
    window.StopOrderEngine = StopOrderEngine;
}
