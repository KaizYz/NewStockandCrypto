# Position Tracking & Auto Stop-Loss/Take-Profit System
## Detailed Design Document for StockandCrypto

---

# Part 1: Position Tracking System

## 1.1 Database Schema

### positions table
```sql
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    
    -- Position Identity
    symbol TEXT NOT NULL,                    -- e.g., 'BTCUSDT'
    market TEXT NOT NULL,                    -- 'crypto', 'cn_equity', 'us_equity'
    exchange TEXT,                           -- 'binance', 'okx', etc.
    
    -- Position Details
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    entry_price DECIMAL(20, 8) NOT NULL,
    current_price DECIMAL(20, 8),
    quantity DECIMAL(20, 8) NOT NULL,
    remaining_qty DECIMAL(20, 8) NOT NULL,
    
    -- Financial Metrics
    cost_basis DECIMAL(20, 8) NOT NULL,      -- Total cost
    current_value DECIMAL(20, 8),            -- current_price * remaining_qty
    unrealized_pnl DECIMAL(20, 8),           -- Profit/Loss
    unrealized_pnl_pct DECIMAL(10, 4),       -- Percentage
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    
    -- Leverage
    leverage DECIMAL(10, 2) DEFAULT 1,
    margin_used DECIMAL(20, 8),
    liquidation_price DECIMAL(20, 8),
    
    -- Status
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
    
    -- Timestamps
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    
    -- Metadata
    notes TEXT,
    tags TEXT[],
    external_order_id TEXT
);
```

### position_history table
```sql
CREATE TABLE position_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE,
    action TEXT NOT NULL,                    -- 'open', 'add', 'reduce', 'close'
    previous_qty DECIMAL(20, 8),
    new_qty DECIMAL(20, 8),
    price DECIMAL(20, 8),
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### portfolio_snapshots table
```sql
CREATE TABLE portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    total_equity DECIMAL(20, 8) NOT NULL,
    cash_balance DECIMAL(20, 8) NOT NULL,
    positions_value DECIMAL(20, 8) NOT NULL,
    daily_pnl DECIMAL(20, 8),
    total_pnl DECIMAL(20, 8),
    open_positions INTEGER DEFAULT 0
);
```

---

# Part 2: Auto Stop-Loss/Take-Profit System

## 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Auto SL/TP System                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Price Feed   │───▶│   Trigger    │───▶│  Execution   │          │
│  │ (WebSocket)  │    │   Engine     │    │   Engine     │          │
│  │              │    │              │    │              │          │
│  │ • Binance    │    │ • Check SL   │    │ • Close Pos  │          │
│  │ • Real-time  │    │ • Check TP   │    │ • Notify     │          │
│  │              │    │ • Check TS   │    │ • Log        │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                    │                  │
│         └───────────────────┴────────────────────┘                  │
│                             │                                        │
│                     ┌───────▼───────┐                               │
│                     │   Database    │                               │
│                     │  (Supabase)   │                               │
│                     └───────────────┘                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 2.2 Database Schema

### stop_orders table
```sql
CREATE TABLE stop_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    
    -- Order Type
    order_type TEXT NOT NULL CHECK (order_type IN ('stop_loss', 'take_profit', 'trailing_stop')),
    
    -- Trigger Conditions
    trigger_price DECIMAL(20, 8) NOT NULL,
    trigger_type TEXT DEFAULT 'price' CHECK (trigger_type IN ('price', 'percentage', 'trailing')),
    
    -- Trailing Stop Specific
    trail_percent DECIMAL(10, 4),            -- e.g., 5% trailing
    trail_amount DECIMAL(20, 8),             -- Absolute amount
    highest_price DECIMAL(20, 8),            -- Track highest for trailing
    lowest_price DECIMAL(20, 8),             -- Track lowest for short trailing
    
    -- Execution
    quantity DECIMAL(20, 8),                 -- Amount to close (null = full)
    reduce_only BOOLEAN DEFAULT true,        -- Can only reduce, not open new
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled', 'expired')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    triggered_at TIMESTAMPTZ,
    
    -- Metadata
    notes TEXT
);

