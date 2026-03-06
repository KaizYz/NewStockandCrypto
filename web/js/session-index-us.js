const ET_TIMEZONE = 'America/New_York';
const REFRESH_MS = 15000;
const LONG_TRIGGER = 0.55;
const SHORT_TRIGGER = 0.45;
const MIN_CONFIDENCE = 0.90;
const US_INDEX_CONFIG = {
    DJI: { key: 'DJI', symbol: '^DJI', quoteKey: 'dow', historyKey: 'dow', displayName: 'Dow Jones' },
    NDX: { key: 'NDX', symbol: '^NDX', quoteKey: 'nasdaq100', historyKey: 'nasdaq100', displayName: 'Nasdaq' },
    SPX: { key: 'SPX', symbol: '^SPX', quoteKey: 'sp500', historyKey: 'sp500', displayName: 'S&P 500' }
};
const US_HOLIDAYS_2026 = new Set([
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'
]);
const US_EARLY_CLOSE_2026 = new Set(['2026-07-03', '2026-11-27', '2026-12-24']);

const state = {
    selectedIndex: 'SPX',
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
        'timeRemainingText', 'nextOpenText', 'preOpenText', 'btnDJI', 'btnNDX', 'btnSPX', 'indexFilter',
        'scopeAllBtn', 'scopeNextBtn', 'currentIndexValue', 'currentIndexChange', 'selectedSessionLabel',
        'lastUpdatedLabel', 'marketStructureLabel', 'marketStructureMeta', 'marketStateInline',
        'nextActionInline', 'accuracyPrimary', 'confidenceRing', 'confidenceRingValue', 'goNoGoBadge',
        'tPlusOneBadge', 'accuracyBreakdown', 'noGoReason', 'quickDecisionPill', 'quickDecisionMode',
        'quickEntryLabel', 'quickStopLabel', 'quickTakeProfitLabel', 'quickNetEdgeLabel', 'quickEntry',
        'quickStop', 'quickTakeProfit', 'quickNetEdge', 'quickDecisionNote', 'chartModeDirection',
        'chartModeVolatility', 'sessionChart', 'sessionChartNote', 'windowBars', 'windowMostLikely',
        'windowConfidenceNote', 'magnitudeQ10', 'magnitudeQ50', 'magnitudeQ90', 'magnitudeWidth',
        'limitAdjustedBox', 'limitAdjustedText', 'limitAdjustedNote', 'magnitudeSparkChart',
        'currentBiasText', 'currentLimitRiskText', 'tPlusOneText', 'dataSourceText', 'sessionExplanationText',
        'sessionTableBody', 'hoveredSessionLabel', 'hoveredExplanation', 'hoveredExecutionHint',
        'hoveredWindowBias', 'hoveredLimitText', 'dataDelayNote', 'mockDisclaimer', 'accuracyCard',
        'quickDecisionCard', 'startWindowCard', 'magnitudeCard', 'projectionCard', 'executionLensCard',
        'sessionTableShell'
    ].forEach((id) => {
        els[id] = document.getElementById(id);
    });
}

function bindEvents() {
    [['btnDJI', 'DJI'], ['btnNDX', 'NDX'], ['btnSPX', 'SPX']].forEach(([id, key]) => {
        els[id]?.addEventListener('click', async () => {
            state.selectedIndex = key;
            renderIndexButtons();
            await refreshData();
        });
    });

    els.indexFilter?.addEventListener('change', async () => {
        state.selectedIndex = ['DJI', 'NDX', 'SPX'].includes(els.indexFilter.value) ? els.indexFilter.value : 'SPX';
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
                datasets: [{
                    data: [],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56,189,248,0.12)',
                    pointRadius: 0,
                    fill: false,
                    tension: 0.28,
                    borderWidth: 2.2
                }]
            },
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
}

function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => refreshData(), REFRESH_MS);
}
async function refreshData(showToast = false) {
    try {
        const indexMeta = currentIndexMeta();
        const marketState = buildUsMarketState(new Date());
        const [indicesResult, historyResult] = await Promise.allSettled([
            api.getUSEquityIndices(),
            api.getUSEquityIndicesHistory({ mode: 'regular_sessions', sessions: 1, interval: '5m' })
        ]);

        if (historyResult.status !== 'fulfilled') {
            throw historyResult.reason || new Error('US regular-session history is unavailable.');
        }

        const indicesPayload = indicesResult.status === 'fulfilled' ? indicesResult.value : null;
        const historyPayload = historyResult.value;
        const lastSeries = Array.isArray(historyPayload?.series?.[indexMeta.historyKey]) ? historyPayload.series[indexMeta.historyKey] : [];
        const hasSnapshot = lastSeries.length > 0;
        let predictionPayload = null;

        if (marketState.isRegular) {
            try {
                predictionPayload = await api.getUSEquityIndexPrediction(indexMeta.symbol);
            } catch (error) {
                predictionPayload = null;
            }
        }

        state.viewModel = buildViewModel({ indexMeta, marketState, indicesPayload, historyPayload, predictionPayload, hasSnapshot });
        renderAll();
    } catch (error) {
        console.error('Failed to load US session forecast', error);
        renderErrorState(error);
        if (showToast) {
            window.showToast?.error?.('Failed to load US session view.');
        }
    }
}

