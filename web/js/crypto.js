// ========================================
// StockandCrypto - Crypto Page Full-Pack Logic
// ========================================

const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const SIGNAL_FILTERS = ['ALL', 'LONG', 'SHORT', 'FLAT'];
const ALERT_STORAGE_KEY = 'crypto_alerts_v1';
const PRESET_STORAGE_KEY = 'crypto_ui_preset_v1';
const MAX_LEVERAGE = 2.0;
const LONG_SIGNAL_THRESHOLD = 0.55;
const SHORT_SIGNAL_THRESHOLD = 0.45;
const MIN_ACTIONABLE_CONFIDENCE = 0.45;
const POLL_INTERVAL_MS = 10000;
const ALERT_COOLDOWN_MS = 60000;
const COMPARISON_HISTORY_LIMIT = 30;
const CHART_RANGE_WINDOW_MS = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000
};
const CHART_RESEED_INTERVAL_MS = {
    '1h': 60 * 1000,
    '24h': 5 * 60 * 1000,
    '7d': 5 * 60 * 1000
};

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
    neutral_zone: 'Direction probability remains inside the neutral zone.',
    confidence_gate: 'Confidence has not cleared the execution gate.',
    drift_block: 'Drift monitor reduces confidence.',
    risk_cap: 'Position size capped by risk controls.'
};

