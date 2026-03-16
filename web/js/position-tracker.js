// ========================================
// StockandCrypto - Position Tracker Logic
// Uses the shared site auth state and site-backed position APIs.
// ========================================

let currentUser = null;
let positions = [];
let stopOrders = [];

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    await initializePositionTracker();
});

async function initializePositionTracker() {
    try {
        if (window.Auth?.ready) {
            await window.Auth.ready();
        }

        const authState = window.Auth?.getState ? window.Auth.getState() : null;
        currentUser = authState?.user || authState?.legacyUser || null;

        if (!currentUser) {
            showAuthRequired();
            return;
        }

        await Promise.all([
            loadPositions(),
            loadStopOrders(),
            loadPortfolioStats()
        ]);

        setupEventListeners();
    } catch (error) {
        console.error('Position tracker init error:', error);
        showUnavailable('Failed to initialize positions.');
    }
}

function showAuthRequired() {
    const main = document.querySelector('main');
    if (!main) return;

    main.innerHTML = `
        <div class="container" style="padding-top: 100px; text-align: center;">
            <div class="card" style="max-width: 420px; margin: 0 auto;">
                <div class="card-body">
                    <h2>Sign in Required</h2>
                    <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                        Please sign in to track your positions.
                    </p>
                    <a href="login.html" class="btn btn-primary" style="width: 100%;">Sign In</a>
                </div>
            </div>
        </div>
    `;
}

function showUnavailable(message) {
    const main = document.querySelector('main');
    if (!main) return;

    main.innerHTML = `
        <div class="container" style="padding-top: 100px; text-align: center;">
            <div class="card" style="max-width: 520px; margin: 0 auto;">
                <div class="card-body">
                    <h2>Positions Unavailable</h2>
                    <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                        ${escapeHtml(message || 'The position tracker is temporarily unavailable.')}
                    </p>
                    <a href="index.html" class="btn btn-secondary">Back to Home</a>
                </div>
            </div>
        </div>
    `;
}

