// ========================================
// StockandCrypto - Crypto Page Full-Pack Logic
// ========================================

const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const TABLE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT', 'DOTUSDT', 'MATICUSDT'];
const SIGNAL_FILTERS = ['ALL', 'LONG', 'SHORT', 'FLAT'];
const ALERT_STORAGE_KEY = 'crypto_alerts_v1';
const PRESET_STORAGE_KEY = 'crypto_ui_preset_v1';
const MAX_LEVERAGE = 2.0;
const POLL_INTERVAL_MS = 10000;
const ALERT_COOLDOWN_MS = 60000;
const COMPARISON_HISTORY_LIMIT = 30;

const ACTION_COLORS = {
    LONG: '#00FFAA',
    FLAT: '#FBBF24',
    SHORT: '#FF4D5A'
};

const REASON_CODE_TEXT = {
    p_bull_gate: 'Direction probability exceeds bullish threshold.',
    p_bear_gate: 'Direction probability below bearish threshold.',
    momentum_gate: 'Momentum confirms the directional signal.',
    volatility_gate: 'Volatility remains in an accepted range.',
    volume_gate: 'Volume supports move quality.',
    drift_block: 'Drift monitor reduces confidence.',
    risk_cap: 'Position size capped by risk controls.'
};

const state = {
    selectedSymbol: 'BTCUSDT',
    timeframe: '7d',
    signalFilter: 'ALL',
    query: '',
    dataMode: 'Simulated Feed',
    autoRefreshEnabled: true,
    tickCount: 0,
    lastTickAt: null,
    prices: {},
    prediction: null,
    symbolPredictions: {},
    performance: null,
    health: null,
    universe: [],
    chartSeries: {},
    priceChart: null,
    comparisonChart: null,
    sharpeChart: null,
    comparisonLabels: [],
    comparisonHistory: {
        BTCUSDT: [],
        ETHUSDT: [],
        SOLUSDT: []
    },
    sortKey: 'pUp',
    sortDirection: 'desc',
    visibleRows: 8,
    expandedSymbol: null,
    alerts: [],
    sizerEdited: false,
    pollTimer: null
};

const els = {};

const lastPointPulsePlugin = {
    id: 'lastPointPulse',
    afterDatasetsDraw(chart) {
        const datasetMeta = chart.getDatasetMeta(0);
        if (!datasetMeta || !datasetMeta.data || datasetMeta.data.length === 0) return;
        const points = datasetMeta.data;
        const targetPoint = points[points.length - 1];
        if (!targetPoint) return;

        const { ctx } = chart;
        const phase = (Date.now() % 1200) / 1200;
        const pulseRadius = 4 + Math.sin(phase * Math.PI * 2) * 2;

        ctx.save();
        ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(targetPoint.x, targetPoint.y, pulseRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(targetPoint.x, targetPoint.y, pulseRadius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    loadPreset();
    bindEvents();
    loadAlerts();
    initializeCharts();
    syncControlState();
    updateTimeframeButtons();
    await refreshData(true);
    startAutoRefresh();
});

function cacheElements() {
    const byId = (id) => document.getElementById(id);
    Object.assign(els, {
        symbolSelect: byId('symbolSelect'),
        refreshNowBtn: byId('refreshNowBtn'),
        autoRefreshBtn: byId('autoRefreshBtn'),
        savePresetBtn: byId('savePresetBtn'),
        exportReportBtn: byId('exportReportBtn'),
        dataModeBadge: byId('dataModeBadge'),
        transportBadge: byId('transportBadge'),
        lastUpdated: byId('lastUpdated'),
        liveBannerMode: byId('liveBannerMode'),
        tickCount: byId('tickCount'),
        bannerTransport: byId('bannerTransport'),
        lastTickAt: byId('lastTickAt'),
        priceChartTitle: byId('priceChartTitle'),
        modelAccuracy: byId('modelAccuracy'),
        btcPrice: byId('btcPrice'),
        btcChange: byId('btcChange'),
        btcStatus: byId('btcStatus'),
        ethPrice: byId('ethPrice'),
        ethChange: byId('ethChange'),
        ethStatus: byId('ethStatus'),
        solPrice: byId('solPrice'),
        solChange: byId('solChange'),
        solStatus: byId('solStatus'),
        pUpValue: byId('pUpValue'),
        pDownValue: byId('pDownValue'),
        signalPill: byId('signalPill'),
        directionConfidence: byId('directionConfidence'),
        confidenceRing: byId('confidenceRing'),
        confidenceRingValue: byId('confidenceRingValue'),
        w0Fill: byId('w0Fill'),
        w1Fill: byId('w1Fill'),
        w2Fill: byId('w2Fill'),
        w3Fill: byId('w3Fill'),
        w0Prob: byId('w0Prob'),
        w1Prob: byId('w1Prob'),
        w2Prob: byId('w2Prob'),
        w3Prob: byId('w3Prob'),
        mostLikelyWindow: byId('mostLikelyWindow'),
        expectedStart: byId('expectedStart'),
        q10Value: byId('q10Value'),
        q50Value: byId('q50Value'),
        q90Value: byId('q90Value'),
        intervalWidth: byId('intervalWidth'),
        expectedReturn: byId('expectedReturn'),
        actionPill: byId('actionPill'),
        regimeChip: byId('regimeChip'),
        positionSize: byId('positionSize'),
        entryPrice: byId('entryPrice'),
        stopLoss: byId('stopLoss'),
        takeProfit1: byId('takeProfit1'),
        takeProfit2: byId('takeProfit2'),
        rrRatio1: byId('rrRatio1'),
        rrRatio2: byId('rrRatio2'),
        explanationSummary: byId('explanationSummary'),
        topFeaturesList: byId('topFeaturesList'),
        reasonCodesList: byId('reasonCodesList'),
        healthStatusBadge: byId('healthStatusBadge'),
        driftAlerts: byId('driftAlerts'),
        healthSharpe: byId('healthSharpe'),
        sharpeStability: byId('sharpeStability'),
        dataFreshness: byId('dataFreshness'),
        lastTraining: byId('lastTraining'),
        sharpeContext: byId('sharpeContext'),
        directionAccuracy: byId('directionAccuracy'),
        intervalCoverage: byId('intervalCoverage'),
        brierScore: byId('brierScore'),
        winRate: byId('winRate'),
        searchInput: byId('searchInput'),
        filterBtn: byId('filterBtn'),
        cryptoTableBody: byId('cryptoTableBody'),
        loadMoreBtn: byId('loadMoreBtn'),
        volatilityStrip: byId('volatilityStrip'),
        regimeSummary: byId('regimeSummary'),
        priceChart: byId('priceChart'),
        comparisonChart: byId('comparisonChart'),
        sharpeChart: byId('sharpeChart'),
        sizerConfidence: byId('sizerConfidence'),
        sizerPUp: byId('sizerPUp'),
        sizerEntry: byId('sizerEntry'),
        sizerQ10: byId('sizerQ10'),
        sizerQ50: byId('sizerQ50'),
        sizerQ90: byId('sizerQ90'),
        sizerAction: byId('sizerAction'),
        sizerSize: byId('sizerSize'),
        sizerTp: byId('sizerTp'),
        sizerSl: byId('sizerSl'),
        sizerRr: byId('sizerRr'),
        applyToLiveBtn: byId('applyToLiveBtn'),
        momentumDelta: byId('momentumDelta'),
        momentumDeltaValue: byId('momentumDeltaValue'),
        volatilityMultiplier: byId('volatilityMultiplier'),
        volatilityMultiplierValue: byId('volatilityMultiplierValue'),
        whatIfPUp: byId('whatIfPUp'),
        whatIfAction: byId('whatIfAction'),
        whatIfConfidence: byId('whatIfConfidence'),
        alertForm: byId('alertForm'),
        alertSymbol: byId('alertSymbol'),
        alertThreshold: byId('alertThreshold'),
        alertList: byId('alertList'),
        alertStatusText: byId('alertStatusText'),
        setBtcDriftAlert: byId('setBtcDriftAlert'),
        testAlertBtn: byId('testAlertBtn'),
        sortableHeaders: Array.from(document.querySelectorAll('.sortable')),
        timeframeButtons: Array.from(document.querySelectorAll('.timeframe-btn'))
    });
}

function bindEvents() {
    const throttledWhatIf = utils.throttle(() => renderWhatIf(), 40);

    if (els.symbolSelect) {
        els.symbolSelect.value = state.selectedSymbol;
        els.symbolSelect.addEventListener('change', async (event) => {
            state.selectedSymbol = event.target.value;
            state.sizerEdited = false;
            await refreshData(true);
        });
    }

    els.timeframeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            state.timeframe = button.dataset.timeframe;
            updateTimeframeButtons();
            renderPriceChart();
            renderVolatilityStrip();
        });
    });

    if (els.searchInput) {
        els.searchInput.addEventListener('input', utils.debounce((event) => {
            state.query = String(event.target.value || '').toLowerCase();
            state.visibleRows = 8;
            renderUniverseTable();
        }, 200));
    }

    if (els.filterBtn) {
        els.filterBtn.addEventListener('click', () => {
            const index = SIGNAL_FILTERS.indexOf(state.signalFilter);
            state.signalFilter = SIGNAL_FILTERS[(index + 1) % SIGNAL_FILTERS.length];
            els.filterBtn.textContent = `Signal: ${state.signalFilter}`;
            state.visibleRows = 8;
            renderUniverseTable();
        });
    }

    if (els.refreshNowBtn) {
        els.refreshNowBtn.addEventListener('click', async () => {
            await refreshData(true, true);
        });
    }

    if (els.savePresetBtn) {
        els.savePresetBtn.addEventListener('click', () => {
            savePreset();
        });
    }

    if (els.exportReportBtn) {
        els.exportReportBtn.addEventListener('click', () => {
            exportReport();
        });
    }

    if (els.autoRefreshBtn) {
        els.autoRefreshBtn.addEventListener('click', () => {
            state.autoRefreshEnabled = !state.autoRefreshEnabled;
            updateAutoRefreshButton();
            startAutoRefresh();
            renderModeAndBanner();
        });
    }

    if (els.loadMoreBtn) {
        els.loadMoreBtn.addEventListener('click', () => {
            state.visibleRows += 8;
            renderUniverseTable();
        });
    }

    if (els.cryptoTableBody) {
        els.cryptoTableBody.addEventListener('click', (event) => {
            const row = event.target.closest('tr.crypto-row');
            if (!row) return;
            const symbol = row.dataset.symbol;
            state.expandedSymbol = state.expandedSymbol === symbol ? null : symbol;
            renderUniverseTable();
        });
    }

    if (els.sortableHeaders?.length) {
        els.sortableHeaders.forEach((header) => {
            header.addEventListener('click', () => {
                const key = header.dataset.sortKey;
                if (!key) return;
                if (state.sortKey === key) {
                    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = key;
                    state.sortDirection = ['symbol', 'signal', 'status'].includes(key) ? 'asc' : 'desc';
                }
                renderUniverseTable();
            });
        });
    }

    [
        els.sizerConfidence,
        els.sizerPUp,
        els.sizerEntry,
        els.sizerQ10,
        els.sizerQ50,
        els.sizerQ90
    ].forEach((input) => {
        if (!input) return;
        input.addEventListener('input', () => {
            state.sizerEdited = true;
            renderSizer();
        });
    });

    if (els.momentumDelta) {
        els.momentumDelta.addEventListener('input', throttledWhatIf);
    }
    if (els.volatilityMultiplier) {
        els.volatilityMultiplier.addEventListener('input', throttledWhatIf);
    }

    if (els.applyToLiveBtn) {
        els.applyToLiveBtn.addEventListener('click', () => {
            if (window.showToast?.info) {
                window.showToast.info('Simulated execution submitted.', 2500);
            }
        });
    }

    if (els.alertForm) {
        els.alertForm.addEventListener('submit', (event) => {
            event.preventDefault();
            addAlert(els.alertSymbol?.value || 'BTCUSDT', asNumber(els.alertThreshold?.value, 5));
        });
    }

    if (els.setBtcDriftAlert) {
        els.setBtcDriftAlert.addEventListener('click', () => {
            addAlert('BTCUSDT', 5);
        });
    }

    if (els.testAlertBtn) {
        els.testAlertBtn.addEventListener('click', () => {
            triggerTestAlert();
        });
    }

    if (els.alertList) {
        els.alertList.addEventListener('click', (event) => {
            const actionEl = event.target.closest('[data-alert-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.alertAction;
            const id = actionEl.dataset.alertId;
            if (!action || !id) return;

            if (action === 'delete') {
                state.alerts = state.alerts.filter((alert) => alert.id !== id);
            }
            if (action === 'toggle') {
                const target = state.alerts.find((alert) => alert.id === id);
                if (target) target.enabled = !target.enabled;
            }
            saveAlerts();
            renderAlertList();
        });
    }
}

