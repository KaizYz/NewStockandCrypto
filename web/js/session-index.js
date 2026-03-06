const BJT_TIMEZONE = 'Asia/Shanghai';
const REFRESH_MS = 15000;
const LONG_TRIGGER = 0.55;
const MIN_CONFIDENCE = 0.45;
const POLICY_LIMIT_PCT = 0.10;
const ESTIMATED_FEE_PCT = 0.004;
const CN_INDEX_CONFIG = {
    SSE: {
        key: 'SSE',
        code: '000001.SH',
        historyKey: 'sse',
        quoteKey: 'sse',
        displayName: 'SSE Composite',
        shortLabel: 'SSE',
        policyLabel: 'SSE constituent policy band',
        disclaimer: 'Mock Mode | Simulated for A-Share Index Sessions | Not Trading Advice'
    },
    CSI300: {
        key: 'CSI300',
        code: '000300.SH',
        historyKey: 'csi300',
        quoteKey: 'csi300',
        displayName: 'CSI 300',
        shortLabel: 'CSI 300',
        policyLabel: 'A-share constituent policy proxy',
        disclaimer: 'Mock Mode | Simulated for A-Share Index Sessions | Not Trading Advice'
    }
};

const SESSION_ROWS = [
    { key: 'morning_open', label: 'Morning Open', timeLabel: '09:30-10:00', start: '09:30', end: '10:00' },
    { key: 'morning_mid', label: 'Morning Mid', timeLabel: '10:00-11:30', start: '10:00', end: '11:30' },
    { key: 'afternoon_open', label: 'Afternoon Open', timeLabel: '13:00-14:00', start: '13:00', end: '14:00' },
    { key: 'afternoon_close', label: 'Afternoon Close', timeLabel: '14:00-15:00', start: '14:00', end: '15:00' }
];

const state = {
    selectedIndex: 'SSE',
    sessionScope: 'all',
    chartMode: 'direction',
    viewModel: null,
    sessionChart: null,
    magnitudeChart: null,
    refreshTimer: null
};

const els = {};

window.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    bindEvents();
    initializeCharts();
    renderIndexButtons();
    await refreshData();
    startAutoRefresh();
});

function cacheElements() {
    [
        'statusBannerTitle', 'statusBannerSubtitle', 'marketStatusBadge', 'marketActivityBadge',
        'statusProgressLabel', 'statusProgressValue', 'statusProgressFill', 'currentPhaseText',
        'timeRemainingText', 'nextOpenText', 'preOpenText', 'btnSSE', 'btnCSI', 'indexFilter',
        'scopeAllBtn', 'scopeNextBtn', 'currentIndexValue', 'currentIndexChange',
        'selectedSessionLabel', 'lastUpdatedLabel', 'marketStructureLabel', 'marketStructureMeta',
        'marketStateInline', 'nextActionInline', 'accuracyPrimary', 'confidenceRing',
        'confidenceRingValue', 'goNoGoBadge', 'tPlusOneBadge', 'accuracyBreakdown',
        'noGoReason', 'quickDecisionPill', 'quickDecisionMode', 'quickEntryLabel',
        'quickStopLabel', 'quickTakeProfitLabel', 'quickNetEdgeLabel', 'quickEntry',
        'quickStop', 'quickTakeProfit', 'quickNetEdge', 'quickDecisionNote',
        'chartModeDirection', 'chartModeVolatility', 'sessionChart', 'sessionChartNote',
        'windowBars', 'windowMostLikely', 'windowConfidenceNote', 'magnitudeQ10',
        'magnitudeQ50', 'magnitudeQ90', 'magnitudeWidth', 'limitAdjustedBox',
        'limitAdjustedText', 'limitAdjustedNote', 'magnitudeSparkChart', 'currentBiasText',
        'currentLimitRiskText', 'tPlusOneText', 'dataSourceText', 'sessionExplanationText',
        'sessionTableBody', 'hoveredSessionLabel', 'hoveredExplanation', 'hoveredExecutionHint',
        'hoveredWindowBias', 'hoveredLimitText', 'dataDelayNote', 'mockDisclaimer'
    ].forEach((id) => {
        els[id] = document.getElementById(id);
    });
}

function bindEvents() {
    els.btnSSE?.addEventListener('click', async () => {
        state.selectedIndex = 'SSE';
        if (els.indexFilter) els.indexFilter.value = 'SSE';
        renderIndexButtons();
        await refreshData();
    });

    els.btnCSI?.addEventListener('click', async () => {
        state.selectedIndex = 'CSI300';
        if (els.indexFilter) els.indexFilter.value = 'CSI300';
        renderIndexButtons();
        await refreshData();
    });

    els.indexFilter?.addEventListener('change', async () => {
        state.selectedIndex = els.indexFilter.value === 'CSI300' ? 'CSI300' : 'SSE';
        renderIndexButtons();
        await refreshData();
    });

    els.scopeAllBtn?.addEventListener('click', () => {
        state.sessionScope = 'all';
        renderScopeButtons();
        renderAll();
    });

    els.scopeNextBtn?.addEventListener('click', () => {
        state.sessionScope = 'next';
        renderScopeButtons();
        renderAll();
    });

    els.chartModeDirection?.addEventListener('click', () => {
        state.chartMode = 'direction';
        renderChartButtons();
        renderSessionChart();
    });

    els.chartModeVolatility?.addEventListener('click', () => {
        state.chartMode = 'volatility';
        renderChartButtons();
        renderSessionChart();
    });
}

