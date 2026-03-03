// ========================================
// StockandCrypto - CN Equity Page Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeCNEquityPage();
});

async function initializeCNEquityPage() {
    await loadCNEquityData();
    initializeSearch();
}

async function loadCNEquityData() {
    try {
        const data = await api.getCNEquityPrices();
        updateCNEquityUI(data);
    } catch (error) {
        console.log('Using simulated data');
        updateCNEquityUI(getSimulatedCNEquityData());
    }
}

function getSimulatedCNEquityData() {
    return {
        sse: { index: 3124.56, change: 1.23 },
        csi: { index: 3892.45, change: -0.45 }
    };
}

function updateCNEquityUI(data) {
    if (data.sse) {
        const sseIndex = document.getElementById('sseIndex');
        const sseChange = document.getElementById('sseChange');
        
        if (sseIndex) sseIndex.textContent = utils.formatNumber(data.sse.index, 2);
        if (sseChange) {
            sseChange.textContent = utils.formatPercent(data.sse.change / 100);
            sseChange.className = `metric-change ${data.sse.change >= 0 ? 'positive' : 'negative'}`;
        }
    }
    
    if (data.csi) {
        const csiIndex = document.getElementById('csiIndex');
        const csiChange = document.getElementById('csiChange');
        
        if (csiIndex) csiIndex.textContent = utils.formatNumber(data.csi.index, 2);
        if (csiChange) {
            csiChange.textContent = utils.formatPercent(data.csi.change / 100);
            csiChange.className = `metric-change ${data.csi.change >= 0 ? 'positive' : 'negative'}`;
        }
    }
}

function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    
    if (searchInput) {
        searchInput.addEventListener('input', utils.debounce((e) => {
            filterTable(e.target.value);
        }, 300));
    }
}

function filterTable(query) {
    const tableBody = document.querySelector('.data-table tbody');
    if (!tableBody) return;
    
    const rows = tableBody.querySelectorAll('tr');
    const lowerQuery = query.toLowerCase();
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(lowerQuery) ? '' : 'none';
    });
}
