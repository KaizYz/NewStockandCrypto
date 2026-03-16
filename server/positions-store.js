const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function nowIso() {
    return new Date().toISOString();
}

function clampQuantity(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }
    return numeric;
}

function clampLimit(value, fallback = 100) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(numeric), 500);
}

function normalizeSide(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'long' || normalized === 'short') {
        return normalized;
    }
    return 'long';
}

function normalizeMarket(value) {
    const normalized = String(value || '').trim();
    return normalized || 'Crypto';
}

function computeUnrealizedPnl(side, entryPrice, currentPrice, quantity) {
    if (side === 'short') {
        return (entryPrice - currentPrice) * quantity;
    }
    return (currentPrice - entryPrice) * quantity;
}

function mapPositionRow(row) {
    if (!row) {
        return null;
    }

    const entryPrice = Number(row.entry_price) || 0;
    const currentPrice = Number(row.current_price) || entryPrice;
    const remainingQty = Number(row.remaining_qty) || 0;
    const currentValue = row.status === 'open' ? currentPrice * remainingQty : 0;
    const activeCostBasis = entryPrice * remainingQty;
    const unrealizedPnl = row.status === 'open'
        ? computeUnrealizedPnl(row.side, entryPrice, currentPrice, remainingQty)
        : 0;
    const unrealizedPnlPct = activeCostBasis > 0 ? (unrealizedPnl / activeCostBasis) * 100 : 0;

    return {
        id: String(row.id),
        user_id: row.user_id,
        symbol: row.symbol,
        market: row.market,
        side: row.side,
        entry_price: entryPrice,
        current_price: currentPrice,
        quantity: Number(row.quantity) || 0,
        remaining_qty: remainingQty,
        cost_basis: Number(row.cost_basis) || entryPrice * (Number(row.quantity) || 0),
        current_value: currentValue,
        realized_pnl: Number(row.realized_pnl) || 0,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_pct: unrealizedPnlPct,
        notes: row.notes || '',
        status: row.status || 'open',
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function mapStopOrderRow(row) {
    if (!row) {
        return null;
    }

    return {
        id: String(row.id),
        user_id: row.user_id,
        position_id: String(row.position_id),
        order_type: row.order_type,
        trigger_price: Number(row.trigger_price) || 0,
        trigger_type: row.trigger_type || 'price',
        trail_percent: row.trail_percent === null || row.trail_percent === undefined ? null : Number(row.trail_percent),
        highest_price: row.highest_price === null || row.highest_price === undefined ? null : Number(row.highest_price),
        lowest_price: row.lowest_price === null || row.lowest_price === undefined ? null : Number(row.lowest_price),
        quantity: Number(row.quantity) || 0,
        status: row.status || 'active',
        created_at: row.created_at,
        updated_at: row.updated_at,
        positions: row.position_id ? {
            id: String(row.position_id),
            symbol: row.symbol || null,
            side: row.side || null,
            current_price: row.position_current_price === null || row.position_current_price === undefined ? null : Number(row.position_current_price),
            remaining_qty: row.position_remaining_qty === null || row.position_remaining_qty === undefined ? null : Number(row.position_remaining_qty)
        } : null
    };
}

function createPositionsStore(options = {}) {
    const baseDir = options.baseDir || process.cwd();
    const dataDir = path.join(baseDir, 'data');
    const dbPath = path.join(dataDir, 'stockandcrypto.db');
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL DEFAULT 'Crypto',
            side TEXT NOT NULL DEFAULT 'long',
            entry_price REAL NOT NULL,
            current_price REAL NOT NULL,
            quantity REAL NOT NULL,
            remaining_qty REAL NOT NULL,
            cost_basis REAL NOT NULL,
            current_value REAL NOT NULL DEFAULT 0,
            realized_pnl REAL NOT NULL DEFAULT 0,
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open',
            opened_at TEXT NOT NULL,
            closed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS position_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            previous_qty REAL,
            new_qty REAL,
            price REAL NOT NULL,
            quantity REAL NOT NULL,
            realized_pnl REAL NOT NULL DEFAULT 0,
            reason TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL,
            FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS stop_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            position_id INTEGER NOT NULL,
            order_type TEXT NOT NULL,
            trigger_price REAL NOT NULL,
            trigger_type TEXT NOT NULL DEFAULT 'price',
            trail_percent REAL,
            highest_price REAL,
            lowest_price REAL,
            quantity REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_positions_user_status ON positions(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_positions_opened_at ON positions(opened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_position_history_position ON position_history(position_id);
        CREATE INDEX IF NOT EXISTS idx_stop_orders_user_status ON stop_orders(user_id, status);
    `);

    const getPositionStmt = db.prepare(`
        SELECT *
        FROM positions
        WHERE id = ? AND user_id = ?
        LIMIT 1
    `);

    const listPositionsStmt = db.prepare(`
        SELECT *
        FROM positions
        WHERE user_id = @user_id
          AND (@status IS NULL OR status = @status)
        ORDER BY
            CASE WHEN status = 'open' THEN opened_at ELSE COALESCE(closed_at, updated_at) END DESC
        LIMIT @limit
    `);

    const insertPositionStmt = db.prepare(`
        INSERT INTO positions (
            user_id,
            symbol,
            market,
            side,
            entry_price,
            current_price,
            quantity,
            remaining_qty,
            cost_basis,
            current_value,
            realized_pnl,
            notes,
            status,
            opened_at,
            closed_at,
            created_at,
            updated_at
        ) VALUES (
            @user_id,
            @symbol,
            @market,
            @side,
            @entry_price,
            @current_price,
            @quantity,
            @remaining_qty,
            @cost_basis,
            @current_value,
            @realized_pnl,
            @notes,
            @status,
            @opened_at,
            @closed_at,
            @created_at,
            @updated_at
        )
    `);

    const insertHistoryStmt = db.prepare(`
        INSERT INTO position_history (
            position_id,
            action,
            previous_qty,
            new_qty,
            price,
            quantity,
            realized_pnl,
            reason,
            created_at
        ) VALUES (
            @position_id,
            @action,
            @previous_qty,
            @new_qty,
            @price,
            @quantity,
            @realized_pnl,
            @reason,
            @created_at
        )
    `);

    const updatePositionStmt = db.prepare(`
        UPDATE positions
        SET current_price = @current_price,
            remaining_qty = @remaining_qty,
            current_value = @current_value,
            realized_pnl = @realized_pnl,
            status = @status,
            closed_at = @closed_at,
            updated_at = @updated_at
        WHERE id = @id AND user_id = @user_id
    `);

    const listStopOrdersStmt = db.prepare(`
        SELECT
            stop_orders.*, 
            positions.symbol,
            positions.side,
            positions.current_price AS position_current_price,
            positions.remaining_qty AS position_remaining_qty
        FROM stop_orders
        LEFT JOIN positions ON positions.id = stop_orders.position_id
        WHERE stop_orders.user_id = @user_id
          AND (@status IS NULL OR stop_orders.status = @status)
        ORDER BY stop_orders.created_at DESC
    `);

    const insertStopOrderStmt = db.prepare(`
        INSERT INTO stop_orders (
            user_id,
            position_id,
            order_type,
            trigger_price,
            trigger_type,
            trail_percent,
            highest_price,
            lowest_price,
            quantity,
            status,
            created_at,
            updated_at
        ) VALUES (
            @user_id,
            @position_id,
            @order_type,
            @trigger_price,
            @trigger_type,
            @trail_percent,
            @highest_price,
            @lowest_price,
            @quantity,
            @status,
            @created_at,
            @updated_at
        )
    `);

    const getStopOrderStmt = db.prepare(`
        SELECT *
        FROM stop_orders
        WHERE id = ? AND user_id = ?
        LIMIT 1
    `);

    const cancelStopOrderStmt = db.prepare(`
        UPDATE stop_orders
        SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND user_id = ?
    `);

    const cancelPositionStopOrdersStmt = db.prepare(`
        UPDATE stop_orders
        SET status = 'cancelled', updated_at = ?
        WHERE position_id = ? AND user_id = ? AND status = 'active'
    `);

    const listPositionHistoryStmt = db.prepare(`
        SELECT *
        FROM position_history
        WHERE position_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `);

    function normalizeCreatePayload(payload = {}) {
        const symbol = String(payload.symbol || '').trim().toUpperCase();
        const market = normalizeMarket(payload.market);
        const side = normalizeSide(payload.side);
        const entryPrice = Number(payload.entry_price);
        const quantity = Number(payload.quantity);
        const notes = String(payload.notes || '').trim();

        if (!symbol) {
            throw new Error('Symbol is required.');
        }
        if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
            throw new Error('Entry price must be greater than zero.');
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Quantity must be greater than zero.');
        }

        return { symbol, market, side, entryPrice, quantity, notes };
    }

    function listPositions(userId, options = {}) {
        const rows = listPositionsStmt.all({
            user_id: userId,
            status: options.status ? String(options.status) : null,
            limit: clampLimit(options.limit, 200)
        });
        return rows.map(mapPositionRow);
    }

    function getPosition(userId, positionId) {
        return mapPositionRow(getPositionStmt.get(positionId, userId));
    }

    function createPosition(userId, payload = {}) {
        const normalized = normalizeCreatePayload(payload);
        const timestamp = nowIso();
        const record = {
            user_id: userId,
            symbol: normalized.symbol,
            market: normalized.market,
            side: normalized.side,
            entry_price: normalized.entryPrice,
            current_price: normalized.entryPrice,
            quantity: normalized.quantity,
            remaining_qty: normalized.quantity,
            cost_basis: normalized.entryPrice * normalized.quantity,
            current_value: normalized.entryPrice * normalized.quantity,
            realized_pnl: 0,
            notes: normalized.notes,
            status: 'open',
            opened_at: timestamp,
            closed_at: null,
            created_at: timestamp,
            updated_at: timestamp
        };

        const transaction = db.transaction(() => {
            const result = insertPositionStmt.run(record);
            insertHistoryStmt.run({
                position_id: result.lastInsertRowid,
                action: 'open',
                previous_qty: null,
                new_qty: normalized.quantity,
                price: normalized.entryPrice,
                quantity: normalized.quantity,
                realized_pnl: 0,
                reason: 'manual',
                created_at: timestamp
            });
            return Number(result.lastInsertRowid);
        });

        const positionId = transaction();
        return getPosition(userId, positionId);
    }

    function closePosition(userId, positionId, payload = {}) {
        const position = getPosition(userId, positionId);
        if (!position) {
            return null;
        }
        if (position.status !== 'open') {
            throw new Error('Position is already closed.');
        }

        const closePrice = Number(payload.price);
        if (!Number.isFinite(closePrice) || closePrice <= 0) {
            throw new Error('Close price must be greater than zero.');
        }

        const requestedQty = clampQuantity(payload.quantity, position.remaining_qty);
        const quantity = Math.min(requestedQty, position.remaining_qty);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Quantity must be greater than zero.');
        }

        const timestamp = nowIso();
        const realizedPnl = computeUnrealizedPnl(position.side, position.entry_price, closePrice, quantity);
        const remainingQty = Math.max(0, position.remaining_qty - quantity);
        const isClosed = remainingQty <= 0.00000001;
        const nextStatus = isClosed ? 'closed' : 'open';
        const nextClosedAt = isClosed ? timestamp : null;
        const currentValue = isClosed ? 0 : closePrice * remainingQty;
        const totalRealizedPnl = (Number(position.realized_pnl) || 0) + realizedPnl;

        const transaction = db.transaction(() => {
            updatePositionStmt.run({
                id: positionId,
                user_id: userId,
                current_price: closePrice,
                remaining_qty: remainingQty,
                current_value: currentValue,
                realized_pnl: totalRealizedPnl,
                status: nextStatus,
                closed_at: nextClosedAt,
                updated_at: timestamp
            });

            insertHistoryStmt.run({
                position_id: positionId,
                action: isClosed ? 'close' : 'reduce',
                previous_qty: position.remaining_qty,
                new_qty: remainingQty,
                price: closePrice,
                quantity,
                realized_pnl: realizedPnl,
                reason: String(payload.reason || 'manual'),
                created_at: timestamp
            });

            if (isClosed) {
                cancelPositionStopOrdersStmt.run(timestamp, positionId, userId);
            }
        });

        transaction();
        return {
            position: getPosition(userId, positionId),
            realizedPnl,
            isClosed
        };
    }

    function listPositionHistory(userId, positionId, limit = 100) {
        const position = getPosition(userId, positionId);
        if (!position) {
            return null;
        }
        return listPositionHistoryStmt.all(positionId, clampLimit(limit, 100)).map((row) => ({
            id: String(row.id),
            position_id: String(row.position_id),
            action: row.action,
            previous_qty: row.previous_qty,
            new_qty: row.new_qty,
            price: row.price,
            quantity: row.quantity,
            realized_pnl: row.realized_pnl,
            reason: row.reason,
            created_at: row.created_at
        }));
    }

    function listStopOrders(userId, options = {}) {
        const rows = listStopOrdersStmt.all({
            user_id: userId,
            status: options.status ? String(options.status) : null
        });
        return rows.map(mapStopOrderRow);
    }

    function createStopOrder(userId, payload = {}) {
        const position = getPosition(userId, payload.position_id);
        if (!position) {
            throw new Error('Position not found.');
        }
        if (position.status !== 'open') {
            throw new Error('Cannot create stop order for a closed position.');
        }

        const triggerPrice = Number(payload.trigger_price);
        if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
            throw new Error('Trigger price must be greater than zero.');
        }

        const quantity = clampQuantity(payload.quantity, position.remaining_qty);
        const timestamp = nowIso();
        const result = insertStopOrderStmt.run({
            user_id: userId,
            position_id: Number(payload.position_id),
            order_type: String(payload.order_type || 'stop_loss'),
            trigger_price: triggerPrice,
            trigger_type: String(payload.trigger_type || 'price'),
            trail_percent: payload.trail_percent === null || payload.trail_percent === undefined ? null : Number(payload.trail_percent),
            highest_price: payload.highest_price === null || payload.highest_price === undefined ? null : Number(payload.highest_price),
            lowest_price: payload.lowest_price === null || payload.lowest_price === undefined ? null : Number(payload.lowest_price),
            quantity,
            status: 'active',
            created_at: timestamp,
            updated_at: timestamp
        });

        const created = getStopOrderStmt.get(result.lastInsertRowid, userId);
        return mapStopOrderRow({ ...created, symbol: position.symbol, side: position.side, position_current_price: position.current_price, position_remaining_qty: position.remaining_qty });
    }

    function cancelStopOrder(userId, stopOrderId) {
        const order = getStopOrderStmt.get(stopOrderId, userId);
        if (!order) {
            return false;
        }
        cancelStopOrderStmt.run(nowIso(), stopOrderId, userId);
        return true;
    }

    return {
        listPositions,
        getPosition,
        createPosition,
        closePosition,
        listPositionHistory,
        listStopOrders,
        createStopOrder,
        cancelStopOrder
    };
}

module.exports = {
    createPositionsStore
};