const state = {
    selectedSymbol: 'BTCUSDT',
    timeframe: '7d',
    signalFilter: 'ALL',
    query: '',
    dataMode: 'Unavailable',
    autoRefreshEnabled: true,
    tickCount: 0,
    lastTickAt: null,
    prices: {},
    prediction: null,
    symbolPredictions: {},
    performance: null,
    performanceEstimated: false,
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
        const chartArea = chart.chartArea;
        if (!chartArea) return;

        let targetPoint = null;
        for (let index = points.length - 1; index >= 0; index -= 1) {
            const point = points[index];
            if (!point || point.skip) continue;
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
            if (
                point.x < chartArea.left
                || point.x > chartArea.right
                || point.y < chartArea.top
                || point.y > chartArea.bottom
            ) {
                continue;
            }
            targetPoint = point;
            break;
        }
        if (!targetPoint) return;

        const { ctx } = chart;
        const phase = (Date.now() % 1200) / 1200;
        const pulseRadius = 4 + Math.sin(phase * Math.PI * 2) * 2;
        const outerRadius = pulseRadius + 4;
        const safeX = clamp(targetPoint.x, chartArea.left + outerRadius + 2, chartArea.right - outerRadius - 2);
        const safeY = clamp(targetPoint.y, chartArea.top + outerRadius + 2, chartArea.bottom - outerRadius - 2);

        ctx.save();
        ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(safeX, safeY, pulseRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(safeX, safeY, outerRadius, 0, Math.PI * 2);
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
        chartSourceNote: byId('chartSourceNote'),
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
        predictionDataNote: byId('predictionDataNote'),
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
        actionLabel: byId('actionLabel'),
        regimeChip: byId('regimeChip'),
        positionSizeLabel: byId('positionSizeLabel'),
        positionSize: byId('positionSize'),
        entryPriceLabel: byId('entryPriceLabel'),
        entryPrice: byId('entryPrice'),
        stopLossLabel: byId('stopLossLabel'),
        stopLoss: byId('stopLoss'),
        takeProfit1Label: byId('takeProfit1Label'),
        takeProfit1: byId('takeProfit1'),
        takeProfit2Label: byId('takeProfit2Label'),
        takeProfit2: byId('takeProfit2'),
        rrRatio1Label: byId('rrRatio1Label'),
        rrRatio1: byId('rrRatio1'),
        rrRatio2Label: byId('rrRatio2Label'),
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
        performanceDataNote: byId('performanceDataNote'),
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
        sizerAvailabilityNote: byId('sizerAvailabilityNote'),
        applyToLiveBtn: byId('applyToLiveBtn'),
        momentumDelta: byId('momentumDelta'),
        momentumDeltaValue: byId('momentumDeltaValue'),
        volatilityMultiplier: byId('volatilityMultiplier'),
        volatilityMultiplierValue: byId('volatilityMultiplierValue'),
        whatIfPUp: byId('whatIfPUp'),
        whatIfAction: byId('whatIfAction'),
        whatIfConfidence: byId('whatIfConfidence'),
        whatIfAvailabilityNote: byId('whatIfAvailabilityNote'),
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
        button.addEventListener('click', async () => {
            state.timeframe = button.dataset.timeframe;
            updateTimeframeButtons();
            await loadChartHistory(state.selectedSymbol, state.timeframe, true);
            pushLatestPriceToSeries();
            renderPriceChart();
            renderVolatilityStrip();
            renderChartSourceNote();
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
            els.filterBtn.textContent = formatSignalFilterLabel(state.signalFilter);
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
                window.showToast.info('Execution preview submitted.', 2500);
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
    syncSelectedSymbolWithLivePrices();
    if (loadFullPrediction || !state.prediction || state.tickCount % 3 === 0 || manual) {
        await loadPredictionAndPerformance(loadFullPrediction);
    }

    await ensureSelectedChartHistory(loadFullPrediction);
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

function syncSelectedSymbolWithLivePrices() {
    const liveSymbols = Object.keys(state.prices);
    if (liveSymbols.length === 0) return;
    if (liveSymbols.includes(state.selectedSymbol)) {
        if (els.symbolSelect) els.symbolSelect.value = state.selectedSymbol;
        return;
    }
    state.selectedSymbol = liveSymbols[0];
    state.sizerEdited = false;
    if (els.symbolSelect) {
        els.symbolSelect.value = state.selectedSymbol;
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
        if (Object.keys(state.prices).length === 0) {
            state.prices = {};
        }
        state.dataMode = 'Unavailable';
    }
}

async function loadPredictionAndPerformance(loadAllSymbols = false) {
    const selectedSymbol = state.selectedSymbol;
    const [prediction, performance] = await Promise.all([
        fetchPrediction(selectedSymbol),
        fetchPerformance(selectedSymbol)
    ]);

    state.prediction = prediction;
    if (prediction) {
        state.symbolPredictions[selectedSymbol] = prediction;
    } else {
        delete state.symbolPredictions[selectedSymbol];
    }

    if (performance) {
        state.performance = performance;
        state.performanceEstimated = Boolean(performance.estimated);
    } else if (prediction) {
        state.performance = deriveEstimatedPerformanceFromPrediction(prediction);
        state.performanceEstimated = true;
    } else {
        state.performance = null;
        state.performanceEstimated = false;
    }

    state.health = prediction?.health || deriveHealthFromPrediction(prediction, state.performance, state.dataMode);

    if (loadAllSymbols) {
        const missingSymbols = CRYPTO_SYMBOLS.filter((symbol) => symbol !== selectedSymbol);
        const results = await Promise.allSettled(missingSymbols.map((symbol) => fetchPrediction(symbol)));
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
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

    return null;
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

    return null;
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
    if (!payload || typeof payload !== 'object') return null;

    const predictionRaw = payload.prediction && typeof payload.prediction === 'object' ? payload.prediction : payload;
    const signalRaw = payload.signal && typeof payload.signal === 'object' ? payload.signal : {};

    const pUpRaw = asNumber(
        predictionRaw.p_up
        ?? predictionRaw.pUp
        ?? predictionRaw.prob_up
        ?? predictionRaw.direction?.p_up
        ?? predictionRaw.direction?.pUp
    );
    if (!Number.isFinite(pUpRaw)) return null;

    const pUp = normalizeProbability(pUpRaw);
    const pDownCandidate = asNumber(
        predictionRaw.p_down
        ?? predictionRaw.pDown
        ?? predictionRaw.direction?.p_down
        ?? predictionRaw.direction?.pDown
    );
    const pDown = Number.isFinite(pDownCandidate) ? normalizeProbability(pDownCandidate) : normalizeProbability(1 - pUp);
    const confidence = normalizeProbability(asNumber(
        predictionRaw.confidence
        ?? predictionRaw.confidence_score
        ?? predictionRaw.direction?.confidence,
        Math.abs(pUp - 0.5) * 2
    ));
    const signal = String(predictionRaw.signal ?? signalRaw.action ?? resolveTradeSignal(pUp, confidence)).toUpperCase();

    const startRaw = predictionRaw.start_window || predictionRaw.startWindow || {};
    const window = normalizeWindowFromPayload(startRaw, pUp, confidence);

    const magnitudeRaw = predictionRaw.magnitude || predictionRaw;
    const q10Raw = asNumber(magnitudeRaw.q10 ?? magnitudeRaw.q10_change_pct ?? predictionRaw.q10_change_pct);
    const q50Raw = asNumber(magnitudeRaw.q50 ?? magnitudeRaw.q50_change_pct ?? predictionRaw.q50_change_pct);
    const q90Raw = asNumber(magnitudeRaw.q90 ?? magnitudeRaw.q90_change_pct ?? predictionRaw.q90_change_pct);
    if (!Number.isFinite(q10Raw) || !Number.isFinite(q50Raw) || !Number.isFinite(q90Raw)) return null;
    const sorted = [normalizeReturn(q10Raw), normalizeReturn(q50Raw), normalizeReturn(q90Raw)].sort((a, b) => a - b);

    const entryPrice = asNumber(
        signalRaw.entry_price
        ?? signalRaw.entryPrice
        ?? signalRaw.reference_price
        ?? signalRaw.referencePrice
        ?? predictionRaw.current_price
        ?? currentPrice(symbol)
    );
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
    const action = String(signalRaw.action ?? signal ?? resolveTradeSignal(pUp, confidence)).toUpperCase();
    const actionable = typeof signalRaw.actionable === 'boolean'
        ? signalRaw.actionable
        : String(signalRaw.presentation || '').toUpperCase() === 'TRADE'
            ? true
            : isActionableSignal(action);
    const presentation = String(signalRaw.presentation || (actionable ? 'TRADE' : 'NO_TRADE')).toUpperCase();
    const referencePrice = nullableNumber(signalRaw.reference_price ?? signalRaw.referencePrice, entryPrice);
    const stopLoss = actionable
        ? nullableNumber(signalRaw.stop_loss ?? signalRaw.stopLoss, estimateStopLoss(entryPrice, sorted[0], action))
        : nullableNumber(signalRaw.stop_loss ?? signalRaw.stopLoss, null);
    const takeProfit1 = actionable
        ? nullableNumber(signalRaw.take_profit_1 ?? signalRaw.takeProfit1, estimateTakeProfit(entryPrice, sorted[1], action))
        : nullableNumber(signalRaw.take_profit_1 ?? signalRaw.takeProfit1, null);
    const takeProfit2 = actionable
        ? nullableNumber(signalRaw.take_profit_2 ?? signalRaw.takeProfit2, estimateTakeProfit(entryPrice, sorted[2], action))
        : nullableNumber(signalRaw.take_profit_2 ?? signalRaw.takeProfit2, null);
    const rr1 = actionable
        ? nullableNumber(signalRaw.rr_1 ?? signalRaw.rr1, calculateRiskReward(entryPrice, stopLoss, takeProfit1))
        : nullableNumber(signalRaw.rr_1 ?? signalRaw.rr1, null);
    const rr2 = actionable
        ? nullableNumber(signalRaw.rr_2 ?? signalRaw.rr2, calculateRiskReward(entryPrice, stopLoss, takeProfit2))
        : nullableNumber(signalRaw.rr_2 ?? signalRaw.rr2, null);
    const longTriggerPUp = normalizeProbability(asNumber(signalRaw.long_trigger_p_up ?? signalRaw.longTriggerPUp, LONG_SIGNAL_THRESHOLD));
    const shortTriggerPUp = normalizeProbability(asNumber(signalRaw.short_trigger_p_up ?? signalRaw.shortTriggerPUp, SHORT_SIGNAL_THRESHOLD));

    const topFeatures = normalizeTopFeatures(payload.explanation?.top_features ?? payload.explanation?.topFeatures);
    const reasonCodes = normalizeReasonCodes(
        payload.explanation?.reason_codes ?? payload.explanation?.reasonCodes,
        action,
        pUp,
        confidence
    );

    return {
        symbol,
        timestamp: payload.timestamp || payload.meta?.timestamp || new Date().toISOString(),
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
            actionable,
            presentation,
            positionSize: asNumber(signalRaw.position_size ?? signalRaw.positionSize, actionable ? clamp((confidence - MIN_ACTIONABLE_CONFIDENCE) / (1 - MIN_ACTIONABLE_CONFIDENCE), 0, 1) * MAX_LEVERAGE : 0),
            entryPrice,
            referencePrice,
            longTriggerPUp,
            shortTriggerPUp,
            stopLoss,
            takeProfit1,
            takeProfit2,
            rr1,
            rr2
        },
        explanation: {
            summary: String(payload.explanation?.summary || `Live ${displaySignalLabel(action)} view derived from current market regime.`),
            topFeatures,
            reasonCodes
        },
        health: normalizeHealth(payload.health, {
            confidence,
            q10: sorted[0],
            q50: sorted[1],
            q90: sorted[2],
            stale: Boolean(payload?.meta?.stale)
        })
    };
}

function normalizePerformance(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const metrics = payload?.metrics || payload || {};
    const directionAccuracy = asNumber(metrics.direction_accuracy ?? metrics.directionAccuracy);
    const intervalCoverage = asNumber(metrics.interval_coverage ?? metrics.intervalCoverage);
    const sharpeRatio = asNumber(metrics.sharpe_ratio ?? metrics.sharpeRatio);
    const winRate = asNumber(metrics.win_rate ?? metrics.winRate);
    const brierScore = asNumber(metrics.brier_score ?? metrics.brierScore);
    if (
        !Number.isFinite(directionAccuracy)
        || !Number.isFinite(intervalCoverage)
        || !Number.isFinite(sharpeRatio)
        || !Number.isFinite(winRate)
        || !Number.isFinite(brierScore)
    ) {
        return null;
    }

    return {
        directionAccuracy: normalizeProbability(directionAccuracy),
        intervalCoverage: normalizeProbability(intervalCoverage),
        sharpeRatio,
        winRate: normalizeProbability(winRate),
        brierScore,
        estimated: Boolean(payload?.meta?.estimated)
    };
}

function normalizeHealth(payload, context = null) {
    if (!payload || typeof payload !== 'object') {
        if (!context) return null;
        return deriveHealthFromPrediction(
            {
                direction: { confidence: context.confidence || 0.5 },
                magnitude: {
                    q10: context.q10 || -0.01,
                    q50: context.q50 || 0,
                    q90: context.q90 || 0.01
                }
            },
            null,
            context.stale ? 'Stale Feed' : state.dataMode
        );
    }

    return {
        status: payload.status || 'IN REVIEW',
        driftAlerts: asNumber(payload.driftAlerts ?? payload.drift_alerts, 0),
        sharpeRatio: asNumber(payload.sharpeRatio ?? payload.sharpe_ratio, 0),
        sharpeStability: asNumber(payload.sharpeStability ?? payload.sharpe_stability, 0),
        dataFreshness: payload.dataFreshness || payload.data_freshness || 'live',
        lastTraining: payload.lastTraining || payload.last_training || 'N/A (live derived)'
    };
}

function normalizeWindowFromPayload(windowRaw, pUp, confidence) {
    const w0 = normalizeProbability(asNumber(windowRaw.w0 ?? windowRaw.w0_prob, 0.22 + (1 - confidence) * 0.12));
    const w1 = normalizeProbability(asNumber(windowRaw.w1 ?? windowRaw.w1_prob, 0.30 + Math.max(0, pUp - 0.5) * 0.4));
    const w2 = normalizeProbability(asNumber(windowRaw.w2 ?? windowRaw.w2_prob, 0.28));
    const w3 = normalizeProbability(asNumber(windowRaw.w3 ?? windowRaw.w3_prob, 0.20));
    const total = w0 + w1 + w2 + w3;
    const normalized = total > 0
        ? { w0: w0 / total, w1: w1 / total, w2: w2 / total, w3: w3 / total }
        : { w0: 0.25, w1: 0.35, w2: 0.25, w3: 0.15 };

    const mostLikely = windowRaw.most_likely || windowRaw.mostLikely || Object.entries({
        W0: normalized.w0,
        W1: normalized.w1,
        W2: normalized.w2,
        W3: normalized.w3
    }).sort((a, b) => b[1] - a[1])[0][0];

    const expectedStart = windowRaw.expected_start || windowRaw.expectedStart || (
        mostLikely === 'W0' ? 'Immediate'
            : mostLikely === 'W1' ? 'Within 1 hour'
                : mostLikely === 'W2' ? 'Within 2 hours'
                    : 'Within 3 hours'
    );

    return {
        w0: normalized.w0,
        w1: normalized.w1,
        w2: normalized.w2,
        w3: normalized.w3,
        mostLikely,
        expectedStart
    };
}

function normalizeTopFeatures(featuresRaw) {
    if (!Array.isArray(featuresRaw)) return [];
    return featuresRaw
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            feature: String(item.feature || item.name || 'feature'),
            shap_value: asNumber(item.shap_value ?? item.value ?? item.weight, 0),
            contribution: String(item.contribution || item.reason || 'Live contribution signal.')
        }));
}

function normalizeReasonCodes(reasonCodesRaw, signal, pUp = 0.5, confidence = 0.5) {
    if (Array.isArray(reasonCodesRaw) && reasonCodesRaw.length > 0) {
        return reasonCodesRaw.map((value) => String(value));
    }
    if (signal === 'LONG') return ['p_bull_gate', 'momentum_gate', 'volume_gate'];
    if (signal === 'SHORT') return ['p_bear_gate', 'volatility_gate', 'risk_cap'];
    const reasonCodes = [];
    if (pUp > SHORT_SIGNAL_THRESHOLD && pUp < LONG_SIGNAL_THRESHOLD) {
        reasonCodes.push('neutral_zone');
    }
    if ((pUp >= LONG_SIGNAL_THRESHOLD || pUp <= SHORT_SIGNAL_THRESHOLD) && confidence < MIN_ACTIONABLE_CONFIDENCE) {
        reasonCodes.push('confidence_gate');
    }
    reasonCodes.push('risk_cap');
    return reasonCodes;
}

function deriveEstimatedPerformanceFromPrediction(packet) {
    if (!packet) return null;
    const pUp = packet.direction.pUp;
    const confidence = packet.direction.confidence;
    const spread = Math.max(packet.magnitude.intervalWidth, 0.0001);
    const directionAccuracy = clamp(0.52 + Math.abs(pUp - 0.5) * 0.28 + confidence * 0.16, 0.45, 0.9);
    const intervalCoverage = clamp(0.72 + confidence * 0.16, 0.6, 0.94);
    const brierScore = clamp(0.33 - Math.abs(pUp - 0.5) * 0.20 + (1 - confidence) * 0.06, 0.12, 0.42);
    const winRate = clamp(0.5 + (pUp - 0.5) * 0.6, 0.05, 0.95);
    const sharpeRatio = clamp(packet.magnitude.expectedReturn / spread * 0.65, -3, 3);

    return {
        directionAccuracy,
        intervalCoverage,
        sharpeRatio,
        winRate,
        brierScore,
        estimated: true
    };
}

function deriveHealthFromPrediction(packet, performance, dataMode) {
    if (!packet) {
        return {
            status: 'Unavailable',
            driftAlerts: 0,
            sharpeRatio: 0,
            sharpeStability: 0,
            dataFreshness: dataMode === 'Unavailable' ? 'unavailable' : 'unknown',
            lastTraining: 'N/A'
        };
    }
    const spread = Math.max(packet.magnitude.intervalWidth, 0);
    const confidence = packet.direction.confidence;
    const sharpeRatio = Number((performance?.sharpeRatio ?? clamp(packet.magnitude.expectedReturn / Math.max(spread, 0.0001) * 0.65, -3, 3)).toFixed(3));
    const driftAlerts = Math.max(0, Math.round((0.65 - confidence) * 40));
    const status = dataMode === 'Unavailable'
        ? 'Unavailable'
        : driftAlerts > 10
            ? 'IN REVIEW'
            : 'MONITORED';

    return {
        status,
        driftAlerts,
        sharpeRatio,
        sharpeStability: Number((spread * 100).toFixed(3)),
        dataFreshness: dataMode === 'Stale Feed' ? 'stale cache' : 'live',
        lastTraining: 'N/A (live derived)'
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
    renderChartSourceNote();
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
        : state.dataMode === 'Stale Feed' ? 'status-stale' : 'status-unavailable';
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
            : state.dataMode === 'Stale Feed' ? 'status-stale' : 'status-unavailable';
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
        els.filterBtn.textContent = formatSignalFilterLabel(state.signalFilter);
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
    if (!item) {
        text(priceEl, '--');
        if (changeEl) {
            changeEl.textContent = '--';
            changeEl.className = 'metric-change';
        }
        if (statusEl) {
            statusEl.textContent = 'Unavailable';
            statusEl.className = `status-badge ${statusBadgeClass('Unavailable')}`;
        }
        return;
    }

    text(priceEl, utils.formatCurrency(item.price));
    if (changeEl) {
        changeEl.textContent = utils.formatPercent(item.change / 100);
        changeEl.className = `metric-change ${item.change >= 0 ? 'positive' : 'negative'}`;
    }

    if (statusEl) {
        const statusText = state.dataMode === 'Live Feed' ? 'Live' : state.dataMode === 'Stale Feed' ? 'Stale' : 'Unavailable';
        statusEl.textContent = statusText;
        statusEl.className = `status-badge ${statusBadgeClass(statusText)}`;
    }
}

function renderPredictionPanel() {
    const packet = state.prediction;
    if (!packet) {
        text(els.pUpValue, '--');
        text(els.pDownValue, '--');
        text(els.directionConfidence, '--');
        setSignalPill(els.signalPill, 'FLAT');
        updateConfidenceRing(0, 'FLAT');
        applyRiskPacketLabels('TRADE');
        renderWindow(els.w0Fill, els.w0Prob, 0);
        renderWindow(els.w1Fill, els.w1Prob, 0);
        renderWindow(els.w2Fill, els.w2Prob, 0);
        renderWindow(els.w3Fill, els.w3Prob, 0);
        text(els.mostLikelyWindow, '--');
        text(els.expectedStart, '--');
        text(els.q10Value, '--');
        text(els.q50Value, '--');
        text(els.q90Value, '--');
        text(els.intervalWidth, '--');
        text(els.expectedReturn, '--');
        setSignalPill(els.actionPill, 'FLAT');
        text(els.positionSize, '--');
        text(els.entryPrice, '--');
        text(els.stopLoss, '--');
        text(els.takeProfit1, '--');
        text(els.takeProfit2, '--');
        text(els.rrRatio1, '--');
        text(els.rrRatio2, '--');
        if (els.predictionDataNote) {
            els.predictionDataNote.textContent = 'Live prediction data unavailable.';
        }
        return;
    }

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
    if (packet.signal.actionable) {
        applyRiskPacketLabels('TRADE');
        text(els.positionSize, `${packet.signal.positionSize.toFixed(2)}x`);
        text(els.entryPrice, formatNullableCurrency(packet.signal.entryPrice));
        text(els.stopLoss, formatNullableCurrency(packet.signal.stopLoss));
        text(els.takeProfit1, formatNullableCurrency(packet.signal.takeProfit1));
        text(els.takeProfit2, formatNullableCurrency(packet.signal.takeProfit2));
        text(els.rrRatio1, formatNullableRatio(packet.signal.rr1));
        text(els.rrRatio2, formatNullableRatio(packet.signal.rr2));
    } else {
        applyRiskPacketLabels('NO_TRADE');
        text(els.positionSize, `${packet.signal.positionSize.toFixed(2)}x`);
        text(els.entryPrice, formatNullableCurrency(packet.signal.referencePrice ?? packet.signal.entryPrice));
        text(els.stopLoss, formatNullableProbability(packet.signal.longTriggerPUp));
        text(els.takeProfit1, formatNullableProbability(packet.signal.shortTriggerPUp));
        text(els.takeProfit2, formatCurrentEdge(packet.direction.pUp, packet.direction.confidence));
        text(els.rrRatio1, '--');
        text(els.rrRatio2, '--');
    }
    if (els.predictionDataNote) {
        const feedNote = state.dataMode === 'Stale Feed'
            ? 'Prediction derived from stale cache.'
            : 'Prediction sourced from live derived feed.';
        els.predictionDataNote.textContent = packet.signal.actionable
            ? feedNote
            : `${feedNote} NO TRADE until direction and confidence clear the execution gate.`;
    }
}

function applyRiskPacketLabels(mode) {
    const noTrade = mode === 'NO_TRADE';
    text(els.actionLabel, 'Action');
    text(els.positionSizeLabel, 'Position Size');
    text(els.entryPriceLabel, noTrade ? 'Reference Price' : 'Entry');
    text(els.stopLossLabel, noTrade ? 'Long Trigger' : 'Stop Loss');
    text(els.takeProfit1Label, noTrade ? 'Short Trigger' : 'Take Profit 1');
    text(els.takeProfit2Label, noTrade ? 'Current Edge' : 'Take Profit 2');
    text(els.rrRatio1Label, noTrade ? 'Stop / TP' : 'R:R (TP1)');
    text(els.rrRatio2Label, noTrade ? 'Risk:Reward' : 'R:R (TP2)');
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
    if (!explanation) {
        text(els.explanationSummary, 'Live prediction explanation unavailable.');
        if (els.topFeaturesList) {
            els.topFeaturesList.innerHTML = '<li class="feature-item">No live feature contribution data.</li>';
        }
        if (els.reasonCodesList) {
            els.reasonCodesList.innerHTML = '<li class="reason-item">No live reason code data.</li>';
        }
        return;
    }

    text(els.explanationSummary, explanation.summary || 'No explanation available.');

    if (els.topFeaturesList) {
        const topFeatureMarkup = explanation.topFeatures.map((item) => {
            const value = asNumber(item.shap_value, 0);
            return `<li class="feature-item"><strong>${escapeHtml(item.feature || 'feature')}</strong> (${value.toFixed(3)}) - ${escapeHtml(item.contribution || 'n/a')}</li>`;
        }).join('');
        els.topFeaturesList.innerHTML = topFeatureMarkup || '<li class="feature-item">No live feature contribution data.</li>';
    }

    if (els.reasonCodesList) {
        const reasonMarkup = explanation.reasonCodes.map((code) => {
            const key = String(code);
            return `<li class="reason-item"><strong>${escapeHtml(key)}</strong> - ${escapeHtml(REASON_CODE_TEXT[key] || key)}</li>`;
        }).join('');
        els.reasonCodesList.innerHTML = reasonMarkup || '<li class="reason-item">No live reason code data.</li>';
    }
}

function renderPerformance() {
    const perf = state.performance;
    if (!perf) {
        text(els.directionAccuracy, '--');
        text(els.intervalCoverage, '--');
        text(els.brierScore, '--');
        text(els.winRate, '--');
        if (els.modelAccuracy) {
            els.modelAccuracy.textContent = '--';
        }
        if (els.performanceDataNote) {
            els.performanceDataNote.textContent = 'Performance data unavailable.';
        }
        return;
    }

    text(els.directionAccuracy, formatRate(perf.directionAccuracy));
    text(els.intervalCoverage, formatRate(perf.intervalCoverage));
    text(els.brierScore, perf.brierScore.toFixed(3));
    text(els.winRate, formatRate(perf.winRate));

    if (els.modelAccuracy) {
        els.modelAccuracy.textContent = perf.directionAccuracy.toFixed(2);
    }
    if (els.performanceDataNote) {
        els.performanceDataNote.textContent = state.performanceEstimated
            ? 'Performance estimated from live prediction packet.'
            : 'Performance sourced from live endpoint.';
    }
}

function renderHealth() {
    const health = state.health;
    if (!health) {
        if (els.healthStatusBadge) {
            els.healthStatusBadge.textContent = 'Unavailable';
            els.healthStatusBadge.className = 'status-badge status-unavailable';
        }
        text(els.driftAlerts, '--');
        text(els.healthSharpe, '--');
        text(els.sharpeStability, '--');
        text(els.dataFreshness, 'unavailable');
        text(els.lastTraining, '--');
        if (els.sharpeContext) {
            els.sharpeContext.textContent = 'Live health metrics unavailable.';
        }
        renderRegimeChip(null);
        updateSharpeChart(null);
        return;
    }

    if (els.healthStatusBadge) {
        const badgeClass = health.status === 'Unavailable'
            ? 'status-unavailable'
            : health.status === 'MONITORED'
                ? 'status-live'
                : 'info';
        els.healthStatusBadge.textContent = health.status;
        els.healthStatusBadge.className = `status-badge ${badgeClass}`;
    }
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
    if (!Number.isFinite(sharpeRatio)) {
        els.regimeChip.textContent = 'Current Regime: Unavailable';
        els.regimeChip.className = 'regime-chip defensive';
        return;
    }
    const regime = computeRegimeFromSharpe(sharpeRatio);
    els.regimeChip.textContent = `Current Regime: ${regime.label}`;
    els.regimeChip.className = `regime-chip ${regime.className}`;
}

function updateSharpeChart(currentSharpe) {
    if (!state.sharpeChart) return;
    if (!Number.isFinite(currentSharpe)) {
        state.sharpeChart.data.labels = [];
        state.sharpeChart.data.datasets[0].data = [];
        state.sharpeChart.update('none');
        return;
    }

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
    const hasPrediction = Boolean(packet);
    setPredictionDependentControlsEnabled(hasPrediction);

    if (!hasPrediction) {
        setSignalPill(els.sizerAction, 'FLAT');
        text(els.sizerSize, '--');
        text(els.sizerTp, '--');
        text(els.sizerSl, '--');
        text(els.sizerRr, '--');
        if (els.applyToLiveBtn) {
            els.applyToLiveBtn.disabled = true;
        }
        if (els.sizerAvailabilityNote) {
            els.sizerAvailabilityNote.textContent = 'Requires live prediction.';
        }
        return;
    }

    if (!state.sizerEdited) {
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
    text(els.sizerTp, result.actionable
        ? `${formatNullableCurrency(result.tp1)} / ${formatNullableCurrency(result.tp2)}`
        : '--');
    text(els.sizerSl, result.actionable ? formatNullableCurrency(result.sl) : '--');
    text(els.sizerRr, result.actionable
        ? `${formatNullableRatio(result.rr1)} / ${formatNullableRatio(result.rr2)}`
        : '--');
    if (els.applyToLiveBtn) {
        els.applyToLiveBtn.disabled = !result.actionable;
    }
    if (els.sizerAvailabilityNote) {
        els.sizerAvailabilityNote.textContent = result.actionable
            ? ''
            : 'NO TRADE until P(UP) and confidence clear the execution thresholds.';
    }
}

function calculateSizer(confidence, pUp, entry, q10, q50, q90) {
    const sorted = [q10, q50, q90].sort((a, b) => a - b);
    const action = resolveTradeSignal(pUp, confidence);

    let size = clamp((confidence - MIN_ACTIONABLE_CONFIDENCE) / (1 - MIN_ACTIONABLE_CONFIDENCE), 0, 1) * MAX_LEVERAGE;
    if (!isActionableSignal(action)) {
        size = 0;
    }

    let sl = null;
    let tp1 = null;
    let tp2 = null;

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
        actionable: isActionableSignal(action),
        size,
        sl,
        tp1,
        tp2,
        rr1: isActionableSignal(action) ? calculateRiskReward(entry, sl, tp1) : null,
        rr2: isActionableSignal(action) ? calculateRiskReward(entry, sl, tp2) : null
    };
}

function renderWhatIf() {
    const basePrediction = state.prediction;
    if (!basePrediction) {
        text(els.momentumDeltaValue, '--');
        text(els.volatilityMultiplierValue, '--');
        text(els.whatIfPUp, '--');
        setSignalPill(els.whatIfAction, 'FLAT');
        text(els.whatIfConfidence, '--');
        if (els.whatIfAvailabilityNote) {
            els.whatIfAvailabilityNote.textContent = 'Requires live prediction.';
        }
        return;
    }
    const momentumDelta = asNumber(els.momentumDelta?.value, 0);
    const volatilityMultiplier = asNumber(els.volatilityMultiplier?.value, 1);

    text(els.momentumDeltaValue, momentumDelta.toFixed(2));
    text(els.volatilityMultiplierValue, `${volatilityMultiplier.toFixed(2)}x`);

    const adjustedPUp = clamp(basePrediction.direction.pUp + momentumDelta * 0.6 - (volatilityMultiplier - 1) * 0.12, 0, 1);
    const adjustedConfidence = clamp(basePrediction.direction.confidence + momentumDelta * 0.2 - (volatilityMultiplier - 1) * 0.08, 0, 1);
    const action = resolveTradeSignal(adjustedPUp, adjustedConfidence);

    text(els.whatIfPUp, adjustedPUp.toFixed(2));
    setSignalPill(els.whatIfAction, action);
    text(els.whatIfConfidence, `${(adjustedConfidence - basePrediction.direction.confidence).toFixed(2)}`);
    if (els.whatIfAvailabilityNote) {
        els.whatIfAvailabilityNote.textContent = '';
    }
}

function setPredictionDependentControlsEnabled(enabled) {
    [
        els.sizerConfidence,
        els.sizerPUp,
        els.sizerEntry,
        els.sizerQ10,
        els.sizerQ50,
        els.sizerQ90,
        els.applyToLiveBtn,
        els.momentumDelta,
        els.volatilityMultiplier
    ].forEach((element) => {
        if (!element) return;
        element.disabled = !enabled;
    });
}

function buildUniverseRows() {
    const liveRows = Object.values(state.prices).filter((row) => Number.isFinite(row?.price));
    state.universe = liveRows.map((live) => {
        const symbol = live.symbol;
        const packet = state.symbolPredictions[symbol] || (symbol === state.selectedSymbol ? state.prediction : null);
        const pUp = Number.isFinite(packet?.direction?.pUp) ? packet.direction.pUp : 0.5;
        const confidence = Number.isFinite(packet?.direction?.confidence) ? packet.direction.confidence : 0.5;
        const signal = packet?.signal?.action || packet?.direction?.signal || resolveTradeSignal(pUp, confidence);
        return {
            symbol,
            price: live.price,
            change: live.change,
            volume: live.volume,
            pUp,
            signal,
            status: state.dataMode === 'Live Feed' ? 'Live' : state.dataMode === 'Stale Feed' ? 'Stale' : 'Unavailable',
            detail: {
                summary: packet?.explanation?.summary || 'Live explanation unavailable.',
                topFeatures: packet?.explanation?.topFeatures || [],
                reasonCodes: packet?.explanation?.reasonCodes || []
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

    if (visibleRows.length === 0) {
        els.cryptoTableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; color: var(--text-secondary); padding: 1rem;">
                    No live quote rows available.
                </td>
            </tr>
        `;
        if (els.loadMoreBtn) {
            els.loadMoreBtn.style.display = 'none';
        }
        updateSortIndicators();
        return;
    }

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
                <td><span class="status-badge ${signalBadge}">${displaySignalLabel(row.signal)}</span></td>
                <td>${formatLargeMoney(row.volume)}</td>
                <td><span class="status-badge ${statusBadge}">${row.status.toUpperCase()}</span></td>
            </tr>
        `;

        if (!expanded) return base;

        const featureText = row.detail.topFeatures.slice(0, 3).map((item) => {
            const shap = asNumber(item.shap_value, 0).toFixed(3);
            return `<li>${escapeHtml(item.feature)} (${shap})</li>`;
        }).join('') || '<li>No live feature data.</li>';

        const reasonText = row.detail.reasonCodes.map((code) => {
            return `<li>${escapeHtml(REASON_CODE_TEXT[code] || code)}</li>`;
        }).join('') || '<li>No live reason code data.</li>';

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
    if (!bucket || !Array.isArray(bucket.values) || bucket.values.length === 0) {
        state.priceChart.data.labels = [];
        state.priceChart.data.datasets.forEach((dataset) => {
            dataset.data = [];
        });
        state.priceChart.update('none');
        return;
    }

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

function renderChartSourceNote() {
    if (!els.chartSourceNote) return;
    const bucket = state.chartSeries[state.selectedSymbol]?.[state.timeframe];
    if (!bucket || bucket.values.length === 0) {
        els.chartSourceNote.textContent = 'Live history unavailable. Waiting for Binance US candles.';
        return;
    }

    const freshness = bucket.stale ? 'Stale history cache.' : 'Live history.';
    els.chartSourceNote.textContent = `${freshness} Actual: Binance US candles | Projection: live prediction q10/q50/q90.`;
}

function buildProjection(values) {
    const packet = state.prediction;
    if (!packet) {
        return { labels: [], predicted: [], low: [], high: [] };
    }
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
    const label = `T${state.tickCount + 1}`;
    state.comparisonLabels.push(label);
    if (state.comparisonLabels.length > COMPARISON_HISTORY_LIMIT) {
        state.comparisonLabels.shift();
    }

    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach((symbol) => {
        const packet = state.symbolPredictions[symbol] || (symbol === state.selectedSymbol ? state.prediction : null);
        const pUpRaw = asNumber(packet?.direction?.pUp, null);
        const pUpValue = Number.isFinite(pUpRaw) ? clamp(pUpRaw, 0, 1) * 100 : null;
        state.comparisonHistory[symbol].push(Number.isFinite(pUpValue) ? Number(pUpValue.toFixed(2)) : null);
        if (state.comparisonHistory[symbol].length > COMPARISON_HISTORY_LIMIT) {
            state.comparisonHistory[symbol].shift();
        }
    });
}

function renderVolatilityStrip() {
    if (!els.volatilityStrip) return;

    const bucket = state.chartSeries[state.selectedSymbol]?.[state.timeframe];
    if (!bucket || bucket.values.length < 8) {
        els.volatilityStrip.innerHTML = '';
        text(els.regimeSummary, 'Regime: unavailable (insufficient live points).');
        return;
    }

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

function getChartHistoryConfig(timeframe) {
    if (timeframe === '1h') {
        return { range: '1h', reseedMs: CHART_RESEED_INTERVAL_MS['1h'], windowMs: CHART_RANGE_WINDOW_MS['1h'] };
    }
    if (timeframe === '24h') {
        return { range: '24h', reseedMs: CHART_RESEED_INTERVAL_MS['24h'], windowMs: CHART_RANGE_WINDOW_MS['24h'] };
    }
    return { range: '7d', reseedMs: CHART_RESEED_INTERVAL_MS['7d'], windowMs: CHART_RANGE_WINDOW_MS['7d'] };
}

function createEmptyChartBucket() {
    return {
        labels: [],
        values: [],
        timestamps: [],
        stale: false,
        lastSeedAt: 0,
        lastAppendAt: 0
    };
}

function ensureSymbolChartSeries(symbol) {
    if (!symbol) return null;
    if (!state.chartSeries[symbol]) {
        state.chartSeries[symbol] = {
            '1h': createEmptyChartBucket(),
            '24h': createEmptyChartBucket(),
            '7d': createEmptyChartBucket()
        };
    }
    return state.chartSeries[symbol];
}

function formatChartLabelFromTs(timestamp, timeframe) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '--';

    if (timeframe === '1h') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    if (timeframe === '24h') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function pruneChartBucket(bucket, timeframe) {
    if (!bucket || !Array.isArray(bucket.timestamps)) return;
    const config = getChartHistoryConfig(timeframe);
    const now = Date.now();
    const threshold = now - config.windowMs;
    while (bucket.timestamps.length > 1 && bucket.timestamps[0] < threshold) {
        bucket.timestamps.shift();
        bucket.labels.shift();
        bucket.values.shift();
    }
}

async function loadChartHistory(symbol, timeframe, force = false) {
    const canonical = toCanonicalSymbol(symbol);
    if (!canonical || !api.getCryptoHistory) return false;

    const config = getChartHistoryConfig(timeframe);
    const seriesGroup = ensureSymbolChartSeries(canonical);
    const bucket = seriesGroup?.[timeframe];
    if (!bucket) return false;

    const now = Date.now();
    if (!force && bucket.lastSeedAt > 0 && now - bucket.lastSeedAt < config.reseedMs) {
        return true;
    }

    try {
        const payload = await api.getCryptoHistory(canonical, { range: config.range });
        const rawSeries = Array.isArray(payload?.series) ? payload.series : [];
        const points = rawSeries
            .map((point) => {
                const ts = new Date(point.ts).getTime();
                const price = asNumber(point.close);
                if (!Number.isFinite(ts) || !Number.isFinite(price)) return null;
                return { ts, price };
            })
            .filter((point) => point !== null)
            .sort((a, b) => a.ts - b.ts);

        if (!points.length) {
            bucket.lastSeedAt = now;
            bucket.stale = true;
            return false;
        }

        bucket.timestamps = points.map((point) => point.ts);
        bucket.values = points.map((point) => point.price);
        bucket.labels = points.map((point) => formatChartLabelFromTs(point.ts, timeframe));
        bucket.lastSeedAt = now;
        bucket.stale = Boolean(payload?.meta?.stale);
        pruneChartBucket(bucket, timeframe);
        return true;
    } catch (error) {
        bucket.lastSeedAt = now;
        bucket.stale = true;
        return false;
    }
}

async function ensureSelectedChartHistory(force = false) {
    const symbol = state.selectedSymbol;
    if (!symbol) return;
    ensureSymbolChartSeries(symbol);
    const bucket = state.chartSeries[symbol]?.[state.timeframe];
    if (!bucket) return;

    const config = getChartHistoryConfig(state.timeframe);
    const shouldSeed = force || bucket.values.length === 0 || (Date.now() - bucket.lastSeedAt >= config.reseedMs);
    if (shouldSeed) {
        await loadChartHistory(symbol, state.timeframe, true);
    }
}

function pushLatestPriceToSeries() {
    const symbol = state.selectedSymbol;
    const latest = currentPrice(symbol);
    const seriesGroup = ensureSymbolChartSeries(symbol);
    const bucket = seriesGroup?.[state.timeframe];
    if (!Number.isFinite(latest) || !bucket) return;

    const now = Date.now();
    if (bucket.timestamps.length && now - bucket.timestamps[bucket.timestamps.length - 1] < 5000) {
        return;
    }

    bucket.timestamps.push(now);
    bucket.labels.push(formatChartLabelFromTs(now, state.timeframe));
    bucket.values.push(latest);
    bucket.lastAppendAt = now;
    pruneChartBucket(bucket, state.timeframe);
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
    element.textContent = displaySignalLabel(normalized);
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
    return 'status-unavailable';
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

function displaySignalLabel(signal) {
    const normalized = String(signal || 'FLAT').toUpperCase();
    return normalized === 'FLAT' ? 'NO TRADE' : normalized;
}

function formatSignalFilterLabel(signal) {
    const normalized = String(signal || 'ALL').toUpperCase();
    return `Signal: ${normalized === 'ALL' ? 'ALL' : displaySignalLabel(normalized)}`;
}

function isActionableSignal(signal) {
    const normalized = String(signal || '').toUpperCase();
    return normalized === 'LONG' || normalized === 'SHORT';
}

function resolveTradeSignal(pUp, confidence = 1) {
    const normalizedPUp = clamp(asNumber(pUp, 0.5), 0, 1);
    const normalizedConfidence = clamp(asNumber(confidence, 0), 0, 1);
    if (normalizedConfidence >= MIN_ACTIONABLE_CONFIDENCE && normalizedPUp >= LONG_SIGNAL_THRESHOLD) {
        return 'LONG';
    }
    if (normalizedConfidence >= MIN_ACTIONABLE_CONFIDENCE && normalizedPUp <= SHORT_SIGNAL_THRESHOLD) {
        return 'SHORT';
    }
    return 'FLAT';
}

function inferSignal(pUp) {
    return resolveTradeSignal(pUp, 1);
}

function formatNullableCurrency(value) {
    return Number.isFinite(value) ? utils.formatCurrency(value) : '--';
}

function formatNullableRatio(value) {
    return Number.isFinite(value) ? Number(value).toFixed(2) : '--';
}

function formatNullableProbability(value) {
    return Number.isFinite(value) ? normalizeProbability(value).toFixed(2) : '--';
}

function formatCurrentEdge(pUp, confidence) {
    const normalizedPUp = clamp(asNumber(pUp, 0.5), 0, 1);
    const normalizedConfidence = clamp(asNumber(confidence, 0), 0, 1);
    const confidenceGap = MIN_ACTIONABLE_CONFIDENCE - normalizedConfidence;
    if ((normalizedPUp >= LONG_SIGNAL_THRESHOLD || normalizedPUp <= SHORT_SIGNAL_THRESHOLD) && confidenceGap > 0) {
        return `Conf gate -${confidenceGap.toFixed(2)}`;
    }

    const leaningLong = normalizedPUp >= 0.5;
    const trigger = leaningLong ? LONG_SIGNAL_THRESHOLD : SHORT_SIGNAL_THRESHOLD;
    const gap = Math.abs(trigger - normalizedPUp);
    return `${gap.toFixed(2)} from ${leaningLong ? 'LONG' : 'SHORT'}`;
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

function nullableNumber(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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
