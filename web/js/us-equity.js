// ========================================
// StockandCrypto - US Equity Page Logic
// ========================================

const US_FAST_POLL_INTERVAL_MS = 5000;
const US_SLOW_POLL_INTERVAL_MS = 30000;
const US_INDEX_HISTORY_RANGE = '2d';
const US_INDEX_HISTORY_INTERVAL = '5m';
const US_ET_TIMEZONE = 'America/New_York';
const SESSION_REFRESH_COOLDOWN_MS = 60000;
const DEFAULT_SESSION_LABEL = 'Regular Session (09:30-16:00 ET)';
const MAIN_CHART_TIMEFRAME_TO_SESSIONS = {
    '1d': 1,
    '5d': 5,
    '1m': 22
};
const MAX_MAIN_POINTS_BY_TIMEFRAME = {
    '1d': 180,
    '5d': 540,
    '1m': 2500
};

const state = {
    page: 1,
    pageSize: 50,
    sort: 'pUp',
    direction: 'desc',
    search: '',
    sector: 'all',
    timeframe: '5d',
    axisMode: 'normalized',
    predictionIndexSymbol: '^SPX',
    tickCount: 0,
    lastUpdated: null,
    mode: 'loading',
    fastLoading: false,
    slowLoading: false,
    indices: null,
    prediction: null,
    marketSession: null,
    sectors: new Set(['all']),
    universe: {
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        rows: []
    },
    chart: null,
    chartLabels: [],
    chartSeries: {
        actual: [],
        predictedOpen: [],
        predictedClose: []
    },
    indexSeries: {
        dow: [],
        nasdaq100: [],
        sp500: []
    },
    lastQuoteStampByIndex: {
        dow: '--',
        nasdaq100: '--',
        sp500: '--'
    },
    lastQuoteKeyByIndex: {
        dow: '',
        nasdaq100: '',
        sp500: ''
    },
    historySeedInfo: null,
    historySessionStartMs: null,
    historySessionEndMs: null,
    historySessionLabel: DEFAULT_SESSION_LABEL,
    lastHistoryReseedAttemptAt: 0,
    mainChartSessionStartMs: null,
    mainChartSessionEndMs: null,
    mainChartRangeLabel: 'Range: Last 5 regular sessions (09:30-16:00 ET)',
    lastMainChartQuoteKey: '',
    mainChartSeedRequestId: 0,
    sparklineCharts: {
        dowCard: null,
        ndxCard: null,
        spxCard: null,
        dowMini: null,
        ndxMini: null,
        spxMini: null
    },
    fastTickTimer: null,
    slowTableTimer: null,
    countdownTimer: null,
    localCountdownSec: 0
};

const els = {};

const phaseToneToBadge = {
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    info: 'info',
    muted: 'muted'
};

document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    renderMainChartRangeLabel();
    bindEvents();
    initializeMainChart();
    initializeSparklineCharts();

    await seedIndexHistory();
    await refreshIndicesFast(true);
    await seedMainChartByTimeframe(state.timeframe);
    await refreshFullData(true);

    startFastTimer();
    startSlowTimer();
    startCountdownTimer();
});

function cacheElements() {
    const byId = (id) => document.getElementById(id);
    Object.assign(els, {
        feedModeBadge: byId('feedModeBadge'),
        feedTickCount: byId('feedTickCount'),
        feedLastUpdate: byId('feedLastUpdate'),
        feedMessage: byId('feedMessage'),
        sourceDelayNote: byId('sourceDelayNote'),
        disclaimerText: byId('disclaimerText'),
        sessionPhaseValue: byId('sessionPhaseValue'),
        sessionTimezoneValue: byId('sessionTimezoneValue'),
        nextPhaseBadge: byId('nextPhaseBadge'),
        dowIndexValue: byId('dowIndexValue'),
        dowIndexChange: byId('dowIndexChange'),
        dowIndexStatus: byId('dowIndexStatus'),
        ndxIndexValue: byId('ndxIndexValue'),
        ndxIndexChange: byId('ndxIndexChange'),
        ndxIndexStatus: byId('ndxIndexStatus'),
        spxIndexValue: byId('spxIndexValue'),
        spxIndexChange: byId('spxIndexChange'),
        spxIndexStatus: byId('spxIndexStatus'),
        dowQuoteTime: byId('dowQuoteTime'),
        ndxQuoteTime: byId('ndxQuoteTime'),
        spxQuoteTime: byId('spxQuoteTime'),
        dowOpenClose: byId('dowOpenClose'),
        ndxOpenClose: byId('ndxOpenClose'),
        spxOpenClose: byId('spxOpenClose'),
        refreshNowBtn: byId('refreshNowBtn'),
        indexSelector: byId('indexSelector'),
        indexChart: byId('indexChart'),
        pUpValue: byId('pUpValue'),
        pDownValue: byId('pDownValue'),
        confidenceValue: byId('confidenceValue'),
        signalBadge: byId('signalBadge'),
        actionValue: byId('actionValue'),
        positionSizeValue: byId('positionSizeValue'),
        shortAllowedValue: byId('shortAllowedValue'),
        leverageValue: byId('leverageValue'),
        w0Bar: byId('w0Bar'),
        w1Bar: byId('w1Bar'),
        w2Bar: byId('w2Bar'),
        w3Bar: byId('w3Bar'),
        w0Text: byId('w0Text'),
        w1Text: byId('w1Text'),
        w2Text: byId('w2Text'),
        w3Text: byId('w3Text'),
        q10Value: byId('q10Value'),
        q50Value: byId('q50Value'),
        q90Value: byId('q90Value'),
        intervalWidthValue: byId('intervalWidthValue'),
        searchInput: byId('searchInput'),
        sectorSelect: byId('sectorSelect'),
        pageSizeSelect: byId('pageSizeSelect'),
        sp500TableBody: byId('sp500TableBody'),
        prevPageBtn: byId('prevPageBtn'),
        nextPageBtn: byId('nextPageBtn'),
        pageInfo: byId('pageInfo'),
        dowSparkline: byId('dowSparkline'),
        ndxSparkline: byId('ndxSparkline'),
        spxSparkline: byId('spxSparkline'),
        dowMiniTrend: byId('dowMiniTrend'),
        ndxMiniTrend: byId('ndxMiniTrend'),
        spxMiniTrend: byId('spxMiniTrend'),
        dowMiniLabel: byId('dowMiniLabel'),
        ndxMiniLabel: byId('ndxMiniLabel'),
        spxMiniLabel: byId('spxMiniLabel'),
        dowMiniOpenClose: byId('dowMiniOpenClose'),
        ndxMiniOpenClose: byId('ndxMiniOpenClose'),
        spxMiniOpenClose: byId('spxMiniOpenClose'),
        mainChartRangeLabel: byId('mainChartRangeLabel')
    });
}

