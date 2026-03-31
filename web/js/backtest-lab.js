(function () {
    'use strict';

    const state = {
        model: 'ensemble',
        asset: 'BTCUSDT',
        horizon: '1H',
        equityChart: null,
        radarChart: null,
        summaryRows: [],
    };

    const els = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function toNumber(value, fallback = NaN) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function formatPercent(value, digits = 2, signed = false) {
        const num = toNumber(value, NaN);
        if (!Number.isFinite(num)) return '--';
        const sign = signed && num >= 0 ? '+' : '';
        return `${sign}${(num * 100).toFixed(digits)}%`;
    }

    function formatRatio(value, digits = 3) {
        const num = toNumber(value, NaN);
        if (!Number.isFinite(num)) return '--';
        return num.toFixed(digits);
    }

    function setStatus(text) {
        if (els.statusNote) {
            els.statusNote.textContent = text;
        }
    }

    function collectElements() {
        els.modelSelect = byId('btModel');
        els.assetSelect = byId('btAsset');
        els.horizonSelect = byId('btHorizon');
        els.confidenceInput = byId('btConfidence');
        els.stopLossInput = byId('btStopLoss');
        els.takeProfitInput = byId('btTakeProfit');
        els.loadSummaryBtn = byId('btLoadSummary');
        els.runCustomBtn = byId('btRunCustom');
        els.statusNote = byId('btStatusNote');

        els.totalReturn = byId('btTotalReturn');
        els.sharpe = byId('btSharpe');
        els.maxDd = byId('btMaxDd');
        els.winRate = byId('btWinRate');
        els.profitFactor = byId('btProfitFactor');
        els.trades = byId('btTrades');

        els.equityCanvas = byId('btEquityChart');
        els.radarCanvas = byId('btRadarChart');
    }

    function updateStateFromInputs() {
        state.model = els.modelSelect ? els.modelSelect.value : state.model;
        state.asset = els.assetSelect ? els.assetSelect.value : state.asset;
        state.horizon = els.horizonSelect ? els.horizonSelect.value : state.horizon;
    }

    function renderMetrics(summary) {
        if (!summary) return;
        const totalReturn = toNumber(summary.total_return);
        const maxDd = toNumber(summary.max_drawdown);

        if (els.totalReturn) {
            els.totalReturn.textContent = formatPercent(totalReturn, 2, true);
            els.totalReturn.className = Number.isFinite(totalReturn)
                ? `metric-value ${totalReturn >= 0 ? 'metric-positive' : 'metric-negative'}`
                : 'metric-value';
        }
        if (els.sharpe) els.sharpe.textContent = formatRatio(summary.sharpe_ratio, 3);
        if (els.maxDd) {
            els.maxDd.textContent = formatPercent(maxDd, 2, false);
            els.maxDd.className = Number.isFinite(maxDd)
                ? `metric-value ${maxDd <= 0.2 ? 'metric-positive' : 'metric-negative'}`
                : 'metric-value';
        }
        if (els.winRate) els.winRate.textContent = formatPercent(summary.win_rate, 1);
        if (els.profitFactor) els.profitFactor.textContent = formatRatio(summary.profit_factor, 3);
        if (els.trades) els.trades.textContent = String(summary.total_trades ?? '--');
    }

    function renderEquityChart(equityRows) {
        if (!els.equityCanvas || !window.Chart) return;
        const labels = equityRows.map((row) => row.timestamp || '');
        const values = equityRows.map((row) => toNumber(row.equity, 0));
        const ddValues = equityRows.map((row) => toNumber(row.drawdown, 0) * -100);

        if (state.equityChart) {
            state.equityChart.destroy();
        }
        state.equityChart = new Chart(els.equityCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Equity',
                        data: values,
                        borderColor: '#00FFAA',
                        backgroundColor: 'rgba(0, 255, 170, 0.12)',
                        fill: true,
                        tension: 0.2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Drawdown %',
                        data: ddValues,
                        borderColor: '#FF4D4F',
                        backgroundColor: 'rgba(255, 77, 79, 0.08)',
                        fill: false,
                        tension: 0.15,
                        yAxisID: 'y1',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { ticks: { color: '#8EA0B8', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { ticks: { color: '#8EA0B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y1: {
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#8EA0B8' },
                    },
                },
                plugins: { legend: { labels: { color: '#D6E0F0' } } },
            },
        });
    }

    function renderRadarChart(rows) {
        if (!els.radarCanvas || !window.Chart) return;
        const targetRows = rows
            .filter((row) => row.asset === state.asset && row.horizon === state.horizon)
            .sort((a, b) => String(a.model).localeCompare(String(b.model)));

        if (state.radarChart) {
            state.radarChart.destroy();
        }
        if (!targetRows.length) return;

        const palette = ['#00E5FF', '#00FFAA', '#F59E0B', '#A78BFA', '#F97316'];
        const datasets = targetRows.map((row, idx) => {
            const ret = toNumber(row.total_return, 0);
            const sharpe = toNumber(row.sharpe_ratio, 0);
            const win = toNumber(row.win_rate, 0);
            const dd = toNumber(row.max_drawdown, 0);
            const pf = toNumber(row.profit_factor, 0);
            const tradeCount = toNumber(row.total_trades, 0);

            return {
                label: String(row.model).toUpperCase(),
                data: [
                    Math.max(0, Math.min(100, ret * 300)),
                    Math.max(0, Math.min(100, sharpe * 35)),
                    Math.max(0, Math.min(100, win * 100)),
                    Math.max(0, Math.min(100, (1 - dd) * 100)),
                    Math.max(0, Math.min(100, pf * 45)),
                    Math.max(0, Math.min(100, tradeCount / 40)),
                ],
                borderColor: palette[idx % palette.length],
                backgroundColor: `${palette[idx % palette.length]}33`,
                borderWidth: 2,
            };
        });

        state.radarChart = new Chart(els.radarCanvas, {
            type: 'radar',
            data: {
                labels: ['Return', 'Sharpe', 'Win Rate', 'Drawdown', 'Profit Factor', 'Trades'],
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        suggestedMin: 0,
                        suggestedMax: 100,
                        angleLines: { color: 'rgba(255,255,255,0.08)' },
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        pointLabels: { color: '#8EA0B8' },
                        ticks: { color: '#64748B', backdropColor: 'transparent' },
                    },
                },
                plugins: { legend: { labels: { color: '#D6E0F0' } } },
            },
        });
    }

    function hasBacktestSummary(summary) {
        if (!summary || typeof summary !== 'object') return false;
        const candidateFields = [
            summary.total_return,
            summary.sharpe_ratio,
            summary.max_drawdown,
            summary.win_rate,
            summary.profit_factor,
            summary.total_trades,
        ];
        return candidateFields.some((value) => Number.isFinite(Number(value)));
    }

    async function loadCatalog() {
        if (!window.api) return;
        const [modelsRes, assetsRes] = await Promise.all([
            api.getModelExplorerModels(),
            api.getModelExplorerAssets(),
        ]);
        const models = Array.isArray(modelsRes.models) ? modelsRes.models : [];
        const assets = Array.isArray(assetsRes.assets) ? assetsRes.assets : [];

        if (els.modelSelect) {
            els.modelSelect.innerHTML = models.map((item) => `<option value=\"${item.id}\">${item.label}</option>`).join('');
            if (models.some((item) => item.id === state.model)) {
                els.modelSelect.value = state.model;
            } else if (models[0]) {
                state.model = models[0].id;
                els.modelSelect.value = state.model;
            }
        }
        if (els.assetSelect) {
            els.assetSelect.innerHTML = assets.map((item) => `<option value=\"${item.symbol}\">${item.label}</option>`).join('');
            if (assets.some((item) => item.symbol === state.asset)) {
                els.assetSelect.value = state.asset;
            } else if (assets[0]) {
                state.asset = assets[0].symbol;
                els.assetSelect.value = state.asset;
            }
        }
        if (els.horizonSelect) {
            els.horizonSelect.value = state.horizon;
        }
    }

    async function loadSummaryAndDetail() {
        if (!window.api) return;
        updateStateFromInputs();
        setStatus('Loading backtest summary...');

        const [summaryRes, detailRes] = await Promise.all([
            api.getModelExplorerBacktestSummary({ asset: state.asset, horizon: state.horizon }),
            api.getModelExplorerBacktestDetail({ model: state.model, asset: state.asset, horizon: state.horizon }),
        ]);

        state.summaryRows = Array.isArray(summaryRes.rows) ? summaryRes.rows : [];
        const targetSummary = state.summaryRows.find(
            (row) => row.model === state.model && row.asset === state.asset && row.horizon === state.horizon
        ) || detailRes.summary || {};

        renderEquityChart(Array.isArray(detailRes.equity) ? detailRes.equity : []);
        renderRadarChart(state.summaryRows);
        if (!hasBacktestSummary(targetSummary)) {
            renderMetrics({});
            setStatus(`No live backtest summary is available for ${state.asset} / ${state.horizon}.`);
            return;
        }

        renderMetrics(targetSummary);
        setStatus('Summary loaded.');
    }

    async function runCustomBacktest() {
        if (!window.api) return;
        updateStateFromInputs();
        setStatus('Running custom backtest...');

        const payload = {
            model: state.model,
            asset: state.asset,
            horizon: state.horizon,
            confidence_threshold: toNumber(els.confidenceInput?.value, 0.55),
            stop_loss_pct: toNumber(els.stopLossInput?.value, 0.02),
            take_profit_pct: toNumber(els.takeProfitInput?.value, 0.04),
        };

        const response = await api.runModelExplorerBacktest(payload);
        renderMetrics(response.summary || {});
        renderEquityChart(Array.isArray(response.equity) ? response.equity : []);
        setStatus(`Custom run complete. Cache key: ${response.cacheKey || '--'}`);
    }

    function bindEvents() {
        if (els.loadSummaryBtn) {
            els.loadSummaryBtn.addEventListener('click', async () => {
                try {
                    await loadSummaryAndDetail();
                } catch (error) {
                    setStatus(`Failed to load summary: ${error.message || error}`);
                }
            });
        }
        if (els.runCustomBtn) {
            els.runCustomBtn.addEventListener('click', async () => {
                try {
                    await runCustomBacktest();
                } catch (error) {
                    setStatus(`Custom backtest failed: ${error.message || error}`);
                }
            });
        }
        if (els.modelSelect) {
            els.modelSelect.addEventListener('change', () => {
                updateStateFromInputs();
                loadSummaryAndDetail().catch((error) => setStatus(`Reload failed: ${error.message || error}`));
            });
        }
        if (els.assetSelect) {
            els.assetSelect.addEventListener('change', () => {
                updateStateFromInputs();
                loadSummaryAndDetail().catch((error) => setStatus(`Reload failed: ${error.message || error}`));
            });
        }
        if (els.horizonSelect) {
            els.horizonSelect.addEventListener('change', () => {
                updateStateFromInputs();
                loadSummaryAndDetail().catch((error) => setStatus(`Reload failed: ${error.message || error}`));
            });
        }
    }

    async function init() {
        collectElements();
        bindEvents();
        try {
            await loadCatalog();
            await loadSummaryAndDetail();
        } catch (error) {
            setStatus(`Initialization failed: ${error.message || error}`);
        }
    }

