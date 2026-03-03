// ========================================
// StockandCrypto - Session Index Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeSessionIndexPage();
});

async function initializeSessionIndexPage() {
    await loadIndexSessionData();
    initializeMarketButtons();
}

async function loadIndexSessionData() {
    try {
        const data = await api.getIndexSessionForecast();
        updateIndexSessionUI(data);
    } catch (error) {
        console.log('Using simulated index session data');
    }
}

function initializeMarketButtons() {
    const buttons = document.querySelectorAll('.btn-group button, div[style*="gap: 1rem"] button');
    
    buttons.forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active state from all buttons
            buttons.forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-secondary');
            });
            
            // Add active state to clicked button
            this.classList.remove('btn-secondary');
            this.classList.add('btn-primary');
            
            // Load data for selected market
            const market = this.textContent.trim();
            loadMarketSessionData(market);
        });
    });
}

function loadMarketSessionData(market) {
    console.log(`Loading session data for ${market}`);
    // Would fetch from API in real implementation
}

function updateIndexSessionUI(data) {
    if (data && data.currentIndex) {
        const indexEl = document.getElementById('currentIndex');
        if (indexEl) {
            indexEl.textContent = utils.formatNumber(data.currentIndex, 2);
        }
    }
    
    if (data && data.indexChange) {
        const changeEl = document.getElementById('indexChange');
        if (changeEl) {
            changeEl.textContent = utils.formatPercent(data.indexChange);
            changeEl.className = `metric-change ${data.indexChange >= 0 ? 'positive' : 'negative'}`;
        }
    }
}