function initializeCharts() {
    Chart.register(lastPointPulsePlugin);

    if (els.priceChart) {
        state.priceChart = new Chart(els.priceChart.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Actual',
                        data: [],
                        borderColor: '#00E5FF',
                        borderWidth: 2,
                        tension: 0.28,
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: 'Band High',
                        data: [],
                        borderColor: 'rgba(103, 232, 249, 0)',
                        borderWidth: 0,
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: 'Band Low',
                        data: [],
                        borderColor: 'rgba(103, 232, 249, 0)',
                        backgroundColor(context) {
                            const { chart } = context;
                            const area = chart.chartArea;
                            if (!area) return 'rgba(103, 232, 249, 0.2)';
                            const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                            gradient.addColorStop(0, 'rgba(103, 232, 249, 0.32)');
                            gradient.addColorStop(1, 'rgba(103, 232, 249, 0.04)');
                            return gradient;
                        },
                        borderWidth: 0,
                        pointRadius: 0,
                        fill: '-1'
                    },
                    {
                        label: 'Predicted',
                        data: [],
                        borderColor: '#67E8F9',
                        borderWidth: 2,
                        tension: 0.2,
                        pointRadius: 0,
                        fill: false,
                        borderDash: [7, 4]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                if (!Number.isFinite(context.raw)) return `${context.dataset.label}: -`;
                                return `${context.dataset.label}: ${utils.formatCurrency(context.raw)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#94A3B8', maxTicksLimit: 10 },
                        grid: { color: 'rgba(148,163,184,0.08)' }
                    },
                    y: {
                        ticks: {
                            color: '#94A3B8',
                            callback: (value) => `$${Number(value).toLocaleString('en-US')}`
                        },
                        grid: { color: 'rgba(148,163,184,0.15)' }
                    }
                }
            }
        });
    }

    if (els.comparisonChart) {
        state.comparisonChart = new Chart(els.comparisonChart.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'BTC P(UP)',
                        data: [],
                        borderColor: '#00FFAA',
                        backgroundColor: 'rgba(0, 255, 170, 0.2)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.28
                    },
                    {
                        label: 'ETH P(UP)',
                        data: [],
                        borderColor: '#67E8F9',
                        backgroundColor: 'rgba(103, 232, 249, 0.2)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.28
                    },
                    {
                        label: 'SOL P(UP)',
                        data: [],
                        borderColor: '#FBBF24',
                        backgroundColor: 'rgba(251, 191, 36, 0.2)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.28
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const values = context.dataset.data;
                                const current = asNumber(context.raw, 0);
                                const previous = context.dataIndex > 0
                                    ? asNumber(values[context.dataIndex - 1], current)
                                    : current;
                                const delta = current - previous;
                                const sign = delta >= 0 ? '+' : '';
                                return `${context.dataset.label}: ${current.toFixed(2)}% | Delta ${sign}${delta.toFixed(2)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94A3B8' }, grid: { display: false } },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { color: '#94A3B8', callback: (value) => `${value}%` },
                        grid: { color: 'rgba(148,163,184,0.15)' }
                    }
                }
            }
        });
    }

    if (els.sharpeChart) {
        state.sharpeChart = new Chart(els.sharpeChart.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: '#67E8F9',
                    borderWidth: 1.5,
                    fill: true,
                    backgroundColor: 'rgba(103, 232, 249, 0.12)',
                    pointRadius: 0,
                    tension: 0.32
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }
}