function buildViewModel({ indexMeta, marketState, indicesPayload, historyPayload, predictionPayload, hasSnapshot }) {
    const lastSeries = Array.isArray(historyPayload?.series?.[indexMeta.historyKey]) ? historyPayload.series[indexMeta.historyKey] : [];
    const latestHistoryPoint = lastSeries[lastSeries.length - 1] || null;
    const firstHistoryPoint = lastSeries[0] || null;
    const liveQuote = indicesPayload?.indices?.[indexMeta.quoteKey] || null;
    const quote = marketState.isRegular && liveQuote
        ? buildQuoteFromLive(liveQuote, firstHistoryPoint)
        : buildQuoteFromHistory(latestHistoryPoint, firstHistoryPoint);
    const predictionAvailable = marketState.isRegular && !!predictionPayload?.prediction;
    const sessionSegments = buildUsSessionSegments(marketState);
    const historyPath = lastSeries.map((point) => ({ ts: point.ts, price: Number(point.price) })).filter((point) => Number.isFinite(point.price));

    let rows = [];
    let focusRow = null;
    let accuracy = null;
    let riskInfo = null;
    let quickDecision = buildClosedQuickDecision(marketState, quote);
    let noGoReason = buildClosedReason(marketState, hasSnapshot);

    if (predictionAvailable) {
        const direction = predictionPayload.prediction.direction || {};
        const magnitude = predictionPayload.prediction.magnitude || {};
        const windowForecast = predictionPayload.prediction.window || {};
        rows = buildUsSessionRows({ direction, magnitude, windowForecast, marketState, sessionSegments, historyPath });
        focusRow = resolveFocusRow(rows, marketState);
        accuracy = deriveUsAccuracy(direction, magnitude);
        riskInfo = buildUsRiskInfo(focusRow);
        quickDecision = buildUsQuickDecision(quote.price, direction, predictionPayload.tpSl || {}, marketState, focusRow);
        noGoReason = buildUsNoGoReason(quickDecision, direction, riskInfo, marketState);
    }

    return {
        indexMeta,
        marketState,
        quote,
        lastUpdated: indicesPayload?.meta?.timestamp || historyPayload?.meta?.timestamp || new Date().toISOString(),
        historyLabel: String(historyPayload?.selectedSession?.label || 'Last Regular Session'),
        historyPath,
        prediction: predictionPayload?.prediction || null,
        predictionAvailable,
        rows,
        focusRow,
        accuracy,
        riskInfo,
        quickDecision,
        noGoReason,
        hasSnapshot,
        dataSourceText: indicesPayload?.meta?.delayNote || 'US Level-1 quote feed; normal delay depends on venue',
        disclaimer: 'Regular Session Only | Last real snapshot only | Not Trading Advice'
    };
}

function buildQuoteFromLive(liveQuote, firstHistoryPoint) {
    const openPrice = asNumber(liveQuote.open, asNumber(firstHistoryPoint?.price, liveQuote.price));
    const price = asNumber(liveQuote.price, null);
    const changePct = Number.isFinite(liveQuote?.changePct) ? Number(liveQuote.changePct) : openPrice > 0 && Number.isFinite(price) ? ((price - openPrice) / openPrice) * 100 : null;
    return {
        price,
        open: openPrice,
        changePct,
        sourceLabel: 'Regular Session'
    };
}

function buildQuoteFromHistory(lastPoint, firstPoint) {
    const price = asNumber(lastPoint?.price, null);
    const openPrice = asNumber(firstPoint?.price, price);
    const changePct = openPrice > 0 && Number.isFinite(price) ? ((price - openPrice) / openPrice) * 100 : null;
    return {
        price,
        open: openPrice,
        changePct,
        sourceLabel: 'Last Regular Session'
    };
}
function buildUsMarketState(now) {
    const parts = getEtParts(now);
    const currentDate = makeEtDate(parts.dateKey, `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`);
    const isTradingDay = isUsTradingDate(parts.dateKey, parts.weekday);
    const isEarlyClose = US_EARLY_CLOSE_2026.has(parts.dateKey);
    const closeHour = isEarlyClose ? 13 : 16;
    const regularStart = makeEtDate(parts.dateKey, '09:30:00');
    const regularEnd = makeEtDate(parts.dateKey, `${pad2(closeHour)}:00:00`);
    const nowMs = currentDate.getTime();
    const isRegular = isTradingDay && nowMs >= regularStart.getTime() && nowMs < regularEnd.getTime();
    const nextOpenAt = resolveNextUsOpen(currentDate, isTradingDay, regularStart, regularEnd);
    const nextEventAt = isRegular ? regularEnd : nextOpenAt;
    const sessionSeconds = Math.max(1, Math.floor((regularEnd.getTime() - regularStart.getTime()) / 1000));
    const elapsedSec = isRegular ? Math.max(0, Math.floor((nowMs - regularStart.getTime()) / 1000)) : 0;
    const remainingSec = isRegular ? Math.max(0, Math.floor((regularEnd.getTime() - nowMs) / 1000)) : Math.max(0, Math.floor((nextOpenAt.getTime() - nowMs) / 1000));

    return {
        isRegular,
        isTradingDay,
        isEarlyClose,
        phaseLabel: isRegular ? 'Regular Session' : 'Closed',
        activityLabel: isRegular ? 'REGULAR' : 'CLOSED',
        rangeLabel: `09:30-${pad2(closeHour)}:00 ET`,
        regularStart,
        regularEnd,
        nextOpenAt,
        nextEventAt,
        remainingSec,
        progressRatio: isRegular ? clamp(elapsedSec / sessionSeconds, 0, 1) : 0,
        helperText: isRegular
            ? `US cash-session data is live for ${pad2(closeHour)}:00 ET close${isEarlyClose ? ' (early close)' : ''}.`
            : `Only regular-session data is shown here. Pre-market and after-hours are treated as closed.`
    };
}

