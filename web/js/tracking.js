// ========================================
// StockandCrypto - Tracking Page Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeTrackingPage();
});

async function initializeTrackingPage() {
    await loadUniverseData();
    initializeFilters();
    initializeExport();
}

async function loadUniverseData() {
    try {
        const data = await api.getUniverseRanking();
        updateUniverseUI(data);
    } catch (error) {
        console.log('Using simulated universe data');
    }
}

function updateUniverseUI(data) {
    // Would update the universe table in real implementation
}

function initializeFilters() {
    const marketSelect = document.querySelector('.form-select');
    
    if (marketSelect) {
        marketSelect.addEventListener('change', function() {
            const market = this.value.toLowerCase();
            filterUniverse(market);
        });
    }
}

function filterUniverse(market) {
    const tableBody = document.querySelector('.data-table tbody');
    if (!tableBody) return;
    
    const rows = tableBody.querySelectorAll('tr');
    
    rows.forEach(row => {
        if (market === 'all markets') {
            row.style.display = '';
        } else {
            const marketCell = row.querySelector('td:nth-child(3)');
            if (marketCell) {
                const rowMarket = marketCell.textContent.toLowerCase();
                row.style.display = rowMarket.includes(market.toLowerCase()) ? '' : 'none';
            }
        }
    });
}

function initializeExport() {
    const exportBtn = document.querySelector('.btn-primary.btn-sm');
    
    if (exportBtn && exportBtn.textContent.includes('Export')) {
        exportBtn.addEventListener('click', exportUniverseData);
    }
}

function exportUniverseData() {
    console.log('Exporting universe data...');
    // Would generate CSV export in real implementation
}
