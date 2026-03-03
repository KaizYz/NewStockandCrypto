// ========================================
// StockandCrypto - US Equity Page Logic
// ========================================

const US_POLL_INTERVAL_MS = 10000;
const MAX_POINTS_BY_TIMEFRAME = {
    '1d': 36,
    '5d': 72,
    '1m': 140
};

const state = {
    page: 1,
    pageSize: 50,
    sort: 'pUp',
    direction: 'desc',
    search: '',
    sector: 'all',
    timeframe: '5d',
    predictionIndexSymbol: '^SPX',
    tickCount: 0,
    lastUpdated: null,
    mode: 'loading',
    loading: false,
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
    pollTimer: null,
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

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    bindEvents();
    initializeChart();
    refreshAll();
    startPolling();
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
        pageInfo: byId('pageInfo')
    });
}

function bindEvents() {
    const debouncedSearch = utils.debounce(() => {
        state.page = 1;
        state.search = (els.searchInput?.value || '').trim();
        refreshAll();
    }, 300);

    if (els.searchInput) {
        els.searchInput.addEventListener('input', debouncedSearch);
    }

    if (els.sectorSelect) {
        els.sectorSelect.addEventListener('change', () => {
            state.page = 1;
            state.sector = els.sectorSelect.value || 'all';
            refreshAll();
        });
    }

    if (els.pageSizeSelect) {
        els.pageSizeSelect.addEventListener('change', () => {
            state.page = 1;
            state.pageSize = Number(els.pageSizeSelect.value || 50);
            refreshAll();
        });
    }

    if (els.prevPageBtn) {
        els.prevPageBtn.addEventListener('click', () => {
            if (state.page > 1) {
                state.page -= 1;
                refreshAll();
            }
        });
    }

    if (els.nextPageBtn) {
        els.nextPageBtn.addEventListener('click', () => {
            if (state.page < (state.universe.totalPages || 1)) {
                state.page += 1;
                refreshAll();
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
        els.refreshNowBtn.addEventListener('click', () => refreshAll(true));
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
            refreshAll();
        });
    });

    document.querySelectorAll('[data-timeframe]').forEach((button) => {
        button.addEventListener('click', () => {
            const timeframe = button.getAttribute('data-timeframe');
            if (!timeframe) return;
            state.timeframe = timeframe;
            document.querySelectorAll('[data-timeframe]').forEach((chip) => chip.classList.toggle('active', chip === button));
            trimChartSeries();
            syncChartDatasets();
        });
    });
}

function initializeChart() {
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

function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => refreshAll(), US_POLL_INTERVAL_MS);
}

function startCountdownTimer() {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(() => {
        if (state.localCountdownSec > 0) state.localCountdownSec -= 1;
        renderSession();
    }, 1000);
}

async function refreshAll(manual = false) {
    if (state.loading) return;
    state.loading = true;
    try {
        const payload = await api.getUSEquityPrices({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sort,
            direction: state.direction,
            search: state.search,
            sector: state.sector
        });

        state.indices = payload.indices || null;
        state.universe = payload.universe || state.universe;
        state.marketSession = payload.marketSession || null;
        state.localCountdownSec = Math.max(0, Number(payload.marketSession?.countdownSec || 0));
        state.lastUpdated = payload.meta?.timestamp || new Date().toISOString();
        state.tickCount += 1;
        state.mode = payload.meta?.stale ? 'stale' : 'live';

        text(els.sourceDelayNote, payload.meta?.delayNote || 'US Level-1 quote feed; normal delay depends on venue');
        text(els.disclaimerText, payload.meta?.disclaimer || 'Not for actual trading - simulation only');

        if (state.indices?.sp500?.price !== null && state.indices?.sp500?.price !== undefined) {
            pushChartPoint(state.indices.sp500.price, state.lastUpdated);
        }

        updateSectorOptions(state.universe.rows || []);
        await loadIndexPrediction();
        renderAll();
    } catch (error) {
        state.mode = 'error';
        renderModeBanner(error.message || 'US data request failed.');
        renderTableError(error.message || 'US data request failed.');
        if (manual && window.showToast?.error) {
            window.showToast.error('Failed to refresh US equity data.');
        }
    } finally {
        state.loading = false;
    }
}

async function loadIndexPrediction() {
    try {
        state.prediction = await api.getUSEquityIndexPrediction(state.predictionIndexSymbol);
    } catch (error) {
        state.prediction = null;
    }
}

function renderAll() {
    renderModeBanner();
    renderSession();
    renderIndices();
    renderPrediction();
    renderTable();
    renderSortIndicators();
}

function renderModeBanner(message) {
    let label = 'LIVE FEED';
    let badgeClass = 'status-badge success';
    let feedText = message || 'Streaming via Stooq polling.';
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
    renderIndexCard(state.indices?.dow, els.dowIndexValue, els.dowIndexChange, els.dowIndexStatus);
    renderIndexCard(state.indices?.nasdaq100, els.ndxIndexValue, els.ndxIndexChange, els.ndxIndexStatus);
    renderIndexCard(state.indices?.sp500, els.spxIndexValue, els.spxIndexChange, els.spxIndexStatus);
}

function renderIndexCard(data, valueEl, changeEl, statusEl) {
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
    const width = (Number(magnitude.q90 || 0) - Number(magnitude.q10 || 0));
    text(els.intervalWidthValue, formatSignedRatioAsPercent(width, false));

    updateChartOverlays(magnitude);
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

function pushChartPoint(price, timestamp) {
    if (!state.chart || !Number.isFinite(price)) return;
    state.chartLabels.push(utils.formatTimestamp(timestamp, 'time'));
    state.chartSeries.actual.push(Number(price.toFixed(2)));
    state.chartSeries.predictedOpen.push(null);
    state.chartSeries.predictedClose.push(null);
    trimChartSeries();
    syncChartDatasets();
}

function trimChartSeries() {
    const maxPoints = MAX_POINTS_BY_TIMEFRAME[state.timeframe] || MAX_POINTS_BY_TIMEFRAME['5d'];
    while (state.chartLabels.length > maxPoints) {
        state.chartLabels.shift();
        state.chartSeries.actual.shift();
        state.chartSeries.predictedOpen.shift();
        state.chartSeries.predictedClose.shift();
    }
}

function updateChartOverlays(magnitude) {
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
    syncChartDatasets();
}

function syncChartDatasets() {
    if (!state.chart) return;
    state.chart.data.labels = state.chartLabels;
    state.chart.data.datasets[0].data = state.chartSeries.actual;
    state.chart.data.datasets[1].data = state.chartSeries.predictedOpen;
    state.chart.data.datasets[2].data = state.chartSeries.predictedClose;
    state.chart.update('none');
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