function resolveNextUsOpen(currentDate, isTradingDay, regularStart, regularEnd) {
    const nowMs = currentDate.getTime();
    if (isTradingDay && nowMs < regularStart.getTime()) {
        return regularStart;
    }
    if (isTradingDay && nowMs < regularEnd.getTime()) {
        return regularStart;
    }
    return makeEtDate(nextUsTradingDateKey(getEtParts(currentDate).dateKey), '09:30:00');
}

function isUsTradingDate(dateKey, weekday) {
    return weekday !== 'Sat' && weekday !== 'Sun' && !US_HOLIDAYS_2026.has(dateKey);
}

function nextUsTradingDateKey(dateKey) {
    let cursor = makeEtDate(dateKey, '12:00:00');
    while (true) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const parts = getEtParts(cursor);
        if (isUsTradingDate(parts.dateKey, parts.weekday)) {
            return parts.dateKey;
        }
    }
}

function buildUsSessionSegments(marketState) {
    const dateKey = getEtParts(marketState.regularStart).dateKey;
    if (marketState.isEarlyClose) {
        return [
            { key: 'opening_drive', label: 'Opening Drive', timeLabel: '09:30-10:15', start: makeEtDate(dateKey, '09:30:00'), end: makeEtDate(dateKey, '10:15:00') },
            { key: 'midday', label: 'Midday', timeLabel: '10:15-11:15', start: makeEtDate(dateKey, '10:15:00'), end: makeEtDate(dateKey, '11:15:00') },
            { key: 'afternoon_trend', label: 'Afternoon Trend', timeLabel: '11:15-12:15', start: makeEtDate(dateKey, '11:15:00'), end: makeEtDate(dateKey, '12:15:00') },
            { key: 'closing_ramp', label: 'Closing Ramp', timeLabel: '12:15-13:00', start: makeEtDate(dateKey, '12:15:00'), end: makeEtDate(dateKey, '13:00:00') }
        ];
    }
    return [
        { key: 'opening_drive', label: 'Opening Drive', timeLabel: '09:30-10:30', start: makeEtDate(dateKey, '09:30:00'), end: makeEtDate(dateKey, '10:30:00') },
        { key: 'midday', label: 'Midday', timeLabel: '10:30-12:00', start: makeEtDate(dateKey, '10:30:00'), end: makeEtDate(dateKey, '12:00:00') },
        { key: 'afternoon_trend', label: 'Afternoon Trend', timeLabel: '12:00-14:30', start: makeEtDate(dateKey, '12:00:00'), end: makeEtDate(dateKey, '14:30:00') },
        { key: 'closing_ramp', label: 'Closing Ramp', timeLabel: '14:30-16:00', start: makeEtDate(dateKey, '14:30:00'), end: makeEtDate(dateKey, '16:00:00') }
    ];
}