function bindEvents() {
    const debouncedSearch = utils.debounce(() => {
        state.page = 1;
        state.search = (els.searchInput?.value || '').trim();
        refreshFullData();
    }, 300);

    if (els.searchInput) {
        els.searchInput.addEventListener('input', debouncedSearch);
    }

    if (els.sectorSelect) {
        els.sectorSelect.addEventListener('change', () => {
            state.page = 1;
            state.sector = els.sectorSelect.value || 'all';
            refreshFullData();
        });
    }

    if (els.pageSizeSelect) {
        els.pageSizeSelect.addEventListener('change', () => {
            state.page = 1;
            state.pageSize = Number(els.pageSizeSelect.value || 50);
            refreshFullData();
        });
    }

    if (els.prevPageBtn) {
        els.prevPageBtn.addEventListener('click', () => {
            if (state.page > 1) {
                state.page -= 1;
                refreshFullData();
            }
        });
    }

    if (els.nextPageBtn) {
        els.nextPageBtn.addEventListener('click', () => {
            if (state.page < (state.universe.totalPages || 1)) {
                state.page += 1;
                refreshFullData();
            }
        });
    }

    if (els.indexSelector) {
        els.indexSelector.addEventListener('change', async () => {
            state.predictionIndexSymbol = els.indexSelector.value || '^SPX';
            await loadIndexPrediction();
            renderPrediction();
        });
    }

    if (els.refreshNowBtn) {
        els.refreshNowBtn.addEventListener('click', async () => {
            await refreshIndicesFast(true);
            await seedMainChartByTimeframe(state.timeframe, true);
            await refreshFullData(true);
        });
    }

    document.querySelectorAll('[data-sort]').forEach((th) => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            if (!key) return;
            if (state.sort === key) {
                state.direction = state.direction === 'asc' ? 'desc' : 'asc';
            } else {
                state.sort = key;
                state.direction = ['symbol', 'name', 'sector'].includes(key) ? 'asc' : 'desc';
            }
            state.page = 1;
            refreshFullData();
        });
    });

    document.querySelectorAll('[data-timeframe]').forEach((button) => {
        button.addEventListener('click', async () => {
            const timeframe = button.getAttribute('data-timeframe');
            if (!timeframe) return;
            state.timeframe = timeframe;
            document.querySelectorAll('[data-timeframe]').forEach((chip) => chip.classList.toggle('active', chip === button));
            await seedMainChartByTimeframe(state.timeframe, true);
        });
    });

    document.querySelectorAll('[data-axis-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            const mode = button.getAttribute('data-axis-mode');
            if (!mode) return;
            state.axisMode = mode;
            document.querySelectorAll('[data-axis-mode]').forEach((chip) => chip.classList.toggle('active', chip === button));
            updateAllSparklines();
        });
    });
}

function initializeMainChart() {
    if (!els.indexChart || !window.Chart) return;
    const ctx = els.indexChart.getContext('2d');
    state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Actual',
                    data: [],
                    borderColor: '#00E5FF',
                    backgroundColor: 'rgba(0,229,255,0.12)',
                    borderWidth: 2,
                    tension: 0.25,
                    pointRadius: 0,
                    fill: true
                },
                {
                    label: 'Predicted Open',
                    data: [],
                    borderColor: 'rgba(245,158,11,0.85)',
                    borderDash: [4, 5],
                    pointRadius: 2,
                    pointHoverRadius: 3,
                    fill: false
                },
                {
                    label: 'Predicted Close',
                    data: [],
                    borderColor: 'rgba(139,92,246,0.85)',
                    borderDash: [4, 5],
                    pointRadius: 2,
                    pointHoverRadius: 3,
                    fill: false
                }
            ]
        },
        options: {
            maintainAspectRatio: false,
            animation: { duration: 250 },
            scales: {
                x: { ticks: { color: '#94A3B8', maxTicksLimit: 8 }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(148,163,184,0.08)' } }
            },
            plugins: {
                legend: { labels: { color: '#F8FAFC' } }
            }
        }
    });
}

