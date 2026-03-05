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
            els.totalReturn.className = `metric-value ${totalReturn >= 0 ? 'metric-positive' : 'metric-negative'}`;
        }
        if (els.sharpe) els.sharpe.textContent = formatRatio(summary.sharpe_ratio, 3);
        if (els.maxDd) {
            els.maxDd.textContent = formatPercent(maxDd, 2, true);
            els.maxDd.className = `metric-value ${maxDd <= 0.2 ? 'metric-positive' : 'metric-negative'}`;
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

        renderMetrics(targetSummary);
        renderEquityChart(Array.isArray(detailRes.equity) ? detailRes.equity : []);
        renderRadarChart(state.summaryRows);
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