function buildUsSessionRows({ direction, magnitude, windowForecast, marketState, sessionSegments, historyPath }) {
    const basePUp = asNumber(direction.pUp, 0.5);
    const baseConfidence = asNumber(direction.confidence, 0.5);
    const baseQ10 = asNumber(magnitude.q10, -0.012);
    const baseQ50 = asNumber(magnitude.q50, 0);
    const baseQ90 = asNumber(magnitude.q90, 0.012);
    const realizedVol = estimateRealizedVolatility(historyPath);
    const offsets = [0.03, 0.005, -0.002, 0.018];
    const focusKey = resolveUsFocusKey(marketState);

    return sessionSegments.map((segment, index) => {
        const windowWeight = asNumber(windowForecast[`W${index}`], 0.25);
        const pUp = clamp(basePUp + offsets[index] + (windowWeight - 0.25) * 0.38, 0.03, 0.97);
        const confidence = clamp(baseConfidence - realizedVol * 1.2 + [0.02, 0, -0.01, 0.015][index], 0.5, 0.99);
        const spread = clamp(Math.abs(baseQ90 - baseQ10) * [1.12, 0.95, 0.9, 1.08][index] + realizedVol * [0.5, 0.3, 0.28, 0.42][index], 0.01, 0.12);
        const center = clamp(baseQ50 + (pUp - 0.5) * 0.03 + [0.002, 0, -0.001, 0.003][index], -0.15, 0.15);
        const q10 = clamp(center - spread / 2, -0.15, 0.15);
        const q90 = clamp(center + spread / 2, -0.15, 0.15);
        const signal = resolveUsSignal(pUp, confidence);
        const gapRisk = classifyGapRisk(spread, historyPath, index);
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
            gapRisk,
            isFocus: segment.key === focusKey,
            explanation: buildUsSessionExplanation(segment, signal, confidence, gapRisk),
            executionHint: signal === 'NO-TRADE' ? `No live trade packet until P(UP) >= ${LONG_TRIGGER.toFixed(2)} or <= ${SHORT_TRIGGER.toFixed(2)} with confidence >= ${MIN_CONFIDENCE.toFixed(2)}.` : `${signal} setup is valid for regular-session execution only.`
        };
    });
}
function renderAll() {
    if (!state.viewModel) return;
    renderIndexButtons();
    renderScopeButtons();
    renderChartButtons();
    renderAvailabilityState();
    renderBanner();
    renderOverview();
    renderStartWindow();
    renderMagnitude();
    renderSessionTable();
    renderHoveredSession(state.viewModel.focusRow);
    renderSessionChart();
    renderMagnitudeChart();
}

function renderAvailabilityState() {
    const unavailable = !state.viewModel.hasSnapshot;
    ['accuracyCard', 'quickDecisionCard', 'startWindowCard', 'magnitudeCard', 'projectionCard', 'executionLensCard', 'sessionTableShell'].forEach((id) => {
        els[id]?.classList.toggle('panel-unavailable', unavailable);
    });
}

function renderBanner() {
    const { marketState, historyLabel } = state.viewModel;
    text(els.statusBannerTitle, `Current: ${marketState.phaseLabel} (${marketState.rangeLabel}) | Status: ${marketState.activityLabel}`);
    text(els.statusBannerSubtitle, marketState.isRegular
        ? `${marketState.helperText} Time remaining in regular hours: ${formatDuration(marketState.remainingSec)}.`
        : `${marketState.helperText} Snapshot source: ${historyLabel}. Next official open in ${formatDuration(marketState.remainingSec)}.`);
    setBadge(els.marketStatusBadge, marketState.isRegular ? 'Regular Session' : 'Closed', marketState.isRegular ? 'success' : 'warning');
    setBadge(els.marketActivityBadge, marketState.activityLabel, marketState.isRegular ? 'success' : 'info');
    text(els.statusProgressLabel, marketState.isRegular ? 'Regular session progress' : 'Time to next open');
    text(els.statusProgressValue, `${Math.round(marketState.progressRatio * 100)}%`);
    if (els.statusProgressFill) {
        els.statusProgressFill.style.width = `${marketState.isRegular ? Math.max(6, Math.round(marketState.progressRatio * 100)) : 6}%`;
        els.statusProgressFill.classList.remove('activity-live', 'activity-warning', 'activity-closed');
        els.statusProgressFill.classList.add(marketState.isRegular ? 'activity-live' : 'activity-closed');
    }
    text(els.currentPhaseText, marketState.phaseLabel);
    text(els.timeRemainingText, marketState.isRegular ? `Closes in ${formatDuration(marketState.remainingSec)}` : `Reopens in ${formatDuration(marketState.remainingSec)}`);
    text(els.nextOpenText, `${marketState.isRegular ? 'Close' : 'Open'} ${formatEtTime(marketState.nextEventAt)} in ${formatDuration(marketState.remainingSec)}`);
    text(els.preOpenText, 'Only official regular-session data is shown. Extended-hours quotes are ignored.');
}