function createSparklineChart(canvasEl) {
    if (!canvasEl || !window.Chart) return null;
    return new Chart(canvasEl.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#00E5FF',
                borderWidth: 1.8,
                pointRadius: 0,
                tension: 0.22,
                fill: false
            }]
        },
        options: {
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            },
            scales: {
                x: { display: false },
                y: { display: false }
            }
        }
    });
}

function initializeSparklineCharts() {
    state.sparklineCharts.dowCard = createSparklineChart(els.dowSparkline);
    state.sparklineCharts.ndxCard = createSparklineChart(els.ndxSparkline);
    state.sparklineCharts.spxCard = createSparklineChart(els.spxSparkline);
    state.sparklineCharts.dowMini = createSparklineChart(els.dowMiniTrend);
    state.sparklineCharts.ndxMini = createSparklineChart(els.ndxMiniTrend);
    state.sparklineCharts.spxMini = createSparklineChart(els.spxMiniTrend);
}

function startFastTimer() {
    if (state.fastTickTimer) clearInterval(state.fastTickTimer);
    state.fastTickTimer = setInterval(() => refreshIndicesFast(), US_FAST_POLL_INTERVAL_MS);
}

function startSlowTimer() {
    if (state.slowTableTimer) clearInterval(state.slowTableTimer);
    state.slowTableTimer = setInterval(() => refreshFullData(), US_SLOW_POLL_INTERVAL_MS);
}

function startCountdownTimer() {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(() => {
        if (state.localCountdownSec > 0) state.localCountdownSec -= 1;
        renderSession();
    }, 1000);
}

async function seedIndexHistory(silent = false) {
    try {
        const payload = await api.getUSEquityIndicesHistory({
            range: US_INDEX_HISTORY_RANGE,
            interval: US_INDEX_HISTORY_INTERVAL
        });
        applyHistorySessionMetadata(payload?.selectedSession);
        const seeded = hydrateIndexSeriesFromHistory(payload?.series);
        state.historySeedInfo = payload?.selectedSession || null;
        if (!state.marketSession && payload?.marketSession) {
            state.marketSession = payload.marketSession;
        }
        if (seeded > 0) {
            updateAllSparklines();
            return true;
        }
        return false;
    } catch (error) {
        if (!silent && window.showToast?.warning) {
            window.showToast.warning('Unable to preload intraday history. Live sampling will continue.');
        }
        return false;
    }
}

function sessionsFromTimeframe(timeframe) {
    return MAIN_CHART_TIMEFRAME_TO_SESSIONS[timeframe] || 5;
}

async function seedMainChartByTimeframe(timeframe, silent = false) {
    if (!state.chart) return false;
    const requestId = state.mainChartSeedRequestId + 1;
    state.mainChartSeedRequestId = requestId;
    const sessions = sessionsFromTimeframe(timeframe);
    try {
        const payload = await api.getUSEquityIndicesHistory({
            mode: 'regular_sessions',
            sessions,
            interval: US_INDEX_HISTORY_INTERVAL
        });
        if (requestId !== state.mainChartSeedRequestId) return false;
        const raw = Array.isArray(payload?.series?.sp500) ? payload.series.sp500 : [];
        const points = raw
            .map((point) => {
                const ts = Date.parse(point?.ts);
                const price = Number(point?.price);
                if (!Number.isFinite(ts) || !Number.isFinite(price)) return null;
                return { ts, price };
            })
            .filter(Boolean)
            .sort((a, b) => a.ts - b.ts);

        const startMs = Date.parse(payload?.selectedSession?.startEt || '');
        const endMs = Date.parse(payload?.selectedSession?.endEt || '');
        state.mainChartSessionStartMs = Number.isFinite(startMs) ? startMs : null;
        state.mainChartSessionEndMs = Number.isFinite(endMs) ? endMs : null;
        state.mainChartRangeLabel = resolveMainChartRangeLabel(payload?.selectedSession, sessions);
        renderMainChartRangeLabel();
        replaceMainChartSeries(points);
        updateMainChartXAxisDensity(points.length);
        if (state.prediction?.prediction?.magnitude) {
            updateMainChartOverlays(state.prediction.prediction.magnitude);
        }
        state.lastMainChartQuoteKey = '';
        return points.length > 0;
    } catch (error) {
        if (!silent && window.showToast?.warning) {
            window.showToast.warning('Failed to load main chart history.');
        }
        return false;
    }
}

function resolveMainChartRangeLabel(selectedSession, sessions) {
    if (sessions > 1) {
        return `Range: Last ${sessions} regular sessions (09:30-16:00 ET)`;
    }
    const type = String(selectedSession?.type || '').toUpperCase();
    if (type === 'LAST_REGULAR') return 'Range: Last regular session (09:30-16:00 ET)';
    return 'Range: Today regular session (09:30-16:00 ET)';
}

function renderMainChartRangeLabel() {
    text(els.mainChartRangeLabel, state.mainChartRangeLabel);
}