function initializeCharts() {
    if (window.Chart && els.sessionChart) {
        state.sessionChart = new Chart(els.sessionChart.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], borderRadius: 10, borderSkipped: false }] },
            options: {
                maintainAspectRatio: false,
                animation: { duration: 250 },
                scales: {
                    x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.10)' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    if (window.Chart && els.magnitudeSparkChart) {
        state.magnitudeChart = new Chart(els.magnitudeSparkChart.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'q10',
                        data: [],
                        borderColor: 'rgba(248,113,113,0.75)',
                        backgroundColor: 'rgba(248,113,113,0.08)',
                        pointRadius: 0,
                        fill: false,
                        tension: 0.25
                    },
                    {
                        label: 'q90',
                        data: [],
                        borderColor: 'rgba(52,211,153,0.85)',
                        backgroundColor: 'rgba(34,197,94,0.12)',
                        pointRadius: 0,
                        fill: '-1',
                        tension: 0.25
                    },
                    {
                        label: 'q50',
                        data: [],
                        borderColor: '#38bdf8',
                        pointRadius: 0,
                        fill: false,
                        tension: 0.3,
                        borderWidth: 2.2
                    }
                ]
            },
            options: {
                maintainAspectRatio: false,
                animation: { duration: 250 },
                scales: {
                    x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
                    y: {
                        ticks: { color: '#94a3b8', callback: (value) => `${Number(value).toFixed(1)}%` },
                        grid: { color: 'rgba(148,163,184,0.10)' }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

function startAutoRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
    }
    state.refreshTimer = setInterval(() => refreshData(), REFRESH_MS);
}

async function refreshData(showToast = false) {
    try {
        const indexMeta = currentIndexMeta();
        const [pricesResult, predictionResult, historyResult] = await Promise.allSettled([
            api.getCNEquityPrices({ pageSize: 20 }),
            api.getCNEquityIndexPrediction(indexMeta.code),
            api.getCNEquityIndicesHistory({ symbols: indexMeta.historyKey, interval: '1m', session: 'auto' })
        ]);

        if (historyResult.status !== 'fulfilled') {
            throw historyResult.reason || new Error(`${indexMeta.displayName} history seed failed.`);
        }

        const historyPayload = historyResult.value;
        const pricesPayload = pricesResult.status === 'fulfilled'
            ? pricesResult.value
            : buildFallbackPricesPayload(historyPayload, pricesResult.reason, indexMeta);
        const predictionPayload = predictionResult.status === 'fulfilled'
            ? predictionResult.value
            : buildFallbackPredictionPayload(historyPayload, pricesPayload, predictionResult.reason, indexMeta);

        state.viewModel = buildViewModel(pricesPayload, predictionPayload, historyPayload, indexMeta);
        renderAll();
    } catch (error) {
        console.error('Failed to refresh A-share session page', error);
        renderErrorState(error);
        if (showToast) {
            window.showToast?.error?.('Failed to load A-share session view.');
        }
    }
}
function buildViewModel(pricesPayload, predictionPayload, historyPayload, indexMeta) {
    const resolvedIndexMeta = indexMeta || currentIndexMeta();
    const indexQuote = pricesPayload?.indices?.[resolvedIndexMeta.quoteKey] || {};
    const direction = predictionPayload?.prediction?.direction || {};
    const magnitude = predictionPayload?.prediction?.magnitude || {};
    const windowForecast = predictionPayload?.prediction?.window || {};
    const historySeries = Array.isArray(historyPayload?.series?.[resolvedIndexMeta.historyKey]) ? historyPayload.series[resolvedIndexMeta.historyKey] : [];
    const phase = buildCurrentPhase(new Date());
    const rows = buildSessionRows({ direction, magnitude, windowForecast, historySeries, phase });
    const focusRow = resolveFocusRow(rows, phase);
    const accuracy = deriveAccuracy(direction, magnitude);
    const limitInfo = buildLimitInfo(magnitude, focusRow, resolvedIndexMeta);
    const quickDecision = buildQuickDecision(predictionPayload?.currentValue ?? indexQuote.price, direction, magnitude, predictionPayload?.tpSl || {}, phase, focusRow, resolvedIndexMeta);
    const noGoReason = buildNoGoReason(quickDecision, direction, magnitude, phase, limitInfo, resolvedIndexMeta);

    return {
        indexMeta: resolvedIndexMeta,
        meta: pricesPayload?.meta || predictionPayload?.meta || {},
        quote: indexQuote,
        direction,
        magnitude,
        windowForecast,
        phase,
        rows,
        focusRow,
        accuracy,
        limitInfo,
        quickDecision,
        noGoReason,
        historySeries,
        lastUpdated: pricesPayload?.meta?.timestamp || predictionPayload?.meta?.timestamp || new Date().toISOString(),
        dataSourceText: pricesPayload?.meta?.delayNote || 'Data Source: EastMoney API | Delay: ~3-10s (Level-1)',
        disclaimer: resolvedIndexMeta.disclaimer
    };
}

function buildFallbackPricesPayload(historyPayload, error, indexMeta) {
    const resolvedIndexMeta = indexMeta || currentIndexMeta();
    const series = Array.isArray(historyPayload?.series?.[resolvedIndexMeta.historyKey]) ? historyPayload.series[resolvedIndexMeta.historyKey] : [];
    const openClose = historyPayload?.openClose?.[resolvedIndexMeta.historyKey] || {};
    const latestPrice = asNumber(openClose.close, asNumber(series[series.length - 1]?.price, null));
    const openPrice = asNumber(openClose.open, asNumber(series[0]?.price, latestPrice));
    const priceHigh = series.reduce((max, point) => Math.max(max, asNumber(point?.price, latestPrice)), latestPrice);
    const priceLow = series.reduce((min, point) => Math.min(min, asNumber(point?.price, latestPrice)), latestPrice);
    const changePct = openPrice > 0 ? ((latestPrice - openPrice) / openPrice) * 100 : 0;

    return {
        meta: {
            source: 'eastmoney_trends_fallback',
            timestamp: historyPayload?.meta?.timestamp || new Date().toISOString(),
            stale: true,
            delayNote: `Data Source: EastMoney trend cache | Delay: last regular ${resolvedIndexMeta.displayName} session`,
            staleReason: error?.message || 'Live quote endpoint unavailable'
        },
        indices: {
            [resolvedIndexMeta.quoteKey]: {
                code: resolvedIndexMeta.code,
                price: latestPrice,
                changePct,
                open: openPrice,
                high: priceHigh,
                low: priceLow,
                prevClose: openPrice
            }
        }
    };
}

function buildFallbackPredictionPayload(historyPayload, pricesPayload, error, indexMeta) {
    const resolvedIndexMeta = indexMeta || currentIndexMeta();
    const quote = pricesPayload?.indices?.[resolvedIndexMeta.quoteKey] || {};
    const prediction = deriveFallbackForecast(quote);
    const tpSl = deriveFallbackTpSl(quote.price, prediction, prediction.signal);

    return {
        meta: {
            source: 'session_index_fallback',
            timestamp: historyPayload?.meta?.timestamp || new Date().toISOString(),
            stale: true,
            delayNote: `Forecast derived locally from the last regular ${resolvedIndexMeta.displayName} session`,
            staleReason: error?.message || 'Prediction endpoint unavailable'
        },
        currentValue: quote.price,
        prediction: {
            direction: {
                pUp: prediction.pUp,
                pDown: prediction.pDown,
                confidence: prediction.confidence,
                signal: prediction.signal,
                horizon: '1d'
            },
            window: prediction.window,
            magnitude: {
                q10: prediction.q10,
                q50: prediction.q50,
                q90: prediction.q90
            }
        },
        tpSl
    };
}

function deriveFallbackForecast(quote) {
    const price = asNumber(quote.price, 0);
    const prevClose = asNumber(quote.prevClose, price || 1);
    const open = asNumber(quote.open, prevClose);
    const high = asNumber(quote.high, price || prevClose);
    const low = asNumber(quote.low, price || prevClose);
    const changePct = asNumber(quote.changePct, prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);
    const intradayPct = prevClose > 0 ? ((price - open) / prevClose) * 100 : 0;
    const rangePct = prevClose > 0 ? (high - low) / prevClose : 0;

    const trendComponent = clamp(changePct / 6, -1, 1);
    const intradayComponent = clamp(intradayPct / 4, -1, 1);
    const pUp = clamp(0.5 + trendComponent * 0.22 + intradayComponent * 0.18, 0.05, 0.95);
    const pDown = clamp(1 - pUp, 0.05, 0.95);
    const distance = Math.abs(pUp - 0.5) * 2;
    const rangePenalty = clamp(rangePct / 0.08, 0, 1);
    const confidence = clamp(0.45 + distance * 0.5 - rangePenalty * 0.15, 0.4, 0.98);
    const center = clamp((changePct / 100) * 0.45 + (pUp - 0.5) * 0.08, -0.09, 0.09);
    const spread = clamp(0.012 + rangePct * 0.6 + (1 - confidence) * 0.04, 0.01, 0.08);
    const q10 = clamp(center - spread * 0.9, -0.1, 0.1);
    const q50 = clamp(center, -0.09, 0.09);
    const q90 = clamp(center + spread * 0.9, -0.1, 0.1);

    let w1 = clamp(0.24 + (pUp - 0.5) * 0.36 + confidence * 0.10, 0.05, 0.60);
    let w2 = clamp(0.21 + (pUp - 0.5) * 0.16 + confidence * 0.06, 0.05, 0.45);
    let w3 = clamp(0.20 - (pUp - 0.5) * 0.10 + (1 - confidence) * 0.05, 0.05, 0.40);
    let w4 = clamp(0.13 - (pUp - 0.5) * 0.08 + (1 - confidence) * 0.06, 0.03, 0.30);
    let w0 = Math.max(0.01, 1 - (w1 + w2 + w3 + w4));
    const total = w0 + w1 + w2 + w3 + w4;
    w0 /= total;
    w1 /= total;
    w2 /= total;
    w3 /= total;
    w4 /= total;
    const windowValues = { W0: w0, W1: w1, W2: w2, W3: w3, W4: w4 };
    const mostLikely = Object.entries(windowValues).sort((a, b) => b[1] - a[1])[0][0];

    return {
        pUp: Number(pUp.toFixed(4)),
        pDown: Number(pDown.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        signal: pUp >= LONG_TRIGGER ? 'LONG' : 'FLAT',
        q10: Number(q10.toFixed(4)),
        q50: Number(q50.toFixed(4)),
        q90: Number(q90.toFixed(4)),
        window: {
            W0: Number(w0.toFixed(4)),
            W1: Number(w1.toFixed(4)),
            W2: Number(w2.toFixed(4)),
            W3: Number(w3.toFixed(4)),
            W4: Number(w4.toFixed(4)),
            mostLikely
        }
    };
}

function deriveFallbackTpSl(entryPrice, prediction, signal) {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return { entryPrice: null, stopLossPct: null, takeProfit2Pct: null };
    }

    const stopLossPct = signal === 'LONG'
        ? Math.max(asNumber(prediction.q10, -0.015) * 0.8, -0.09)
        : Math.min(Math.abs(asNumber(prediction.q90, 0.015)) * 0.8, 0.09);
    const takeProfit2Pct = signal === 'LONG'
        ? Math.min(asNumber(prediction.q90, 0.015) * 0.7, 0.09)
        : Math.max(Math.abs(asNumber(prediction.q10, -0.015)) * 0.7, 0.008);

    return {
        entryPrice: Number(entryPrice.toFixed(4)),
        stopLossPct: Number(stopLossPct.toFixed(4)),
        takeProfit2Pct: Number(takeProfit2Pct.toFixed(4))
    };
}

function buildCurrentPhase(now) {
    const nowParts = getBjtParts(now);
    const currentDate = makeBjtDate(nowParts.dateKey, `${pad2(nowParts.hour)}:${pad2(nowParts.minute)}:${pad2(nowParts.second)}`);
    const isWeekend = nowParts.weekday === 'Sat' || nowParts.weekday === 'Sun';

    if (isWeekend) {
        const nextDateKey = nextTradingDateKey(makeBjtDate(nowParts.dateKey, '12:00:00'));
        const nextOpenAt = makeBjtDate(nextDateKey, '09:30:00');
        const preOpenAt = makeBjtDate(nextDateKey, '09:15:00');
        return finalizePhase({
            key: 'weekend',
            label: 'Weekend Close',
            bannerLabel: 'Market Closed',
            rangeLabel: 'Weekend',
            tone: 'closed',
            activityLabel: 'CLOSED',
            start: currentDate,
            end: currentDate,
            nextOpenAt,
            preOpenText: `Pre-open auction: ${formatTimeOnly(preOpenAt)}-09:25 BJT`,
            helperText: 'A-share cash indices are closed on weekends. The next tradable window starts with the 09:15 auction.',
            tradable: false
        }, currentDate);
    }

    const phases = buildSsePhases(nowParts.dateKey);
    const active = phases.find((phase) => currentDate >= phase.start && currentDate < phase.end) || phases[phases.length - 1];
    return finalizePhase(active, currentDate);
}

function buildSsePhases(dateKey) {
    const nextDateKey = nextTradingDateKey(makeBjtDate(dateKey, '12:00:00'));
    return [
        { key: 'pre_market', label: 'Pre-Market', bannerLabel: 'Pre-Market Preparation', rangeLabel: '00:00-09:15', tone: 'closed', activityLabel: 'CLOSED', start: makeBjtDate(dateKey, '00:00:00'), end: makeBjtDate(dateKey, '09:15:00'), nextOpenAt: makeBjtDate(dateKey, '09:30:00'), preOpenText: 'Pre-open auction: 09:15-09:25 BJT', helperText: 'Orders queue before the opening auction. Continuous trading starts at 09:30.', tradable: false },
        { key: 'pre_open_auction', label: 'Pre-Open Auction', bannerLabel: 'Pre-Open Auction', rangeLabel: '09:15-09:25', tone: 'warning', activityLabel: 'HIGH ACTIVITY', start: makeBjtDate(dateKey, '09:15:00'), end: makeBjtDate(dateKey, '09:25:00'), nextOpenAt: makeBjtDate(dateKey, '09:30:00'), preOpenText: 'Order matching buffer: 09:25-09:30 BJT', helperText: 'Auction pricing is active. Expect tighter order-book repricing into the open.', tradable: false },
        { key: 'order_matching', label: 'Open Matching Buffer', bannerLabel: 'Open Matching Buffer', rangeLabel: '09:25-09:30', tone: 'warning', activityLabel: 'HIGH ACTIVITY', start: makeBjtDate(dateKey, '09:25:00'), end: makeBjtDate(dateKey, '09:30:00'), nextOpenAt: makeBjtDate(dateKey, '09:30:00'), preOpenText: 'Continuous trading starts at 09:30 BJT', helperText: 'The call auction is resolving into the cash-session open.', tradable: false },
        { key: 'morning_open', label: 'Morning Session', bannerLabel: 'Morning Session', rangeLabel: '09:30-10:00', tone: 'live', activityLabel: 'HIGH ACTIVITY', start: makeBjtDate(dateKey, '09:30:00'), end: makeBjtDate(dateKey, '10:00:00'), nextOpenAt: makeBjtDate(dateKey, '13:00:00'), preOpenText: 'Lunch break starts at 11:30 BJT', helperText: 'The first 30 minutes usually carry the strongest domestic order flow.', tradable: true },
        { key: 'morning_mid', label: 'Morning Session', bannerLabel: 'Morning Session', rangeLabel: '10:00-11:30', tone: 'live', activityLabel: 'MODERATE', start: makeBjtDate(dateKey, '10:00:00'), end: makeBjtDate(dateKey, '11:30:00'), nextOpenAt: makeBjtDate(dateKey, '13:00:00'), preOpenText: 'Midday break starts at 11:30 BJT', helperText: 'The morning trend is still tradable, but flow is less urgent than the open.', tradable: true },
        { key: 'lunch_break', label: 'Lunch Break', bannerLabel: 'Lunch Break', rangeLabel: '11:30-13:00', tone: 'closed', activityLabel: 'CLOSED', start: makeBjtDate(dateKey, '11:30:00'), end: makeBjtDate(dateKey, '13:00:00'), nextOpenAt: makeBjtDate(dateKey, '13:00:00'), preOpenText: 'No separate afternoon auction. Continuous trading resumes at 13:00.', helperText: 'Use lunch break to stage the afternoon setup; SSE does not run a second open auction.', tradable: false },
        { key: 'afternoon_open', label: 'Afternoon Session', bannerLabel: 'Afternoon Session', rangeLabel: '13:00-14:00', tone: 'live', activityLabel: 'HIGH ACTIVITY', start: makeBjtDate(dateKey, '13:00:00'), end: makeBjtDate(dateKey, '14:00:00'), nextOpenAt: makeBjtDate(nextDateKey, '09:30:00'), preOpenText: 'Close auction begins at 14:57 BJT', helperText: 'Afternoon reopening is the highest-liquidity window after lunch.', tradable: true },
        { key: 'afternoon_close', label: 'Afternoon Session', bannerLabel: 'Afternoon Session', rangeLabel: '14:00-14:57', tone: 'warning', activityLabel: 'MODERATE', start: makeBjtDate(dateKey, '14:00:00'), end: makeBjtDate(dateKey, '14:57:00'), nextOpenAt: makeBjtDate(nextDateKey, '09:30:00'), preOpenText: 'Close auction: 14:57-15:00 BJT', helperText: 'Late session positioning matters more than outright range expansion.', tradable: true },
        { key: 'close_auction', label: 'Close Auction', bannerLabel: 'Close Auction', rangeLabel: '14:57-15:00', tone: 'warning', activityLabel: 'HIGH ACTIVITY', start: makeBjtDate(dateKey, '14:57:00'), end: makeBjtDate(dateKey, '15:00:00'), nextOpenAt: makeBjtDate(nextDateKey, '09:30:00'), preOpenText: `Next pre-open auction: ${nextDateKey.slice(5)} 09:15-09:25 BJT`, helperText: 'Closing auction imbalance dominates the final print.', tradable: true },
        { key: 'post_market', label: 'Post-Market Closed', bannerLabel: 'Market Closed', rangeLabel: '15:00-24:00', tone: 'closed', activityLabel: 'CLOSED', start: makeBjtDate(dateKey, '15:00:00'), end: makeBjtDate(nextDateKey, '00:00:00'), nextOpenAt: makeBjtDate(nextDateKey, '09:30:00'), preOpenText: `Next pre-open auction: ${nextDateKey.slice(5)} 09:15-09:25 BJT`, helperText: 'The cash session is closed. Any trade packet is simulation-only until the next open.', tradable: false }
    ];
}

function finalizePhase(phase, now) {
    const startMs = phase.start?.getTime?.() || now.getTime();
    const endMs = phase.end?.getTime?.() || now.getTime();
    const durationSec = Math.max(1, Math.floor((endMs - startMs) / 1000));
    const elapsedSec = clamp(Math.floor((now.getTime() - startMs) / 1000), 0, durationSec);
    const remainingSec = Math.max(0, Math.floor((endMs - now.getTime()) / 1000));
    const nextOpenAt = phase.nextOpenAt || phase.end || now;
    return {
        ...phase,
        elapsedSec,
        remainingSec,
        progressRatio: durationSec > 0 ? clamp(elapsedSec / durationSec, 0, 1) : 0,
        nextOpenAt,
        timeToNextOpenSec: Math.max(0, Math.floor((nextOpenAt.getTime() - now.getTime()) / 1000))
    };
}

function buildSessionRows({ direction, magnitude, windowForecast, historySeries, phase }) {
    const basePUp = asNumber(direction.pUp, 0.5);
    const baseConfidence = asNumber(direction.confidence, 0.5);
    const baseQ10 = asNumber(magnitude.q10, -0.015);
    const baseQ50 = asNumber(magnitude.q50, 0);
    const baseQ90 = asNumber(magnitude.q90, 0.015);
    const baseWidth = Math.max(0.01, Math.abs(baseQ90 - baseQ10));
    const realizedVol = estimateRealizedVolatility(historySeries);
    const phaseBias = phase.key === 'morning_open' || phase.key === 'afternoon_open' ? 0.015 : phase.key === 'morning_mid' ? 0.006 : -0.004;
    const focusKey = phaseToSessionKey(phase.key);

    return SESSION_ROWS.map((segment, index) => {
        const windowWeight = asNumber(windowForecast[`W${index}`], 0.2);
        const pUp = clamp(basePUp + phaseBias + (windowWeight - 0.22) * 0.46 + [0.024, 0.01, 0.012, -0.008][index], 0.05, 0.95);
        const confidence = clamp(baseConfidence + (windowWeight - 0.22) * 0.58 - realizedVol * 1.8 + [0.05, 0.02, 0.035, 0.01][index], 0.22, 0.96);
        const spread = clamp(baseWidth * [1.08, 0.92, 1.1, 1.18][index] + realizedVol * [0.35, 0.25, 0.30, 0.42][index], 0.01, 0.10);
        const center = clamp(baseQ50 + [0.003, 0.001, 0.002, -0.0025][index] + (pUp - 0.5) * 0.024, -0.10, 0.10);
        const q10 = clamp(center - spread / 2, -0.10, 0.10);
        const q90 = clamp(center + spread / 2, -0.10, 0.10);
        const signal = resolveSignal(pUp, confidence);
        const limitRisk = classifyLimitRisk(q10, q90);
        const isFocus = segment.key === focusKey;

        return {
            ...segment,
            pUp: Number(pUp.toFixed(4)),
            confidence: Number(confidence.toFixed(4)),
            windowWeight: Number(windowWeight.toFixed(4)),
            q10: Number(q10.toFixed(4)),
            q50: Number(center.toFixed(4)),
            q90: Number(q90.toFixed(4)),
            volatilityPct: Number(spread.toFixed(4)),
            signal,
            limitRisk,
            isFocus,
            explanation: buildSessionExplanation(segment, pUp, confidence, spread, phase, limitRisk),
            executionHint: signal === 'LONG' ? 'LONG setup clears the gate. Respect T+1 for the next exit window.' : `No-GO until P(UP) >= ${LONG_TRIGGER.toFixed(2)} and confidence >= ${MIN_CONFIDENCE.toFixed(2)}.`
        };
    });
}
function resolveFocusRow(rows, phase) {
    const sessionKey = phaseToSessionKey(phase.key);
    return rows.find((row) => row.key === sessionKey) || rows[0] || null;
}

function deriveAccuracy(direction, magnitude) {
    const pUp = asNumber(direction.pUp, 0.5);
    const confidence = asNumber(direction.confidence, 0.5);
    const intervalWidth = Math.max(0.01, Math.abs(asNumber(magnitude.q90, 0.015) - asNumber(magnitude.q10, -0.015)));
    const directionAccuracy = clamp(0.57 + Math.abs(pUp - 0.5) * 0.42 + (confidence - 0.45) * 0.16, 0.55, 0.84);
    const coverage = clamp(0.74 + confidence * 0.12 - intervalWidth * 1.05, 0.66, 0.89);
    const brier = clamp(0.315 - Math.abs(pUp - 0.5) * 0.16 - confidence * 0.05, 0.18, 0.33);
    return {
        directionAccuracy: Number(directionAccuracy.toFixed(4)),
        coverage: Number(coverage.toFixed(4)),
        brier: Number(brier.toFixed(4))
    };
}

function buildLimitInfo(magnitude, focusRow, indexMeta) {
    const q10 = asNumber(focusRow?.q10, magnitude?.q10 ?? -0.015);
    const q90 = asNumber(focusRow?.q90, magnitude?.q90 ?? 0.015);
    const upperBuffer = POLICY_LIMIT_PCT - q90;
    const lowerBuffer = q10 + POLICY_LIMIT_PCT;
    const level = classifyLimitRisk(q10, q90);
    const cappedQ90 = Math.min(q90, POLICY_LIMIT_PCT);
    const cappedQ10 = Math.max(q10, -POLICY_LIMIT_PCT);
    const policyLabel = indexMeta?.policyLabel || 'A-share constituent policy proxy';
    const note = level === 'high'
        ? `q-band is pressing into the ${policyLabel.toLowerCase()} boundary.`
        : level === 'moderate'
            ? `q-band is still tradable, but the ${policyLabel.toLowerCase()} is close enough to cap upside or downside extension.`
            : `The forecast stays comfortably inside the ${policyLabel.toLowerCase()} (+/-10%).`;
    return {
        level,
        cappedQ10,
        cappedQ90,
        upperBuffer,
        lowerBuffer,
        note
    };
}

function renderAll() {
    if (!state.viewModel) return;
    renderIndexButtons();
    renderScopeButtons();
    renderChartButtons();
    renderBanner();
    renderOverview();
    renderStartWindow();
    renderMagnitude();
    renderSessionTable();
    renderHoveredSession(state.viewModel.focusRow);
    renderSessionChart();
    renderMagnitudeChart();
}

function renderBanner() {
    const { phase } = state.viewModel;
    text(els.statusBannerTitle, `Current: ${phase.bannerLabel} (${phase.rangeLabel} BJT) | Status: ${phase.activityLabel}`);
    text(els.statusBannerSubtitle, phase.tradable
        ? `${phase.helperText} Time remaining in the active window: ${formatDuration(phase.remainingSec)}.`
        : `${phase.helperText} Next open in ${formatDuration(phase.timeToNextOpenSec)}.`);
    setBadge(els.marketStatusBadge, phase.tradable ? 'Market Open' : 'Market Closed', phase.tradable ? 'success' : 'warning');
    setBadge(els.marketActivityBadge, phase.activityLabel, phase.activityLabel === 'HIGH ACTIVITY' ? 'success' : phase.activityLabel === 'MODERATE' ? 'warning' : 'muted');
    text(els.statusProgressLabel, phase.tradable || phase.key === 'lunch_break' ? 'Session progress' : 'Time to next open');
    text(els.statusProgressValue, `${Math.round(phase.progressRatio * 100)}%`);
    if (els.statusProgressFill) {
        els.statusProgressFill.style.width = `${Math.max(6, Math.round(phase.progressRatio * 100))}%`;
        els.statusProgressFill.classList.remove('activity-live', 'activity-warning', 'activity-closed');
        els.statusProgressFill.classList.add(phase.activityLabel === 'HIGH ACTIVITY' ? 'activity-live' : phase.activityLabel === 'MODERATE' ? 'activity-warning' : 'activity-closed');
    }
    text(els.currentPhaseText, phase.label);
    text(els.timeRemainingText, phase.tradable ? formatDuration(phase.remainingSec) : `Reopens in ${formatDuration(phase.timeToNextOpenSec)}`);
    text(els.nextOpenText, `${formatTimeOnly(phase.nextOpenAt)} in ${formatDuration(phase.timeToNextOpenSec)}`);
    text(els.preOpenText, phase.preOpenText);
}

function renderOverview() {
    const viewModel = state.viewModel;
    const { quote, phase, focusRow, quickDecision, accuracy, indexMeta } = viewModel;
    text(els.currentIndexValue, formatIndexValue(quote.price));
    text(els.currentIndexChange, `${formatSignedPercent((quote.changePct || 0) / 100)} vs prev close`);
    text(els.selectedSessionLabel, `Session: ${focusRow?.label || '--'} (${focusRow?.timeLabel || '--'})`);
    text(els.lastUpdatedLabel, `Updated: ${formatDateTime(viewModel.lastUpdated)}`);
    text(els.marketStructureLabel, phase.tradable ? 'Tradable Window' : 'Wait State');
    text(els.marketStructureMeta, 'Morning 09:30-11:30 | Afternoon 13:00-15:00 BJT');
    text(els.marketStateInline, `Current phase: ${phase.label}`);
    text(els.nextActionInline, phase.tradable ? `Active ${indexMeta.displayName} window until ${formatTimeOnly(phase.end)}` : `Next tradable window: ${focusRow?.label || 'Morning Open'} at ${formatTimeOnly(phase.nextOpenAt)}`);
    text(els.accuracyPrimary, `${Math.round(accuracy.directionAccuracy * 100)}%`);
    renderConfidenceRing(asNumber(viewModel.direction.confidence, 0.5));
    setBadge(els.goNoGoBadge, quickDecision.liveEligible ? 'GO' : 'NO-GO', quickDecision.liveEligible ? 'success' : 'danger');
    els.goNoGoBadge.title = viewModel.noGoReason;
    setBadge(els.tPlusOneBadge, 'T+1', quickDecision.actionable ? 'warning' : 'info');
    els.tPlusOneBadge.title = 'T+1 Holding Rule Applies';
    text(els.accuracyBreakdown, `Direction: ${Math.round(accuracy.directionAccuracy * 100)}% | Coverage: ${Math.round(accuracy.coverage * 100)}% | Brier Score: ${accuracy.brier.toFixed(3)}`);
    text(els.noGoReason, viewModel.noGoReason);
    setSignalPill(els.quickDecisionPill, quickDecision.badge, quickDecision.tone);
    setBadge(els.quickDecisionMode, quickDecision.mode, quickDecision.modeTone);
    text(els.quickEntryLabel, quickDecision.entryLabel);
    text(els.quickStopLabel, quickDecision.stopLabel);
    text(els.quickTakeProfitLabel, quickDecision.takeProfitLabel);
    text(els.quickNetEdgeLabel, quickDecision.netEdgeLabel);
    text(els.quickEntry, quickDecision.entryValue);
    text(els.quickStop, quickDecision.stopValue);
    text(els.quickTakeProfit, quickDecision.takeProfitValue);
    text(els.quickNetEdge, quickDecision.netEdgeValue);
    text(els.quickDecisionNote, quickDecision.note);
}

function renderStartWindow() {
    const viewModel = state.viewModel;
    const bars = ['W0', 'W1', 'W2', 'W3'].map((key, index) => {
        const value = asNumber(viewModel.windowForecast[key], 0);
        const label = `${key} | ${SESSION_ROWS[index].label}`;
        return `<div class="window-row"><span>${escapeHtml(label)}</span><div class="window-track"><div class="window-fill" style="width:${Math.round(value * 100)}%"></div></div><span class="window-value">${Math.round(value * 100)}%</span></div>`;
    }).join('');
    if (els.windowBars) {
        els.windowBars.innerHTML = bars;
    }
    const mostLikely = String(viewModel.windowForecast.mostLikely || 'W1');
    text(els.windowMostLikely, `${mostLikely} | ${SESSION_ROWS[Math.min(3, Number(mostLikely.replace('W', '')) || 0)]?.label || 'Morning Open'}`);
    text(els.windowConfidenceNote, `Distribution seeded from the live ${viewModel.indexMeta.displayName} regime. Current confidence: ${Math.round(asNumber(viewModel.direction.confidence, 0.5) * 100)}%.`);
}

function renderMagnitude() {
    const viewModel = state.viewModel;
    const { focusRow, limitInfo, quickDecision, indexMeta } = viewModel;
    text(els.magnitudeQ10, formatSignedPercent(focusRow?.q10 || 0));
    text(els.magnitudeQ50, formatSignedPercent(focusRow?.q50 || 0));
    text(els.magnitudeQ90, formatSignedPercent(focusRow?.q90 || 0));
    text(els.magnitudeWidth, formatSignedPercent((focusRow?.volatilityPct || 0), false));
    text(els.limitAdjustedText, `q90 capped at ${formatSignedPercent(limitInfo.cappedQ90)} | q10 floored at ${formatSignedPercent(limitInfo.cappedQ10)}`);
    text(els.limitAdjustedNote, `Limit risk: ${capitalize(limitInfo.level)} | ${limitInfo.note}`);
    els.limitAdjustedBox?.classList.toggle('high', limitInfo.level === 'high');
    text(els.currentBiasText, quickDecision.actionable ? `Directional LONG bias into the next ${indexMeta.displayName} window.` : 'No directional edge yet; wait for cleaner domestic flow.');
    text(els.currentLimitRiskText, `${capitalize(limitInfo.level)} | q90 ${formatSignedPercent(focusRow?.q90 || 0)} / q10 ${formatSignedPercent(focusRow?.q10 || 0)}`);
    text(els.tPlusOneText, quickDecision.actionable ? 'T+1 applies. Any long initiated today can only exit on the next trading day.' : 'T+1 still applies once a long is opened. No shorting assumption for this page.');
    text(els.dataSourceText, viewModel.dataSourceText);
    text(els.sessionExplanationText, focusRow?.explanation || 'Hover a session row to inspect the rationale.');
    text(els.dataDelayNote, viewModel.dataSourceText);
    text(els.mockDisclaimer, viewModel.disclaimer);
}
function getVisibleRows() {
    const rows = state.viewModel?.rows || [];
    if (state.sessionScope === 'next') {
        return state.viewModel?.focusRow ? [state.viewModel.focusRow] : rows.slice(0, 1);
    }
    return rows;
}

function renderSessionTable() {
    const rows = getVisibleRows();
    if (!els.sessionTableBody) return;

    els.sessionTableBody.innerHTML = rows.map((row) => `
        <tr data-row-key="${row.key}" class="${row.isFocus ? 'is-focus' : ''}">
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.timeLabel)}</td>
            <td>${Math.round(row.pUp * 100)}%</td>
            <td>${Math.round(row.windowWeight * 100)}%</td>
            <td>${formatSignedPercent(row.q50)}</td>
            <td>${formatSignedPercent(row.volatilityPct, false)}</td>
            <td><span class="signal-pill ${row.signal === 'LONG' ? 'long' : 'flat'}">${row.signal}</span></td>
            <td><span class="row-pill ${row.limitRisk}">${row.limitRisk.toUpperCase()}</span></td>
        </tr>
    `).join('');

    rows.forEach((row) => {
        const tr = els.sessionTableBody.querySelector(`[data-row-key="${row.key}"]`);
        tr?.addEventListener('mouseenter', () => renderHoveredSession(row));
        tr?.addEventListener('focus', () => renderHoveredSession(row));
    });
}

function renderHoveredSession(row) {
    if (!row) return;
    text(els.hoveredSessionLabel, `${row.label} (${row.timeLabel})`);
    text(els.hoveredExplanation, row.explanation);
    text(els.hoveredExecutionHint, row.executionHint);
    text(els.hoveredWindowBias, `P(W1): ${Math.round(row.windowWeight * 100)}% | Confidence: ${Math.round(row.confidence * 100)}%`);
    text(els.hoveredLimitText, `${capitalize(row.limitRisk)} limit risk | T+1 applies after any long entry.`);
}

function renderSessionChart() {
    if (!state.sessionChart || !state.viewModel) return;
    const rows = getVisibleRows();
    const isDirection = state.chartMode === 'direction';
    state.sessionChart.data.labels = rows.map((row) => row.label);
    state.sessionChart.data.datasets[0].label = isDirection ? 'P(UP)' : 'Volatility';
    state.sessionChart.data.datasets[0].data = rows.map((row) => Number(((isDirection ? row.pUp : row.volatilityPct) * 100).toFixed(2)));
    state.sessionChart.data.datasets[0].backgroundColor = rows.map((row) => {
        if (!isDirection) {
            return row.volatilityPct >= 0.08 ? 'rgba(248,113,113,0.82)' : row.volatilityPct >= 0.05 ? 'rgba(250,204,21,0.82)' : 'rgba(56,189,248,0.82)';
        }
        return row.signal === 'LONG' ? 'rgba(34,197,94,0.82)' : 'rgba(248,113,113,0.74)';
    });
    state.sessionChart.options.scales.y.ticks.callback = (value) => `${value}%`;
    state.sessionChart.update();
    text(els.sessionChartNote, isDirection
        ? 'Bar chart of session-by-session P(UP). Use this to see where the directional edge is concentrated.'
        : 'Bar chart of projected session volatility. Higher bars imply more path uncertainty and wider q-bands.');
}

function renderMagnitudeChart() {
    if (!state.magnitudeChart || !state.viewModel) return;
    const rows = state.viewModel.rows;
    state.magnitudeChart.data.labels = rows.map((row) => row.label.replace('Session', '').trim());
    state.magnitudeChart.data.datasets[0].data = rows.map((row) => Number((row.q10 * 100).toFixed(2)));
    state.magnitudeChart.data.datasets[1].data = rows.map((row) => Number((row.q90 * 100).toFixed(2)));
    state.magnitudeChart.data.datasets[2].data = rows.map((row) => Number((row.q50 * 100).toFixed(2)));
    state.magnitudeChart.update();
}

function renderErrorState(error) {
    const message = error?.message || 'Unable to load A-share session forecast.';
    text(els.statusBannerTitle, 'Current: A-share session data unavailable');
    text(els.statusBannerSubtitle, message);
    setBadge(els.marketStatusBadge, 'Unavailable', 'danger');
    setBadge(els.marketActivityBadge, 'NO-GO', 'danger');
    text(els.sessionTableBody, '');
    if (els.sessionTableBody) {
        els.sessionTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-secondary); padding: 1.2rem;">${escapeHtml(message)}</td></tr>`;
    }
}