function renderOverview() {
    const viewModel = state.viewModel;
    const { quote, marketState, accuracy, quickDecision, indexMeta } = viewModel;
    text(els.currentIndexValue, formatIndexValue(quote.price));
    text(els.currentIndexChange, quote.changePct === null ? 'Real snapshot unavailable.' : `${formatSignedPercent((quote.changePct || 0) / 100)} | ${quote.sourceLabel}`);
    text(els.selectedSessionLabel, `Snapshot: ${viewModel.historyLabel}`);
    text(els.lastUpdatedLabel, `Updated: ${formatEtDateTime(viewModel.lastUpdated)}`);
    text(els.marketStructureLabel, marketState.isRegular ? 'Regular Hours' : 'Closed');
    text(els.marketStructureMeta, marketState.isEarlyClose ? 'Early Close: 09:30-13:00 ET' : 'Regular Hours: 09:30-16:00 ET');
    text(els.marketStateInline, `State: ${marketState.phaseLabel}`);
    text(els.nextActionInline, marketState.isRegular ? `Official close at ${formatEtTime(marketState.regularEnd)}` : `Next official open at ${formatEtTime(marketState.nextOpenAt)}`);

    if (viewModel.predictionAvailable && accuracy) {
        text(els.accuracyPrimary, `${Math.round(accuracy.directionAccuracy * 100)}%`);
        renderConfidenceRing(asNumber(viewModel.prediction?.direction?.confidence, 0.5));
        setBadge(els.goNoGoBadge, quickDecision.liveEligible ? 'GO' : 'NO-TRADE', quickDecision.liveEligible ? 'success' : 'warning');
        text(els.accuracyBreakdown, `Direction: ${Math.round(accuracy.directionAccuracy * 100)}% | Coverage: ${Math.round(accuracy.coverage * 100)}% | Brier Score: ${accuracy.brier.toFixed(3)}`);
    } else {
        text(els.accuracyPrimary, '--');
        renderConfidenceRing(null);
        setBadge(els.goNoGoBadge, marketState.isRegular ? 'Unavailable' : 'Closed', marketState.isRegular ? 'danger' : 'warning');
        text(els.accuracyBreakdown, marketState.isRegular ? 'Live prediction unavailable from the official feed.' : `No fresh prediction outside regular hours | ${viewModel.historyLabel}`);
    }

    setBadge(els.tPlusOneBadge, 'REAL', 'info');
    els.tPlusOneBadge.title = 'Regular-session real data only';
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

    text(els.dataDelayNote, viewModel.dataSourceText);
    text(els.mockDisclaimer, viewModel.disclaimer);
    text(els.dataSourceText, viewModel.dataSourceText);
    text(els.currentBiasText, viewModel.predictionAvailable ? `${quickDecision.badge} bias for ${indexMeta.displayName} during regular hours.` : 'Last regular session snapshot only. No new forecast is shown while the market is closed.');
    text(els.currentLimitRiskText, viewModel.predictionAvailable && viewModel.riskInfo ? `${capitalize(viewModel.riskInfo.level)} | ${viewModel.riskInfo.note}` : 'Gap risk resets at the next official open.');
    text(els.tPlusOneText, 'Only regular-session data is used on this page. Pre-market and after-hours remain closed here.');
    text(els.sessionExplanationText, viewModel.predictionAvailable && viewModel.focusRow ? viewModel.focusRow.explanation : 'Closed state: holding the last regular-session snapshot only.');
}

function renderStartWindow() {
    if (!viewHasForecast()) {
        if (els.windowBars) els.windowBars.innerHTML = '<div class="window-note">No live regular-session forecast outside official hours.</div>';
        text(els.windowMostLikely, '--');
        text(els.windowConfidenceNote, 'This panel activates only during regular hours when the real prediction feed is available.');
        return;
    }

    const bars = ['W0', 'W1', 'W2', 'W3'].map((key, index) => {
        const row = state.viewModel.rows[index];
        const value = asNumber(state.viewModel.prediction?.window?.[key], 0);
        return `<div class="window-row"><span>${escapeHtml(key)} | ${escapeHtml(row.label)}</span><div class="window-track"><div class="window-fill" style="width:${Math.round(value * 100)}%"></div></div><span class="window-value">${Math.round(value * 100)}%</span></div>`;
    }).join('');
    els.windowBars.innerHTML = bars;
    const mostLikely = String(state.viewModel.prediction?.window?.mostLikely || 'W0');
    text(els.windowMostLikely, `${mostLikely} | ${state.viewModel.rows[Math.min(3, Number(mostLikely.replace('W', '')) || 0)]?.label || '--'}`);
    text(els.windowConfidenceNote, `Real regular-session forecast for ${state.viewModel.indexMeta.displayName}. Confidence: ${Math.round(asNumber(state.viewModel.prediction?.direction?.confidence, 0.5) * 100)}%.`);
}

function renderMagnitude() {
    if (!viewHasForecast()) {
        text(els.magnitudeQ10, '--');
        text(els.magnitudeQ50, '--');
        text(els.magnitudeQ90, '--');
        text(els.magnitudeWidth, '--');
        text(els.limitAdjustedText, 'Last regular-session snapshot only. No live band is computed while closed.');
        text(els.limitAdjustedNote, 'Gap / volatility risk will refresh when regular trading resumes.');
        els.limitAdjustedBox?.classList.remove('high');
        return;
    }

    const row = state.viewModel.focusRow;
    text(els.magnitudeQ10, formatSignedPercent(row.q10));
    text(els.magnitudeQ50, formatSignedPercent(row.q50));
    text(els.magnitudeQ90, formatSignedPercent(row.q90));
    text(els.magnitudeWidth, formatSignedPercent(row.volatilityPct, false));
    text(els.limitAdjustedText, `Regular-session q-band: ${formatSignedPercent(row.q10)} to ${formatSignedPercent(row.q90)}`);
    text(els.limitAdjustedNote, `Gap / volatility risk: ${state.viewModel.riskInfo.note}`);
    els.limitAdjustedBox?.classList.toggle('high', state.viewModel.riskInfo.level === 'high');
}
function getVisibleRows() {
    const rows = state.viewModel?.rows || [];
    if (state.sessionScope === 'next') {
        return state.viewModel?.focusRow ? [state.viewModel.focusRow] : rows.slice(0, 1);
    }
    return rows;
}