document.addEventListener('DOMContentLoaded', init);
})();

(function () {
    'use strict';

    const state = {
        runs: [],
        charts: {
            equity: null,
            regime: null,
            walkForward: null,
            benchmark: null,
        },
    };

    const els = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function toNumber(value, fallback = NaN) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function formatPercent(value, digits = 2, signed = false) {
        const num = toNumber(value, NaN);
        if (!Number.isFinite(num)) return '--';
        const sign = signed && num >= 0 ? '+' : '';
        return `${sign}${(num * 100).toFixed(digits)}%`;
    }

    function formatRatio(value, digits = 3) {
        const num = toNumber(value, NaN);
        if (!Number.isFinite(num)) return '--';
        return num.toFixed(digits);
    }

    function collectRouterElements() {
        els.runSelect = byId('qrRunSelect');
        els.reloadBtn = byId('qrReloadBtn');
        els.statusNote = byId('qrStatusNote');
        els.statusChips = byId('qrStatusChips');
        els.sectionName = byId('qrSectionName');
        els.currentRegime = byId('qrCurrentRegime');
        els.championStatus = byId('qrChampionStatus');
        els.totalReturn = byId('qrTotalReturn');
        els.sharpe = byId('qrSharpe');
        els.maxDrawdown = byId('qrMaxDrawdown');
        els.monteCarloQ10 = byId('qrMonteCarloQ10');
        els.benchmarkEdge = byId('qrBenchmarkEdge');
        els.trades = byId('qrTrades');
        els.latestSignal = byId('qrLatestSignal');
        els.moduleTable = byId('qrModuleTable');
        els.candidateTable = byId('qrCandidateTable');
        els.downloads = byId('qrDownloads');
        els.equityCanvas = byId('qrEquityChart');
        els.regimeCanvas = byId('qrRegimeChart');
        els.walkForwardCanvas = byId('qrWalkForwardChart');
        els.benchmarkCanvas = byId('qrBenchmarkChart');
    }

    function setRouterStatus(text) {
        if (els.statusNote) {
            els.statusNote.textContent = text;
        }
    }

    function chip(label, tone) {
        return `<span class="router-chip ${tone || ''}">${label}</span>`;
    }

    async function loadRouterRuns(preferredRunId) {
        if (!window.api || !els.runSelect) return null;
        setRouterStatus('Loading BTC Regime Router runs...');
        const response = await api.getQuantRouterRuns();
        state.runs = Array.isArray(response.runs) ? response.runs : [];
        if (!state.runs.length) {
            els.runSelect.innerHTML = '';
            setRouterStatus('No BTC Regime Router runs were found.');
            return null;
        }
        els.runSelect.innerHTML = state.runs
            .map((run) => `<option value="${run.runId}">${run.runId}${run.archived ? ' (archive)' : ''}</option>`)
            .join('');
        const nextRunId = preferredRunId && state.runs.some((run) => run.runId === preferredRunId)
            ? preferredRunId
            : state.runs[0].runId;
        els.runSelect.value = nextRunId;
        return nextRunId;
    }

    async function loadRouterRun(runId) {
        if (!window.api || !runId) return;
        setRouterStatus('Loading BTC Regime Router details...');
        const response = await api.getQuantRouterRun(runId);
        const run = response.run || response;
        renderRouterRun(run, response);
    }

    function renderRouterRun(run, response) {
        const manifest = run?.manifest || {};
        const summary = run?.backtestSummary?.deploymentSummary || run?.backtestSummary?.champion?.summary || {};
        const champion = run?.backtestSummary?.champion || {};
        const status = response?.status || {};
        const cached = Boolean(response?.cached);
        const degraded = Boolean(response?.degraded);

        if (els.sectionName) els.sectionName.textContent = manifest.sectionName || 'BTC Regime Router';
        if (els.currentRegime) els.currentRegime.textContent = String(manifest.currentRegime || '--').toUpperCase();
        if (els.championStatus) els.championStatus.textContent = `${String(manifest.championStatus || '--').toUpperCase()} / ${String(manifest.championSource || 'n/a').toUpperCase()}`;
        if (els.totalReturn) els.totalReturn.textContent = formatPercent(summary.total_return, 2, true);
        if (els.sharpe) els.sharpe.textContent = formatRatio(summary.sharpe_ratio, 3);
        if (els.maxDrawdown) els.maxDrawdown.textContent = formatPercent(summary.max_drawdown, 2, false);
        if (els.monteCarloQ10) els.monteCarloQ10.textContent = formatPercent(run?.monteCarlo?.q10Return, 2, true);
        if (els.benchmarkEdge) els.benchmarkEdge.textContent = formatRatio(manifest.benchmarkEdge, 3);
        if (els.trades) els.trades.textContent = String(summary.total_trades ?? '--');
        if (els.latestSignal) {
            const latest = manifest.latestSignal || {};
            els.latestSignal.textContent = `${String(latest.action || '--').toUpperCase()} / ${String(latest.side || '--').toUpperCase()} / ${String(latest.module || '--').toUpperCase()}`;
        }

        if (els.statusChips) {
            const chips = [
                chip(`run ${manifest.mode || 'n/a'}`, manifest.status === 'success' ? 'good' : 'warn'),
                chip(`pipeline ${status.stage || 'idle'}`, status.updating ? 'warn' : 'good'),
                chip(`champion ${manifest.championStatus || 'unknown'}`, manifest.championStatus === 'pass' ? 'good' : 'bad'),
            ];
            if (manifest.stale) chips.push(chip('stale', 'warn'));
            if (cached) chips.push(chip('cached fallback', 'warn'));
            if (degraded) chips.push(chip('degraded source', 'bad'));
            els.statusChips.innerHTML = chips.join('');
        }

        const generatedAt = manifest.generatedAt ? new Date(manifest.generatedAt).toLocaleString() : '--';
        const cacheNote = cached ? ' Cached fallback active.' : '';
        const degradeNote = degraded ? ' Source directory degraded.' : '';
        setRouterStatus(`Generated ${generatedAt}. Champion ${manifest.championCandidateId || '--'} in ${String(manifest.currentRegime || '--').toUpperCase()} regime.${cacheNote}${degradeNote}`);

        renderModuleTable(summary.module_breakdown || []);
        renderCandidateTable(run?.backtestSummary?.candidates || []);
        renderDownloads(manifest.runId, manifest.files || {});
        renderEquityChart(run?.equity || []);
        renderRegimeChart(run?.regimeSeries || []);
        renderWalkForwardChart(run?.walkForward?.folds || []);
        renderBenchmarkChart(summary);
    }

    function renderModuleTable(rows) {
        if (!els.moduleTable) return;
        els.moduleTable.innerHTML = rows.map((row) => `<tr>
            <td>${String(row.module || '--').replace('_', ' ')}</td>
            <td>${formatPercent(row.totalReturn, 2, true)}</td>
            <td>${formatRatio(row.sharpeRatio, 3)}</td>
            <td>${String(row.totalTrades ?? '--')}</td>
            <td>${formatPercent(row.winRate, 1)}</td>
        </tr>`).join('');
    }

    function renderCandidateTable(rows) {
        if (!els.candidateTable) return;
        els.candidateTable.innerHTML = rows.map((row) => `<tr>
            <td>${row.candidateId || '--'}</td>
            <td>${String(row.status || '--').toUpperCase()}</td>
            <td>${formatRatio(row.summary?.sharpe_ratio, 3)}</td>
            <td>${formatPercent(row.summary?.max_drawdown, 2, false)}</td>
            <td>${formatRatio(row.benchmarkEdge, 3)}</td>
        </tr>`).join('');
    }

    function renderDownloads(runId, files) {
        if (!els.downloads || !runId) return;
        els.downloads.innerHTML = Object.keys(files).map((key) => {
            const file = files[key];
            const href = `/api/quant/router/runs/${encodeURIComponent(runId)}/file/${encodeURIComponent(file)}`;
            return `<a href="${href}">${key}</a>`;
        }).join('');
    }

    function destroyChart(key) {
        if (state.charts[key]) {
            state.charts[key].destroy();
            state.charts[key] = null;
        }
    }

    function renderEquityChart(rows) {
        if (!els.equityCanvas || !window.Chart) return;
        destroyChart('equity');
        state.charts.equity = new Chart(els.equityCanvas, {
            type: 'line',
            data: {
                labels: rows.map((row) => String(row.timestamp || '').slice(0, 10)),
                datasets: [{
                    label: 'Strategy Equity',
                    data: rows.map((row) => toNumber(row.equity, 0)),
                    borderColor: '#00FFAA',
                    backgroundColor: 'rgba(0,255,170,0.12)',
                    fill: true,
                    pointRadius: 0,
                    tension: 0.18,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#8EA0B8', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { ticks: { color: '#8EA0B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                },
                plugins: { legend: { labels: { color: '#D6E0F0' } } },
            },
        });
    }

    function renderRegimeChart(rows) {
        if (!els.regimeCanvas || !window.Chart) return;
        const regimeMap = { bear: -1, neutral: 0, bull: 1 };
        destroyChart('regime');
        state.charts.regime = new Chart(els.regimeCanvas, {
            type: 'line',
            data: {
                labels: rows.map((row) => String(row.timestamp || '').slice(0, 10)),
                datasets: [{
                    label: 'Regime',
                    data: rows.map((row) => regimeMap[row.state] ?? 0),
                    borderColor: '#00E5FF',
                    pointRadius: 0,
                    stepped: true,
                    tension: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#8EA0B8', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: {
                        min: -1,
                        max: 1,
                        ticks: {
                            color: '#8EA0B8',
                            callback(value) {
                                if (value === 1) return 'Bull';
                                if (value === 0) return 'Neutral';
                                if (value === -1) return 'Bear';
                                return '';
                            },
                        },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                    },
                },
                plugins: { legend: { labels: { color: '#D6E0F0' } } },
            },
        });
    }

    function renderWalkForwardChart(folds) {
        if (!els.walkForwardCanvas || !window.Chart) return;
        destroyChart('walkForward');
        state.charts.walkForward = new Chart(els.walkForwardCanvas, {
            type: 'bar',
            data: {
                labels: folds.map((fold) => fold.foldId || '--'),
                datasets: [{
                    label: 'Fold Sharpe',
                    data: folds.map((fold) => toNumber(fold.sharpeRatio, 0)),
                    backgroundColor: folds.map((fold) => toNumber(fold.sharpeRatio, 0) >= 0 ? 'rgba(0,255,170,0.65)' : 'rgba(255,77,79,0.65)'),
                    borderColor: folds.map((fold) => toNumber(fold.sharpeRatio, 0) >= 0 ? '#00FFAA' : '#FF4D4F'),
                    borderWidth: 1,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#8EA0B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { ticks: { color: '#8EA0B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                },
                plugins: { legend: { labels: { color: '#D6E0F0' } } },
            },
        });
    }

    function renderBenchmarkChart(summary) {
        if (!els.benchmarkCanvas || !window.Chart) return;
        const benchmarks = Array.isArray(summary?.benchmarks) ? summary.benchmarks : [];
        destroyChart('benchmark');
        state.charts.benchmark = new Chart(els.benchmarkCanvas, {
            type: 'bar',
            data: {
                labels: ['Strategy', ...benchmarks.map((row) => row.name)],
                datasets: [{
                    label: 'Total Return',
                    data: [toNumber(summary?.total_return, 0), ...benchmarks.map((row) => toNumber(row.totalReturn, 0))],
                    backgroundColor: ['rgba(0,229,255,0.65)', 'rgba(0,255,170,0.55)', 'rgba(245,158,11,0.55)'],
                    borderColor: ['#00E5FF', '#00FFAA', '#F59E0B'],
                    borderWidth: 1,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#8EA0B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: {
                        ticks: {
                            color: '#8EA0B8',
                            callback(value) { return `${value * 100}%`; },
                        },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                    },
                },
                plugins: { legend: { labels: { color: '#D6E0F0' } } },
            },
        });
    }

    function bindRouterEvents() {
        if (els.runSelect) {
            els.runSelect.addEventListener('change', () => {
                loadRouterRun(els.runSelect.value).catch((error) => {
                    setRouterStatus(`Router reload failed: ${error.message || error}`);
                });
            });
        }
        if (els.reloadBtn) {
            els.reloadBtn.addEventListener('click', async () => {
                try {
                    const runId = await loadRouterRuns(els.runSelect ? els.runSelect.value : '');
                    if (runId) {
                        await loadRouterRun(runId);
                    }
                } catch (error) {
                    setRouterStatus(`Router reload failed: ${error.message || error}`);
                }
            });
        }
    }

    async function initRouterSection() {
        collectRouterElements();
        bindRouterEvents();
        if (!els.runSelect) return;
        try {
            const runId = await loadRouterRuns();
            if (runId) {
                await loadRouterRun(runId);
            }
        } catch (error) {
            setRouterStatus(`BTC Regime Router failed to initialize: ${error.message || error}`);
        }
    }

    document.addEventListener('DOMContentLoaded', initRouterSection);
})();