CREATE INDEX idx_stop_orders_position ON stop_orders(position_id);
CREATE INDEX idx_stop_orders_user_status ON stop_orders(user_id, status);
```

### stop_order_history table
```sql
CREATE TABLE stop_order_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stop_order_id UUID REFERENCES stop_orders(id) ON DELETE CASCADE,
    action TEXT NOT NULL,                    -- 'created', 'updated', 'triggered', 'cancelled'
    previous_data JSONB,
    new_data JSONB,
    price_at_action DECIMAL(20, 8),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 2.3 Stop Order Service (Backend)

```javascript
// server/services/stopOrderService.js

class StopOrderService {
    constructor(supabase, positionService, notificationService) {
        this.supabase = supabase;
        this.positionService = positionService;
        this.notificationService = notificationService;
        this.priceCache = new Map();
    }

    /**
     * Create a stop-loss order
     */
    async createStopLoss(positionId, triggerPrice, quantity = null, notes = null) {
        const { data: position, error } = await this.supabase
            .from('positions')
            .select('*')
            .eq('id', positionId)
            .eq('status', 'open')
            .single();

        if (error || !position) {
            throw new Error('Position not found or not open');
        }

        // Validate trigger price
        if (position.side === 'long' && triggerPrice >= position.current_price) {
            throw new Error('Stop-loss must be below current price for long positions');
        }
        if (position.side === 'short' && triggerPrice <= position.current_price) {
            throw new Error('Stop-loss must be above current price for short positions');
        }

        const stopOrder = {
            position_id: positionId,
            user_id: position.user_id,
            order_type: 'stop_loss',
            trigger_price: triggerPrice,
            trigger_type: 'price',
            quantity: quantity || position.remaining_qty,
            reduce_only: true,
            status: 'active',
            notes
        };

        const { data, error: insertError } = await this.supabase
            .from('stop_orders')
            .insert(stopOrder)
            .select()
            .single();

        if (insertError) throw insertError;

        await this.logHistory(data.id, 'created', null, data);
        
        return data;
    }

    /**
     * Create a take-profit order
     */
    async createTakeProfit(positionId, triggerPrice, quantity = null, notes = null) {
        const { data: position, error } = await this.supabase
            .from('positions')
            .select('*')
            .eq('id', positionId)
            .eq('status', 'open')
            .single();

        if (error || !position) {
            throw new Error('Position not found or not open');
        }

        // Validate trigger price
        if (position.side === 'long' && triggerPrice <= position.current_price) {
            throw new Error('Take-profit must be above current price for long positions');
        }
        if (position.side === 'short' && triggerPrice >= position.current_price) {
            throw new Error('Take-profit must be below current price for short positions');
        }

        const stopOrder = {
            position_id: positionId,
            user_id: position.user_id,
            order_type: 'take_profit',
            trigger_price: triggerPrice,
            trigger_type: 'price',
            quantity: quantity || position.remaining_qty,
            reduce_only: true,
            status: 'active',
            notes
        };

        const { data, error: insertError } = await this.supabase
            .from('stop_orders')
            .insert(stopOrder)
            .select()
            .single();

        if (insertError) throw insertError;

        await this.logHistory(data.id, 'created', null, data);
        
        return data;
    }

    /**
     * Create a trailing stop order
     */
    async createTrailingStop(positionId, trailPercent, quantity = null, notes = null) {
        const { data: position, error } = await this.supabase
            .from('positions')
            .select('*')
            .eq('id', positionId)
            .eq('status', 'open')
            .single();

        if (error || !position) {
            throw new Error('Position not found or not open');
        }

        // Calculate initial trigger price
        let triggerPrice;
        if (position.side === 'long') {
            triggerPrice = position.current_price * (1 - trailPercent / 100);
        } else {
            triggerPrice = position.current_price * (1 + trailPercent / 100);
        }

        const stopOrder = {
            position_id: positionId,
            user_id: position.user_id,
            order_type: 'trailing_stop',
            trigger_price: triggerPrice,
            trigger_type: 'trailing',
            trail_percent: trailPercent,
            highest_price: position.side === 'long' ? position.current_price : null,
            lowest_price: position.side === 'short' ? position.current_price : null,
            quantity: quantity || position.remaining_qty,
            reduce_only: true,
            status: 'active',
            notes
        };

        const { data, error: insertError } = await this.supabase
            .from('stop_orders')
            .insert(stopOrder)
            .select()
            .single();

        if (insertError) throw insertError;

        await this.logHistory(data.id, 'created', null, data);
        
        return data;
    }

    /**
     * Update trailing stop on price change
     */
    async updateTrailingStop(positionId, currentPrice) {
        const { data: stopOrders, error } = await this.supabase
            .from('stop_orders')
            .select('*')
            .eq('position_id', positionId)
            .eq('order_type', 'trailing_stop')
            .eq('status', 'active');

        if (error || !stopOrders.length) return;

        for (const order of stopOrders) {
            const { data: position } = await this.supabase
                .from('positions')
                .select('side')
                .eq('id', positionId)
                .single();

            let newTriggerPrice = order.trigger_price;
            let newHighest = order.highest_price;
            let newLowest = order.lowest_price;
            let updated = false;

            if (position.side === 'long') {
                // For long: trail below highest price
                if (currentPrice > order.highest_price) {
                    newHighest = currentPrice;
                    newTriggerPrice = currentPrice * (1 - order.trail_percent / 100);
                    updated = true;
                }
            } else {
                // For short: trail above lowest price
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
                
                await this.logHistory(order.id, 'updated', previousData, { trigger_price: newTriggerPrice });
            }
        }
    }

    /**
     * Check all active stop orders against current price
     */
    async checkStopOrders(symbol, currentPrice) {
        const { data: activeOrders, error } = await this.supabase
            .from('stop_orders')
            .select('*, positions!inner(symbol, side, remaining_qty)')
            .eq('positions.symbol', symbol)
            .eq('status', 'active');

        if (error || !activeOrders.length) return [];

        const triggeredOrders = [];

        for (const order of activeOrders) {
            const position = order.positions;
            let shouldTrigger = false;

            // Check if order should trigger
            if (order.order_type === 'stop_loss') {
                if (position.side === 'long' && currentPrice <= order.trigger_price) {
                    shouldTrigger = true;
                } else if (position.side === 'short' && currentPrice >= order.trigger_price) {
                    shouldTrigger = true;
                }
            } else if (order.order_type === 'take_profit') {
                if (position.side === 'long' && currentPrice >= order.trigger_price) {
                    shouldTrigger = true;
                } else if (position.side === 'short' && currentPrice <= order.trigger_price) {
                    shouldTrigger = true;
                }
            } else if (order.order_type === 'trailing_stop') {
                if (position.side === 'long' && currentPrice <= order.trigger_price) {
                    shouldTrigger = true;
                } else if (position.side === 'short' && currentPrice >= order.trigger_price) {
                    shouldTrigger = true;
                }
            }

            if (shouldTrigger) {
                await this.triggerOrder(order, currentPrice);
                triggeredOrders.push(order);
            }
        }

        return triggeredOrders;
    }

    /**
     * Trigger a stop order
     */
    async triggerOrder(order, triggerPrice) {
        // Mark order as triggered
        await this.supabase
            .from('stop_orders')
            .update({
                status: 'triggered',
                triggered_at: new Date().toISOString()
            })
            .eq('id', order.id);

        // Close position (partial or full)
        const closeQuantity = order.quantity || order.positions.remaining_qty;
        
        const result = await this.positionService.reducePosition(
            order.position_id,
            closeQuantity,
            triggerPrice,
            order.order_type
        );

        // Send notification
        await this.notificationService.send({
            user_id: order.user_id,
            type: 'order_triggered',
            title: `${order.order_type.replace('_', ' ').toUpperCase()} Triggered`,
            message: `Your ${order.order_type} for ${order.positions.symbol} has been triggered at ${triggerPrice}`,
            data: {
                order_id: order.id,
                position_id: order.position_id,
                symbol: order.positions.symbol,
                trigger_price: triggerPrice,
                realized_pnl: result.realizedPnl
            }
        });

        await this.logHistory(order.id, 'triggered', order, { trigger_price: triggerPrice });
        
        return result;
    }

    /**
     * Cancel a stop order
     */
    async cancelOrder(orderId) {
        const { data: order, error } = await this.supabase
            .from('stop_orders')
            .select('*')
            .eq('id', orderId)
            .eq('status', 'active')
            .single();

        if (error) throw new Error('Order not found or not active');

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
     * Get all active stop orders for a user
     */
    async getActiveOrders(userId) {
        const { data, error } = await this.supabase
            .from('stop_orders')
            .select('*, positions(symbol, side, current_price, remaining_qty)')
            .eq('user_id', userId)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    }

    /**
     * Calculate risk metrics for a position
     */
    calculateRiskMetrics(position, stopLoss, takeProfit) {
        const entryPrice = position.entry_price;
        const currentPrice = position.current_price;
        const quantity = position.remaining_qty;

        // Calculate potential loss from stop-loss
        let stopLossDistance = 0;
        let stopLossPercent = 0;
        let maxLoss = 0;

        if (stopLoss) {
            if (position.side === 'long') {
                stopLossDistance = entryPrice - stopLoss.trigger_price;
                stopLossPercent = (stopLossDistance / entryPrice) * 100;
            } else {
                stopLossDistance = stopLoss.trigger_price - entryPrice;
                stopLossPercent = (stopLossDistance / entryPrice) * 100;
            }
            maxLoss = stopLossDistance * quantity;
        }

        // Calculate potential gain from take-profit
        let takeProfitDistance = 0;
        let takeProfitPercent = 0;
        let maxGain = 0;

        if (takeProfit) {
            if (position.side === 'long') {
                takeProfitDistance = takeProfit.trigger_price - entryPrice;
                takeProfitPercent = (takeProfitDistance / entryPrice) * 100;
            } else {
                takeProfitDistance = entryPrice - takeProfit.trigger_price;
                takeProfitPercent = (takeProfitDistance / entryPrice) * 100;
            }
            maxGain = takeProfitDistance * quantity;
        }

        // Risk/Reward Ratio
        const riskRewardRatio = maxLoss > 0 ? maxGain / maxLoss : 0;

        return {
            stopLossDistance,
            stopLossPercent,
            maxLoss,
            takeProfitDistance,
            takeProfitPercent,
            maxGain,
            riskRewardRatio,
            currentPnl: (currentPrice - entryPrice) * quantity * (position.side === 'long' ? 1 : -1),
            currentPnlPercent: ((currentPrice - entryPrice) / entryPrice) * 100
        };
    }

    // Helper
    async logHistory(orderId, action, previousData, newData) {
        await this.supabase
            .from('stop_order_history')
            .insert({
                stop_order_id: orderId,
                action,
                previous_data: previousData,
                new_data: newData,
                created_at: new Date().toISOString()
            });
    }
}

module.exports = StopOrderService;
```

