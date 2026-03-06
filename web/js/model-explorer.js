(function () {
    'use strict';

    const DEFAULT_COMPATIBILITY = {
        lstm: ['1H', '4H', '1D'],
        ensemble: ['1H', '4H', '1D', '3D'],
        transformer: ['4H', '1D', '3D'],
        tcn: ['1H', '4H'],
    };

    const MODEL_ORDER = ['lstm', 'ensemble', 'transformer', 'tcn'];

    const MODEL_LABELS = {
        lstm: 'LSTM+Attention',
        ensemble: 'LightGBM Ensemble',
        transformer: 'Transformer',
        tcn: 'TCN',
    };

    const HEALTH_CLASS_MAP = {
        HEALTHY: 'healthy',
        DRIFT_DETECTED: 'drift',
        IN_REVIEW: 'review',
    };

    const HEALTH_LABEL_MAP = {
        HEALTHY: 'Healthy',
        DRIFT_DETECTED: 'Drift Detected',
        IN_REVIEW: 'In Review',
    };

    const RUNTIME_CLASS_MAP = {
        LIVE: 'success',
        STALE: 'warning',
        DEGRADED: 'warning',
        UNAVAILABLE: 'info',
    };

    const AUTO_REFRESH_MS = 10000;

    const COMPARISON_COLORS = {
        lstm: '#00e5ff',
        ensemble: '#00ffaa',
        transformer: '#a78bfa',
        tcn: '#f59e0b',
    };

    const state = {
        model: 'lstm',
        asset: 'BTCUSDT',
        horizon: '1H',
        mode: 'UNKNOWN',
        modelVersion: '--',
        loading: false,
        viewMode: 'individual',
        xaiScope: 'local',
        xaiChartMode: 'heatmap',
        heatmapChart: null,
        waterfallChart: null,
        comparisonRadarChart: null,
        heatmapScale: { min: -1, max: 1 },
        highlightedFeatureKey: null,
        lastTopFeatures: [],
        assetHorizonMap: {},
        compatibilityByModel: { ...DEFAULT_COMPATIBILITY },
        healthByModel: {},
        runtimeByModel: {},
        selection: {},
        lastPrediction: null,
        lastPerformance: null,
        lastHeatmap: null,
        lastInsights: null,
        autoRefreshHandle: null,
        baselineSnapshot: null,
        whatIf: {
            volatilityDelta: 0,
        },
        cycleId: 0,
    };

    const els = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function safeText(value, fallback = '--') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    }

    function toNumber(value, fallback = NaN) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeFeatureKey(name) {
        return safeText(name, '').trim().toLowerCase();
    }

    function titleCase(text) {
        return text
            .split(' ')
            .map((chunk) => (chunk ? chunk[0].toUpperCase() + chunk.slice(1) : chunk))
            .join(' ');
    }

    function formatFeatureName(rawName) {
        const key = normalizeFeatureKey(rawName);
        const map = {
            momentum_20d: 'Momentum (20d)',
            volatility_score: 'Volatility Score',
            us_correlation: 'US Correlation',
            size_factor: 'Size Factor',
            volume_change: 'Volume Change',
            volume_ratio: 'Volume Ratio',
            news_sentiment: 'News Sentiment',
            return_1: 'Return (1)',
            return_3: 'Return (3)',
            return_6: 'Return (6)',
            momentum_6: 'Momentum (6)',
            momentum_12: 'Momentum (12)',
            vol_6: 'Volatility (6)',
            missing_coverage: 'Missing Coverage',
        };

        if (map[key]) {
            return map[key];
        }

        const trailingWindow = key.match(/^(.*)_(\d+)([a-z])$/i);
        if (trailingWindow) {
            const label = titleCase(trailingWindow[1].replace(/_/g, ' '));
            return `${label} (${trailingWindow[2]}${trailingWindow[3].toUpperCase()})`;
        }

        const trailingNumber = key.match(/^(.*)_(\d+)$/);
        if (trailingNumber) {
            const label = titleCase(trailingNumber[1].replace(/_/g, ' '));
            return `${label} (${trailingNumber[2]})`;
        }

        return titleCase(key.replace(/_/g, ' '));
    }

    function formatRatio(value, digits = 2) {
        const num = toNumber(value);
        if (!Number.isFinite(num)) return '--';
        return num.toFixed(digits);
    }

    function formatSignedPercent(value, digits = 2) {
        const num = toNumber(value);
        if (!Number.isFinite(num)) return '--';
        const sign = num >= 0 ? '+' : '';
        return `${sign}${(num * 100).toFixed(digits)}%`;
    }

    function formatPercentNoSign(value, digits = 1) {
        const num = toNumber(value);
        if (!Number.isFinite(num)) return '--';
        return `${(num * 100).toFixed(digits)}%`;
    }

    function modeClass(mode) {
        const normalized = String(mode || '').toUpperCase();
        if (normalized === 'MOCK') return 'warning';
        if (normalized === 'LIVE') return 'success';
        return 'info';
    }

    function runtimeBadgeClass(status) {
        return RUNTIME_CLASS_MAP[String(status || '').toUpperCase()] || 'info';
    }

    function effectiveHorizon() {
        return safeText(state.selection?.resolvedHorizon || state.horizon, state.horizon);
    }

    function setLoading(flag) {
        state.loading = flag;
        if (!els.loadingMask) return;
        els.loadingMask.style.display = flag ? 'flex' : 'none';
    }

    function notify(message, level = 'info', duration = 3500) {
        if (!window.showToast) {
            if (level === 'error') {
                console.error(message);
            } else {
                console.log(message);
            }
            return;
        }

        if (level === 'error' && typeof window.showToast.error === 'function') {
            window.showToast.error(message, duration);
            return;
        }
        if (level === 'warning' && typeof window.showToast.warning === 'function') {
            window.showToast.warning(message, duration);
            return;
        }
        if (level === 'success' && typeof window.showToast.success === 'function') {
            window.showToast.success(message, duration);
            return;
        }
        if (typeof window.showToast.info === 'function') {
            window.showToast.info(message, duration);
        }
    }

    function collectElements() {
        els.modeBadge = byId('modelModeBadge');
        els.loadedModelBadge = byId('loadedModelBadge');
        els.predictionContext = byId('predictionContext');
        els.predictionConfidenceTag = byId('predictionConfidenceTag');
        els.runtimeStatusBadge = byId('runtimeStatusBadge');
        els.runtimeStatusText = byId('runtimeStatusText');
        els.runtimeNoticeBanner = byId('runtimeNoticeBanner');
        els.pUpValue = byId('predictionPUp');
        els.q50Value = byId('predictionQ50');
        els.intervalWidthValue = byId('predictionIntervalWidth');
        els.explanationSummary = byId('modelExplanationSummary');
        els.ensembleCard = byId('ensembleCard');
        els.ensembleFusedPup = byId('ensembleFusedPup');
        els.ensembleBlendText = byId('ensembleBlendText');
        els.ensembleExplanation = byId('ensembleExplanation');
        els.ensembleConfidence = byId('ensembleConfidence');
        els.ensembleDisagreement = byId('ensembleDisagreement');

        els.metricAccuracy = byId('metricDirectionAccuracy');
        els.metricBrier = byId('metricBrierScore');
        els.metricEce = byId('metricEce');
        els.metricCoverage = byId('metricCoverage');

        els.assetSelect = byId('assetSelect');
        els.modelButtons = Array.from(document.querySelectorAll('[data-model-btn], [data-model]'));
        els.horizonButtons = Array.from(document.querySelectorAll('[data-horizon-btn], [data-horizon]'));
        els.featuresList = byId('topFeaturesList');

        els.heatmapCanvas = byId('heatmapChart');
        els.heatmapEmptyState = byId('heatmapEmptyState');
        els.waterfallWrap = byId('waterfallWrap');
        els.waterfallCanvas = byId('waterfallChart');
        els.insightPositive = byId('heatmapInsightPositive');
        els.insightNegative = byId('heatmapInsightNegative');
        els.insightNeutral = byId('heatmapInsightNeutral');
        els.xaiModeBadge = byId('xaiModeBadge');
        els.scopeLocalBtn = byId('scopeLocalBtn');
        els.scopeGlobalBtn = byId('scopeGlobalBtn');
        els.xaiHeatmapBtn = byId('xaiHeatmapBtn');
        els.xaiWaterfallBtn = byId('xaiWaterfallBtn');

        els.loadingMask = byId('modelExplorerLoading');
        els.refreshButton = byId('modelExplorerRefresh');
        els.viewIndividualBtn = byId('viewIndividualBtn');
        els.viewEnsembleBtn = byId('viewEnsembleBtn');
        els.comparisonTableBody = byId('comparisonTableBody');
        els.comparisonRadarCanvas = byId('comparisonRadarChart');
        els.whatIfSlider = byId('whatIfVolatilitySlider');
        els.whatIfDeltaValue = byId('whatIfDeltaValue');
        els.whatIfResetBtn = byId('whatIfResetBtn');
        els.whatIfSimPup = byId('whatIfSimPup');
        els.whatIfSimConfidence = byId('whatIfSimConfidence');
        els.whatIfSimExplanation = byId('whatIfSimExplanation');
        els.copyExplanationBtn = byId('copyExplanationBtn');
        els.exportShapBtn = byId('exportShapBtn');
        els.disclaimer = byId('modelExplorerDisclaimer');
    }

    function getModelFromButton(button) {
        return button.dataset.modelBtn || button.dataset.model || '';
    }

    function getHorizonFromButton(button) {
        return button.dataset.horizonBtn || button.dataset.horizon || '';
    }

    function syncModelCompatibility() {
        els.modelButtons.forEach((button) => {
            button.classList.remove('disabled');
            button.setAttribute('aria-disabled', 'false');
        });
    }

    function formatCompatibilityText(modelId) {
        const compatibility = state.compatibilityByModel || DEFAULT_COMPATIBILITY;
        const horizons = compatibility[modelId] || [];
        if (!horizons.length) return 'Best: In Review';
        return `Best: ${horizons.join('-')}`;
    }

    function syncHorizonAvailability() {
        const allowedList = Array.isArray(state.assetHorizonMap[state.asset]) ? state.assetHorizonMap[state.asset] : [];
        const allowed = new Set(allowedList);
        els.horizonButtons.forEach((button) => {
            const horizon = getHorizonFromButton(button);
            const enabled = allowed.has(horizon);
            button.disabled = !enabled;
            button.style.opacity = enabled ? '1' : '0.45';
            button.style.cursor = enabled ? 'pointer' : 'not-allowed';
        });

        if (allowedList.length && !allowed.has(state.horizon)) {
            state.horizon = allowedList[0];
        }
    }

    function applyButtonStates() {
        els.modelButtons.forEach((button) => {
            const modelId = getModelFromButton(button);
            const active = modelId === state.model;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        els.horizonButtons.forEach((button) => {
            const active = getHorizonFromButton(button) === state.horizon;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (els.assetSelect) {
            els.assetSelect.value = state.asset;
        }

        if (els.viewIndividualBtn && els.viewEnsembleBtn) {
            const individual = state.viewMode === 'individual';
            els.viewIndividualBtn.classList.toggle('active', individual);
            els.viewEnsembleBtn.classList.toggle('active', !individual);
        }

        if (els.scopeLocalBtn && els.scopeGlobalBtn) {
            const local = state.xaiScope === 'local';
            els.scopeLocalBtn.classList.toggle('active', local);
            els.scopeGlobalBtn.classList.toggle('active', !local);
        }

        if (els.xaiHeatmapBtn && els.xaiWaterfallBtn) {
            const heatmap = state.xaiChartMode === 'heatmap';
            els.xaiHeatmapBtn.classList.toggle('active', heatmap);
            els.xaiWaterfallBtn.classList.toggle('active', !heatmap);
        }

        Array.from(document.querySelectorAll('[data-compat-for]')).forEach((tag) => {
            const modelId = tag.getAttribute('data-compat-for');
            if (modelId) {
                tag.textContent = formatCompatibilityText(modelId);
            }
        });
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

        if (els.disclaimer) {
            if (state.mode === 'MOCK') {
                els.disclaimer.textContent = `${state.modelVersion || 'Mock-v1'} - Simulated Data | Not for Trading`;
            } else {
                els.disclaimer.textContent = `${state.modelVersion || 'Live'} - ${state.mode} Data | Not for Trading`;
            }
        }

        if (els.predictionContext) {
            els.predictionContext.textContent = `${state.asset} | ${effectiveHorizon()} Horizon | ${state.model.toUpperCase()} | ${state.modelVersion}`;
        }
    }

    function normalizeSummary(summary, features) {
        let result = safeText(summary, 'No explanation available.');
        if (!Array.isArray(features)) return result;

        features.forEach((feature) => {
            const rawName = safeText(feature.name, '');
            if (!rawName) return;
            const readable = formatFeatureName(rawName);
            const escaped = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(escaped, 'g'), readable);
        });

        return result;
    }

    function getSignalFromProbability(pUp) {
        if (pUp >= 0.55) return 'LONG';
        if (pUp <= 0.45) return 'SHORT';
        return 'FLAT';
    }

    function getPredictionToneClass(pUp) {
        if (!Number.isFinite(pUp)) return 'neutral';
        if (pUp > 0.52) return 'positive';
        if (pUp < 0.48) return 'negative';
        return 'neutral';
    }

    function getPrimaryViewPayload() {
        const ensemblePayload = state.lastInsights?.ensemble;
        const ensemblePrediction = ensemblePayload?.enabled ? ensemblePayload?.fusedPrediction : null;
        if (state.viewMode === 'ensemble' && ensemblePrediction) {
            return {
                prediction: ensemblePrediction,
                summary: safeText(ensemblePayload?.explanation, 'Ensemble view is active.'),
                label: 'ENSEMBLE',
            };
        }
        return {
            prediction: state.lastPrediction?.prediction || null,
            summary: normalizeSummary(state.lastPrediction?.explanation?.summary, state.lastPrediction?.explanation?.topFeatures || []),
            label: MODEL_LABELS[state.model] || state.model.toUpperCase(),
        };
    }

    function renderPredictionAndExplanation() {
        const viewPayload = getPrimaryViewPayload();
        const prediction = viewPayload.prediction;
        if (!prediction) {
            renderPredictionUnavailable('Runtime unavailable for the selected model.');
            return;
        }

        const pUp = toNumber(prediction.pUp);
        const q50 = toNumber(prediction.q50);
        const intervalWidth = toNumber(prediction.intervalWidth);
        const confidence = toNumber(prediction.confidence);

        if (els.pUpValue) {
            const toneClass = getPredictionToneClass(pUp);
            els.pUpValue.className = `prediction-value ${toneClass}`;
            els.pUpValue.textContent = formatRatio(pUp, 2);
        }

        if (els.q50Value) {
            const qClass = q50 > 0.0001 ? 'positive' : q50 < -0.0001 ? 'negative' : 'neutral';
            els.q50Value.className = `prediction-value ${qClass}`;
            els.q50Value.textContent = formatSignedPercent(q50, 2);
        }

        if (els.intervalWidthValue) {
            els.intervalWidthValue.className = 'prediction-value neutral';
            els.intervalWidthValue.textContent = formatSignedPercent(intervalWidth, 2);
        }

        if (els.predictionConfidenceTag) {
            const signal = safeText(prediction.signal, getSignalFromProbability(pUp));
            const confidenceText = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}% Confidence` : 'Confidence --';
            els.predictionConfidenceTag.textContent = `${signal} | ${confidenceText}`;
            els.predictionConfidenceTag.className = `status-badge ${confidence >= 0.75 ? 'success' : confidence >= 0.55 ? 'warning' : 'info'}`;
        }

        if (els.predictionContext) {
            els.predictionContext.textContent = `${state.asset} | ${effectiveHorizon()} Horizon | ${viewPayload.label} | ${state.modelVersion}`;
        }

        if (els.explanationSummary) {
            els.explanationSummary.textContent = viewPayload.summary;
        }

        state.baselineSnapshot = {
            pUp: Number.isFinite(pUp) ? pUp : 0.5,
            confidence: Number.isFinite(confidence) ? confidence : 0.5,
            summary: viewPayload.summary,
        };

        renderWhatIfPreview();
    }

    function mapModelNameForBlend(modelId) {
        if (modelId === 'ensemble') return 'LightGBM';
        if (modelId === 'lstm') return 'LSTM';
        if (modelId === 'transformer') return 'Transformer';
        if (modelId === 'tcn') return 'TCN';
        return String(modelId || '').toUpperCase();
    }

    function renderEnsembleCard() {
        const ensemble = state.lastInsights?.ensemble;
        if (!ensemble || !els.ensembleCard || ensemble.enabled === false) {
            if (els.ensembleCard) els.ensembleCard.style.display = 'none';
            return;
        }

        els.ensembleCard.style.display = '';
        const fused = ensemble.fusedPrediction || {};
        const fusedPup = toNumber(fused.pUp);
        const confidence = toNumber(fused.confidence);

        if (els.ensembleFusedPup) {
            els.ensembleFusedPup.textContent = `Fused P(UP): ${formatRatio(fusedPup, 2)}`;
            els.ensembleFusedPup.style.color = fusedPup > 0.5 ? '#00FFAA' : fusedPup < 0.5 ? '#FF4D4F' : '#facc15';
        }

        if (els.ensembleBlendText) {
            const blend = Array.isArray(ensemble.blend) ? ensemble.blend : [];
            if (blend.length) {
                const blendText = blend
                    .map((part) => `${Math.round(toNumber(part.weight, 0) * 100)}% ${mapModelNameForBlend(part.model)}`)
                    .join(' + ');
                els.ensembleBlendText.textContent = `Blended: ${blendText}`;
            } else {
                els.ensembleBlendText.textContent = 'Blended: --';
            }
        }

        if (els.ensembleExplanation) {
            els.ensembleExplanation.textContent = safeText(ensemble.explanation, 'Ensemble explanation unavailable.');
        }
        if (els.ensembleConfidence) {
            els.ensembleConfidence.textContent = `Confidence: ${Number.isFinite(confidence) ? Math.round(confidence * 100) : '--'}%`;
        }
        if (els.ensembleDisagreement) {
            const disagreement = toNumber(ensemble.disagreementScore);
            els.ensembleDisagreement.textContent = `Disagreement: ${Number.isFinite(disagreement) ? disagreement.toFixed(3) : '--'}`;
        }
    }

    function updateHealthBadges() {
        Array.from(document.querySelectorAll('[data-health-for]')).forEach((node) => {
            const modelId = node.getAttribute('data-health-for');
            const payload = state.healthByModel?.[modelId] || null;
            const status = payload ? safeText(payload?.status, 'IN_REVIEW').toUpperCase() : 'UNAVAILABLE';
            const cssClass = HEALTH_CLASS_MAP[status] || 'review';
            node.className = `model-health-badge ${cssClass}`;
            node.textContent = payload ? (HEALTH_LABEL_MAP[status] || 'In Review') : 'Quality N/A';
            const psi = toNumber(payload?.psi);
            const drop = toNumber(payload?.coverageDropPct);
            const reason = safeText(payload?.reason, 'Quality status unavailable.');
            node.title = payload
                ? `Status: ${HEALTH_LABEL_MAP[status] || status} | PSI: ${Number.isFinite(psi) ? psi.toFixed(3) : '--'} | Coverage Drop: ${Number.isFinite(drop) ? drop.toFixed(2) : '--'}% | ${reason}`
                : 'Quality status unavailable.';
        });
    }

    function renderPredictionUnavailable(message) {
        if (els.pUpValue) els.pUpValue.textContent = '--';
        if (els.q50Value) els.q50Value.textContent = '--';
        if (els.intervalWidthValue) els.intervalWidthValue.textContent = '--';
        if (els.explanationSummary) els.explanationSummary.textContent = message || 'Runtime unavailable.';
        if (els.predictionConfidenceTag) {
            els.predictionConfidenceTag.textContent = 'Runtime unavailable';
            els.predictionConfidenceTag.className = 'status-badge info';
        }
    }

    function renderRuntimeStatus() {
        const runtimePayload = state.runtimeByModel?.[state.model] || null;
        const status = safeText(runtimePayload?.status, 'UNAVAILABLE').toUpperCase();
        const sessionState = safeText(runtimePayload?.sessionState, 'PAUSED').toUpperCase();
        const reason = safeText(runtimePayload?.reason, 'Runtime status unavailable.');
        const effective = effectiveHorizon();

        if (els.runtimeStatusBadge) {
            els.runtimeStatusBadge.className = `status-badge ${runtimeBadgeClass(status)}`;
            els.runtimeStatusBadge.textContent = status;
        }

        if (els.runtimeStatusText) {
            const age = toNumber(runtimePayload?.priceAgeSec);
            const ageText = Number.isFinite(age) ? `${Math.round(age)}s ago` : '--';
            els.runtimeStatusText.textContent = `${sessionState} | ${effective} | Updated ${ageText}`;
        }

        if (els.runtimeNoticeBanner) {
            const switchedFrom = safeText(state.selection?.autoSwitchedFrom, '');
            const shouldShow = status !== 'LIVE' || switchedFrom;
            if (!shouldShow) {
                els.runtimeNoticeBanner.style.display = 'none';
            } else {
                const switchText = switchedFrom ? `Auto-switched from ${switchedFrom} to ${effective}. ` : '';
                els.runtimeNoticeBanner.style.display = 'block';
                els.runtimeNoticeBanner.textContent = `${switchText}${reason}`;
            }
        }
    }

    function applyInsightsSelection(selection, triggerSource) {
        state.selection = selection || {};
        const resolvedHorizon = safeText(selection?.resolvedHorizon, '');
        if (resolvedHorizon && resolvedHorizon !== state.horizon) {
            const previous = state.horizon;
            state.horizon = resolvedHorizon;
            applyButtonStates();
            if (triggerSource !== 'silent') {
                notify(`Auto-switched to ${resolvedHorizon} because ${previous} is not runtime-enabled for ${state.asset}.`, 'warning', 2600);
            }
        }
    }

    function setHighlightedFeature(featureKey) {
        state.highlightedFeatureKey = featureKey || null;
        if (state.heatmapChart) {
            state.heatmapChart.update('none');
        }

        if (!els.featuresList) return;
        Array.from(els.featuresList.querySelectorAll('.feature-bar')).forEach((row) => {
            const key = row.dataset.featureKey || '';
            row.classList.toggle('active', !!featureKey && key === featureKey);
        });
    }

    function renderHeatmapInsights() {
        if (!els.insightPositive || !els.insightNegative || !els.insightNeutral) {
            return;
        }

        const features = Array.isArray(state.lastTopFeatures) ? state.lastTopFeatures : [];
        const positive = features.find((feature) => toNumber(feature.value, 0) > 0.01);
        const negative = features.find((feature) => toNumber(feature.value, 0) < -0.01);
        const neutral = features.find((feature) => Math.abs(toNumber(feature.value, 0)) <= 0.01) || features[features.length - 1];

        if (positive) {
            els.insightPositive.textContent = `If ${formatFeatureName(positive.name)} is bright green, the model reads a bullish push and increases LONG confidence.`;
        }
        if (negative) {
            els.insightNegative.textContent = `If ${formatFeatureName(negative.name)} is red, the model reads bearish pressure and may reduce LONG confidence.`;
        }
        if (neutral) {
            els.insightNeutral.textContent = `If ${formatFeatureName(neutral.name)} stays yellow, the signal is neutral and has limited directional influence.`;
        }
    }

    function renderTopFeatures(features) {
        if (!els.featuresList) return;

        if (!Array.isArray(features) || features.length === 0) {
            state.lastTopFeatures = [];
            els.featuresList.innerHTML = [
                '<div class="feature-list-note">Hover a feature to highlight its row in the heatmap.</div>',
                '<div style="color: var(--text-muted);">No feature contribution data available.</div>',
            ].join('');
            renderHeatmapInsights();
            return;
        }

        const sorted = [...features].sort((a, b) => Math.abs(toNumber(b.value, 0)) - Math.abs(toNumber(a.value, 0)));
        state.lastTopFeatures = sorted;
        const maxAbs = sorted.reduce((acc, item) => Math.max(acc, Math.abs(toNumber(item.value, 0))), 0) || 1;

        const rows = sorted.slice(0, 8).map((item) => {
            const rawValue = toNumber(item.value, 0);
            const sign = rawValue >= 0 ? '+' : '';
            const width = Math.max(6, Math.round((Math.abs(rawValue) / maxAbs) * 100));
            const featureKey = normalizeFeatureKey(item.name);
            const valueClass = Math.abs(rawValue) < 0.01 ? 'neutral' : rawValue > 0 ? 'positive' : 'negative';

            return `
                <div class="feature-bar" data-feature-key="${featureKey}">
                    <div class="feature-name">${formatFeatureName(item.name)}</div>
                    <div class="feature-impact ${valueClass}">${sign}${rawValue.toFixed(3)}</div>
                    <div class="progress-bar" style="margin-left: 0.7rem; width: 34%;">
                        <div class="progress-fill" style="width:${width}%; background:${rawValue > 0 ? '#00FFAA' : rawValue < 0 ? '#FF4D4F' : '#facc15'};"></div>
                    </div>
                </div>
            `;
        }).join('');

        els.featuresList.innerHTML = `
            <div class="feature-list-note">Hover a feature to highlight its row in the heatmap.</div>
            ${rows}
        `;

        Array.from(els.featuresList.querySelectorAll('.feature-bar')).forEach((row) => {
            const key = row.dataset.featureKey || '';
            row.addEventListener('mouseenter', () => setHighlightedFeature(key));
            row.addEventListener('mouseleave', () => setHighlightedFeature(null));
        });

        renderHeatmapInsights();
    }

    function renderPerformance(payload) {
        if (!payload) return;

        renderMeta(payload.meta);
        const perf = payload.performance || {};

        if (els.metricAccuracy) els.metricAccuracy.textContent = formatPercentNoSign(perf.directionAccuracy, 1);
        if (els.metricBrier) els.metricBrier.textContent = formatRatio(perf.brierScore, 3);
        if (els.metricEce) els.metricEce.textContent = formatRatio(perf.ece, 3);
        if (els.metricCoverage) els.metricCoverage.textContent = formatPercentNoSign(perf.intervalCoverage, 1);
    }

    function toggleHeatmapEmpty(show, message) {
        if (!els.heatmapEmptyState) return;
        els.heatmapEmptyState.textContent = message || 'No strong feature contribution detected.';
        els.heatmapEmptyState.style.display = show ? 'flex' : 'none';
    }

    function interpolateColor(start, end, ratio) {
        const t = Math.max(0, Math.min(1, ratio));
        return [
            Math.round(start[0] + (end[0] - start[0]) * t),
            Math.round(start[1] + (end[1] - start[1]) * t),
            Math.round(start[2] + (end[2] - start[2]) * t),
        ];
    }

    function computeHeatmapScale(values, meta) {
        const metaMin = toNumber(meta?.scaleMin);
        const metaMax = toNumber(meta?.scaleMax);
        if (Number.isFinite(metaMin) && Number.isFinite(metaMax) && metaMin < metaMax) {
            return { min: metaMin, max: metaMax };
        }

        const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 0);
        if (!Number.isFinite(maxAbs) || maxAbs === 0) {
            return { min: -1, max: 1 };
        }

        return { min: -maxAbs, max: maxAbs };
    }

    function describeImpact(value, neutralBand) {
        if (Math.abs(value) <= neutralBand) {
            return {
                direction: 'Neutral',
                meaning: 'Neutral impact on P(UP)',
            };
        }

        if (value > 0) {
            return {
                direction: 'Bullish',
                meaning: 'Increases P(UP)',
            };
        }

        return {
            direction: 'Bearish',
            meaning: 'Decreases P(UP)',
        };
    }

    function colorForHeatValue(value) {
        const min = state.heatmapScale.min;
        const max = state.heatmapScale.max;
        const neutralBand = Math.max((max - min) * 0.03, 0.01);

        const red = [255, 77, 79];
        const yellow = [250, 204, 21];
        const green = [0, 255, 170];

        let rgb;
        if (Math.abs(value) <= neutralBand) {
            rgb = yellow;
        } else if (value > 0) {
            const ratio = max <= 0 ? 1 : Math.min(value / max, 1);
            rgb = interpolateColor(yellow, green, ratio);
        } else {
            const ratio = min >= 0 ? 1 : Math.min(Math.abs(value / min), 1);
            rgb = interpolateColor(yellow, red, ratio);
        }

        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.9)`;
    }

    function renderHeatmap(payload) {
        if (!els.heatmapCanvas || !window.Chart || !payload) return;

        renderMeta(payload.meta);

        let xLabels = Array.isArray(payload.xLabels) ? payload.xLabels : [];
        let yLabels = Array.isArray(payload.yLabels) ? payload.yLabels : [];
        let matrix = Array.isArray(payload.matrix) ? payload.matrix : [];

        if (xLabels.length === 0) xLabels = ['W0'];
        if (yLabels.length === 0) yLabels = ['missing_coverage'];

        const normalizedMatrix = yLabels.map((_, rowIndex) => {
            const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
            return xLabels.map((__, columnIndex) => toNumber(row[columnIndex], 0));
        });

        const rawStateMatrix = Array.isArray(payload.stateMatrix) ? payload.stateMatrix : [];
        const normalizedStateMatrix = yLabels.map((_, rowIndex) => {
            const row = Array.isArray(rawStateMatrix[rowIndex]) ? rawStateMatrix[rowIndex] : [];
            return xLabels.map((__, columnIndex) => {
                const rawValue = row[columnIndex];
                const parsed = toNumber(rawValue, NaN);
                if (Number.isFinite(parsed)) return parsed;
                return clamp(normalizedMatrix[rowIndex][columnIndex] * 1.4, -1, 1);
            });
        });

        const allValues = normalizedMatrix.flat();
        const allNeutral = allValues.length === 0 || allValues.every((value) => Math.abs(value) < 1e-8);
        toggleHeatmapEmpty(allNeutral, allNeutral ? 'No strong feature contribution detected.' : '');

        state.heatmapScale = computeHeatmapScale(allValues, payload.meta);
        state.lastHeatmap = {
            ...payload,
            xLabels,
            yLabels,
            matrix: normalizedMatrix,
            stateMatrix: normalizedStateMatrix,
        };

        const points = [];
        for (let row = 0; row < yLabels.length; row += 1) {
            for (let col = 0; col < xLabels.length; col += 1) {
                points.push({
                    x: col,
                    y: yLabels.length - row - 1,
                    r: 10,
                    v: normalizedMatrix[row][col],
                    featureKey: normalizeFeatureKey(yLabels[row]),
                    featureName: formatFeatureName(yLabels[row]),
                    window: xLabels[col],
                    stateValue: normalizedStateMatrix[row][col],
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
                        backgroundColor: (context) => colorForHeatValue(toNumber(context.raw?.v, 0)),
                        borderColor: (context) => {
                            const rowKey = context.raw?.featureKey;
                            if (state.highlightedFeatureKey && rowKey === state.highlightedFeatureKey) {
                                return 'rgba(34, 211, 238, 0.95)';
                            }
                            return 'rgba(255, 255, 255, 0.22)';
                        },
                        borderWidth: (context) => {
                            const rowKey = context.raw?.featureKey;
                            return state.highlightedFeatureKey && rowKey === state.highlightedFeatureKey ? 2 : 1;
                        },
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const raw = items[0]?.raw;
                                return `${raw?.featureName || ''} @ ${raw?.window || ''}`;
                            },
                            label: (item) => {
                                const value = toNumber(item.raw?.v, 0);
                                const stateValue = toNumber(item.raw?.stateValue, 0);
                                const neutralBand = Math.max((state.heatmapScale.max - state.heatmapScale.min) * 0.03, 0.01);
                                const impact = describeImpact(value, neutralBand);
                                const stateText = `${stateValue >= 0 ? '+' : ''}${stateValue.toFixed(3)}`;
                                const contributionText = `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
                                return [
                                    `State: ${stateText}`,
                                    `Contribution: ${contributionText} to P(UP)`,
                                    `${impact.direction}: ${impact.meaning}`,
                                ];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: -0.5,
                        max: xLabels.length - 0.5,
                        grid: { color: 'rgba(255, 255, 255, 0.06)' },
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
                        grid: { color: 'rgba(255, 255, 255, 0.06)' },
                        ticks: {
                            stepSize: 1,
                            callback: (value) => {
                                const index = yLabels.length - Number(value) - 1;
                                return formatFeatureName(yLabels[index] || '');
                            },
                            color: '#8b9bb4',
                        },
                    },
                },
                onHover: (_, elements) => {
                    els.heatmapCanvas.style.cursor = elements.length ? 'pointer' : 'default';
                },
            },
        });

        if (state.highlightedFeatureKey) {
            state.heatmapChart.update('none');
        }
    }

    function selectedPayload() {
        return {
            model: state.model,
            asset: state.asset,
            horizon: state.horizon,
        };
    }

    function deriveTopFeaturesFromHeatmap(payload) {
        if (!payload) return [];
        const yLabels = Array.isArray(payload.yLabels) ? payload.yLabels : [];
        const matrix = Array.isArray(payload.matrix) ? payload.matrix : [];
        if (!yLabels.length || !matrix.length) return [];

        const derived = yLabels.map((label, rowIndex) => {
            const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex].map((value) => toNumber(value, 0)) : [];
            if (!row.length) {
                return { name: label, value: 0 };
            }

            const avg = row.reduce((sum, value) => sum + value, 0) / row.length;
            return { name: label, value: avg };
        });

        return derived.sort((a, b) => Math.abs(toNumber(b.value, 0)) - Math.abs(toNumber(a.value, 0)));
    }

    function renderComparison(insights) {
        const rows = Array.isArray(insights?.comparison) ? insights.comparison : [];

        if (els.comparisonTableBody) {
            if (!rows.length) {
                els.comparisonTableBody.innerHTML = '<tr><td colspan="7" style="text-align:left; color: var(--text-muted);">No comparison metrics available.</td></tr>';
            } else {
                els.comparisonTableBody.innerHTML = rows.map((row) => `
                    <tr>
                        <td>${safeText(MODEL_LABELS[row.model], row.model)}</td>
                        <td>${formatPercentNoSign(row.directionAccuracy, 1)}</td>
                        <td>${formatRatio(row.brierScore, 3)}</td>
                        <td>${formatRatio(row.ece, 3)}</td>
                        <td>${formatPercentNoSign(row.intervalCoverage, 1)}</td>
                        <td>${formatRatio(row.inferenceMs, 1)}</td>
                        <td>${formatRatio(row.trainingMinutes, 1)}</td>
                    </tr>
                `).join('');
            }
        }

        if (!els.comparisonRadarCanvas || !window.Chart) return;

        if (state.comparisonRadarChart) {
            state.comparisonRadarChart.destroy();
            state.comparisonRadarChart = null;
        }
        if (!rows.length) return;

        const maxInference = Math.max(...rows.map((row) => toNumber(row.inferenceMs, 0)), 1);
        const maxTraining = Math.max(...rows.map((row) => toNumber(row.trainingMinutes, 0)), 1);
        const maxBrier = Math.max(...rows.map((row) => toNumber(row.brierScore, 0)), 0.001);

        const datasets = rows.map((row) => {
            const accuracy = clamp(toNumber(row.directionAccuracy, 0), 0, 1);
            const coverage = clamp(toNumber(row.intervalCoverage, 0), 0, 1);
            const calibration = clamp(1 - toNumber(row.ece, 1), 0, 1);
            const brier = clamp(1 - (toNumber(row.brierScore, maxBrier) / maxBrier), 0, 1);
            const latency = clamp(1 - (toNumber(row.inferenceMs, maxInference) / maxInference), 0, 1);
            const training = clamp(1 - (toNumber(row.trainingMinutes, maxTraining) / maxTraining), 0, 1);
            const color = COMPARISON_COLORS[row.model] || '#00e5ff';

            return {
                label: MODEL_LABELS[row.model] || String(row.model).toUpperCase(),
                data: [accuracy, coverage, calibration, brier, latency, training],
                borderColor: color,
                backgroundColor: `${color}22`,
                pointBackgroundColor: color,
                borderWidth: 2,
            };
        });

        state.comparisonRadarChart = new Chart(els.comparisonRadarCanvas, {
            type: 'radar',
            data: {
                labels: ['Accuracy', 'Coverage', 'Calibration', 'Brier', 'Latency', 'Train Cost'],
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 0,
                        max: 1,
                        ticks: {
                            stepSize: 0.2,
                            display: false,
                        },
                        angleLines: { color: 'rgba(255,255,255,0.12)' },
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        pointLabels: { color: '#8b9bb4' },
                    },
                },
                plugins: {
                    legend: {
                        labels: { color: '#8b9bb4', boxWidth: 10 },
                    },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                return `${context.dataset.label}: ${formatRatio(context.parsed.r, 2)}`;
                            },
                        },
                    },
                },
            },
        });
    }

    function clearComparisonRadar() {
        if (state.comparisonRadarChart) {
            state.comparisonRadarChart.destroy();
            state.comparisonRadarChart = null;
        }
    }

    function renderComparisonUnavailable(message, fallbackFromPerformance) {
        if (els.comparisonTableBody) {
            if (fallbackFromPerformance) {
                const perf = fallbackFromPerformance.performance || {};
                els.comparisonTableBody.innerHTML = `
                    <tr>
                        <td>${safeText(MODEL_LABELS[state.model], state.model)}</td>
                        <td>${formatPercentNoSign(perf.directionAccuracy, 1)}</td>
                        <td>${formatRatio(perf.brierScore, 3)}</td>
                        <td>${formatRatio(perf.ece, 3)}</td>
                        <td>${formatPercentNoSign(perf.intervalCoverage, 1)}</td>
                        <td>--</td>
                        <td>--</td>
                    </tr>
                `;
            } else {
                els.comparisonTableBody.innerHTML = `<tr><td colspan="7" style="text-align:left; color: var(--danger);">${safeText(message, 'Comparison unavailable (insights endpoint error).')}</td></tr>`;
            }
        }

        clearComparisonRadar();
    }

    function renderWhatIfPreview() {
        const baseline = state.baselineSnapshot;
        if (!baseline) {
            if (els.whatIfSimPup) els.whatIfSimPup.textContent = 'P(UP): --';
            if (els.whatIfSimConfidence) els.whatIfSimConfidence.textContent = 'Confidence: --';
            if (els.whatIfSimExplanation) {
                els.whatIfSimExplanation.textContent = 'Adjust the slider to preview how volatility sensitivity changes the model view.';
            }
            return;
        }

        const delta = toNumber(state.whatIf.volatilityDelta, 0);
        const adjustedPup = clamp(baseline.pUp - delta * 0.28, 0.01, 0.99);
        const adjustedConfidence = clamp(baseline.confidence - Math.abs(delta) * 0.35, 0.05, 0.99);
        const signal = getSignalFromProbability(adjustedPup);

        if (els.whatIfDeltaValue) {
            const signed = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
            els.whatIfDeltaValue.textContent = signed;
            els.whatIfDeltaValue.style.color = delta > 0 ? '#f59e0b' : delta < 0 ? '#00FFAA' : 'var(--text-primary)';
        }
        if (els.whatIfSimPup) {
            els.whatIfSimPup.textContent = `P(UP): ${formatRatio(adjustedPup, 3)} (${signal})`;
            els.whatIfSimPup.style.color = adjustedPup > 0.5 ? '#00FFAA' : '#FF4D4F';
        }
        if (els.whatIfSimConfidence) {
            els.whatIfSimConfidence.textContent = `Confidence: ${Math.round(adjustedConfidence * 100)}%`;
        }
        if (els.whatIfSimExplanation) {
            const text = delta > 0
                ? 'Higher volatility increases downside risk and softens bullish confidence.'
                : delta < 0
                    ? 'Lower volatility supports directional confidence and tighter uncertainty.'
                    : 'No volatility adjustment applied. Baseline model view is active.';
            els.whatIfSimExplanation.textContent = `${text} This layer is a client-side sensitivity simulation.`;
        }
    }

    function setXaiChartMode(mode) {
        state.xaiChartMode = mode === 'waterfall' ? 'waterfall' : 'heatmap';
        applyButtonStates();

        if (els.waterfallWrap) {
            els.waterfallWrap.style.display = state.xaiChartMode === 'waterfall' ? 'block' : 'none';
        }
        if (els.heatmapCanvas?.parentElement) {
            els.heatmapCanvas.parentElement.style.display = state.xaiChartMode === 'heatmap' ? 'block' : 'none';
        }

        if (state.xaiChartMode === 'waterfall') {
            if (!els.waterfallCanvas || !window.Chart) return;
            if (state.waterfallChart) {
                state.waterfallChart.destroy();
            }
            const rows = state.lastTopFeatures.slice(0, 8);
            const labels = rows.map((row) => formatFeatureName(row.name));
            const deltas = rows.map((row) => toNumber(row.value, 0));
            let running = 0.5;
            const cumulative = deltas.map((delta) => {
                running += delta * 0.15;
                return clamp(running, 0, 1);
            });

            state.waterfallChart = new Chart(els.waterfallCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            type: 'bar',
                            label: 'Contribution',
                            data: deltas,
                            backgroundColor: deltas.map((value) => (value > 0 ? 'rgba(0,255,170,0.45)' : value < 0 ? 'rgba(255,77,79,0.45)' : 'rgba(250,204,21,0.45)')),
                            borderColor: deltas.map((value) => (value > 0 ? '#00FFAA' : value < 0 ? '#FF4D4F' : '#facc15')),
                            borderWidth: 1,
                            yAxisID: 'y',
                        },
                        {
                            type: 'line',
                            label: 'Cumulative P(UP)',
                            data: cumulative,
                            borderColor: '#00e5ff',
                            borderWidth: 2,
                            tension: 0.25,
                            pointRadius: 2,
                            yAxisID: 'y1',
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: '#8b9bb4' } },
                    },
                    scales: {
                        x: {
                            ticks: { color: '#8b9bb4', maxRotation: 0, autoSkip: true },
                            grid: { color: 'rgba(255,255,255,0.06)' },
                        },
                        y: {
                            position: 'left',
                            ticks: { color: '#8b9bb4' },
                            grid: { color: 'rgba(255,255,255,0.06)' },
                        },
                        y1: {
                            position: 'right',
                            min: 0,
                            max: 1,
                            grid: { drawOnChartArea: false },
                            ticks: {
                                color: '#8b9bb4',
                                callback(value) {
                                    return `${(value * 100).toFixed(0)}%`;
                                },
                            },
                        },
                    },
                },
            });
        }

        if (els.xaiModeBadge) {
            els.xaiModeBadge.textContent = state.xaiChartMode === 'waterfall'
                ? `${state.xaiScope.toUpperCase()} WATERFALL`
                : `${state.xaiScope.toUpperCase()} SHAP ANALYSIS`;
        }
    }

    function renderInsightsPayload(insights, triggerSource = 'silent') {
        if (!insights) return;
        renderMeta(insights.meta);
        state.compatibilityByModel = insights.compatibility || { ...DEFAULT_COMPATIBILITY };
        state.healthByModel = insights.qualityHealth || insights.health || {};
        state.runtimeByModel = insights.runtimeHealth || {};
        applyInsightsSelection(insights.selection, triggerSource);
        syncModelCompatibility();
        syncHorizonAvailability();
        applyButtonStates();
        updateHealthBadges();
        renderRuntimeStatus();
        renderEnsembleCard();
        renderComparison(insights);
    }

    function reconcileTopFeaturesWithScope() {
        if (state.xaiScope === 'global') {
            renderTopFeatures(deriveTopFeaturesFromHeatmap(state.lastHeatmap));
            return;
        }

        const list = state.lastPrediction?.explanation?.topFeatures;
        if (Array.isArray(list) && list.length) {
            renderTopFeatures(list);
            return;
        }
        renderTopFeatures(deriveTopFeaturesFromHeatmap(state.lastHeatmap));
    }

    async function refreshAll(triggerSource = 'auto') {
        if (!window.api) {
            notify('API client is not available on this page.', 'error', 3800);
            return;
        }

        const cycleId = ++state.cycleId;
        setLoading(true);
        const payload = selectedPayload();

        try {
            const [predictionRes, heatmapRes, performanceRes, insightsRes] = await Promise.allSettled([
                api.getModelExplorerPrediction(payload),
                api.getModelExplorerHeatmap({ ...payload, scope: state.xaiScope }),
                api.getModelExplorerPerformance(payload),
                api.getModelExplorerInsights({ asset: state.asset, horizon: state.horizon, model: state.model }),
            ]);

            if (cycleId !== state.cycleId) return;

            if (predictionRes.status === 'fulfilled') {
                state.lastPrediction = predictionRes.value;
                renderMeta(predictionRes.value.meta);
            } else {
                state.lastPrediction = null;
                renderPredictionUnavailable(`Runtime unavailable for ${state.asset} ${state.horizon} ${state.model.toUpperCase()}.`);
                notify(`Prediction request failed: ${predictionRes.reason?.message || predictionRes.reason}`, 'error', 3600);
            }

            if (performanceRes.status === 'fulfilled') {
                state.lastPerformance = performanceRes.value;
                renderMeta(performanceRes.value.meta);
            } else {
                notify(`Performance request failed: ${performanceRes.reason?.message || performanceRes.reason}`, 'warning', 3200);
            }

            if (insightsRes.status === 'fulfilled') {
                state.lastInsights = insightsRes.value;
                renderInsightsPayload(insightsRes.value, triggerSource);
            } else {
                state.lastInsights = null;
                state.healthByModel = {};
                state.runtimeByModel = {};
                state.selection = {};
                updateHealthBadges();
                renderRuntimeStatus();
                notify(`Insights request failed: ${insightsRes.reason?.message || insightsRes.reason}`, 'warning', 3400);
                if (state.lastPerformance) {
                    renderComparisonUnavailable('Comparison unavailable (insights endpoint error). Showing selected model fallback.', state.lastPerformance);
                } else {
                    renderComparisonUnavailable('Comparison unavailable (insights endpoint error).');
                }
            }

            if (heatmapRes.status === 'fulfilled') {
                renderHeatmap(heatmapRes.value);
            } else if (state.xaiScope === 'global') {
                notify(`Global heatmap failed: ${heatmapRes.reason?.message || heatmapRes.reason}. Using local scope.`, 'warning', 3400);
                state.xaiScope = 'local';
                applyButtonStates();
                try {
                    const fallback = await api.getModelExplorerHeatmap({ ...payload, scope: 'local' });
                    renderHeatmap(fallback);
                } catch (fallbackError) {
                    notify(`Local heatmap fallback failed: ${fallbackError.message || fallbackError}`, 'error', 3600);
                }
            } else {
                notify(`Heatmap request failed: ${heatmapRes.reason?.message || heatmapRes.reason}`, 'error', 3600);
            }

            reconcileTopFeaturesWithScope();
            renderPredictionAndExplanation();
            renderPerformance(state.lastPerformance);
            setXaiChartMode(state.xaiChartMode);

            if (triggerSource === 'manual') {
                notify('Model explorer refreshed.', 'success', 1800);
            }
        } finally {
            if (cycleId === state.cycleId) {
                setLoading(false);
            }
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
            if (!models.some((model) => model.id === state.model) && models.length > 0) {
                state.model = models[0].id;
            }

            const assets = Array.isArray(assetsRes.assets) ? assetsRes.assets : [];
            state.assetHorizonMap = {};
            assets.forEach((asset) => {
                const available = Array.isArray(asset.availableHorizons) ? asset.availableHorizons : [];
                state.assetHorizonMap[asset.symbol] = available;
            });

            if (els.assetSelect) {
                els.assetSelect.innerHTML = assets.map((asset) => `<option value="${asset.symbol}">${asset.label}</option>`).join('');
                if (!assets.some((asset) => asset.symbol === state.asset) && assets.length > 0) {
                    state.asset = assets[0].symbol;
                }
                els.assetSelect.value = state.asset;
            }

            syncHorizonAvailability();
            syncModelCompatibility();
        } catch (error) {
            notify(`Catalog load failed: ${error.message || error}`, 'error', 3600);
        }
    }

    async function copyExplanationToClipboard() {
        const primary = getPrimaryViewPayload();
        const prediction = primary.prediction || {};
        const lines = [
            'Model Explorer Summary',
            `Mode: ${state.mode}`,
            `Model Version: ${state.modelVersion}`,
            `Asset: ${state.asset}`,
            `Horizon: ${effectiveHorizon()}`,
            `View: ${state.viewMode.toUpperCase()}`,
            `P(UP): ${formatRatio(prediction.pUp, 3)}`,
            `Signal: ${safeText(prediction.signal, getSignalFromProbability(toNumber(prediction.pUp, 0.5)))}`,
            `Confidence: ${formatPercentNoSign(prediction.confidence, 1)}`,
            `Explanation: ${safeText(primary.summary, '--')}`,
            `Top Features: ${(state.lastTopFeatures || []).slice(0, 5).map((item) => `${formatFeatureName(item.name)} ${item.value >= 0 ? '+' : ''}${toNumber(item.value, 0).toFixed(3)}`).join(' | ')}`,
        ].join('\n');

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(lines);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = lines;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            notify('Explanation copied to clipboard.', 'success', 2200);
        } catch (error) {
            notify(`Copy failed: ${error.message || error}`, 'error', 3200);
        }
    }

    function exportShapReport() {
        if (!state.lastHeatmap) {
            notify('No heatmap data available for export.', 'warning', 2500);
            return;
        }

        const report = {
            generatedAt: new Date().toISOString(),
            context: {
                model: state.model,
                asset: state.asset,
                horizon: effectiveHorizon(),
                viewMode: state.viewMode,
                xaiScope: state.xaiScope,
                xaiChartMode: state.xaiChartMode,
                mode: state.mode,
                modelVersion: state.modelVersion,
            },
            prediction: state.lastPrediction,
            performance: state.lastPerformance,
            insights: state.lastInsights,
            heatmap: state.lastHeatmap,
            topFeatures: state.lastTopFeatures,
            whatIf: {
                volatilityDelta: state.whatIf.volatilityDelta,
            },
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const a = document.createElement('a');
        a.href = url;
        a.download = `shap-report-${state.asset}-${state.horizon}-${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        notify('SHAP report exported.', 'success', 2200);
    }

    function bindEvents() {
        els.modelButtons.forEach((button) => {
            const selectModel = () => {
                const selected = getModelFromButton(button);
                if (!selected || selected === state.model) return;
                state.model = selected;
                applyButtonStates();
                refreshAll('manual');
            };

            button.addEventListener('click', selectModel);
            if (button.tagName !== 'BUTTON') {
                button.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectModel();
                    }
                });
            }
        });

        els.horizonButtons.forEach((button) => {
            button.addEventListener('click', () => {
                if (button.disabled) return;
                const selected = getHorizonFromButton(button);
                if (!selected || selected === state.horizon) return;
                state.horizon = selected;
                syncModelCompatibility();
                applyButtonStates();
                refreshAll('manual');
            });
        });

        if (els.assetSelect) {
            els.assetSelect.addEventListener('change', (event) => {
                state.asset = event.target.value;
                syncHorizonAvailability();
                syncModelCompatibility();
                applyButtonStates();
                refreshAll('manual');
            });
        }

        if (els.refreshButton) {
            els.refreshButton.addEventListener('click', () => refreshAll('manual'));
        }

        if (els.viewIndividualBtn) {
            els.viewIndividualBtn.addEventListener('click', () => {
                if (state.viewMode === 'individual') return;
                state.viewMode = 'individual';
                applyButtonStates();
                renderPredictionAndExplanation();
            });
        }

        if (els.viewEnsembleBtn) {
            els.viewEnsembleBtn.addEventListener('click', () => {
                if (state.viewMode === 'ensemble') return;
                state.viewMode = 'ensemble';
                applyButtonStates();
                renderPredictionAndExplanation();
            });
        }

        if (els.scopeLocalBtn) {
            els.scopeLocalBtn.addEventListener('click', () => {
                if (state.xaiScope === 'local') return;
                state.xaiScope = 'local';
                applyButtonStates();
                refreshAll('manual');
            });
        }

        if (els.scopeGlobalBtn) {
            els.scopeGlobalBtn.addEventListener('click', () => {
                if (state.xaiScope === 'global') return;
                state.xaiScope = 'global';
                applyButtonStates();
                refreshAll('manual');
            });
        }

        if (els.xaiHeatmapBtn) {
            els.xaiHeatmapBtn.addEventListener('click', () => setXaiChartMode('heatmap'));
        }
        if (els.xaiWaterfallBtn) {
            els.xaiWaterfallBtn.addEventListener('click', () => setXaiChartMode('waterfall'));
        }

        if (els.whatIfSlider) {
            els.whatIfSlider.addEventListener('input', (event) => {
                state.whatIf.volatilityDelta = toNumber(event.target.value, 0);
                renderWhatIfPreview();
            });
        }

        if (els.whatIfResetBtn) {
            els.whatIfResetBtn.addEventListener('click', () => {
                state.whatIf.volatilityDelta = 0;
                if (els.whatIfSlider) {
                    els.whatIfSlider.value = '0';
                }
                renderWhatIfPreview();
            });
        }

        if (els.copyExplanationBtn) {
            els.copyExplanationBtn.addEventListener('click', () => {
                copyExplanationToClipboard();
            });
        }
        if (els.exportShapBtn) {
            els.exportShapBtn.addEventListener('click', () => {
                exportShapReport();
            });
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            refreshAll('auto');
        });
    }

    function startAutoRefresh() {
        if (state.autoRefreshHandle) {
            clearInterval(state.autoRefreshHandle);
        }
        state.autoRefreshHandle = window.setInterval(() => {
            refreshAll('auto');
        }, AUTO_REFRESH_MS);
    }

    async function init() {
        collectElements();
        bindEvents();
        applyButtonStates();
        await initCatalog();
        applyButtonStates();
        await refreshAll();
        startAutoRefresh();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