function renderScopeButtons() {
    setButtonState(els.scopeAllBtn, state.sessionScope === 'all');
    setButtonState(els.scopeNextBtn, state.sessionScope === 'next');
}

function renderChartButtons() {
    setButtonState(els.chartModeDirection, state.chartMode === 'direction');
    setButtonState(els.chartModeVolatility, state.chartMode === 'volatility');
}
function buildQuickDecision(price, direction, magnitude, tpSl, phase, focusRow, indexMeta) {
    const resolvedIndexMeta = indexMeta || currentIndexMeta();
    const pUp = asNumber(direction.pUp, 0.5);
    const confidence = asNumber(direction.confidence, 0.5);
    const signal = resolveSignal(pUp, confidence);
    const actionable = signal === 'LONG';
    const entryPrice = asNumber(price, tpSl.entryPrice);
    const netEdge = asNumber(focusRow?.q50, magnitude.q50 ?? 0) - ESTIMATED_FEE_PCT;

    if (actionable) {
        return {
            actionable,
            liveEligible: phase.tradable,
            badge: 'LONG',
            tone: 'long',
            mode: phase.tradable ? 'Live Window' : 'Simulated Only',
            modeTone: phase.tradable ? 'success' : 'warning',
            entryLabel: 'Entry',
            stopLabel: 'Stop Loss',
            takeProfitLabel: 'Take Profit',
            netEdgeLabel: 'Net Edge',
            entryValue: formatIndexValue(entryPrice),
            stopValue: formatSignedPercent(asNumber(tpSl.stopLossPct, focusRow?.q10 ?? -0.015)),
            takeProfitValue: formatSignedPercent(asNumber(tpSl.takeProfit2Pct, focusRow?.q90 ?? 0.02)),
            netEdgeValue: formatSignedPercent(netEdge),
            note: phase.tradable
                ? `LONG setup for ${resolvedIndexMeta.displayName} ${focusRow?.label || 'the next session'} clears the policy gate. T+1 holding rule applies after entry.`
                : `Simulated only. Market reopens at ${formatTimeOnly(phase.nextOpenAt)} BJT.`
        };
    }

    return {
        actionable,
        liveEligible: false,
        badge: 'NO-GO',
        tone: 'flat',
        mode: phase.tradable ? 'Stand Aside' : 'Simulated Only',
        modeTone: phase.tradable ? 'warning' : 'info',
        entryLabel: 'Reference',
        stopLabel: 'Long Trigger',
        takeProfitLabel: 'Coverage',
        netEdgeLabel: 'Wait For',
        entryValue: formatIndexValue(entryPrice),
        stopValue: `P(UP) >= ${LONG_TRIGGER.toFixed(2)}`,
        takeProfitValue: `Conf >= ${MIN_CONFIDENCE.toFixed(2)}`,
        netEdgeValue: phase.tradable ? `${focusRow?.label || 'Next session'} bias` : `${formatTimeOnly(phase.nextOpenAt)} reopen`,
        note: phase.tradable
            ? `No directional edge yet. Wait for the next higher-conviction ${resolvedIndexMeta.displayName} session before opening risk.`
            : `Simulated only until ${formatTimeOnly(phase.nextOpenAt)} BJT.`
    };
}