async function refreshData(loadFullPrediction = false, manual = false) {
    await loadPrices();
    if (loadFullPrediction || !state.prediction || state.tickCount % 3 === 0 || manual) {
        await loadPredictionAndPerformance(loadFullPrediction);
    }

    ensureChartSeries();
    pushLatestPriceToSeries();
    buildUniverseRows();
    updateComparisonHistory();

    state.tickCount += 1;
    state.lastTickAt = new Date().toISOString();

    evaluateAlerts();
    renderAll();

    if (manual && window.showToast?.info) {
        window.showToast.info('Manual refresh completed.', 2000);
    }
}

function startAutoRefresh() {
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }

    if (!state.autoRefreshEnabled) {
        return;
    }

    state.pollTimer = setInterval(async () => {
        await refreshData(false);
    }, POLL_INTERVAL_MS);
}

async function loadPrices() {
    try {
        const payload = await api.getCryptoPrices();
        const normalized = normalizePrices(payload);
        if (Object.keys(normalized).length === 0) {
            throw new Error('No price rows');
        }
        state.prices = normalized;
        state.dataMode = payload?.meta?.stale ? 'Stale Feed' : 'Live Feed';
    } catch (error) {
        state.prices = simulatedPrices();
        state.dataMode = 'Simulated Feed';
    }
}

async function loadPredictionAndPerformance(loadAllSymbols = false) {
    const selectedSymbol = state.selectedSymbol;
    const [prediction, performance] = await Promise.all([
        fetchPrediction(selectedSymbol),
        fetchPerformance(selectedSymbol)
    ]);

    state.prediction = prediction;
    state.symbolPredictions[selectedSymbol] = prediction;
    state.performance = performance;
    state.health = prediction.health || defaultHealth();

    if (loadAllSymbols) {
        const missingSymbols = CRYPTO_SYMBOLS.filter((symbol) => symbol !== selectedSymbol);
        const results = await Promise.allSettled(missingSymbols.map((symbol) => fetchPrediction(symbol)));
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                state.symbolPredictions[missingSymbols[index]] = result.value;
            }
        });
    }
}

async function fetchPrediction(symbol) {
    try {
        if (typeof api.getCryptoPrediction === 'function') {
            const payload = await api.getCryptoPrediction(symbol);
            return normalizePrediction(payload, symbol);
        }
        if (typeof api.getCryptoPredictions === 'function') {
            const payload = await api.getCryptoPredictions(symbol.replace('USDT', ''));
            return normalizePrediction(payload, symbol);
        }
    } catch (error) {
        // Fallback below.
    }

    return simulatedPrediction(symbol);
}

async function fetchPerformance(symbol) {
    try {
        if (typeof api.getCryptoPerformance === 'function') {
            const payload = await api.getCryptoPerformance(symbol, 30);
            return normalizePerformance(payload);
        }
    } catch (error) {
        // Fallback below.
    }

    return defaultPerformance();
}

function normalizePrices(payload) {
    const normalized = {};
    if (!payload || typeof payload !== 'object') return normalized;

    const addRow = (key, value) => {
        const symbol = toCanonicalSymbol(key);
        if (!symbol || !value || typeof value !== 'object') return;
        const price = asNumber(value.price ?? value.current_price ?? value.last_price ?? value.close);
        if (!Number.isFinite(price)) return;
        normalized[symbol] = {
            symbol,
            price,
            change: asNumber(value.change ?? value.change_24h ?? value['24h_change'], 0),
            volume: asNumber(value.volume ?? value.volume_24h ?? value['24h_volume'], 0)
        };
    };

    if (Array.isArray(payload.data)) payload.data.forEach((row) => addRow(row.symbol, row));
    if (Array.isArray(payload)) payload.forEach((row) => addRow(row.symbol, row));
    Object.entries(payload).forEach(([key, value]) => addRow(key, value));

    return normalized;
}

function normalizePrediction(payload, symbol) {
    const fallback = simulatedPrediction(symbol);
    if (!payload || typeof payload !== 'object') return fallback;

    const packet = payload.prediction ? payload : { prediction: payload };
    const directionRaw = packet.prediction.direction || packet.prediction;

    const pUp = normalizeProbability(asNumber(directionRaw.p_up ?? directionRaw.pUp, fallback.direction.pUp));
    const pDown = normalizeProbability(asNumber(directionRaw.p_down ?? directionRaw.pDown, 1 - pUp));
    const confidence = normalizeProbability(asNumber(directionRaw.confidence, fallback.direction.confidence));
    const signal = (directionRaw.signal || packet.signal?.action || inferSignal(pUp)).toUpperCase();

    const startRaw = packet.prediction.start_window || packet.prediction.startWindow || {};
    const window = {
        w0: normalizeProbability(asNumber(startRaw.w0 ?? startRaw.w0_prob, fallback.window.w0)),
        w1: normalizeProbability(asNumber(startRaw.w1 ?? startRaw.w1_prob, fallback.window.w1)),
        w2: normalizeProbability(asNumber(startRaw.w2 ?? startRaw.w2_prob, fallback.window.w2)),
        w3: normalizeProbability(asNumber(startRaw.w3 ?? startRaw.w3_prob, fallback.window.w3)),
        mostLikely: startRaw.most_likely || startRaw.mostLikely || fallback.window.mostLikely,
        expectedStart: startRaw.expected_start || startRaw.expectedStart || fallback.window.expectedStart
    };

    const magnitudeRaw = packet.prediction.magnitude || packet.prediction;
    const q10 = normalizeReturn(asNumber(magnitudeRaw.q10, fallback.magnitude.q10));
    const q50 = normalizeReturn(asNumber(magnitudeRaw.q50, fallback.magnitude.q50));
    const q90 = normalizeReturn(asNumber(magnitudeRaw.q90, fallback.magnitude.q90));
    const sorted = [q10, q50, q90].sort((a, b) => a - b);

    const entryPrice = asNumber(packet.signal?.entry_price ?? packet.signal?.entryPrice, currentPrice(symbol) || fallback.signal.entryPrice);
    const action = (packet.signal?.action || signal).toUpperCase();
    const stopLoss = asNumber(packet.signal?.stop_loss, estimateStopLoss(entryPrice, sorted[0], action));
    const takeProfit1 = asNumber(packet.signal?.take_profit_1, estimateTakeProfit(entryPrice, sorted[1], action));
    const takeProfit2 = asNumber(packet.signal?.take_profit_2, estimateTakeProfit(entryPrice, sorted[2], action));

    const topFeatures = Array.isArray(packet.explanation?.top_features)
        ? packet.explanation.top_features
        : fallback.explanation.topFeatures;

    const reasonCodes = Array.isArray(packet.explanation?.reason_codes)
        ? packet.explanation.reason_codes
        : fallback.explanation.reasonCodes;

    return {
        symbol,
        timestamp: packet.timestamp || new Date().toISOString(),
        direction: { pUp, pDown, confidence, signal },
        window,
        magnitude: {
            q10: sorted[0],
            q50: sorted[1],
            q90: sorted[2],
            intervalWidth: sorted[2] - sorted[0],
            expectedReturn: sorted[1]
        },
        signal: {
            action,
            positionSize: asNumber(packet.signal?.position_size, fallback.signal.positionSize),
            entryPrice,
            stopLoss,
            takeProfit1,
            takeProfit2,
            rr1: calculateRiskReward(entryPrice, stopLoss, takeProfit1),
            rr2: calculateRiskReward(entryPrice, stopLoss, takeProfit2)
        },
        explanation: {
            summary: packet.explanation?.summary || fallback.explanation.summary,
            topFeatures,
            reasonCodes
        },
        health: normalizeHealth(packet.health)
    };
}

function normalizePerformance(payload) {
    const metrics = payload?.metrics || payload || {};
    const fallback = defaultPerformance();

    return {
        directionAccuracy: normalizeProbability(asNumber(metrics.direction_accuracy, fallback.directionAccuracy)),
        intervalCoverage: normalizeProbability(asNumber(metrics.interval_coverage, fallback.intervalCoverage)),
        sharpeRatio: asNumber(metrics.sharpe_ratio, fallback.sharpeRatio),
        winRate: normalizeProbability(asNumber(metrics.win_rate, fallback.winRate)),
        brierScore: asNumber(metrics.brier_score, fallback.brierScore)
    };
}