function replaceMainChartSeries(points) {
    const safePoints = Array.isArray(points) ? points : [];
    state.chartLabels = safePoints.map((point) => formatMainChartLabel(point.ts));
    state.chartSeries.actual = safePoints.map((point) => Number(point.price.toFixed(2)));
    state.chartSeries.predictedOpen = safePoints.map(() => null);
    state.chartSeries.predictedClose = safePoints.map(() => null);
    syncMainChartDatasets();
}

function formatMainChartLabel(timestampMs) {
    const includeDate = state.timeframe !== '1d';
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: US_ET_TIMEZONE,
        month: includeDate ? '2-digit' : undefined,
        day: includeDate ? '2-digit' : undefined,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(new Date(timestampMs));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (includeDate) return `${map.month}/${map.day} ${map.hour}:${map.minute}`;
    return `${map.hour}:${map.minute}`;
}

function updateMainChartXAxisDensity(pointCount) {
    if (!state.chart) return;
    let ticks = 8;
    if (state.timeframe === '1d') ticks = 8;
    else if (state.timeframe === '5d') ticks = pointCount > 420 ? 8 : 10;
    else if (state.timeframe === '1m') ticks = pointCount > 1200 ? 8 : 10;
    state.chart.options.scales.x.ticks.maxTicksLimit = ticks;
    state.chart.update('none');
}

async function refreshIndicesFast(manual = false) {
    if (state.fastLoading) return;
    state.fastLoading = true;
    try {
        const payload = await api.getUSEquityIndices();
        state.indices = payload.indices || state.indices;
        state.marketSession = payload.marketSession || state.marketSession;
        state.localCountdownSec = Math.max(0, Number(payload.marketSession?.countdownSec || state.localCountdownSec));
        state.lastUpdated = payload.meta?.timestamp || new Date().toISOString();
        state.mode = payload.meta?.stale ? 'stale' : 'live';
        state.tickCount += 1;

        const nowMs = Date.parse(state.lastUpdated) || Date.now();
        if (shouldReseedHistory(nowMs)) {
            const cooldownElapsed = Date.now() - state.lastHistoryReseedAttemptAt > SESSION_REFRESH_COOLDOWN_MS;
            if (cooldownElapsed) {
                state.lastHistoryReseedAttemptAt = Date.now();
                await seedIndexHistory(true);
                await seedMainChartByTimeframe(state.timeframe, true);
            }
        }

        text(els.sourceDelayNote, payload.meta?.delayNote || 'US Level-1 quote feed; normal delay depends on venue');
        text(els.disclaimerText, payload.meta?.disclaimer || 'Not for actual trading - simulation only');

        appendIndexSeriesPoints(payload.indices, state.lastUpdated, true);
        if (Number.isFinite(payload.indices?.sp500?.price) && shouldAppendMainChartPoint(payload.indices?.sp500, nowMs)) {
            pushMainChartPoint(payload.indices.sp500.price, state.lastUpdated);
        }

        renderModeBanner();
        renderSession();
        renderIndices();
        updateAllSparklines();
    } catch (error) {
        if (!state.indices) {
            state.mode = 'error';
            renderModeBanner(error.message || 'US indices request failed.');
        }
        if (manual && window.showToast?.error) {
            window.showToast.error('Failed to refresh US indices.');
        }
    } finally {
        state.fastLoading = false;
    }
}

async function refreshFullData(manual = false) {
    if (state.slowLoading) return;
    state.slowLoading = true;
    try {
        const payload = await api.getUSEquityPrices({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sort,
            direction: state.direction,
            search: state.search,
            sector: state.sector
        });

        if (!state.indices) state.indices = payload.indices || null;
        state.universe = payload.universe || state.universe;
        if (!state.marketSession) state.marketSession = payload.marketSession || null;
        if (!state.lastUpdated) state.lastUpdated = payload.meta?.timestamp || new Date().toISOString();
        updateSectorOptions(state.universe.rows || []);

        await loadIndexPrediction();
        renderPrediction();
        renderTable();
        renderSortIndicators();

        if (manual && window.showToast?.success) {
            window.showToast.success('US equity snapshot refreshed.');
        }
    } catch (error) {
        renderTableError(error.message || 'US data request failed.');
        if (manual && window.showToast?.error) {
            window.showToast.error('Failed to refresh US equity table/prediction.');
        }
    } finally {
        state.slowLoading = false;
    }
}

async function loadIndexPrediction() {
    try {
        state.prediction = await api.getUSEquityIndexPrediction(state.predictionIndexSymbol);
    } catch (error) {
        state.prediction = null;
    }
}

function renderModeBanner(message) {
    let label = 'LIVE FEED';
    let badgeClass = 'status-badge success';
    let feedText = message || `Indices @ ${Math.round(US_FAST_POLL_INTERVAL_MS / 1000)}s, table @ ${Math.round(US_SLOW_POLL_INTERVAL_MS / 1000)}s.`;
    if (state.mode === 'stale') {
        label = 'STALE FEED';
        badgeClass = 'status-badge warning';
        feedText = message || 'Serving cached data because upstream refresh failed.';
    } else if (state.mode === 'error') {
        label = 'ERROR';
        badgeClass = 'status-badge danger';
        feedText = message || 'No data available from upstream.';
    }

    if (els.feedModeBadge) {
        els.feedModeBadge.className = badgeClass;
        els.feedModeBadge.textContent = label;
    }

    text(els.feedTickCount, String(state.tickCount));
    text(els.feedLastUpdate, state.lastUpdated ? utils.formatTimestamp(state.lastUpdated, 'time') : '--');
    text(els.feedMessage, feedText);
}

