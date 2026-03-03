(function () {
    'use strict';

    const state = {
        model: 'lstm',
        asset: 'BTCUSDT',
        horizon: '1H',
        mode: 'UNKNOWN',
        modelVersion: '--',
        heatmapChart: null,
        loading: false,
    };

    const els = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function safeText(value, fallback = '--') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    }

    function formatRatio(value, digits = 2) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return num.toFixed(digits);
    }

    function formatPercent(value, digits = 2) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        const signed = num >= 0 ? '+' : '';
        return `${signed}${(num * 100).toFixed(digits)}%`;
    }

    function setLoading(flag) {
        state.loading = flag;
        if (!els.loadingMask) return;
        els.loadingMask.style.display = flag ? 'flex' : 'none';
    }

    function notifyError(message) {
        if (window.showToast && window.showToast.error) {
            window.showToast.error(message, 3500);
            return;
        }
        console.error(message);
    }

    function collectElements() {
        els.modeBadge = byId('modelModeBadge');
        els.loadedModelBadge = byId('loadedModelBadge');
        els.predictionContext = byId('predictionContext');
        els.predictionConfidenceTag = byId('predictionConfidenceTag');
        els.pUpValue = byId('predictionPUp');
        els.q50Value = byId('predictionQ50');
        els.intervalWidthValue = byId('predictionIntervalWidth');
        els.explanationSummary = byId('modelExplanationSummary');
        els.featuresList = byId('topFeaturesList');

        els.metricAccuracy = byId('metricDirectionAccuracy');
        els.metricBrier = byId('metricBrierScore');
        els.metricEce = byId('metricEce');
        els.metricCoverage = byId('metricCoverage');

        els.assetSelect = byId('assetSelect');
        els.modelButtons = Array.from(document.querySelectorAll('[data-model-btn]'));
        els.horizonButtons = Array.from(document.querySelectorAll('[data-horizon-btn]'));
        els.heatmapCanvas = byId('heatmapChart');
        els.loadingMask = byId('modelExplorerLoading');
        els.refreshButton = byId('modelExplorerRefresh');
    }

    function applyButtonStates() {
        els.modelButtons.forEach((button) => {
            const active = button.dataset.model === state.model;
            button.classList.toggle('btn-primary', active);
            button.classList.toggle('btn-secondary', !active);
        });

        els.horizonButtons.forEach((button) => {
            const active = button.dataset.horizon === state.horizon;
            button.classList.toggle('btn-primary', active);
            button.classList.toggle('btn-secondary', !active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (els.assetSelect) {
            els.assetSelect.value = state.asset;
        }
    }

    function modeClass(mode) {
        const normalized = String(mode || '').toUpperCase();
        if (normalized === 'MOCK') return 'warning';
        if (normalized === 'LIVE') return 'success';
        return 'info';
    }

    function renderMeta(meta) {
        if (!meta) return;
        state.mode = safeText(meta.mode, 'unknown').toUpperCase();
        state.modelVersion = safeText(meta.modelVersion, '--');

        if (els.modeBadge) {
            els.modeBadge.className = `status-badge ${modeClass(state.mode)}`;
            els.modeBadge.textContent = state.mode === 'MOCK' ? 'MOCK FEED' : state.mode === 'LIVE' ? 'LIVE MODEL' : state.mode;
        }

        if (els.loadedModelBadge) {
            els.loadedModelBadge.textContent = `Model ${state.modelVersion}`;
        }

        if (els.predictionContext) {
            els.predictionContext.textContent = `${state.asset} • ${state.horizon} Horizon • ${state.model.toUpperCase()} • ${state.modelVersion}`;
        }
    }

    function renderPrediction(payload) {
        if (!payload) return;
        renderMeta(payload.meta);

        const prediction = payload.prediction || {};
        if (els.pUpValue) {
            els.pUpValue.textContent = formatRatio(prediction.pUp, 2);
        }
        if (els.q50Value) {
            els.q50Value.textContent = formatPercent(prediction.q50, 2);
        }
        if (els.intervalWidthValue) {
            els.intervalWidthValue.textContent = formatPercent(prediction.intervalWidth, 2);
        }

        if (els.predictionConfidenceTag) {
            const confidence = Number(prediction.confidence);
            const text = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}% Confidence` : 'Confidence --';
            els.predictionConfidenceTag.textContent = text;
            els.predictionConfidenceTag.className = `status-badge ${confidence >= 0.75 ? 'success' : confidence >= 0.55 ? 'warning' : 'info'}`;
        }

        const explanation = payload.explanation || {};
        if (els.explanationSummary) {
            els.explanationSummary.textContent = safeText(explanation.summary, 'No explanation available.');
        }

        renderTopFeatures(explanation.topFeatures || []);
    }

    function renderTopFeatures(features) {
        if (!els.featuresList) return;

        if (!Array.isArray(features) || !features.length) {
            els.featuresList.innerHTML = '<div style="color: var(--text-muted);">No feature contribution data.</div>';
            return;
        }

        const maxAbs = features.reduce((acc, item) => Math.max(acc, Math.abs(Number(item.value) || 0)), 0) || 1;

        els.featuresList.innerHTML = features.slice(0, 6).map((item) => {
            const value = Number(item.value) || 0;
            const width = Math.max(6, Math.round((Math.abs(value) / maxAbs) * 100));
            const color = value >= 0 ? 'var(--success)' : 'var(--danger)';
            const sign = value >= 0 ? '+' : '';
            return `
                <div style="margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">${safeText(item.name)}</span>
                        <span class="mono" style="font-weight: 600; color: ${color};">${sign}${value.toFixed(3)}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${width}%; background: ${color};"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderPerformance(payload) {
        if (!payload) return;
        renderMeta(payload.meta);

        const perf = payload.performance || {};
        if (els.metricAccuracy) els.metricAccuracy.textContent = `${formatPercent(perf.directionAccuracy, 1).replace('+', '')}`;
        if (els.metricBrier) els.metricBrier.textContent = formatRatio(perf.brierScore, 3);
        if (els.metricEce) els.metricEce.textContent = formatRatio(perf.ece, 3);
        if (els.metricCoverage) els.metricCoverage.textContent = `${formatPercent(perf.intervalCoverage, 1).replace('+', '')}`;
    }

    function colorForHeatValue(value) {
        const clamped = Math.max(-2.5, Math.min(2.5, Number(value) || 0));
        const normalized = (clamped + 2.5) / 5.0;
        const r = Math.round(240 * (1 - normalized) + 15 * normalized);
        const g = Math.round(45 * (1 - normalized) + 230 * normalized);
        const b = Math.round(85 * (1 - normalized) + 255 * normalized);
        return `rgba(${r}, ${g}, ${b}, 0.88)`;
    }

    function renderHeatmap(payload) {
        if (!els.heatmapCanvas || !window.Chart || !payload) return;
        renderMeta(payload.meta);

        const xLabels = Array.isArray(payload.xLabels) ? payload.xLabels : [];
        const yLabels = Array.isArray(payload.yLabels) ? payload.yLabels : [];
        const matrix = Array.isArray(payload.matrix) ? payload.matrix : [];

        const points = [];
        for (let row = 0; row < yLabels.length; row += 1) {
            const values = Array.isArray(matrix[row]) ? matrix[row] : [];
            for (let col = 0; col < xLabels.length; col += 1) {
                points.push({
                    x: col,
                    y: yLabels.length - row - 1,
                    r: 10,
                    v: Number(values[col] || 0),
                    feature: yLabels[row],
                    window: xLabels[col],
                });
            }
        }

        if (state.heatmapChart) {
            state.heatmapChart.destroy();
        }

        state.heatmapChart = new Chart(els.heatmapCanvas, {
            type: 'bubble',
            data: {
                datasets: [
                    {
                        label: 'Feature Heatmap',
                        data: points,
                        backgroundColor: (ctx) => colorForHeatValue(ctx.raw?.v),
                        borderColor: 'rgba(255,255,255,0.18)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const raw = items[0]?.raw;
                                return `${raw?.feature || ''} • ${raw?.window || ''}`;
                            },
                            label: (item) => `Impact: ${(Number(item.raw?.v) || 0).toFixed(3)}`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: -0.5,
                        max: xLabels.length - 0.5,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            stepSize: 1,
                            callback: (value) => xLabels[value] || '',
                            color: '#8b9bb4',
                        },
                    },
                    y: {
                        type: 'linear',
                        min: -0.5,
                        max: yLabels.length - 0.5,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            stepSize: 1,
                            callback: (value) => yLabels[yLabels.length - Number(value) - 1] || '',
                            color: '#8b9bb4',
                        },
                    },
                },
            },
        });
    }

    function selectedPayload() {
        return {
            model: state.model,
            asset: state.asset,
            horizon: state.horizon,
        };
    }

    async function refreshAll() {
        if (!window.api) {
            notifyError('API client is not available on this page.');
            return;
        }

        setLoading(true);
        try {
            const payload = selectedPayload();
            const [prediction, heatmap, performance] = await Promise.all([
                api.getModelExplorerPrediction(payload),
                api.getModelExplorerHeatmap(payload),
                api.getModelExplorerPerformance(payload),
            ]);

            renderPrediction(prediction);
            renderHeatmap(heatmap);
            renderPerformance(performance);
        } catch (error) {
            notifyError(`Model explorer refresh failed: ${error.message || error}`);
        } finally {
            setLoading(false);
        }
    }

    async function initCatalog() {
        if (!window.api) return;

        try {
            const [modelsRes, assetsRes, healthRes] = await Promise.all([
                api.getModelExplorerModels(),
                api.getModelExplorerAssets(),
                api.getModelExplorerHealth(),
            ]);

            renderMeta({
                mode: healthRes.mode,
                modelVersion: healthRes.modelVersion,
                timestamp: healthRes.loadedAt,
            });

            const models = Array.isArray(modelsRes.models) ? modelsRes.models : [];
            if (models.some((model) => model.id === state.model) === false && models.length) {
                state.model = models[0].id;
            }

            const assets = Array.isArray(assetsRes.assets) ? assetsRes.assets : [];
            if (els.assetSelect) {
                els.assetSelect.innerHTML = assets.map((asset) => `<option value="${asset.symbol}">${asset.label}</option>`).join('');
                if (!assets.some((asset) => asset.symbol === state.asset) && assets.length) {
                    state.asset = assets[0].symbol;
                }
                els.assetSelect.value = state.asset;
            }
        } catch (error) {
            notifyError(`Catalog load failed: ${error.message || error}`);
        }
    }

    function bindEvents() {
        els.modelButtons.forEach((button) => {
            button.addEventListener('click', () => {
                state.model = button.dataset.model;
                applyButtonStates();
                refreshAll();
            });
        });

        els.horizonButtons.forEach((button) => {
            button.addEventListener('click', () => {
                state.horizon = button.dataset.horizon;
                applyButtonStates();
                refreshAll();
            });
        });

        if (els.assetSelect) {
            els.assetSelect.addEventListener('change', (event) => {
                state.asset = event.target.value;
                applyButtonStates();
                refreshAll();
            });
        }

        if (els.refreshButton) {
            els.refreshButton.addEventListener('click', () => {
                refreshAll();
            });
        }
    }

    async function init() {
        collectElements();
        bindEvents();
        applyButtonStates();
        await initCatalog();
        applyButtonStates();
        await refreshAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