function normalizeHealth(payload) {
    const fallback = defaultHealth();
    if (!payload || typeof payload !== 'object') return fallback;

    return {
        status: payload.status || fallback.status,
        driftAlerts: asNumber(payload.driftAlerts ?? payload.drift_alerts, fallback.driftAlerts),
        sharpeRatio: asNumber(payload.sharpeRatio ?? payload.sharpe_ratio, fallback.sharpeRatio),
        sharpeStability: asNumber(payload.sharpeStability ?? payload.sharpe_stability, fallback.sharpeStability),
        dataFreshness: payload.dataFreshness || payload.data_freshness || fallback.dataFreshness,
        lastTraining: payload.lastTraining || payload.last_training || fallback.lastTraining
    };
}

function simulatedPrices() {
    const base = {
        BTCUSDT: { price: 68078, change: 1.6, volume: 14200000000 },
        ETHUSDT: { price: 1974, change: 1.1, volume: 6100000000 },
        SOLUSDT: { price: 84.79, change: -0.8, volume: 1230000000 }
    };

    const output = {};
    Object.entries(base).forEach(([symbol, row]) => {
        const drift = 1 + (Math.random() - 0.5) * 0.003;
        output[symbol] = {
            symbol,
            price: row.price * drift,
            change: row.change + (Math.random() - 0.5) * 0.24,
            volume: row.volume * (1 + (Math.random() - 0.5) * 0.02)
        };
    });
    return output;
}

function simulatedPrediction(symbol) {
    const preset = {
        BTCUSDT: { pUp: 0.62, confidence: 0.91, q10: -0.012, q50: 0.008, q90: 0.021 },
        ETHUSDT: { pUp: 0.57, confidence: 0.88, q10: -0.014, q50: 0.007, q90: 0.019 },
        SOLUSDT: { pUp: 0.49, confidence: 0.84, q10: -0.021, q50: 0.003, q90: 0.028 }
    }[symbol] || { pUp: 0.54, confidence: 0.82, q10: -0.016, q50: 0.006, q90: 0.018 };

    const signal = inferSignal(preset.pUp);
    const entry = currentPrice(symbol) || 100;
    const stopLoss = estimateStopLoss(entry, preset.q10, signal);
    const takeProfit1 = estimateTakeProfit(entry, preset.q50, signal);
    const takeProfit2 = estimateTakeProfit(entry, preset.q90, signal);

    return {
        symbol,
        timestamp: new Date().toISOString(),
        direction: { pUp: preset.pUp, pDown: 1 - preset.pUp, confidence: preset.confidence, signal },
        window: { w0: 0.24, w1: 0.37, w2: 0.26, w3: 0.13, mostLikely: 'W1', expectedStart: 'Within 1 hour' },
        magnitude: {
            q10: preset.q10,
            q50: preset.q50,
            q90: preset.q90,
            intervalWidth: preset.q90 - preset.q10,
            expectedReturn: preset.q50
        },
        signal: {
            action: signal,
            positionSize: 1.2,
            entryPrice: entry,
            stopLoss,
            takeProfit1,
            takeProfit2,
            rr1: calculateRiskReward(entry, stopLoss, takeProfit1),
            rr2: calculateRiskReward(entry, stopLoss, takeProfit2)
        },
        explanation: {
            summary: 'Signal is driven by momentum, volatility regime, and volume alignment.',
            topFeatures: [
                { feature: 'momentum_20d', shap_value: 0.341, contribution: 'Momentum confirms trend continuation.' },
                { feature: 'volatility_score', shap_value: 0.214, contribution: 'Volatility remains in stable regime.' },
                { feature: 'volume_ratio', shap_value: 0.183, contribution: 'Volume supports move quality.' }
            ],
            reasonCodes: signal === 'SHORT' ? ['p_bear_gate', 'volatility_gate', 'risk_cap'] : ['p_bull_gate', 'momentum_gate', 'volume_gate']
        },
        health: defaultHealth()
    };
}

function defaultPerformance() {
    return { directionAccuracy: 0.672, intervalCoverage: 0.813, sharpeRatio: -0.36, winRate: 0.542, brierScore: 0.234 };
}

function defaultHealth() {
    return {
        status: 'IN REVIEW',
        driftAlerts: 47,
        sharpeRatio: -0.36,
        sharpeStability: 2.3,
        dataFreshness: '2 hours ago',
        lastTraining: '2026-02-06'
    };
}

function renderAll() {
    renderModeAndBanner();
    renderPriceCards();
    renderPredictionPanel();
    renderPerformance();
    renderHealth();
    renderExplanation();
    renderSizer();
    renderWhatIf();
    renderPriceChart();
    renderComparisonChart();
    renderVolatilityStrip();
    renderUniverseTable();
    renderAlertList();
    updateChartTitle();
    setLastUpdated(state.lastTickAt || new Date().toISOString());
}

function renderModeAndBanner() {
    const modeClass = state.dataMode === 'Live Feed'
        ? 'status-live'
        : state.dataMode === 'Stale Feed' ? 'status-stale' : 'status-simulated';
    if (els.dataModeBadge) {
        els.dataModeBadge.textContent = state.dataMode;
        els.dataModeBadge.className = `status-badge ${modeClass}`;
    }

    const transportText = state.autoRefreshEnabled ? 'Polling' : 'Paused';
    if (els.transportBadge) {
        els.transportBadge.textContent = transportText;
        els.transportBadge.className = 'status-badge info';
    }
    if (els.bannerTransport) {
        els.bannerTransport.textContent = transportText;
    }
    if (els.tickCount) {
        els.tickCount.textContent = String(state.tickCount);
    }
    if (els.lastTickAt) {
        els.lastTickAt.textContent = timeStampLabel(state.lastTickAt);
    }
    if (els.liveBannerMode) {
        els.liveBannerMode.textContent = state.dataMode;
        els.liveBannerMode.className = state.dataMode === 'Live Feed'
            ? 'status-live'
            : state.dataMode === 'Stale Feed' ? 'status-stale' : 'status-sim';
    }

    updateAutoRefreshButton();
}

function updateAutoRefreshButton() {
    if (!els.autoRefreshBtn) return;
    els.autoRefreshBtn.textContent = `Auto Refresh: ${state.autoRefreshEnabled ? 'ON' : 'OFF'}`;
    els.autoRefreshBtn.classList.toggle('btn-primary', state.autoRefreshEnabled);
    els.autoRefreshBtn.classList.toggle('btn-secondary', !state.autoRefreshEnabled);
    els.autoRefreshBtn.setAttribute('aria-pressed', state.autoRefreshEnabled ? 'true' : 'false');
}

function syncControlState() {
    if (els.symbolSelect) {
        els.symbolSelect.value = state.selectedSymbol;
    }
    if (els.filterBtn) {
        els.filterBtn.textContent = `Signal: ${state.signalFilter}`;
    }
    updateAutoRefreshButton();
}

function renderPriceCards() {
    renderPriceCard('BTCUSDT', els.btcPrice, els.btcChange, els.btcStatus);
    renderPriceCard('ETHUSDT', els.ethPrice, els.ethChange, els.ethStatus);
    renderPriceCard('SOLUSDT', els.solPrice, els.solChange, els.solStatus);
}

function renderPriceCard(symbol, priceEl, changeEl, statusEl) {
    const item = state.prices[symbol];
    if (!item) return;

    text(priceEl, utils.formatCurrency(item.price));
    if (changeEl) {
        changeEl.textContent = utils.formatPercent(item.change / 100);
        changeEl.className = `metric-change ${item.change >= 0 ? 'positive' : 'negative'}`;
    }

    if (statusEl) {
        const statusText = state.dataMode === 'Live Feed' ? 'Live' : state.dataMode === 'Stale Feed' ? 'Stale' : 'Simulated';
        statusEl.textContent = statusText;
        statusEl.className = `status-badge ${statusBadgeClass(statusText)}`;
    }
}

