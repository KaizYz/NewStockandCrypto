-- ========================================
-- StockandCrypto - Position Tracking & Stop Orders
-- Database Migration Script
-- ========================================

-- ==================== PART 1: POSITIONS ====================

-- Positions table: Track user holdings
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Position Identity
    symbol TEXT NOT NULL,
    market TEXT NOT NULL CHECK (market IN ('crypto', 'cn_equity', 'us_equity')),
    exchange TEXT,
    
    -- Position Details
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    entry_price DECIMAL(20, 8) NOT NULL,
    current_price DECIMAL(20, 8),
    quantity DECIMAL(20, 8) NOT NULL,
    remaining_qty DECIMAL(20, 8) NOT NULL,
    
    -- Financial Metrics
    cost_basis DECIMAL(20, 8) NOT NULL,
    current_value DECIMAL(20, 8),
    unrealized_pnl DECIMAL(20, 8) DEFAULT 0,
    unrealized_pnl_pct DECIMAL(10, 4) DEFAULT 0,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    
    -- Leverage & Margin
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
    tags TEXT[] DEFAULT '{}',
    external_order_id TEXT
);

-- Indexes for positions
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_user_status ON positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_opened ON positions(opened_at DESC);

-- Position History: Track all changes
CREATE TABLE IF NOT EXISTS position_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE NOT NULL,
    
    action TEXT NOT NULL CHECK (action IN ('open', 'add', 'reduce', 'close', 'liquidate')),
    previous_qty DECIMAL(20, 8),
    new_qty DECIMAL(20, 8),
    price DECIMAL(20, 8),
    quantity DECIMAL(20, 8),
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_position_history_position ON position_history(position_id);
CREATE INDEX IF NOT EXISTS idx_position_history_created ON position_history(created_at DESC);

-- Portfolio Snapshots: For equity curve
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    
    -- Values
    total_equity DECIMAL(20, 8) NOT NULL,
    cash_balance DECIMAL(20, 8) NOT NULL,
    positions_value DECIMAL(20, 8) NOT NULL,
    
    -- P&L
    daily_pnl DECIMAL(20, 8),
    daily_pnl_pct DECIMAL(10, 4),
    total_pnl DECIMAL(20, 8),
    total_pnl_pct DECIMAL(10, 4),
    
    -- Metrics
    max_drawdown DECIMAL(10, 4) DEFAULT 0,
    open_positions INTEGER DEFAULT 0,
    
    -- Breakdown
    market_breakdown JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user ON portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_time ON portfolio_snapshots(user_id, timestamp DESC);

-- ==================== PART 2: STOP ORDERS ====================

-- Stop Orders: Auto SL/TP/Trailing
CREATE TABLE IF NOT EXISTS stop_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Order Type
    order_type TEXT NOT NULL CHECK (order_type IN ('stop_loss', 'take_profit', 'trailing_stop')),
    
    -- Trigger
    trigger_price DECIMAL(20, 8) NOT NULL,
    trigger_type TEXT DEFAULT 'price' CHECK (trigger_type IN ('price', 'percentage', 'trailing')),
    
    -- Trailing Stop
    trail_percent DECIMAL(10, 4),
    trail_amount DECIMAL(20, 8),
    highest_price DECIMAL(20, 8),
    lowest_price DECIMAL(20, 8),
    
    -- Execution
    quantity DECIMAL(20, 8),
    reduce_only BOOLEAN DEFAULT true,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled', 'expired')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    triggered_at TIMESTAMPTZ,
    
    -- Metadata
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_stop_orders_position ON stop_orders(position_id);
CREATE INDEX IF NOT EXISTS idx_stop_orders_user ON stop_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_stop_orders_status ON stop_orders(user_id, status);

-- Stop Order History
CREATE TABLE IF NOT EXISTS stop_order_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stop_order_id UUID REFERENCES stop_orders(id) ON DELETE CASCADE NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'triggered', 'cancelled')),
    previous_data JSONB,
    new_data JSONB,
    price_at_action DECIMAL(20, 8),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stop_order_history_order ON stop_order_history(stop_order_id);

-- ==================== PART 3: USER FUNDS ====================