---

## 2.4 Frontend: Stop-Loss/Take-Profit UI

### Key Features:
1. **Quick Set SL/TP** - One-click buttons for common percentages (3%, 5%, 10%)
2. **Custom Price Input** - Manual price entry
3. **Trailing Stop Controls** - Adjustable trail percentage
4. **Risk/Reward Calculator** - Real-time ratio display
5. **Order Management** - View, edit, cancel active orders

---

# Part 3: Implementation Timeline

## Phase 1: Position Tracking (Week 1-2)
- [ ] Create database tables (positions, history, snapshots)
- [ ] Build PositionService backend
- [ ] Create positions.html dashboard
- [ ] Implement real-time price updates
- [ ] Add equity curve chart

## Phase 2: Auto SL/TP Core (Week 3-4)
- [ ] Create stop_orders table
- [ ] Build StopOrderService
- [ ] Implement trigger engine
- [ ] Add notification system
- [ ] Create order management UI

## Phase 3: Advanced Features (Week 5-6)
- [ ] Trailing stop implementation
- [ ] Risk metrics calculator
- [ ] Portfolio analytics
- [ ] Performance reports
- [ ] Mobile responsive design

---

# Part 4: Key Metrics to Track

| Metric | Description | Formula |
|--------|-------------|---------|
| Unrealized P&L | Current profit on open positions | (Current Price - Entry Price) × Quantity |
| Realized P&L | Total profit from closed positions | Sum of all closed trade P&L |
| Win Rate | Percentage of profitable trades | Winning Trades / Total Trades × 100 |
| Profit Factor | Ratio of gross profit to gross loss | Gross Profit / Gross Loss |
| Max Drawdown | Largest peak-to-trough decline | (Peak - Trough) / Peak × 100 |
| Sharpe Ratio | Risk-adjusted return | (Return - Risk-Free Rate) / Std Dev |
| Risk/Reward | Potential gain vs potential loss | Take Profit Distance / Stop Loss Distance |

---

**Document Version:** 1.0  
**Last Updated:** 2026-03-15