function renderSession() {
    if (!state.marketSession) return;
    const tone = phaseToneToBadge[state.marketSession.phaseTone] || 'info';
    const phaseLabel = state.marketSession.phaseLabel || state.marketSession.phaseCode || 'Closed';
    const nextLabel = state.marketSession.nextPhaseLabel || '--';
    const countdownText = formatCountdown(state.localCountdownSec);

    text(els.sessionPhaseValue, phaseLabel);
    text(els.sessionTimezoneValue, `${state.marketSession.timezoneLabel || 'New York Time (ET)'} | ${state.marketSession.beijingLabel || 'Beijing Time (CST, UTC+8)'}`);
    text(els.nextPhaseBadge, `Next Phase: ${nextLabel} in ${countdownText}`);
    if (els.nextPhaseBadge) {
        els.nextPhaseBadge.className = `status-badge ${tone}`;
    }
}

function renderIndices() {
    renderIndexCard('dow', state.indices?.dow, els.dowIndexValue, els.dowIndexChange, els.dowIndexStatus, els.dowQuoteTime, els.dowOpenClose);
    renderIndexCard('nasdaq100', state.indices?.nasdaq100, els.ndxIndexValue, els.ndxIndexChange, els.ndxIndexStatus, els.ndxQuoteTime, els.ndxOpenClose);
    renderIndexCard('sp500', state.indices?.sp500, els.spxIndexValue, els.spxIndexChange, els.spxIndexStatus, els.spxQuoteTime, els.spxOpenClose);
    renderMiniOpenCloseLines();
}

