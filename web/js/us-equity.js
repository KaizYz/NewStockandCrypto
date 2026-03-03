// ========================================
// StockandCrypto - US Equity Page Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeUSEquityPage();
});

async function initializeUSEquityPage() {
    await loadUSEquityData();
    initializeSearch();
}

async function loadUSEquityData() {
    try {
        const data = await api.getUSEquityPrices();
        updateUSEquityUI(data);
    } catch (error) {
        console.log('Using simulated data');
        updateUSEquityUI(getSimulatedUSEquityData());
    }
}

function getSimulatedUSEquityData() {
    return {
        dow: { index: 38654.42, change: 0.85 },
        nasdaq: { index: 16789.23, change: 1.52 },
        sp: { index: 5234.18, change: 1.12 }
    };
}

function updateUSEquityUI(data) {
    if (data.dow) {
        const dowIndex = document.getElementById('dowIndex');
        const dowChange = document.getElementById('dowChange');
        
        if (dowIndex) dowIndex.textContent = utils.formatNumber(data.dow.index, 2);
        if (dowChange) {
            dowChange.textContent = utils.formatPercent(data.dow.change / 100);
            dowChange.className = `metric-change ${data.dow.change >= 0 ? 'positive' : 'negative'}`;
        }
    }
    
    if (data.nasdaq) {
        const nasdaqIndex = document.getElementById('nasdaqIndex');
        const nasdaqChange = document.getElementById('nasdaqChange');
        
        if (nasdaqIndex) nasdaqIndex.textContent = utils.formatNumber(data.nasdaq.index, 2);
        if (nasdaqChange) {
            nasdaqChange.textContent = utils.formatPercent(data.nasdaq.change / 100);
            nasdaqChange.className = `metric-change ${data.nasdaq.change >= 0 ? 'positive' : 'negative'}`;
        }
    }
    
    if (data.sp) {
        const spIndex = document.getElementById('spIndex');
        const spChange = document.getElementById('spChange');
        
        if (spIndex) spIndex.textContent = utils.formatNumber(data.sp.index, 2);
        if (spChange) {
            spChange.textContent = utils.formatPercent(data.sp.change / 100);
            spChange.className = `metric-change ${data.sp.change >= 0 ? 'positive' : 'negative'}`;
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