function renderSessionTable() {
    if (!els.sessionTableBody) return;
    if (!viewHasForecast()) {
        els.sessionTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-secondary); padding: 1.2rem;">Closed or unavailable. Only the last regular-session snapshot is shown.</td></tr>';
        return;
    }
    const rows = getVisibleRows();
    els.sessionTableBody.innerHTML = rows.map((row) => `
        <tr data-row-key="${row.key}" class="${row.isFocus ? 'is-focus' : ''}">
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.timeLabel)}</td>
            <td>${Math.round(row.pUp * 100)}%</td>
            <td>${Math.round(row.windowWeight * 100)}%</td>
            <td>${formatSignedPercent(row.q50)}</td>
            <td>${formatSignedPercent(row.volatilityPct, false)}</td>
            <td><span class="signal-pill ${signalTone(row.signal)}">${row.signal}</span></td>
            <td><span class="row-pill ${row.gapRisk}">${row.gapRisk.toUpperCase()}</span></td>
        </tr>
    `).join('');
    rows.forEach((row) => {
        els.sessionTableBody.querySelector(`[data-row-key="${row.key}"]`)?.addEventListener('mouseenter', () => renderHoveredSession(row));
    });
}

function renderHoveredSession(row) {
    if (!row) {
        text(els.hoveredSessionLabel, 'No live session hovered.');
        text(els.hoveredExplanation, 'Closed state. Forecast detail reactivates during regular cash hours.');
        text(els.hoveredExecutionHint, 'Decision packets are only shown from real regular-session data.');
        text(els.hoveredWindowBias, '--');
        text(els.hoveredLimitText, '--');
        return;
    }
    text(els.hoveredSessionLabel, `${row.label} (${row.timeLabel})`);
    text(els.hoveredExplanation, row.explanation);
    text(els.hoveredExecutionHint, row.executionHint);
    text(els.hoveredWindowBias, `P(W): ${Math.round(row.windowWeight * 100)}% | Confidence: ${Math.round(row.confidence * 100)}%`);
    text(els.hoveredLimitText, `${capitalize(row.gapRisk)} gap/liquidity risk during regular hours.`);
}

function renderSessionChart() {
    if (!state.sessionChart) return;
    if (!viewHasForecast()) {
        state.sessionChart.data.labels = [];
        state.sessionChart.data.datasets[0].data = [];
        state.sessionChart.update();
        text(els.sessionChartNote, 'Closed or unavailable. Session projection activates only with a real regular-session forecast.');
        return;
    }
    const rows = getVisibleRows();
    const isDirection = state.chartMode === 'direction';
    state.sessionChart.data.labels = rows.map((row) => row.label);
    state.sessionChart.data.datasets[0].label = isDirection ? 'P(UP)' : 'Volatility';
    state.sessionChart.data.datasets[0].data = rows.map((row) => Number(((isDirection ? row.pUp : row.volatilityPct) * 100).toFixed(2)));
    state.sessionChart.data.datasets[0].backgroundColor = rows.map((row) => isDirection
        ? row.signal === 'LONG' ? 'rgba(34,197,94,0.82)' : row.signal === 'SHORT' ? 'rgba(248,113,113,0.82)' : 'rgba(250,204,21,0.82)'
        : row.volatilityPct >= 0.05 ? 'rgba(248,113,113,0.82)' : row.volatilityPct >= 0.03 ? 'rgba(250,204,21,0.82)' : 'rgba(56,189,248,0.82)');
    state.sessionChart.update();
    text(els.sessionChartNote, isDirection ? 'Real regular-session directional bias across the intraday windows.' : 'Real regular-session volatility across the intraday windows.');
}

function renderMagnitudeChart() {
    if (!state.magnitudeChart) return;
    const series = state.viewModel?.historyPath || [];
    state.magnitudeChart.data.labels = series.map((point) => formatEtTime(point.ts));
    state.magnitudeChart.data.datasets[0].data = series.map((point) => Number(point.price.toFixed(2)));
    state.magnitudeChart.update();
}