function buildNoGoReason(decision, direction, magnitude, phase, limitInfo, indexMeta) {
    const resolvedIndexMeta = indexMeta || currentIndexMeta();
    const pUp = asNumber(direction.pUp, 0.5);
    const confidence = asNumber(direction.confidence, 0.5);
    const width = Math.abs(asNumber(magnitude.q90, 0.015) - asNumber(magnitude.q10, -0.015));

    if (decision.liveEligible) {
        return `GO for the active ${resolvedIndexMeta.displayName} window. Confidence ${Math.round(confidence * 100)}% clears the execution gate and T+1 applies after entry.`;
    }

    if (decision.actionable && !phase.tradable) {
        return `NO-GO for execution because the market is closed. The directional bias is still LONG, but this remains simulation-only until ${formatTimeOnly(phase.nextOpenAt)} BJT.`;
    }

    const reasons = [];
    if (pUp < LONG_TRIGGER) reasons.push(`directional edge is only ${Math.round(pUp * 100)}% P(UP)`);
    if (confidence < MIN_CONFIDENCE) reasons.push(`confidence is too low (${Math.round(confidence * 100)}%)`);
    if (width >= 0.05) reasons.push('volatility forecast is elevated');
    if (limitInfo.level === 'high') reasons.push(`the q-band is near the ${resolvedIndexMeta.policyLabel.toLowerCase()}`);
    const waitFor = recommendedWaitTarget(phase.key);
    return `NO-GO due to ${reasons.join(' + ') || 'insufficient edge'}. Recommend wait for ${waitFor}.`;
}