function renderPredictionPanel() {
    const packet = state.prediction || simulatedPrediction(state.selectedSymbol);

    text(els.pUpValue, packet.direction.pUp.toFixed(2));
    text(els.pDownValue, packet.direction.pDown.toFixed(2));
    text(els.directionConfidence, packet.direction.confidence.toFixed(2));
    setSignalPill(els.signalPill, packet.direction.signal);
    updateConfidenceRing(packet.direction.confidence, packet.direction.signal);

    renderWindow(els.w0Fill, els.w0Prob, packet.window.w0);
    renderWindow(els.w1Fill, els.w1Prob, packet.window.w1);
    renderWindow(els.w2Fill, els.w2Prob, packet.window.w2);
    renderWindow(els.w3Fill, els.w3Prob, packet.window.w3);
    text(els.mostLikelyWindow, packet.window.mostLikely);
    text(els.expectedStart, packet.window.expectedStart);

    text(els.q10Value, formatSignedPercent(packet.magnitude.q10));
    text(els.q50Value, formatSignedPercent(packet.magnitude.q50));
    text(els.q90Value, formatSignedPercent(packet.magnitude.q90));
    text(els.intervalWidth, formatSignedPercent(packet.magnitude.intervalWidth, false));
    text(els.expectedReturn, formatSignedPercent(packet.magnitude.expectedReturn));

    setSignalPill(els.actionPill, packet.signal.action);
    text(els.positionSize, `${packet.signal.positionSize.toFixed(2)}x`);
    text(els.entryPrice, utils.formatCurrency(packet.signal.entryPrice));
    text(els.stopLoss, utils.formatCurrency(packet.signal.stopLoss));
    text(els.takeProfit1, utils.formatCurrency(packet.signal.takeProfit1));
    text(els.takeProfit2, utils.formatCurrency(packet.signal.takeProfit2));
    text(els.rrRatio1, packet.signal.rr1.toFixed(2));
    text(els.rrRatio2, packet.signal.rr2.toFixed(2));
}

function updateConfidenceRing(confidence, signal) {
    if (!els.confidenceRing) return;

    const clamped = clamp(confidence, 0, 1);
    const degrees = clamped * 360;
    const color = ACTION_COLORS[(signal || 'FLAT').toUpperCase()] || ACTION_COLORS.FLAT;
    els.confidenceRing.style.background = `conic-gradient(${color} ${degrees}deg, rgba(148, 163, 184, 0.25) ${degrees}deg)`;
    text(els.confidenceRingValue, `${Math.round(clamped * 100)}%`);

    els.confidenceRing.classList.remove('pulse');
    void els.confidenceRing.offsetWidth;
    els.confidenceRing.classList.add('pulse');
}

function renderExplanation() {
    const explanation = state.prediction?.explanation;
    if (!explanation) return;

    text(els.explanationSummary, explanation.summary || 'No explanation available.');

    if (els.topFeaturesList) {
        els.topFeaturesList.innerHTML = explanation.topFeatures.map((item) => {
            const value = asNumber(item.shap_value, 0);
            return `<li class="feature-item"><strong>${escapeHtml(item.feature || 'feature')}</strong> (${value.toFixed(3)}) - ${escapeHtml(item.contribution || 'n/a')}</li>`;
        }).join('');
    }

    if (els.reasonCodesList) {
        els.reasonCodesList.innerHTML = explanation.reasonCodes.map((code) => {
            const key = String(code);
            return `<li class="reason-item"><strong>${escapeHtml(key)}</strong> - ${escapeHtml(REASON_CODE_TEXT[key] || key)}</li>`;
        }).join('');
    }
}

function renderPerformance() {
    const perf = state.performance || defaultPerformance();
    text(els.directionAccuracy, formatRate(perf.directionAccuracy));
    text(els.intervalCoverage, formatRate(perf.intervalCoverage));
    text(els.brierScore, perf.brierScore.toFixed(3));
    text(els.winRate, formatRate(perf.winRate));

    if (els.modelAccuracy) {
        els.modelAccuracy.textContent = perf.directionAccuracy.toFixed(2);
    }
}

function renderHealth() {
    const health = state.health || defaultHealth();
    text(els.healthStatusBadge, health.status);
    text(els.driftAlerts, String(health.driftAlerts));
    text(els.healthSharpe, health.sharpeRatio.toFixed(2));
    text(els.sharpeStability, health.sharpeStability.toFixed(2));
    text(els.dataFreshness, health.dataFreshness);
    text(els.lastTraining, health.lastTraining);

    if (els.healthSharpe) {
        els.healthSharpe.style.color = health.sharpeRatio >= 0 ? ACTION_COLORS.LONG : ACTION_COLORS.SHORT;
    }

    if (els.sharpeContext) {
        const context = health.sharpeRatio < 0
            ? 'Sharpe is negative in the current regime. Strategy is in defensive review mode.'
            : 'Sharpe is positive. Risk-adjusted return quality remains acceptable.';
        els.sharpeContext.textContent = context;
    }
    if (els.sharpeChart) {
        els.sharpeChart.setAttribute('title', 'Negative Sharpe indicates low volatility regime, strategy in review.');
    }

    renderRegimeChip(health.sharpeRatio);
    updateSharpeChart(health.sharpeRatio);
}

function renderRegimeChip(sharpeRatio) {
    if (!els.regimeChip) return;
    const regime = computeRegimeFromSharpe(sharpeRatio);
    els.regimeChip.textContent = `Current Regime: ${regime.label}`;
    els.regimeChip.className = `regime-chip ${regime.className}`;
}

function updateSharpeChart(currentSharpe) {
    if (!state.sharpeChart) return;

    const labels = Array.from({ length: 24 }, (_, index) => `${index + 1}`);
    let anchor = currentSharpe;
    const data = labels.map(() => {
        anchor += (Math.random() - 0.5) * 0.15;
        return Number(anchor.toFixed(3));
    });

    state.sharpeChart.data.labels = labels;
    state.sharpeChart.data.datasets[0].data = data;
    state.sharpeChart.data.datasets[0].borderColor = currentSharpe >= 0 ? '#00FFAA' : '#FF4D5A';
    state.sharpeChart.data.datasets[0].backgroundColor = currentSharpe >= 0 ? 'rgba(0,255,170,0.15)' : 'rgba(255,77,90,0.15)';
    state.sharpeChart.update('none');
}

function renderSizer() {
    const packet = state.prediction;

    if (packet && !state.sizerEdited) {
        if (els.sizerConfidence) els.sizerConfidence.value = packet.direction.confidence.toFixed(2);
        if (els.sizerPUp) els.sizerPUp.value = packet.direction.pUp.toFixed(2);
        if (els.sizerEntry) els.sizerEntry.value = packet.signal.entryPrice.toFixed(2);
        if (els.sizerQ10) els.sizerQ10.value = packet.magnitude.q10.toFixed(3);
        if (els.sizerQ50) els.sizerQ50.value = packet.magnitude.q50.toFixed(3);
        if (els.sizerQ90) els.sizerQ90.value = packet.magnitude.q90.toFixed(3);
    }

    const confidence = clamp(asNumber(els.sizerConfidence?.value, 0.5), 0, 1);
    const pUp = clamp(asNumber(els.sizerPUp?.value, 0.5), 0, 1);
    const entry = Math.max(0.0001, asNumber(els.sizerEntry?.value, currentPrice(state.selectedSymbol) || 1));
    const q10 = normalizeReturn(asNumber(els.sizerQ10?.value, -0.01));
    const q50 = normalizeReturn(asNumber(els.sizerQ50?.value, 0.008));
    const q90 = normalizeReturn(asNumber(els.sizerQ90?.value, 0.02));

    const result = calculateSizer(confidence, pUp, entry, q10, q50, q90);

    setSignalPill(els.sizerAction, result.action);
    text(els.sizerSize, `${result.size.toFixed(2)}x`);
    text(els.sizerTp, `${utils.formatCurrency(result.tp1)} / ${utils.formatCurrency(result.tp2)}`);
    text(els.sizerSl, utils.formatCurrency(result.sl));
    text(els.sizerRr, `${result.rr1.toFixed(2)} / ${result.rr2.toFixed(2)}`);
}

