// ========================================
// StockandCrypto - Crypto Page Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeCryptoPage();
});

async function initializeCryptoPage() {
    await loadCryptoData();
    initializeTimeframeButtons();
    initializeSearch();
}

async function loadCryptoData() {
    try {
        const data = await api.getCryptoPrices();
        updateCryptoUI(data);
    } catch (error) {
        console.log('Using simulated data');
        updateCryptoUI(getSimulatedCryptoData());
    }
}

function getSimulatedCryptoData() {
    return {
        btc: { price: 67234.50, change: 2.34 },
        eth: { price: 3456.78, change: 3.12 },
        sol: { price: 145.23, change: -1.45 }
    };
}

function updateCryptoUI(data) {
    // Update BTC
    if (data.btc) {
        const btcPrice = document.getElementById('btcPrice');
        const btcChange = document.getElementById('btcChange');
        const btcTablePrice = document.getElementById('btcTablePrice');
        
        if (btcPrice) btcPrice.textContent = utils.formatCurrency(data.btc.price);
        if (btcChange) {
            btcChange.textContent = utils.formatPercent(data.btc.change / 100);
            btcChange.className = `metric-change ${data.btc.change >= 0 ? 'positive' : 'negative'}`;
        }
        if (btcTablePrice) btcTablePrice.textContent = utils.formatCurrency(data.btc.price);
    }
    
    // Update ETH
    if (data.eth) {
        const ethPrice = document.getElementById('ethPrice');
        const ethChange = document.getElementById('ethChange');
        const ethTablePrice = document.getElementById('ethTablePrice');
        
        if (ethPrice) ethPrice.textContent = utils.formatCurrency(data.eth.price);
        if (ethChange) {
            ethChange.textContent = utils.formatPercent(data.eth.change / 100);
            ethChange.className = `metric-change ${data.eth.change >= 0 ? 'positive' : 'negative'}`;
        }
        if (ethTablePrice) ethTablePrice.textContent = utils.formatCurrency(data.eth.price);
    }
    
    // Update SOL
    if (data.sol) {
        const solPrice = document.getElementById('solPrice');
        const solChange = document.getElementById('solChange');
        const solTablePrice = document.getElementById('solTablePrice');
        
        if (solPrice) solPrice.textContent = utils.formatCurrency(data.sol.price);
        if (solChange) {
            solChange.textContent = utils.formatPercent(data.sol.change / 100);
            solChange.className = `metric-change ${data.sol.change >= 0 ? 'positive' : 'negative'}`;
        }
        if (solTablePrice) solTablePrice.textContent = utils.formatCurrency(data.sol.price);
    }
}

function initializeTimeframeButtons() {
    const btn1h = document.getElementById('btn1h');
    const btn24h = document.getElementById('btn24h');
    const btn7d = document.getElementById('btn7d');
    
    if (btn1h) btn1h.addEventListener('click', () => switchTimeframe('1h'));
    if (btn24h) btn24h.addEventListener('click', () => switchTimeframe('24h'));
    if (btn7d) btn7d.addEventListener('click', () => switchTimeframe('7d'));
}

function switchTimeframe(timeframe) {
    // Update button states
    document.querySelectorAll('.chart-header .btn').forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    });
    
    event.target.classList.remove('btn-secondary');
    event.target.classList.add('btn-primary');
    
    // Reload chart data (would fetch from API in real implementation)
    console.log(`Switched to ${timeframe} timeframe`);
}

function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    const filterBtn = document.getElementById('filterBtn');
    
    if (searchInput) {
        searchInput.addEventListener('input', utils.debounce((e) => {
            filterTable(e.target.value);
        }, 300));
    }
    
    if (filterBtn) {
        filterBtn.addEventListener('click', () => {
            // Open filter modal or apply filters
            console.log('Filter button clicked');
        });
    }
}

function filterTable(query) {
    const tableBody = document.getElementById('cryptoTableBody');
    if (!tableBody) return;
    
    const rows = tableBody.querySelectorAll('tr');
    const lowerQuery = query.toLowerCase();
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(lowerQuery) ? '' : 'none';
    });
}

// Auto-refresh prices every 10 seconds
setInterval(async () => {
    try {
        const data = await api.getCryptoPrices();
        updateCryptoUI(data);
    } catch (error) {
        // Silent fail for auto-refresh
    }
}, 10000);