function resolveSignal(pUp, confidence) {
    return pUp >= LONG_TRIGGER && confidence >= MIN_CONFIDENCE ? 'LONG' : 'NO-GO';
}

function buildSessionExplanation(segment, pUp, confidence, volatilityPct, phase, limitRisk) {
    const bias = pUp >= LONG_TRIGGER ? 'directional buy-side flow' : 'mixed order flow';
    const volatilityTone = volatilityPct >= 0.06 ? 'high volatility regime' : volatilityPct >= 0.04 ? 'moderate volatility regime' : 'low volatility regime';
    const phaseHint = segment.key === phaseToSessionKey(phase.key)
        ? 'This is the current focus window.'
        : `This sits ${segment.key.includes('afternoon') ? 'after the midday resume' : 'before the afternoon handoff'}.`;
    return `${segment.label}: ${bias} with ${Math.round(confidence * 100)}% confidence inside a ${volatilityTone}. ${capitalize(limitRisk)} limit risk. ${phaseHint}`;
}

function phaseToSessionKey(phaseKey) {
    if (phaseKey === 'morning_open' || phaseKey === 'pre_open_auction' || phaseKey === 'order_matching' || phaseKey === 'pre_market' || phaseKey === 'weekend' || phaseKey === 'post_market') return 'morning_open';
    if (phaseKey === 'morning_mid') return 'morning_mid';
    if (phaseKey === 'lunch_break' || phaseKey === 'afternoon_open') return 'afternoon_open';
    return 'afternoon_close';
}

