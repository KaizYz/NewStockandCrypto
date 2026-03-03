// ========================================
// StockandCrypto - API Client
// ========================================

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:5001/api'
    : `${window.location.origin}/api`;

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
            headers
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
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

    // ==================== Market Data ====================
    
    // Get crypto prices
    async getCryptoPrices() {
        return this.get('/crypto/prices');
    },

    // Get crypto predictions
    async getCryptoPredictions(symbol = 'BTC') {
        return this.get(`/crypto/predictions?symbol=${symbol}`);
    },

    // Get CN equity prices
    async getCNEquityPrices() {
        return this.get('/cn-equity/prices');
    },

    // Get CN equity predictions
    async getCNEquityPredictions(code) {
        return this.get(`/cn-equity/predictions?code=${code}`);
    },

    // Get US equity prices
    async getUSEquityPrices() {
        return this.get('/us-equity/prices');
    },

    // Get US equity predictions
    async getUSEquityPredictions(symbol) {
        return this.get(`/us-equity/predictions?symbol=${symbol}`);
    },

    // ==================== Session Forecast ====================
    
    // Get crypto session forecast
    async getCryptoSessionForecast(symbol = 'BTC') {
        return this.get(`/session/crypto?symbol=${symbol}`);
    },

    // Get index session forecast
    async getIndexSessionForecast(index = 'SSE') {
        return this.get(`/session/index?index=${index}`);
    },

    // ==================== Tracking ====================
    
    // Get universe ranking
    async getUniverseRanking(market = 'all') {
        return this.get(`/tracking/universe?market=${market}`);
    },

    // Get factor scores
    async getFactorScores(symbol) {
        return this.get(`/tracking/factors?symbol=${symbol}`);
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