function renderErrorState(error) {
    const message = error?.message || 'Unable to load the US regular-session snapshot.';
    text(els.statusBannerTitle, 'Current: US session data unavailable');
    text(els.statusBannerSubtitle, message);
    setBadge(els.marketStatusBadge, 'Unavailable', 'danger');
    setBadge(els.marketActivityBadge, 'UNAVAILABLE', 'danger');
    ['accuracyCard', 'quickDecisionCard', 'startWindowCard', 'magnitudeCard', 'projectionCard', 'executionLensCard', 'sessionTableShell'].forEach((id) => {
        els[id]?.classList.add('panel-unavailable');
    });
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
function buildClosedQuickDecision(marketState, quote) {
    return {
        badge: 'NO-TRADE',
        tone: 'flat',
        mode: marketState.isRegular ? 'Unavailable' : 'Closed',
        modeTone: marketState.isRegular ? 'danger' : 'warning',
        liveEligible: false,
        entryLabel: 'Reference',
        stopLabel: 'Session',
        takeProfitLabel: 'Next Open',
        netEdgeLabel: 'Data Status',
        entryValue: formatIndexValue(quote.price),
        stopValue: quote.sourceLabel || '--',
        takeProfitValue: formatEtTime(marketState.nextOpenAt),
        netEdgeValue: marketState.isRegular ? 'Prediction unavailable' : 'Last regular snapshot',
        note: marketState.isRegular ? 'Regular session is open, but the official prediction feed is unavailable.' : 'Market closed. Only the last regular-session snapshot is shown.'
    };
}

function buildClosedReason(marketState, hasSnapshot) {
    if (!hasSnapshot) return 'Unavailable: no last regular-session snapshot is available from the real feed.';
    return marketState.isRegular
        ? 'Live prediction unavailable. Holding the last official snapshot until the real feed returns.'
        : 'Closed. No new decision packet is generated outside official regular hours.';
}

function buildUsQuickDecision(price, direction, tpSl, marketState, focusRow) {
    const pUp = asNumber(direction.pUp, 0.5);
    const confidence = asNumber(direction.confidence, 0.5);
    const signal = resolveUsSignal(pUp, confidence);
    const entryPrice = asNumber(price, null);
    const edge = asNumber(focusRow?.q50, 0) - 0.0025;

    if (signal === 'LONG' || signal === 'SHORT') {
        return {
            badge: signal,
            tone: signal === 'LONG' ? 'long' : 'short',
            mode: marketState.isRegular ? 'Regular Session' : 'Closed',
            modeTone: marketState.isRegular ? 'success' : 'warning',
            liveEligible: marketState.isRegular,
            entryLabel: 'Entry',
            stopLabel: 'Stop Loss',
            takeProfitLabel: 'Take Profit',
            netEdgeLabel: 'Net Edge',
            entryValue: formatIndexValue(entryPrice),
            stopValue: formatSignedPercent(asNumber(tpSl.stopLossPct, signal === 'LONG' ? focusRow?.q10 : -focusRow?.q90)),
            takeProfitValue: formatSignedPercent(asNumber(tpSl.takeProfit2Pct, signal === 'LONG' ? focusRow?.q90 : Math.abs(focusRow?.q10))),
            netEdgeValue: formatSignedPercent(signal === 'LONG' ? edge : -edge),
            note: `${signal} setup is valid only during regular US cash hours.`
        };
    }

    return {
        badge: 'NO-TRADE',
        tone: 'flat',
        mode: marketState.isRegular ? 'Regular Session' : 'Closed',
        modeTone: marketState.isRegular ? 'info' : 'warning',
        liveEligible: false,
        entryLabel: 'Reference',
        stopLabel: 'Long Trigger',
        takeProfitLabel: 'Short Trigger',
        netEdgeLabel: 'Wait For',
        entryValue: formatIndexValue(entryPrice),
        stopValue: `P(UP) >= ${LONG_TRIGGER.toFixed(2)}`,
        takeProfitValue: `P(UP) <= ${SHORT_TRIGGER.toFixed(2)}`,
        netEdgeValue: `Conf >= ${MIN_CONFIDENCE.toFixed(2)}`,
        note: 'No-trade until the real regular-session edge clears the LONG or SHORT gate.'
    };
}

function buildUsNoGoReason(quickDecision, direction, riskInfo, marketState) {
    if (quickDecision.liveEligible) {
        return `GO for the active regular session. Real confidence ${Math.round(asNumber(direction.confidence, 0.5) * 100)}% clears the execution gate.`;
    }
    const reasons = [];
    if (quickDecision.badge === 'NO-TRADE') reasons.push('the regular-session edge is not strong enough yet');
    if (riskInfo?.level === 'high') reasons.push('gap or liquidity risk is elevated');
    if (!marketState.isRegular) reasons.push('the market is closed');
    return `NO-TRADE because ${reasons.join(' + ') || 'the regular-session forecast is unavailable'}.`;
}

function deriveUsAccuracy(direction, magnitude) {
    const pUp = asNumber(direction.pUp, 0.5);
    const confidence = asNumber(direction.confidence, 0.75);
    const width = Math.abs(asNumber(magnitude.q90, 0.015) - asNumber(magnitude.q10, -0.015));
    return {
        directionAccuracy: clamp(0.62 + Math.abs(pUp - 0.5) * 0.28 + (confidence - 0.75) * 0.18, 0.58, 0.91),
        coverage: clamp(0.74 + confidence * 0.11 - width * 0.9, 0.68, 0.92),
        brier: clamp(0.28 - Math.abs(pUp - 0.5) * 0.12 - confidence * 0.03, 0.14, 0.30)
    };
}

function buildUsRiskInfo(row) {
    const width = asNumber(row?.volatilityPct, 0.03);
    const level = width >= 0.06 ? 'high' : width >= 0.035 ? 'moderate' : 'low';
    return {
        level,
        note: level === 'high' ? 'Wide band with elevated gap and late-session liquidity risk.' : level === 'moderate' ? 'Tradable, but watch gap risk around the open and close.' : 'Contained range and normal regular-session liquidity.'
    };
}

function resolveFocusRow(rows, marketState) {
    const focusKey = resolveUsFocusKey(marketState);
    return rows.find((row) => row.key === focusKey) || rows[0] || null;
}

function resolveUsFocusKey(marketState) {
    const currentMs = Date.now();
    if (!marketState.isRegular) return 'opening_drive';
    if (currentMs < marketState.regularStart.getTime() + 60 * 60 * 1000) return 'opening_drive';
    if (currentMs < marketState.regularStart.getTime() + 2.5 * 60 * 60 * 1000) return 'midday';
    if (currentMs < marketState.regularEnd.getTime() - 90 * 60 * 1000) return 'afternoon_trend';
    return 'closing_ramp';
}

function buildUsSessionExplanation(segment, signal, confidence, gapRisk) {
    const tone = signal === 'LONG' ? 'buy-side pressure' : signal === 'SHORT' ? 'sell-side pressure' : 'mixed flow';
    return `${segment.label}: ${tone} with ${Math.round(confidence * 100)}% confidence. ${capitalize(gapRisk)} gap/liquidity risk for regular-session execution.`;
}

function resolveUsSignal(pUp, confidence) {
    if (pUp >= LONG_TRIGGER && confidence >= MIN_CONFIDENCE) return 'LONG';
    if (pUp <= SHORT_TRIGGER && confidence >= MIN_CONFIDENCE) return 'SHORT';
    return 'NO-TRADE';
}

function classifyGapRisk(spread, historyPath, index) {
    const histVol = estimateRealizedVolatility(historyPath);
    const score = spread + histVol * [1.2, 0.8, 0.7, 1.1][index];
    if (score >= 0.06) return 'high';
    if (score >= 0.035) return 'moderate';
    return 'low';
}
function currentIndexMeta() {
    return US_INDEX_CONFIG[state.selectedIndex] || US_INDEX_CONFIG.SPX;
}

function renderIndexButtons() {
    if (els.indexFilter) els.indexFilter.value = state.selectedIndex;
    [['btnDJI', 'DJI'], ['btnNDX', 'NDX'], ['btnSPX', 'SPX']].forEach(([id, key]) => {
        if (els[id]) {
            els[id].className = state.selectedIndex === key ? 'btn btn-primary' : 'btn btn-secondary';
        }
    });
}

function viewHasForecast() {
    return !!state.viewModel?.predictionAvailable;
}

function signalTone(signal) {
    if (signal === 'LONG') return 'long';
    if (signal === 'SHORT') return 'short';
    return 'flat';
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
    if (!Number.isFinite(value)) {
        if (els.confidenceRing) {
            els.confidenceRing.style.background = 'conic-gradient(rgba(255,255,255,0.14) 360deg, rgba(255,255,255,0.14) 0deg)';
        }
        text(els.confidenceRingValue, '--');
        return;
    }
    const pct = Math.round(clamp(value, 0, 1) * 100);
    const hue = Math.round(120 * clamp((pct - 35) / 65, 0, 1));
    if (els.confidenceRing) {
        els.confidenceRing.style.background = `conic-gradient(hsl(${hue} 78% 54%) ${pct * 3.6}deg, rgba(255,255,255,0.14) 0deg)`;
    }
    text(els.confidenceRingValue, `${pct}%`);
}

function estimateRealizedVolatility(series) {
    if (!Array.isArray(series) || series.length < 3) return 0.008;
    const returns = [];
    for (let i = 1; i < series.length; i += 1) {
        const prev = Number(series[i - 1]?.price);
        const curr = Number(series[i]?.price);
        if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0) continue;
        returns.push((curr - prev) / prev);
    }
    if (returns.length < 2) return 0.008;
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
    return clamp(Math.sqrt(variance) * Math.sqrt(78), 0.003, 0.03);
}

function getEtParts(input) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: ET_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(input)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: parts.weekday,
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second)
    };
}

function makeEtDate(dateKey, timeText) {
    const [year, month, day] = String(dateKey).split('-').map((value) => Number(value));
    const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const offsetMinutes = getTimeZoneOffsetMinutes(ET_TIMEZONE, probe);
    const isoOffset = offsetMinutesToIso(offsetMinutes);
    return new Date(`${dateKey}T${timeText}${isoOffset}`);
}

function parseOffsetMinutes(offsetValue) {
    const normalized = String(offsetValue || '').replace('GMT', '').trim();
    const match = normalized.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * (hours * 60 + minutes);
}

function offsetMinutesToIso(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
}

function getTimeZoneOffsetMinutes(timeZone, refDate) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset'
    });
    const tzPart = formatter.formatToParts(refDate).find((part) => part.type === 'timeZoneName');
    return parseOffsetMinutes(tzPart?.value || 'GMT+0');
}

function formatEtDateTime(input) {
    return new Intl.DateTimeFormat('en-US', { timeZone: ET_TIMEZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(input));
}

function formatEtTime(input) {
    return new Intl.DateTimeFormat('en-US', { timeZone: ET_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(input));
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

function formatDuration(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
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