function recommendedWaitTarget(phaseKey) {
    if (phaseKey === 'lunch_break') return 'Afternoon Open';
    if (phaseKey === 'post_market' || phaseKey === 'weekend') return 'the next Morning Open';
    if (phaseKey === 'morning_open' || phaseKey === 'morning_mid') return 'Afternoon Open';
    return 'the next higher-confidence A-share session';
}

function currentIndexMeta() {
    return CN_INDEX_CONFIG[state.selectedIndex] || CN_INDEX_CONFIG.SSE;
}

function renderIndexButtons() {
    if (els.indexFilter) {
        els.indexFilter.value = state.selectedIndex;
    }
    if (els.btnSSE) {
        els.btnSSE.className = state.selectedIndex === 'SSE' ? 'btn btn-primary' : 'btn btn-secondary';
    }
    if (els.btnCSI) {
        els.btnCSI.className = state.selectedIndex === 'CSI300' ? 'btn btn-primary' : 'btn btn-secondary';
    }
}

function classifyLimitRisk(q10, q90) {
    if (q90 >= 0.09 || q10 <= -0.09) return 'high';
    if (q90 >= 0.075 || q10 <= -0.075) return 'moderate';
    return 'low';
}

function estimateRealizedVolatility(series) {
    if (!Array.isArray(series) || series.length < 3) return 0.006;
    const returns = [];
    for (let i = 1; i < series.length; i += 1) {
        const prev = Number(series[i - 1]?.price);
        const curr = Number(series[i]?.price);
        if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0) continue;
        returns.push((curr - prev) / prev);
    }
    if (returns.length < 2) return 0.006;
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
    return clamp(Math.sqrt(variance) * Math.sqrt(60) * 2.1, 0.003, 0.03);
}

