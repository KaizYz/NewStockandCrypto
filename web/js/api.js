// ========================================
// StockandCrypto - API Client
// ========================================

const API_BASE_URL = `${window.location.origin}/api`;

function buildQueryString(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return;
        query.set(key, String(value));
    });
    const encoded = query.toString();
    return encoded ? `?${encoded}` : '';
}

// API Client
const api = {
    // Base request method
    async request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Add auth token if available
        const token = utils.storage.get('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            ...options,
            credentials: options.credentials || 'same-origin',
            headers
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                const error = new Error(data.error || `HTTP error! status: ${response.status}`);
                error.status = response.status;
                error.payload = data;
                error.detail = data?.detail || '';
                error.url = url;
                throw error;
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    // GET request
    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    // POST request
    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    // PUT request
    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    // DELETE request
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    },

    // ==================== Auth ====================

    async register(payload) {
        return this.post('/auth/register', payload);
    },

    async login(payload) {
        return this.post('/auth/login', payload);
    },

    async me() {
        return this.get('/auth/me');
    },

    async logout() {
        return this.post('/auth/logout', {});
    },

    // ==================== Market Data ====================
    
    // Get crypto prices
    async getCryptoPrices() {
        return this.get('/crypto/prices');
    },

    // Get top-50 ex-stablecoins crypto universe
    async getCryptoUniverse() {
        return this.get('/crypto/universe');
    },

    // Get crypto predictions
    async getCryptoPredictions(symbol = 'BTC') {
        return this.get(`/crypto/predictions?symbol=${symbol}`);
    },

    // Get crypto history for chart seeding
    async getCryptoHistory(symbol = 'BTCUSDT', params = {}) {
        return this.get(`/crypto/history/${encodeURIComponent(symbol)}${buildQueryString(params)}`);
    },

    // Get current crypto prediction packet
    async getCryptoPrediction(symbol = 'BTCUSDT') {
        return this.get(`/crypto/prediction/${symbol}`);
    },

    // Get historical crypto performance
    async getCryptoPerformance(symbol = 'BTCUSDT', days = 30) {
        return this.get(`/crypto/performance/${symbol}?days=${days}`);
    },

    // Get CN equity prices
    async getCNEquityPrices(params = {}) {
        return this.get(`/cn-equity/prices${buildQueryString(params)}`);
    },

    // Get CN equity legacy predictions alias
    async getCNEquityPredictions(code) {
        return this.get(`/cn-equity/predictions${buildQueryString({ code })}`);
    },

    // Get CN index prediction
    async getCNEquityIndexPrediction(indexCode = '000001.SH') {
        return this.get(`/cn-equity/prediction/${encodeURIComponent(indexCode)}`);
    },

    // Get single CN stock prediction
    async getCNEquityStockPrediction(stockCode) {
        return this.get(`/cn-equity/stock/${encodeURIComponent(stockCode)}`);
    },

    // Get CSI300 ranking
    async getCNEquityRanking(top = 20) {
        return this.get(`/cn-equity/csi300/ranking${buildQueryString({ top })}`);
    },

    // Get paginated CSI300 quotes
    async getCNEquityQuotes(params = {}) {
        return this.get(`/cn-equity/csi300/quotes${buildQueryString(params)}`);
    },

    // Get CN indices intraday history for mini trends
    async getCNEquityIndicesHistory(params = {}) {
        return this.get(`/cn-equity/indices/history${buildQueryString(params)}`);
    },

    // Get US equity prices
    async getUSEquityPrices(params = {}) {
        return this.get(`/us-equity/prices${buildQueryString(params)}`);
    },

    // Get fast US indices snapshot
    async getUSEquityIndices() {
        return this.get('/us-equity/indices');
    },

    // Get US intraday index history seed
    async getUSEquityIndicesHistory(params = {}) {
        return this.get(`/us-equity/indices/history${buildQueryString(params)}`);
    },

    // Get US equity predictions legacy alias
    async getUSEquityPredictions(symbol) {
        return this.get(`/us-equity/predictions${buildQueryString({ symbol })}`);
    },

    // Get paginated S&P 500 quotes
    async getUSEquityQuotes(params = {}) {
        return this.get(`/us-equity/sp500/quotes${buildQueryString(params)}`);
    },

    // Get US index prediction
    async getUSEquityIndexPrediction(indexSymbol = '^SPX') {
        return this.get(`/us-equity/prediction/${encodeURIComponent(indexSymbol)}`);
    },

    // Get US single-stock prediction
    async getUSEquityStockPrediction(symbol) {
        return this.get(`/us-equity/stock/${encodeURIComponent(symbol)}`);
    },

    // Get US top movers
    async getUSEquityTopMovers(limit = 20) {
        return this.get(`/us-equity/top-movers${buildQueryString({ limit })}`);
    },

    // ==================== Model Explorer ====================

    async getModelExplorerHealth() {
        return this.get('/model-explorer/health');
    },

    async getModelExplorerModels() {
        return this.get('/model-explorer/v1/catalog/models');
    },

    async getModelExplorerAssets() {
        return this.get('/model-explorer/v1/catalog/assets');
    },

    async getModelExplorerPrediction(payload) {
        return this.post('/model-explorer/v1/predict', payload);
    },

    async getModelExplorerHeatmap(params = {}) {
        return this.get(`/model-explorer/v1/explain/heatmap${buildQueryString(params)}`);
    },

    async getModelExplorerPerformance(params = {}) {
        return this.get(`/model-explorer/v1/performance${buildQueryString(params)}`);
    },

    async getModelExplorerInsights(params = {}) {
        return this.get(`/model-explorer/v1/insights${buildQueryString(params)}`);
    },

    async getModelExplorerEvaluationSummary(params = {}) {
        return this.get(`/model-explorer/v1/evaluation/summary${buildQueryString(params)}`);
    },

    async getModelExplorerEvaluationFolds(params = {}) {
        return this.get(`/model-explorer/v1/evaluation/folds${buildQueryString(params)}`);
    },

    async getModelExplorerBacktestSummary(params = {}) {
        return this.get(`/model-explorer/v1/backtest/summary${buildQueryString(params)}`);
    },

    async getModelExplorerBacktestDetail(params = {}) {
        return this.get(`/model-explorer/v1/backtest/detail${buildQueryString(params)}`);
    },

    async runModelExplorerBacktest(payload) {
        return this.post('/model-explorer/v1/backtest/run', payload);
    },

    // ==================== Quant Router ====================

    async getQuantRouterRuns() {
        return this.get('/quant/router/runs');
    },

    async getQuantRouterLatest() {
        return this.get('/quant/router/runs/latest');
    },

    async getQuantRouterRun(runId) {
        return this.get(`/quant/router/runs/${encodeURIComponent(runId)}`);
    },

    // ==================== Session Forecast ====================
    
    // Get crypto session forecast
    async getCryptoSessionForecast(symbol = 'BTCUSDT') {
        return this.get(`/session/crypto?symbol=${symbol}`);
    },

    // Get index session forecast
    async getIndexSessionForecast(index = 'SSE') {
        return this.get(`/session/index?index=${index}`);
    },

    // ==================== Home ====================

    async getHomeLanding() {
        return this.get('/home/landing');
    },

    // ==================== Tracking ====================
    
    async getTrackingSummary() {
        return this.get('/tracking/summary');
    },

    async getTrackingUniverse(params = {}) {
        return this.get(`/tracking/universe${buildQueryString(params)}`);
    },

    async getTrackingFactors(params = {}) {
        return this.get(`/tracking/factors${buildQueryString(params)}`);
    },

    async getTrackingCoverage() {
        return this.get('/tracking/coverage');
    },

    async getTrackingActions(params = {}) {
        return this.get(`/tracking/actions${buildQueryString(params)}`);
    },

    async simulateTrackingPortfolio(payload) {
        return this.post('/tracking/simulate', payload);
    },

    // Compatibility aliases
    async getUniverseRanking(market = 'all') {
        return this.getTrackingUniverse({ market });
    },

    async getFactorScores(symbol, market = '') {
        return this.getTrackingFactors({ symbol, market });
    },

    // ==================== Execution ====================
    
    // Get execution history
    async getExecutions(limit = 50) {
        return this.get(`/execution/history?limit=${limit}`);
    },

    // Get decision packet
    async getDecisionPacket(decisionId) {
        return this.get(`/execution/decision/${decisionId}`);
    },

    // Get equity curve
    async getEquityCurve(days = 30) {
        return this.get(`/execution/equity?days=${days}`);
    },

    // ==================== Auth ====================
    
    // Login
    async login(email, password) {
        const response = await this.post('/auth/login', { email, password });
        if (response.token) {
            utils.storage.set('token', response.token);
            utils.storage.set('user', response.user);
        }
        return response;
    },

    // Register
    async register(userData) {
        return this.post('/auth/register', userData);
    },

    // Logout
    logout() {
        utils.storage.remove('token');
        utils.storage.remove('user');
        window.location.href = 'login.html';
    },

    // Check auth status
    isAuthenticated() {
        return !!utils.storage.get('token');
    },

    // Get current user
    getCurrentUser() {
        return utils.storage.get('user');
    },

    // ==================== Notes ====================
    
    // Get notes
    async getNotes(limit = 50) {
        return this.get(`/notes?limit=${limit}`);
    },

    // Create note
    async createNote(noteData) {
        return this.post('/notes', noteData);
    },

    // Update note
    async updateNote(noteId, noteData) {
        return this.put(`/notes/${noteId}`, noteData);
    },

    // Delete note
    async deleteNote(noteId) {
        return this.delete(`/notes/${noteId}`);
    }
};

// Export API client
window.api = api;