function calculateSizer(confidence, pUp, entry, q10, q50, q90) {
    const sorted = [q10, q50, q90].sort((a, b) => a - b);
    const action = inferSignal(pUp);

    let size = clamp((confidence - 0.45) / 0.55, 0, 1) * MAX_LEVERAGE;
    if (confidence < 0.45 || action === 'FLAT') {
        size = 0;
    }

    let sl = entry;
    let tp1 = entry;
    let tp2 = entry;

    if (action === 'LONG') {
        sl = entry * (1 + sorted[0]);
        tp1 = entry * (1 + sorted[1]);
        tp2 = entry * (1 + sorted[2]);
    }

    if (action === 'SHORT') {
        sl = entry * (1 + Math.abs(sorted[0]));
        tp1 = entry * (1 - Math.abs(sorted[1]));
        tp2 = entry * (1 - Math.abs(sorted[2]));
    }

    return {
        action,
        size,
        sl,
        tp1,
        tp2,
        rr1: calculateRiskReward(entry, sl, tp1),
        rr2: calculateRiskReward(entry, sl, tp2)
    };
}

function renderWhatIf() {
    const basePrediction = state.prediction || simulatedPrediction(state.selectedSymbol);
    const momentumDelta = asNumber(els.momentumDelta?.value, 0);
    const volatilityMultiplier = asNumber(els.volatilityMultiplier?.value, 1);

    text(els.momentumDeltaValue, momentumDelta.toFixed(2));
    text(els.volatilityMultiplierValue, `${volatilityMultiplier.toFixed(2)}x`);

    const adjustedPUp = clamp(basePrediction.direction.pUp + momentumDelta * 0.6 - (volatilityMultiplier - 1) * 0.12, 0, 1);
    const adjustedConfidence = clamp(basePrediction.direction.confidence + momentumDelta * 0.2 - (volatilityMultiplier - 1) * 0.08, 0, 1);
    const action = inferSignal(adjustedPUp);

    text(els.whatIfPUp, adjustedPUp.toFixed(2));
    setSignalPill(els.whatIfAction, action);
    text(els.whatIfConfidence, `${(adjustedConfidence - basePrediction.direction.confidence).toFixed(2)}`);
}

function buildUniverseRows() {
    state.universe = TABLE_SYMBOLS.map((symbol, index) => {
        const prev = state.universe.find((row) => row.symbol === symbol);
        const seedPrediction = state.symbolPredictions[symbol] || simulatedPrediction(symbol);

        const live = state.prices[symbol] || simulatedUniversePrice(index, symbol);
        const pUpBase = seedPrediction.direction.pUp;
        const pUp = clamp((prev?.pUp ?? pUpBase) + (Math.random() - 0.5) * 0.015, 0, 1);
        const signal = inferSignal(pUp);

        return {
            symbol,
            price: live.price,
            change: live.change,
            volume: live.volume,
            pUp,
            signal,
            status: CRYPTO_SYMBOLS.includes(symbol)
                ? (state.dataMode === 'Live Feed' ? 'Live' : state.dataMode === 'Stale Feed' ? 'Stale' : 'Simulated')
                : 'Simulated',
            detail: {
                summary: seedPrediction.explanation.summary,
                topFeatures: seedPrediction.explanation.topFeatures,
                reasonCodes: seedPrediction.explanation.reasonCodes
            }
        };
    });

    const selected = state.universe.find((row) => row.symbol === state.selectedSymbol);
    if (selected && state.prediction) {
        selected.pUp = state.prediction.direction.pUp;
        selected.signal = state.prediction.direction.signal;
        selected.detail = {
            summary: state.prediction.explanation.summary,
            topFeatures: state.prediction.explanation.topFeatures,
            reasonCodes: state.prediction.explanation.reasonCodes
        };
    }
}