function setButtonState(element, active) {
    if (!element) return;
    element.className = active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
}

function setBadge(element, label, tone) {
    if (!element) return;
    const normalizedTone = ['success', 'warning', 'danger', 'info'].includes(tone) ? tone : 'info';
    element.textContent = label;
    element.className = `status-badge ${normalizedTone}`;
}

function setSignalPill(element, label, tone) {
    if (!element) return;
    element.textContent = label;
    element.className = `signal-pill ${tone}`;
}

function renderConfidenceRing(value) {
    const pct = Math.round(clamp(value, 0, 1) * 100);
    const hue = Math.round(120 * clamp((pct - 25) / 75, 0, 1));
    if (els.confidenceRing) {
        els.confidenceRing.style.background = `conic-gradient(hsl(${hue} 78% 54%) ${pct * 3.6}deg, rgba(255,255,255,0.14) 0deg)`;
    }
    text(els.confidenceRingValue, `${pct}%`);
}

function getBjtParts(input) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: BJT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(input)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
        weekday: parts.weekday,
        dateKey: `${parts.year}-${parts.month}-${parts.day}`
    };
}

function makeBjtDate(dateKey, timeText) {
    return new Date(`${dateKey}T${timeText}+08:00`);
}

function nextTradingDateKey(baseDate) {
    const cursor = new Date(baseDate);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while ([0, 6].includes(cursor.getUTCDay())) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cursor.toISOString().slice(0, 10);
}

function formatDuration(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

function formatTimeOnly(input) {
    return new Intl.DateTimeFormat('en-US', { timeZone: BJT_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(input));
}

function formatDateTime(input) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: BJT_TIMEZONE,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(new Date(input));
}

function formatIndexValue(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
}

function formatSignedPercent(value, includeSign = true) {
    if (!Number.isFinite(Number(value))) return '--';
    const numeric = Number(value) * 100;
    const sign = numeric > 0 && includeSign ? '+' : '';
    return `${sign}${numeric.toFixed(2)}%`;
}

function asNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function text(element, value) {
    if (element) element.textContent = value;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function capitalize(value) {
    const textValue = String(value || '');
    return textValue ? textValue[0].toUpperCase() + textValue.slice(1) : '--';
}

function pad2(value) {
    return String(value).padStart(2, '0');
}