function renderIndexCard(seriesKey, data, valueEl, changeEl, statusEl, quoteEl, openCloseEl) {
    if (!data) return;
    text(valueEl, data.price === null ? '--' : utils.formatNumber(data.price, 2));
    if (changeEl) {
        const change = data.changePct;
        text(changeEl, change === null ? '--' : formatSignedPercent(change));
        changeEl.className = `metric-change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    if (statusEl) {
        statusEl.textContent = state.mode === 'live' ? 'LIVE' : state.mode === 'stale' ? 'STALE' : 'ERROR';
        statusEl.className = `status-badge ${state.mode === 'live' ? 'success' : state.mode === 'stale' ? 'warning' : 'danger'}`;
    }

    const quoteText = formatQuoteLabel(data);
    state.lastQuoteStampByIndex[seriesKey] = quoteText;
    text(quoteEl, quoteText);
    text(openCloseEl, formatOpenCloseText(getOpenClosePacket(seriesKey, data)));
}

function formatQuoteLabel(indexData) {
    const time = String(indexData?.quoteTime || '--').trim();
    const tz = String(indexData?.quoteTimezone || 'ET').trim();
    return `Quote: ${time} ${tz}`;
}

function getOpenClosePacket(seriesKey, indexData) {
    const points = state.indexSeries[seriesKey] || [];
    const phaseCode = String(state.marketSession?.phaseCode || '').toUpperCase();
    const isFinalClose = phaseCode !== 'REGULAR';
    if (points.length) {
        return {
            open: Number(points[0].price.toFixed(2)),
            close: Number(points[points.length - 1].price.toFixed(2)),
            isFinalClose
        };
    }
    return {
        open: Number.isFinite(Number(indexData?.open)) ? Number(indexData.open) : null,
        close: Number.isFinite(Number(indexData?.price)) ? Number(indexData.price) : null,
        isFinalClose
    };
}

function formatOpenCloseText(packet) {
    if (!packet) return 'Open: -- | Close: --';
    const openText = Number.isFinite(packet.open) ? utils.formatNumber(packet.open, 2) : '--';
    const closeText = Number.isFinite(packet.close) ? utils.formatNumber(packet.close, 2) : '--';
    const suffix = packet.isFinalClose ? '' : ' (Provisional)';
    return `Open: ${openText} | Close: ${closeText}${suffix}`;
}

function renderMiniOpenCloseLines() {
    text(els.dowMiniOpenClose, formatOpenCloseText(getOpenClosePacket('dow', state.indices?.dow)));
    text(els.ndxMiniOpenClose, formatOpenCloseText(getOpenClosePacket('nasdaq100', state.indices?.nasdaq100)));
    text(els.spxMiniOpenClose, formatOpenCloseText(getOpenClosePacket('sp500', state.indices?.sp500)));
}

function renderPrediction() {
    const packet = state.prediction;
    if (!packet?.prediction) {
        text(els.pUpValue, '--');
        text(els.pDownValue, '--');
        text(els.confidenceValue, '--');
        text(els.signalBadge, '--');
        text(els.actionValue, '--');
        text(els.positionSizeValue, '--');
        text(els.shortAllowedValue, 'Yes');
        text(els.leverageValue, '2.00');
        return;
    }

    const direction = packet.prediction.direction || {};
    const window = packet.prediction.window || {};
    const magnitude = packet.prediction.magnitude || {};
    const policy = packet.policy || {};

    text(els.pUpValue, formatRate(direction.pUp));
    text(els.pDownValue, formatRate(direction.pDown));
    text(els.confidenceValue, formatRate(direction.confidence));

    if (els.signalBadge) {
        const signal = direction.signal || '--';
        const badge = signal.includes('LONG') ? 'success' : signal.includes('SHORT') ? 'danger' : 'warning';
        els.signalBadge.className = `status-badge ${badge}`;
        els.signalBadge.textContent = signal;
    }

    text(els.actionValue, policy.action || '--');
    text(els.positionSizeValue, Number.isFinite(policy.positionSize) ? `${policy.positionSize.toFixed(2)}x` : '--');
    text(els.shortAllowedValue, policy.shortAllowed === false ? 'No' : 'Yes');
    text(els.leverageValue, Number.isFinite(policy.leverage) ? policy.leverage.toFixed(2) : '2.00');

    renderWindow('w0', window.W0);
    renderWindow('w1', window.W1);
    renderWindow('w2', window.W2);
    renderWindow('w3', window.W3);

    text(els.q10Value, formatSignedRatioAsPercent(magnitude.q10));
    text(els.q50Value, formatSignedRatioAsPercent(magnitude.q50));
    text(els.q90Value, formatSignedRatioAsPercent(magnitude.q90));
    const width = Number(magnitude.q90 || 0) - Number(magnitude.q10 || 0);
    text(els.intervalWidthValue, formatSignedRatioAsPercent(width, false));

    updateMainChartOverlays(magnitude);
}

function renderWindow(prefix, value) {
    const bar = els[`${prefix}Bar`];
    const textEl = els[`${prefix}Text`];
    const rate = clamp(Number(value) || 0, 0, 1);
    if (bar) bar.style.width = `${(rate * 100).toFixed(1)}%`;
    if (textEl) textEl.textContent = `${(rate * 100).toFixed(1)}%`;
}

function renderTable() {
    if (!els.sp500TableBody) return;
    const rows = state.universe.rows || [];
    if (!rows.length) {
        els.sp500TableBody.innerHTML = '<tr><td colspan="10">No data available.</td></tr>';
    } else {
        els.sp500TableBody.innerHTML = rows.map((row) => {
            const changeClass = row.changePct >= 0 ? 'positive' : 'negative';
            const signalClass = row.prediction.signal.includes('LONG') ? 'success' : row.prediction.signal.includes('SHORT') ? 'danger' : 'warning';
            const statusClass = row.status === 'LIVE' ? 'us-status-live' : row.status === 'STALE' ? 'us-status-stale' : 'us-status-error';
            return `
                <tr>
                    <td><strong>${escapeHtml(row.symbol)}</strong></td>
                    <td>${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(row.sector || 'Other')}</td>
                    <td>${row.price === null ? '--' : utils.formatNumber(row.price, 2)}</td>
                    <td class="${changeClass}">${row.changePct === null ? '--' : formatSignedPercent(row.changePct)}</td>
                    <td>${formatRate(row.prediction.pUp)}</td>
                    <td>${formatRate(row.prediction.confidence)}</td>
                    <td>${row.volume === null ? '--' : utils.formatNumber(row.volume, 0)}</td>
                    <td><span class="status-badge ${signalClass}">${escapeHtml(row.prediction.signal || '--')}</span></td>
                    <td><span class="${statusClass}">${escapeHtml(row.status || '--')}</span></td>
                </tr>
            `;
        }).join('');
    }

    state.page = state.universe.page || state.page;
    const totalPages = state.universe.totalPages || 1;
    text(els.pageInfo, `Page ${state.page} / ${totalPages} | ${state.universe.total || 0} rows`);
    if (els.prevPageBtn) els.prevPageBtn.disabled = state.page <= 1;
    if (els.nextPageBtn) els.nextPageBtn.disabled = state.page >= totalPages;
}

function renderTableError(errorMessage) {
    if (!els.sp500TableBody) return;
    els.sp500TableBody.innerHTML = `<tr><td colspan="10">Error: ${escapeHtml(errorMessage)}</td></tr>`;
    text(els.pageInfo, 'Page -- / --');
}

function renderSortIndicators() {
    document.querySelectorAll('[data-sort]').forEach((th) => {
        const key = th.getAttribute('data-sort');
        const marker = document.getElementById(`sort-${key}`);
        th.classList.toggle('active', key === state.sort);
        if (marker) marker.textContent = key === state.sort ? (state.direction === 'asc' ? '^' : 'v') : '';
    });
}

function hydrateIndexSeriesFromHistory(series) {
    if (!series || typeof series !== 'object') return 0;
    let count = 0;
    ['dow', 'nasdaq100', 'sp500'].forEach((key) => {
        const raw = Array.isArray(series[key]) ? series[key] : [];
        const normalized = raw
            .map((point) => {
                const ts = Date.parse(point?.ts);
                const price = Number(point?.price);
                if (!Number.isFinite(ts) || !Number.isFinite(price)) return null;
                return { ts, price };
            })
            .filter(Boolean)
            .sort((a, b) => a.ts - b.ts);
        const sessionBounded = trimPointsToSessionWindow(normalized);
        state.indexSeries[key] = sessionBounded;
        count += sessionBounded.length;
    });
    return count;
}

function appendIndexSeriesPoints(indices, timestampIso, dedupeByQuoteStamp = false) {
    const nowMs = Date.parse(timestampIso) || Date.now();
    if (!shouldAppendRealtimePoint(nowMs)) return;
    appendSingleIndexPoint('dow', indices?.dow?.price, nowMs, buildQuoteStamp(indices?.dow), dedupeByQuoteStamp);
    appendSingleIndexPoint('nasdaq100', indices?.nasdaq100?.price, nowMs, buildQuoteStamp(indices?.nasdaq100), dedupeByQuoteStamp);
    appendSingleIndexPoint('sp500', indices?.sp500?.price, nowMs, buildQuoteStamp(indices?.sp500), dedupeByQuoteStamp);
}

function buildQuoteStamp(indexQuote) {
    const date = String(indexQuote?.quoteDate || '').trim();
    const time = String(indexQuote?.quoteTime || '').trim();
    const stamp = `${date} ${time}`.trim();
    return stamp || null;
}

function appendSingleIndexPoint(key, price, nowMs, quoteStamp, dedupeByQuoteStamp) {
    if (!Number.isFinite(price)) return;
    const arr = state.indexSeries[key];
    if (dedupeByQuoteStamp) {
        if (quoteStamp && state.lastQuoteKeyByIndex[key] === quoteStamp) return;
        if (!quoteStamp && arr.length) {
            const last = arr[arr.length - 1];
            if (last && Math.abs(last.price - Number(price)) < 0.000001) return;
        }
    }

    if (quoteStamp) {
        state.lastQuoteKeyByIndex[key] = quoteStamp;
    }
    arr.push({ ts: nowMs, price: Number(price) });
    const bounded = trimPointsToSessionWindow(arr);
    if (bounded.length > 2000) {
        bounded.splice(0, bounded.length - 2000);
    }
    state.indexSeries[key] = bounded;
}

function pushMainChartPoint(price, timestampIso) {
    if (!state.chart || !Number.isFinite(price)) return;
    const timestampMs = Date.parse(timestampIso) || Date.now();
    state.chartLabels.push(formatMainChartLabel(timestampMs));
    state.chartSeries.actual.push(Number(price.toFixed(2)));
    state.chartSeries.predictedOpen.push(null);
    state.chartSeries.predictedClose.push(null);
    trimMainChartSeries();
    syncMainChartDatasets();
}

function trimMainChartSeries() {
    const maxPoints = MAX_MAIN_POINTS_BY_TIMEFRAME[state.timeframe] || MAX_MAIN_POINTS_BY_TIMEFRAME['5d'];
    while (state.chartLabels.length > maxPoints) {
        state.chartLabels.shift();
        state.chartSeries.actual.shift();
        state.chartSeries.predictedOpen.shift();
        state.chartSeries.predictedClose.shift();
    }
}

function updateMainChartOverlays(magnitude) {
    if (!state.chart || !state.chartSeries.actual.length) return;
    const latestPrice = state.chartSeries.actual[state.chartSeries.actual.length - 1];
    const q10 = Number(magnitude?.q10 || 0);
    const q50 = Number(magnitude?.q50 || 0);
    const predictedOpen = Number((latestPrice * (1 + q10 * 0.35)).toFixed(2));
    const predictedClose = Number((latestPrice * (1 + q50)).toFixed(2));

    const idx = state.chartSeries.actual.length - 1;
    state.chartSeries.predictedOpen = state.chartSeries.actual.map(() => null);
    state.chartSeries.predictedClose = state.chartSeries.actual.map(() => null);
    state.chartSeries.predictedOpen[idx] = predictedOpen;
    state.chartSeries.predictedClose[idx] = predictedClose;
    syncMainChartDatasets();
}

function syncMainChartDatasets() {
    if (!state.chart) return;
    state.chart.data.labels = state.chartLabels;
    state.chart.data.datasets[0].data = state.chartSeries.actual;
    state.chart.data.datasets[1].data = state.chartSeries.predictedOpen;
    state.chart.data.datasets[2].data = state.chartSeries.predictedClose;
    state.chart.update('none');
}

function updateAllSparklines() {
    updateSparklinePair('dow', state.sparklineCharts.dowCard, state.sparklineCharts.dowMini);
    updateSparklinePair('nasdaq100', state.sparklineCharts.ndxCard, state.sparklineCharts.ndxMini);
    updateSparklinePair('sp500', state.sparklineCharts.spxCard, state.sparklineCharts.spxMini);
    renderMiniOpenCloseLines();
}

function updateSparklinePair(key, cardChart, miniChart) {
    const fullPoints = state.indexSeries[key] || [];
    const cardTransformed = transformSparklineSeries(fullPoints);
    const cardLabels = fullPoints.map((point) => utils.formatTimestamp(new Date(point.ts).toISOString(), 'time'));
    const miniTransformed = transformSparklineSeries(fullPoints);
    const miniLabels = fullPoints.map((point) => utils.formatTimestamp(new Date(point.ts).toISOString(), 'time'));
    const color = chooseSparklineColor(fullPoints);

    applySparklineData(cardChart, cardLabels, cardTransformed, color);
    applySparklineData(miniChart, miniLabels, miniTransformed, color);
}

function transformSparklineSeries(points) {
    if (!points.length) return [];
    if (state.axisMode === 'absolute') {
        return points.map((point) => Number(point.price.toFixed(4)));
    }
    const base = points[0].price;
    if (!Number.isFinite(base) || base === 0) {
        return points.map(() => 0);
    }
    return points.map((point) => Number((((point.price / base) - 1) * 100).toFixed(4)));
}

function chooseSparklineColor(points) {
    if (state.mode === 'stale') return 'rgba(245,158,11,0.95)';
    if (state.mode === 'error') return 'rgba(148,163,184,0.85)';
    if (!points.length) return 'rgba(0,229,255,0.9)';
    const first = points[0].price;
    const last = points[points.length - 1].price;
    if (last > first) return 'rgba(0,255,170,0.95)';
    if (last < first) return 'rgba(255,77,79,0.95)';
    return 'rgba(0,229,255,0.95)';
}

function applySparklineData(chart, labels, values, color) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].borderColor = color;
    chart.update('none');
}

function applyHistorySessionMetadata(selectedSession) {
    const startMs = Date.parse(selectedSession?.startEt || '');
    const endMs = Date.parse(selectedSession?.endEt || '');
    state.historySessionStartMs = Number.isFinite(startMs) ? startMs : null;
    state.historySessionEndMs = Number.isFinite(endMs) ? endMs : null;
    state.historySessionLabel = String(selectedSession?.label || buildHistorySessionLabel(selectedSession)).trim() || DEFAULT_SESSION_LABEL;
    updateMiniSessionLabels();
}

function buildHistorySessionLabel(selectedSession) {
    const isLast = String(selectedSession?.type || '') === 'LAST_REGULAR';
    return `${isLast ? 'Last Regular Session' : 'Regular Session'} (09:30-16:00 ET)`;
}

function updateMiniSessionLabels() {
    const label = state.historySessionLabel || DEFAULT_SESSION_LABEL;
    text(els.dowMiniLabel, label);
    text(els.ndxMiniLabel, label);
    text(els.spxMiniLabel, label);
}

function trimPointsToSessionWindow(points) {
    const arr = Array.isArray(points) ? points : [];
    if (!arr.length) return [];
    if (!Number.isFinite(state.historySessionStartMs) || !Number.isFinite(state.historySessionEndMs)) {
        return arr.slice();
    }
    const trimmed = arr.filter((point) => {
        const ts = Number(point?.ts);
        return Number.isFinite(ts) && ts >= state.historySessionStartMs && ts <= state.historySessionEndMs;
    });
    return trimmed;
}

function shouldAppendRealtimePoint(nowMs) {
    const phaseCode = String(state.marketSession?.phaseCode || '').toUpperCase();
    if (phaseCode !== 'REGULAR') return false;
    if (Number.isFinite(state.historySessionStartMs) && nowMs < state.historySessionStartMs) return false;
    if (Number.isFinite(state.historySessionEndMs) && nowMs > state.historySessionEndMs) return false;
    return true;
}

function shouldAppendMainChartPoint(indexQuote, nowMs) {
    const phaseCode = String(state.marketSession?.phaseCode || '').toUpperCase();
    if (phaseCode !== 'REGULAR') return false;
    if (Number.isFinite(state.mainChartSessionStartMs) && nowMs < state.mainChartSessionStartMs) return false;
    if (Number.isFinite(state.mainChartSessionEndMs) && nowMs > state.mainChartSessionEndMs) return false;
    const quoteKey = buildQuoteStamp(indexQuote);
    if (quoteKey && quoteKey === state.lastMainChartQuoteKey) return false;
    if (quoteKey) state.lastMainChartQuoteKey = quoteKey;
    return true;
}

function shouldReseedHistory(nowMs) {
    if (!Number.isFinite(nowMs)) return false;
    if (!Number.isFinite(state.historySessionStartMs) || !Number.isFinite(state.historySessionEndMs)) return true;
    const phaseCode = String(state.marketSession?.phaseCode || '').toUpperCase();
    if (phaseCode !== 'PREMARKET' && phaseCode !== 'REGULAR') return false;
    const currentEtDate = toEtDateKey(nowMs);
    const sessionEtDate = toEtDateKey(state.historySessionStartMs);
    return currentEtDate !== sessionEtDate;
}

function toEtDateKey(timestampMs) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: US_ET_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(new Date(timestampMs));
}

function updateSectorOptions(rows) {
    rows.forEach((row) => {
        if (row.sector) state.sectors.add(row.sector);
    });
    if (!els.sectorSelect) return;

    const options = ['all', ...Array.from(state.sectors).filter((sector) => sector !== 'all').sort((a, b) => a.localeCompare(b))];
    const current = state.sector;
    const html = options.map((sector) => {
        const label = sector === 'all' ? 'All Sectors' : sector;
        const selected = sector === current ? ' selected' : '';
        return `<option value="${escapeHtml(sector)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
    els.sectorSelect.innerHTML = html;
}

function formatRate(value) {
    if (!Number.isFinite(value)) return '--';
    return value.toFixed(2);
}

function formatSignedPercent(value) {
    if (!Number.isFinite(value)) return '--';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}

function formatSignedRatioAsPercent(value, forceSign = true) {
    if (!Number.isFinite(value)) return '--';
    const pct = value * 100;
    const sign = pct >= 0 && forceSign ? '+' : '';
    return `${sign}${pct.toFixed(2)}%`;
}

function formatCountdown(totalSec) {
    const sec = Math.max(0, Number(totalSec) || 0);
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function text(el, value) {
    if (el) el.textContent = value;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