-- User Funds: Track cash balance
CREATE TABLE IF NOT EXISTS user_funds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Balances
    cash_balance DECIMAL(20, 8) DEFAULT 0,
    initial_capital DECIMAL(20, 8) DEFAULT 0,
    
    -- Tracking
    total_deposits DECIMAL(20, 8) DEFAULT 0,
    total_withdrawals DECIMAL(20, 8) DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_funds_user ON user_funds(user_id);

-- ==================== PART 4: RLS POLICIES ====================

-- Enable RLS
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_funds ENABLE ROW LEVEL SECURITY;

-- Positions policies
CREATE POLICY "Users view own positions" ON positions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own positions" ON positions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own positions" ON positions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own positions" ON positions FOR DELETE USING (auth.uid() = user_id);

-- Position history policies
CREATE POLICY "Users view own position history" ON position_history FOR SELECT USING (
    EXISTS (SELECT 1 FROM positions WHERE positions.id = position_history.position_id AND positions.user_id = auth.uid())
);

-- Portfolio snapshots policies
CREATE POLICY "Users view own snapshots" ON portfolio_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own snapshots" ON portfolio_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Stop orders policies
CREATE POLICY "Users view own stop orders" ON stop_orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own stop orders" ON stop_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stop orders" ON stop_orders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own stop orders" ON stop_orders FOR DELETE USING (auth.uid() = user_id);

-- Stop order history policies
CREATE POLICY "Users view own stop order history" ON stop_order_history FOR SELECT USING (
    EXISTS (SELECT 1 FROM stop_orders WHERE stop_orders.id = stop_order_history.stop_order_id AND stop_orders.user_id = auth.uid())
);

-- User funds policies
CREATE POLICY "Users view own funds" ON user_funds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own funds" ON user_funds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own funds" ON user_funds FOR UPDATE USING (auth.uid() = user_id);

-- ==================== PART 5: TRIGGERS ====================

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS positions_updated ON positions;
CREATE TRIGGER positions_updated BEFORE UPDATE ON positions
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS stop_orders_updated ON stop_orders;
CREATE TRIGGER stop_orders_updated BEFORE UPDATE ON stop_orders
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS user_funds_updated ON user_funds;
CREATE TRIGGER user_funds_updated BEFORE UPDATE ON user_funds
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Auto-create user funds on user creation
CREATE OR REPLACE FUNCTION create_user_funds()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_funds (user_id, cash_balance, initial_capital)
    VALUES (NEW.id, 100000, 100000);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS create_funds_trigger ON auth.users;
CREATE TRIGGER create_funds_trigger AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION create_user_funds();

-- ==================== PART 6: FUNCTIONS ====================

-- Calculate position P&L
CREATE OR REPLACE FUNCTION calculate_position_pnl(
    p_entry_price DECIMAL(20, 8),
    p_current_price DECIMAL(20, 8),
    p_quantity DECIMAL(20, 8),
    p_side TEXT
) RETURNS DECIMAL(20, 8) AS $$
BEGIN
    IF p_side = 'long' THEN
        RETURN (p_current_price - p_entry_price) * p_quantity;
    ELSE
        RETURN (p_entry_price - p_current_price) * p_quantity;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Get portfolio summary
CREATE OR REPLACE FUNCTION get_portfolio_summary(p_user_id UUID)
RETURNS TABLE (
    total_positions BIGINT,
    total_value DECIMAL(20, 8),
    total_cost DECIMAL(20, 8),
    total_unrealized_pnl DECIMAL(20, 8),
    total_realized_pnl DECIMAL(20, 8)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_positions,
        COALESCE(SUM(current_value), 0) as total_value,
        COALESCE(SUM(cost_basis), 0) as total_cost,
        COALESCE(SUM(unrealized_pnl), 0) as total_unrealized_pnl,
        COALESCE(SUM(realized_pnl), 0) as total_realized_pnl
    FROM positions
    WHERE user_id = p_user_id AND status = 'open';
END;
$$ LANGUAGE plpgsql;

-- ==================== COMPLETE ====================

SELECT 'Position tracking and stop orders migration completed!' as status;