function renderUniverseTable() {
    if (!els.cryptoTableBody) return;

    const rows = getSortedFilteredRows();
    const visibleRows = rows.slice(0, state.visibleRows);

    els.cryptoTableBody.innerHTML = visibleRows.map((row) => {
        const signalBadge = signalBadgeClass(row.signal);
        const statusBadge = statusBadgeClass(row.status);
        const changeColor = row.change >= 0 ? ACTION_COLORS.LONG : ACTION_COLORS.SHORT;
        const expanded = row.symbol === state.expandedSymbol;

        const base = `
            <tr class="crypto-row" data-symbol="${row.symbol}">
                <td><strong>${toDisplaySymbol(row.symbol)}</strong></td>
                <td>${utils.formatCurrency(row.price)}</td>
                <td style="color: ${changeColor};">${utils.formatPercent(row.change / 100)}</td>
                <td>${row.pUp.toFixed(2)}</td>
                <td><span class="status-badge ${signalBadge}">${row.signal}</span></td>
                <td>${formatLargeMoney(row.volume)}</td>
                <td><span class="status-badge ${statusBadge}">${row.status.toUpperCase()}</span></td>
            </tr>
        `;

        if (!expanded) return base;

        const featureText = row.detail.topFeatures.slice(0, 3).map((item) => {
            const shap = asNumber(item.shap_value, 0).toFixed(3);
            return `<li>${escapeHtml(item.feature)} (${shap})</li>`;
        }).join('');

        const reasonText = row.detail.reasonCodes.map((code) => {
            return `<li>${escapeHtml(REASON_CODE_TEXT[code] || code)}</li>`;
        }).join('');

        return `${base}
            <tr class="detail-row">
                <td colspan="7">
                    <div class="detail-grid">
                        <div>
                            <div class="detail-title">Signal Summary</div>
                            <div>${escapeHtml(row.detail.summary)}</div>
                        </div>
                        <div>
                            <div class="detail-title">SHAP Top Features</div>
                            <ul>${featureText}</ul>
                        </div>
                        <div>
                            <div class="detail-title">Reason Codes</div>
                            <ul>${reasonText}</ul>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (els.loadMoreBtn) {
        const hasMore = rows.length > visibleRows.length;
        els.loadMoreBtn.style.display = hasMore ? 'inline-flex' : 'none';
        els.loadMoreBtn.textContent = hasMore ? `Load More (${rows.length - visibleRows.length} left)` : 'All Rows Loaded';
    }

    updateSortIndicators();
}

function getSortedFilteredRows() {
    const filtered = state.universe.filter((row) => {
        const queryMatch = row.symbol.toLowerCase().includes(state.query);
        const signalMatch = state.signalFilter === 'ALL' || row.signal === state.signalFilter;
        return queryMatch && signalMatch;
    });

    const direction = state.sortDirection === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
        const va = a[state.sortKey];
        const vb = b[state.sortKey];
        if (typeof va === 'string' || typeof vb === 'string') {
            return String(va).localeCompare(String(vb)) * direction;
        }
        return ((asNumber(va, 0) - asNumber(vb, 0)) * direction);
    });
}

function updateSortIndicators() {
    els.sortableHeaders.forEach((header) => {
        const indicator = header.querySelector('.sort-indicator');
        if (!indicator) return;
        if (header.dataset.sortKey !== state.sortKey) {
            indicator.textContent = '↕';
            return;
        }
        indicator.textContent = state.sortDirection === 'asc' ? '↑' : '↓';
    });
}

function renderPriceChart() {
    if (!state.priceChart) return;

    const bucket = state.chartSeries[state.selectedSymbol]?.[state.timeframe];
    if (!bucket) return;

    const projection = buildProjection(bucket.values);
    const labels = bucket.labels.concat(projection.labels);
    const actualData = bucket.values.concat(Array(projection.labels.length).fill(null));

    const predictedData = Array(Math.max(bucket.values.length - 1, 0)).fill(null)
        .concat([bucket.values[bucket.values.length - 1]])
        .concat(projection.predicted);

    const bandHighData = Array(Math.max(bucket.values.length - 1, 0)).fill(null)
        .concat([bucket.values[bucket.values.length - 1]])
        .concat(projection.high);

    const bandLowData = Array(Math.max(bucket.values.length - 1, 0)).fill(null)
        .concat([bucket.values[bucket.values.length - 1]])
        .concat(projection.low);

    state.priceChart.data.labels = labels;
    state.priceChart.data.datasets[0].data = actualData;
    state.priceChart.data.datasets[1].data = bandHighData;
    state.priceChart.data.datasets[2].data = bandLowData;
    state.priceChart.data.datasets[3].data = predictedData;
    state.priceChart.update('none');
}

function buildProjection(values) {
    const packet = state.prediction || simulatedPrediction(state.selectedSymbol);
    const q10 = packet.magnitude.q10;
    const q50 = packet.magnitude.q50;
    const q90 = packet.magnitude.q90;

    const steps = state.timeframe === '1h' ? 8 : state.timeframe === '24h' ? 10 : 12;
    const anchor = values[values.length - 1] || currentPrice(state.selectedSymbol) || 1;

    const labels = [];
    const predicted = [];
    const low = [];
    const high = [];

    for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        labels.push(`F+${step}`);
        predicted.push(anchor * (1 + q50 * ratio));
        low.push(anchor * (1 + q10 * ratio));
        high.push(anchor * (1 + q90 * ratio));
    }

    return { labels, predicted, low, high };
}

function renderComparisonChart() {
    if (!state.comparisonChart) return;
    state.comparisonChart.data.labels = state.comparisonLabels;
    state.comparisonChart.data.datasets[0].data = state.comparisonHistory.BTCUSDT;
    state.comparisonChart.data.datasets[1].data = state.comparisonHistory.ETHUSDT;
    state.comparisonChart.data.datasets[2].data = state.comparisonHistory.SOLUSDT;
    state.comparisonChart.update('none');
}

function updateComparisonHistory() {
    const lookup = Object.fromEntries(state.universe.map((row) => [row.symbol, row]));
    const label = `T${state.tickCount + 1}`;
    state.comparisonLabels.push(label);
    if (state.comparisonLabels.length > COMPARISON_HISTORY_LIMIT) {
        state.comparisonLabels.shift();
    }

    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach((symbol) => {
        const pUpValue = clamp(asNumber(lookup[symbol]?.pUp, 0.5), 0, 1) * 100;
        state.comparisonHistory[symbol].push(Number(pUpValue.toFixed(2)));
        if (state.comparisonHistory[symbol].length > COMPARISON_HISTORY_LIMIT) {
            state.comparisonHistory[symbol].shift();
        }
    });
}

function renderVolatilityStrip() {
    if (!els.volatilityStrip) return;

    const bucket = state.chartSeries[state.selectedSymbol]?.[state.timeframe];
    if (!bucket || bucket.values.length < 8) return;

    const segments = 18;
    const segmentSize = Math.max(3, Math.floor(bucket.values.length / segments));
    const vols = [];

    for (let i = 0; i < segments; i += 1) {
        const start = i * segmentSize;
        const segment = bucket.values.slice(start, start + segmentSize);
        const returns = [];
        for (let j = 1; j < segment.length; j += 1) {
            if (segment[j - 1] !== 0) returns.push((segment[j] - segment[j - 1]) / segment[j - 1]);
        }
        vols.push(stdDev(returns));
    }

    const sorted = [...vols].sort((a, b) => a - b);
    const lowCut = sorted[Math.floor(sorted.length * 0.33)] || 0;
    const highCut = sorted[Math.floor(sorted.length * 0.66)] || 0;

    const cells = vols.map((value) => {
        const regime = value <= lowCut ? 'low' : value >= highCut ? 'high' : 'normal';
        return `<span class="regime-cell ${regime}" title="${regime.toUpperCase()} volatility"></span>`;
    }).join('');

    els.volatilityStrip.innerHTML = cells;

    const mean = vols.reduce((acc, v) => acc + v, 0) / Math.max(vols.length, 1);
    const summary = mean >= highCut ? 'high' : mean <= lowCut ? 'low' : 'normal';
    text(els.regimeSummary, `Regime: ${summary} volatility.`);
}

function ensureChartSeries() {
    Object.entries(state.prices).forEach(([symbol, row]) => {
        if (!state.chartSeries[symbol]) {
            state.chartSeries[symbol] = createSeries(row.price);
        }
    });

    if (!state.chartSeries[state.selectedSymbol]) {
        state.chartSeries[state.selectedSymbol] = createSeries(currentPrice(state.selectedSymbol) || 100);
    }
}

function createSeries(anchor) {
    const build = (count, volatility) => {
        const labels = [];
        const values = [];
        let value = anchor;
        for (let i = count - 1; i >= 0; i -= 1) {
            value *= 1 + ((Math.random() - 0.5) * volatility);
            labels.push(timeLabel(i));
            values.push(value);
        }
        return { labels, values };
    };

    return {
        '1h': build(60, 0.0012),
        '24h': build(96, 0.0024),
        '7d': build(168, 0.0045)
    };
}

function pushLatestPriceToSeries() {
    const symbol = state.selectedSymbol;
    const latest = currentPrice(symbol);
    const bucket = state.chartSeries[symbol];
    if (!Number.isFinite(latest) || !bucket) return;

    [['1h', 60], ['24h', 96], ['7d', 168]].forEach(([tf, limit]) => {
        bucket[tf].labels.push(timeLabel(0));
        bucket[tf].values.push(latest);
        if (bucket[tf].labels.length > limit) bucket[tf].labels.shift();
        if (bucket[tf].values.length > limit) bucket[tf].values.shift();
    });
}

function updateChartTitle() {
    text(els.priceChartTitle, `${toDisplaySymbol(state.selectedSymbol)} Price Movement`);
}

function updateTimeframeButtons() {
    els.timeframeButtons.forEach((button) => {
        const active = button.dataset.timeframe === state.timeframe;
        button.classList.toggle('btn-primary', active);
        button.classList.toggle('btn-secondary', !active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function renderWindow(fillEl, valueEl, value) {
    const normalized = normalizeProbability(value);
    if (fillEl) fillEl.style.width = `${(normalized * 100).toFixed(1)}%`;
    if (valueEl) valueEl.textContent = normalized.toFixed(2);
}

function setSignalPill(element, signal) {
    if (!element) return;
    const normalized = (signal || 'FLAT').toUpperCase();
    const type = normalized === 'LONG' ? 'long' : normalized === 'SHORT' ? 'short' : 'flat';
    element.textContent = normalized;
    element.className = `signal-pill ${type}`;
}

function signalBadgeClass(signal) {
    if (signal === 'LONG') return 'success';
    if (signal === 'SHORT') return 'danger';
    return 'warning';
}

function statusBadgeClass(status) {
    if (status === 'Live') return 'status-live';
    if (status === 'Stale') return 'status-stale';
    return 'status-simulated';
}

function computeRegimeFromSharpe(sharpeRatio) {
    if (asNumber(sharpeRatio, 0) < 0) {
        return { label: 'Defensive', className: 'defensive' };
    }
    return { label: 'Balanced', className: 'balanced' };
}

function loadAlerts() {
    const saved = utils.storage.get(ALERT_STORAGE_KEY);
    if (saved && Array.isArray(saved.alerts)) {
        state.alerts = saved.alerts;
    } else {
        state.alerts = [];
    }
}

function saveAlerts() {
    utils.storage.set(ALERT_STORAGE_KEY, { alerts: state.alerts });
}

function loadPreset() {
    const preset = utils.storage.get(PRESET_STORAGE_KEY);
    if (!preset || typeof preset !== 'object') return;

    state.selectedSymbol = toCanonicalSymbol(preset.selectedSymbol) || state.selectedSymbol;
    state.timeframe = ['1h', '24h', '7d'].includes(preset.timeframe) ? preset.timeframe : state.timeframe;
    state.autoRefreshEnabled = typeof preset.autoRefreshEnabled === 'boolean'
        ? preset.autoRefreshEnabled
        : state.autoRefreshEnabled;
    state.signalFilter = SIGNAL_FILTERS.includes(preset.signalFilter) ? preset.signalFilter : state.signalFilter;

    const sizer = preset.sizer;
    if (sizer && typeof sizer === 'object') {
        if (els.sizerConfidence) els.sizerConfidence.value = clamp(asNumber(sizer.confidence, 0.9), 0, 1).toFixed(2);
        if (els.sizerPUp) els.sizerPUp.value = clamp(asNumber(sizer.pUp, 0.5), 0, 1).toFixed(2);
        if (els.sizerEntry) els.sizerEntry.value = asNumber(sizer.entry, 0).toFixed(2);
        if (els.sizerQ10) els.sizerQ10.value = normalizeReturn(asNumber(sizer.q10, -0.01)).toFixed(3);
        if (els.sizerQ50) els.sizerQ50.value = normalizeReturn(asNumber(sizer.q50, 0.01)).toFixed(3);
        if (els.sizerQ90) els.sizerQ90.value = normalizeReturn(asNumber(sizer.q90, 0.02)).toFixed(3);
        state.sizerEdited = true;
    }
}

function savePreset() {
    const payload = {
        selectedSymbol: state.selectedSymbol,
        timeframe: state.timeframe,
        autoRefreshEnabled: state.autoRefreshEnabled,
        signalFilter: state.signalFilter,
        sizer: {
            confidence: clamp(asNumber(els.sizerConfidence?.value, 0.9), 0, 1),
            pUp: clamp(asNumber(els.sizerPUp?.value, 0.5), 0, 1),
            entry: asNumber(els.sizerEntry?.value, 0),
            q10: normalizeReturn(asNumber(els.sizerQ10?.value, -0.01)),
            q50: normalizeReturn(asNumber(els.sizerQ50?.value, 0.01)),
            q90: normalizeReturn(asNumber(els.sizerQ90?.value, 0.02))
        },
        savedAt: new Date().toISOString()
    };

    utils.storage.set(PRESET_STORAGE_KEY, payload);
    if (window.showToast?.success) {
        window.showToast.success('Preset saved locally.', 2200);
    }
}

function exportReport() {
    const report = {
        generatedAt: new Date().toISOString(),
        mode: state.dataMode,
        symbol: state.selectedSymbol,
        timeframe: state.timeframe,
        prices: {
            BTCUSDT: state.prices.BTCUSDT || null,
            ETHUSDT: state.prices.ETHUSDT || null,
            SOLUSDT: state.prices.SOLUSDT || null
        },
        prediction: state.prediction,
        performance: state.performance,
        health: state.health,
        tableTopRows: getSortedFilteredRows().slice(0, 8)
    };

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const fileName = `crypto-report-${stamp}.json`;

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    if (window.showToast?.info) {
        window.showToast.info('Report exported.', 2200);
    }
}

function addAlert(symbol, thresholdPct) {
    const threshold = Math.max(0.1, thresholdPct);
    state.alerts.push({
        id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        symbol,
        type: 'move_gt_pct_24h',
        thresholdPct: threshold,
        enabled: true,
        lastTriggeredAt: null,
        createdAt: new Date().toISOString()
    });

    saveAlerts();
    renderAlertList();

    if (window.showToast?.success) {
        window.showToast.success(`${toDisplaySymbol(symbol)} alert set at ${threshold.toFixed(1)}%.`, 2500);
    }
}

function triggerTestAlert() {
    const symbol = els.alertSymbol?.value || state.selectedSymbol || 'BTCUSDT';
    const threshold = Math.max(0.1, asNumber(els.alertThreshold?.value, 5));
    const syntheticMove = threshold + 0.8;
    const message = `${toDisplaySymbol(symbol)} ${syntheticMove.toFixed(2)}% >= ${threshold.toFixed(1)}%`;
    text(els.alertStatusText, `Triggered: ${message} (demo)`);
    if (window.showToast?.warning) {
        window.showToast.warning(`Test alert triggered: ${message}`, 3200);
    }
}

function evaluateAlerts() {
    if (!state.alerts.length) {
        text(els.alertStatusText, 'No alert triggered yet.');
        return;
    }

    const now = Date.now();
    const triggered = [];

    state.alerts.forEach((alert) => {
        if (!alert.enabled) return;

        const row = state.universe.find((item) => item.symbol === alert.symbol);
        if (!row) return;

        if (Math.abs(row.change) < alert.thresholdPct) return;

        const lastTime = alert.lastTriggeredAt ? Date.parse(alert.lastTriggeredAt) : 0;
        if (Number.isFinite(lastTime) && now - lastTime < ALERT_COOLDOWN_MS) return;

        alert.lastTriggeredAt = new Date().toISOString();
        triggered.push({ symbol: alert.symbol, change: row.change, thresholdPct: alert.thresholdPct });
    });

    if (triggered.length > 0) {
        saveAlerts();
        renderAlertList();
        const msg = triggered
            .map((item) => `${toDisplaySymbol(item.symbol)} ${item.change.toFixed(2)}% >= ${item.thresholdPct.toFixed(1)}%`)
            .join(' | ');
        text(els.alertStatusText, `Triggered: ${msg}`);
        if (window.showToast?.warning) {
            window.showToast.warning(`Alert triggered: ${msg}`, 4000);
        }
        return;
    }

    text(els.alertStatusText, `Watching ${state.alerts.filter((item) => item.enabled).length} active alert(s).`);
}

function renderAlertList() {
    if (!els.alertList) return;

    if (!state.alerts.length) {
        els.alertList.innerHTML = '<li class="alert-item">No alerts configured.</li>';
        return;
    }

    els.alertList.innerHTML = state.alerts.map((alert) => {
        const triggered = alert.lastTriggeredAt ? `Last: ${timeStampLabel(alert.lastTriggeredAt)}` : 'Last: never';
        return `
            <li class="alert-item">
                <span>${toDisplaySymbol(alert.symbol)} > ${alert.thresholdPct.toFixed(1)}% (${alert.enabled ? 'ON' : 'OFF'}) - ${triggered}</span>
                <span>
                    <button type="button" class="btn btn-secondary btn-sm" data-alert-action="toggle" data-alert-id="${alert.id}">${alert.enabled ? 'Disable' : 'Enable'}</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-alert-action="delete" data-alert-id="${alert.id}">Delete</button>
                </span>
            </li>
        `;
    }).join('');
}

function setLastUpdated(timestamp) {
    text(els.lastUpdated, `Updated ${utils.formatTimestamp(timestamp, 'time')}`);
}

function simulatedUniversePrice(index) {
    const anchors = [68078, 1974, 84.79, 420, 0.61, 0.77, 0.12, 42, 18, 91, 8, 1.2];
    const base = anchors[index % anchors.length];

    return {
        price: base * (1 + (Math.random() - 0.5) * (base > 100 ? 0.012 : 0.07)),
        change: (Math.random() - 0.5) * 5,
        volume: Math.max(1000000, Math.random() * 4500000000)
    };
}

function inferSignal(pUp) {
    if (pUp >= 0.55) return 'LONG';
    if (pUp <= 0.45) return 'SHORT';
    return 'FLAT';
}

function estimateStopLoss(entry, q10, action) {
    if (action === 'SHORT') return entry * (1 + Math.abs(q10) * 0.8);
    return entry * (1 + q10 * 0.8);
}

function estimateTakeProfit(entry, quantileValue, action) {
    if (action === 'SHORT') return entry * (1 - Math.abs(quantileValue) * 0.8);
    return entry * (1 + quantileValue * 0.8);
}

function calculateRiskReward(entry, stopLoss, takeProfit) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    return risk > 0 ? reward / risk : 0;
}

function normalizeProbability(value) {
    if (!Number.isFinite(value)) return 0;
    if (value > 1) return clamp(value / 100, 0, 1);
    return clamp(value, 0, 1);
}

function normalizeReturn(value) {
    if (!Number.isFinite(value)) return 0;
    if (Math.abs(value) > 1) return value / 100;
    return value;
}

function toCanonicalSymbol(raw) {
    if (!raw) return null;
    const value = String(raw).toUpperCase().replace('/', '');
    if (value === 'BTC') return 'BTCUSDT';
    if (value === 'ETH') return 'ETHUSDT';
    if (value === 'SOL') return 'SOLUSDT';
    if (value.endsWith('USDT')) return value;
    return `${value}USDT`;
}

function toDisplaySymbol(symbol) {
    return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
}

function formatSignedPercent(value, includeSign = true) {
    const percent = normalizeReturn(value) * 100;
    const sign = includeSign && percent > 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
}

function formatRate(value) {
    return `${(normalizeProbability(value) * 100).toFixed(1)}%`;
}

function formatLargeMoney(value) {
    if (!Number.isFinite(value)) return '-';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return utils.formatCurrency(value);
}

function currentPrice(symbol) {
    return state.prices[symbol]?.price;
}

function asNumber(value, fallback = NaN) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function stdDev(values) {
    if (!values.length) return 0;
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / values.length;
    return Math.sqrt(Math.max(variance, 0));
}

function timeLabel(offsetMinutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() - offsetMinutes);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function timeStampLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function text(el, value) {
    if (el) el.textContent = value;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