function setupEventListeners() {
    document.getElementById('addPositionBtn')?.addEventListener('click', () => {
        openModal('addPositionModal');
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const isJson = String(response.headers.get('content-type') || '').includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
        const message = payload?.message || payload?.error || `Request failed (${response.status})`;
        throw new Error(message);
    }

    return payload || {};
}

// ==================== POSITIONS ====================

async function loadPositions() {
    try {
        const payload = await apiRequest('/api/site-positions?status=open&limit=200');
        positions = Array.isArray(payload.positions) ? payload.positions : [];
        renderPositions();
        updatePortfolioSummary();
    } catch (error) {
        console.error('Load positions error:', error);
        showToast(error.message || 'Failed to load positions', 'error');
    }
}

function renderPositions() {
    const container = document.getElementById('positionsList');
    if (!container) return;

    if (positions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No open positions</p>
                <p style="font-size: 0.85rem;">Click "Add Position" to start tracking.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = positions.map((pos) => `
        <div class="position-card ${pos.side}" data-id="${pos.id}">
            <div class="position-header">
                <div class="position-symbol">
                    ${escapeHtml(pos.symbol)}
                    <span class="side-badge ${pos.side}">${pos.side.toUpperCase()}</span>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; color: ${getPnlColor(pos.unrealized_pnl)};">
                        ${formatPnl(pos.unrealized_pnl)}
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">
                        ${Number(pos.unrealized_pnl_pct || 0).toFixed(2)}%
                    </div>
                </div>
            </div>

            <div class="position-metrics">
                <div class="metric">
                    <div class="metric-label">Entry Price</div>
                    <div class="metric-value">${formatPrice(pos.entry_price)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Current Price</div>
                    <div class="metric-value">${formatPrice(pos.current_price || pos.entry_price)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Quantity</div>
                    <div class="metric-value">${formatNumber(pos.remaining_qty)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Value</div>
                    <div class="metric-value">${formatCurrency(pos.current_value || pos.cost_basis)}</div>
                </div>
            </div>

            <div class="position-actions">
                <button class="btn btn-secondary btn-sm" onclick="openStopLossModal('${pos.id}')">Stop Loss</button>
                <button class="btn btn-secondary btn-sm" onclick="openTakeProfitModal('${pos.id}')">Take Profit</button>
                <button class="btn btn-secondary btn-sm" onclick="openTrailingStopModal('${pos.id}')">Trailing</button>
                <button class="btn btn-danger btn-sm" onclick="openCloseModal('${pos.id}')">Close</button>
            </div>
        </div>
    `).join('');
}

async function savePosition() {
    const symbol = document.getElementById('posSymbol').value.trim().toUpperCase();
    const market = document.getElementById('posMarket').value;
    const side = document.getElementById('posSide').value;
    const entryPrice = parseFloat(document.getElementById('posEntryPrice').value);
    const quantity = parseFloat(document.getElementById('posQuantity').value);
    const notes = document.getElementById('posNotes').value.trim();

    if (!symbol || !entryPrice || !quantity) {
        showToast('Please fill all required fields.', 'error');
        return;
    }

    try {
        await apiRequest('/api/site-positions', {
            method: 'POST',
            body: JSON.stringify({
                symbol,
                market,
                side,
                entry_price: entryPrice,
                quantity,
                notes
            })
        });

        showToast('Position added.', 'success');
        closeModal('addPositionModal');

        document.getElementById('posSymbol').value = '';
        document.getElementById('posEntryPrice').value = '';
        document.getElementById('posQuantity').value = '';
        document.getElementById('posNotes').value = '';

        await Promise.all([loadPositions(), loadPortfolioStats()]);
    } catch (error) {
        console.error('Save position error:', error);
        showToast(error.message || 'Failed to add position', 'error');
    }
}

// ==================== STOP ORDERS ====================

async function loadStopOrders() {
    try {
        const payload = await apiRequest('/api/site-stop-orders?status=active');
        stopOrders = Array.isArray(payload.orders) ? payload.orders : [];
        renderStopOrders();
    } catch (error) {
        console.error('Load stop orders error:', error);
        showToast(error.message || 'Failed to load stop orders', 'error');
    }
}

function renderStopOrders() {
    const container = document.getElementById('stopOrdersList');
    if (!container) return;

    if (stopOrders.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 1rem;">
                No active stop orders.
            </div>
        `;
        return;
    }

    container.innerHTML = stopOrders.map((order) => {
        const pos = order.positions;
        const typeLabel = order.order_type === 'stop_loss'
            ? 'Stop Loss'
            : order.order_type === 'take_profit'
                ? 'Take Profit'
                : 'Trailing';
        const currentPrice = Number(pos?.current_price || 0);
        const distancePct = currentPrice > 0
            ? (((order.trigger_price - currentPrice) / currentPrice) * 100).toFixed(2)
            : '0.00';

        return `
            <div style="padding: 0.75rem; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); margin-bottom: 0.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${escapeHtml(pos?.symbol || 'N/A')}</strong>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${typeLabel}</span>
                    </div>
                    <button class="btn btn-sm btn-secondary" onclick="cancelStopOrder('${order.id}')" title="Cancel">×</button>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
                    Trigger: ${formatPrice(order.trigger_price)} (${distancePct}%)
                </div>
            </div>
        `;
    }).join('');
}

function openStopLossModal(positionId) {
    const pos = positions.find((position) => position.id === positionId);
    if (!pos) return;

    document.getElementById('stopPositionId').value = positionId;
    document.getElementById('stopOrderType').value = 'stop_loss';
    document.getElementById('stopOrderModalTitle').textContent = 'Set Stop Loss';
    document.getElementById('stopPositionInfo').textContent = `${pos.symbol} ${pos.side.toUpperCase()} @ ${formatPrice(pos.entry_price)}`;
    document.getElementById('stopTriggerPrice').value = '';
    document.getElementById('trailingStopGroup').style.display = 'none';
    updateQuickButtons(pos, 'stop_loss');
    openModal('stopOrderModal');
}

function openTakeProfitModal(positionId) {
    const pos = positions.find((position) => position.id === positionId);
    if (!pos) return;

    document.getElementById('stopPositionId').value = positionId;
    document.getElementById('stopOrderType').value = 'take_profit';
    document.getElementById('stopOrderModalTitle').textContent = 'Set Take Profit';
    document.getElementById('stopPositionInfo').textContent = `${pos.symbol} ${pos.side.toUpperCase()} @ ${formatPrice(pos.entry_price)}`;
    document.getElementById('stopTriggerPrice').value = '';
    document.getElementById('trailingStopGroup').style.display = 'none';
    updateQuickButtons(pos, 'take_profit');
    openModal('stopOrderModal');
}

function openTrailingStopModal(positionId) {
    const pos = positions.find((position) => position.id === positionId);
    if (!pos) return;

    document.getElementById('stopPositionId').value = positionId;
    document.getElementById('stopOrderType').value = 'trailing_stop';
    document.getElementById('stopOrderModalTitle').textContent = 'Set Trailing Stop';
    document.getElementById('stopPositionInfo').textContent = `${pos.symbol} ${pos.side.toUpperCase()} @ ${formatPrice(pos.entry_price)}`;
    document.getElementById('trailingStopGroup').style.display = 'block';
    document.getElementById('trailPercent').value = '5';
    openModal('stopOrderModal');
}

function updateQuickButtons(position, orderType) {
    const quickBtns = document.querySelectorAll('.quick-btn');
    const currentPrice = position.current_price || position.entry_price;

    quickBtns.forEach((btn, index) => {
        const pct = [3, 5, 10, 15][index];
        const price = orderType === 'stop_loss'
            ? currentPrice * (1 - pct / 100)
            : currentPrice * (1 + pct / 100);

        btn.onclick = () => {
            document.getElementById('stopTriggerPrice').value = price.toFixed(8);
            updateRiskReward();
        };
    });
}

function setQuickStop(pct) {
    const positionId = document.getElementById('stopPositionId').value;
    const pos = positions.find((position) => position.id === positionId);
    const orderType = document.getElementById('stopOrderType').value;

    if (!pos) return;

    const currentPrice = pos.current_price || pos.entry_price;
    const price = orderType === 'stop_loss'
        ? currentPrice * (1 - pct / 100)
        : currentPrice * (1 + pct / 100);

    document.getElementById('stopTriggerPrice').value = price.toFixed(8);
    updateRiskReward();
}

async function saveStopOrder() {
    const positionId = document.getElementById('stopPositionId').value;
    const orderType = document.getElementById('stopOrderType').value;
    const triggerPriceInput = parseFloat(document.getElementById('stopTriggerPrice').value);
    const trailPercent = orderType === 'trailing_stop' ? parseFloat(document.getElementById('trailPercent').value) : null;
    const pos = positions.find((position) => position.id === positionId);

    if (!pos) {
        showToast('Position not found.', 'error');
        return;
    }

    let triggerPrice = triggerPriceInput;
    if (orderType === 'trailing_stop') {
        if (!trailPercent || trailPercent <= 0) {
            showToast('Please enter a valid trailing percent.', 'error');
            return;
        }
        triggerPrice = pos.side === 'long'
            ? pos.current_price * (1 - trailPercent / 100)
            : pos.current_price * (1 + trailPercent / 100);
    }

    if (!triggerPrice || triggerPrice <= 0) {
        showToast('Please enter a valid trigger price.', 'error');
        return;
    }

    try {
        await apiRequest('/api/site-stop-orders', {
            method: 'POST',
            body: JSON.stringify({
                position_id: positionId,
                order_type: orderType,
                trigger_price: triggerPrice,
                trigger_type: orderType === 'trailing_stop' ? 'trailing' : 'price',
                trail_percent: trailPercent,
                highest_price: pos.side === 'long' ? pos.current_price : null,
                lowest_price: pos.side === 'short' ? pos.current_price : null,
                quantity: pos.remaining_qty
            })
        });

        showToast('Stop order created.', 'success');
        closeModal('stopOrderModal');
        await loadStopOrders();
    } catch (error) {
        console.error('Save stop order error:', error);
        showToast(error.message || 'Failed to create stop order', 'error');
    }
}

async function cancelStopOrder(orderId) {
    if (!confirm('Cancel this stop order?')) return;

    try {
        await apiRequest(`/api/site-stop-orders/${encodeURIComponent(orderId)}/cancel`, {
            method: 'POST'
        });
        showToast('Stop order cancelled.', 'success');
        await loadStopOrders();
    } catch (error) {
        console.error('Cancel stop order error:', error);
        showToast(error.message || 'Failed to cancel stop order', 'error');
    }
}

function updateRiskReward() {
    const positionId = document.getElementById('stopPositionId').value;
    const pos = positions.find((position) => position.id === positionId);
    const triggerPrice = parseFloat(document.getElementById('stopTriggerPrice').value);

    if (!pos || !triggerPrice) return;

    const entryPrice = pos.entry_price;
    const risk = Math.abs(entryPrice - triggerPrice);
    const reward = risk * 2;
    const riskAmount = risk * pos.remaining_qty;
    const rewardAmount = reward * pos.remaining_qty;
    const rrRatio = risk > 0 ? (reward / risk).toFixed(2) : '0.00';

    document.getElementById('riskAmount').textContent = formatCurrency(riskAmount);
    document.getElementById('rewardAmount').textContent = formatCurrency(rewardAmount);
    document.getElementById('rrRatio').textContent = `1:${rrRatio}`;
}

// ==================== CLOSE POSITION ====================

function openCloseModal(positionId) {
    const pos = positions.find((position) => position.id === positionId);
    if (!pos) return;

    document.getElementById('closePositionId').value = positionId;
    document.getElementById('closePositionInfo').innerHTML = `
        <strong>${escapeHtml(pos.symbol)}</strong> ${pos.side.toUpperCase()}<br>
        <span style="color: var(--text-muted);">Qty: ${formatNumber(pos.remaining_qty)} @ ${formatPrice(pos.entry_price)}</span>
    `;
    document.getElementById('closePrice').value = pos.current_price || pos.entry_price;
    document.getElementById('closeQuantity').value = '';
    document.getElementById('closeQuantity').placeholder = `Max: ${formatNumber(pos.remaining_qty)}`;
    updateClosePnl();
    openModal('closePositionModal');
}

function updateClosePnl() {
    const positionId = document.getElementById('closePositionId').value;
    const pos = positions.find((position) => position.id === positionId);
    const closePrice = parseFloat(document.getElementById('closePrice').value);
    const closeQty = parseFloat(document.getElementById('closeQuantity').value) || pos?.remaining_qty;

    if (!pos || !closePrice) return;

    const pnl = computeClosePnl(pos, closePrice, closeQty);
    const closePnl = document.getElementById('closePnl');
    closePnl.textContent = formatCurrency(pnl);
    closePnl.style.color = pnl >= 0 ? 'var(--success)' : 'var(--error)';
}

function computeClosePnl(position, closePrice, quantity) {
    return position.side === 'long'
        ? (closePrice - position.entry_price) * quantity
        : (position.entry_price - closePrice) * quantity;
}

async function confirmClosePosition() {
    const positionId = document.getElementById('closePositionId').value;
    const closePrice = parseFloat(document.getElementById('closePrice').value);
    const closeQty = parseFloat(document.getElementById('closeQuantity').value) || 0;
    const pos = positions.find((position) => position.id === positionId);

    if (!pos || !closePrice) {
        showToast('Invalid close data.', 'error');
        return;
    }

    const quantity = closeQty > 0 ? closeQty : pos.remaining_qty;

    try {
        const payload = await apiRequest(`/api/site-positions/${encodeURIComponent(positionId)}/close`, {
            method: 'POST',
            body: JSON.stringify({
                price: closePrice,
                quantity,
                reason: 'manual'
            })
        });

        const realizedPnl = Number(payload.realizedPnl || 0);
        showToast(`Position ${payload.isClosed ? 'closed' : 'reduced'}. P&L: ${formatCurrency(realizedPnl)}`, 'success');
        closeModal('closePositionModal');
        await Promise.all([loadPositions(), loadStopOrders(), loadPortfolioStats()]);
    } catch (error) {
        console.error('Close position error:', error);
        showToast(error.message || 'Failed to close position', 'error');
    }
}

// ==================== PORTFOLIO STATS ====================

function updatePortfolioSummary() {
    const totalValue = positions.reduce((sum, position) => sum + Number(position.current_value || position.cost_basis || 0), 0);
    const totalCost = positions.reduce((sum, position) => sum + Number(position.entry_price || 0) * Number(position.remaining_qty || 0), 0);
    const unrealizedPnl = positions.reduce((sum, position) => sum + Number(position.unrealized_pnl || 0), 0);
    const pnlPct = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;

    document.getElementById('portfolioValue').textContent = formatCurrency(totalValue);
    document.getElementById('portfolioPnl').textContent = formatCurrency(unrealizedPnl);
    document.getElementById('portfolioPnl').className = unrealizedPnl >= 0 ? 'portfolio-pnl pnl-positive' : 'portfolio-pnl pnl-negative';
    document.getElementById('portfolioPnlPct').textContent = `(${pnlPct.toFixed(2)}%)`;
    document.getElementById('positionCount').textContent = positions.length;
    document.getElementById('unrealizedPnl').textContent = formatCurrency(unrealizedPnl);
}

async function loadPortfolioStats() {
    try {
        const payload = await apiRequest('/api/site-positions?status=closed&limit=100');
        const closedPositions = Array.isArray(payload.positions) ? payload.positions : [];

        if (closedPositions.length === 0) {
            document.getElementById('winRate').textContent = '0.0%';
            document.getElementById('avgWin').textContent = '$0.00';
            document.getElementById('avgLoss').textContent = '$0.00';
            document.getElementById('profitFactor').textContent = 'N/A';
            document.getElementById('realizedPnl').textContent = '$0.00';
            return;
        }

        const wins = closedPositions.filter((position) => Number(position.realized_pnl || 0) > 0);
        const losses = closedPositions.filter((position) => Number(position.realized_pnl || 0) < 0);
        const totalWins = wins.reduce((sum, position) => sum + Number(position.realized_pnl || 0), 0);
        const totalLosses = Math.abs(losses.reduce((sum, position) => sum + Number(position.realized_pnl || 0), 0));
        const winRate = (wins.length / closedPositions.length) * 100;
        const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
        const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
        const profitFactor = totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : 'N/A';

        document.getElementById('winRate').textContent = `${winRate.toFixed(1)}%`;
        document.getElementById('avgWin').textContent = formatCurrency(avgWin);
        document.getElementById('avgLoss').textContent = formatCurrency(avgLoss);
        document.getElementById('profitFactor').textContent = profitFactor;
        document.getElementById('realizedPnl').textContent = formatCurrency(totalWins - totalLosses);
    } catch (error) {
        console.error('Load portfolio stats error:', error);
        showToast(error.message || 'Failed to load portfolio stats', 'error');
    }
}

// ==================== MODAL HELPERS ====================

function openModal(modalId) {
    document.getElementById(modalId)?.classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
}

// ==================== FORMATTING HELPERS ====================

function formatPrice(price) {
    const numeric = Number(price || 0);
    if (!Number.isFinite(numeric)) return '0.00';
    if (numeric < 0.01) return numeric.toFixed(8);
    if (numeric < 1) return numeric.toFixed(6);
    if (numeric < 1000) return numeric.toFixed(4);
    return numeric.toFixed(2);
}

function formatNumber(num) {
    const numeric = Number(num || 0);
    if (!Number.isFinite(numeric)) return '0';
    if (numeric < 0.01) return numeric.toFixed(8);
    if (numeric < 1) return numeric.toFixed(6);
    return numeric.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatCurrency(amount) {
    const numeric = Number(amount || 0);
    if (!Number.isFinite(numeric)) return '$0.00';
    const absAmount = Math.abs(numeric);
    const prefix = numeric < 0 ? '-$' : '$';
    return prefix + absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPnl(pnl) {
    const numeric = Number(pnl || 0);
    if (!Number.isFinite(numeric)) return '$0.00';
    const prefix = numeric >= 0 ? '+$' : '-$';
    return prefix + Math.abs(numeric).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getPnlColor(pnl) {
    const numeric = Number(pnl || 0);
    if (!Number.isFinite(numeric) || numeric === 0) return 'var(--text-muted)';
    return numeric >= 0 ? 'var(--success)' : 'var(--error)';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 24px;
        background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--primary-accent)'};
        color: white;
        border-radius: 8px;
        z-index: 10000;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

document.getElementById('closePrice')?.addEventListener('input', updateClosePnl);
document.getElementById('closeQuantity')?.addEventListener('input', updateClosePnl);
document.getElementById('stopTriggerPrice')?.addEventListener('input', updateRiskReward);

console.log('Position Tracker loaded');


