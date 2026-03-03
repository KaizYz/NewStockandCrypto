// ========================================
// StockandCrypto - Execution Page Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeExecutionPage();
});

async function initializeExecutionPage() {
    await loadExecutionData();
    initializeTimeframeButtons();
    initializeExport();
}

async function loadExecutionData() {
    try {
        const data = await api.getExecutions(50);
        updateExecutionUI(data);
    } catch (error) {
        console.log('Using simulated execution data');
    }
}

function updateExecutionUI(data) {
    // Would update the execution table in real implementation
}

function initializeTimeframeButtons() {
    const buttons = document.querySelectorAll('.chart-header .btn-secondary, .chart-header .btn-primary');
    
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
            
            // Load data for selected timeframe
            const timeframe = this.textContent.trim();
            loadEquityData(timeframe);
        });
    });
}

function loadEquityData(timeframe) {
    console.log(`Loading equity data for ${timeframe}`);
    // Would fetch from API in real implementation
}

function initializeExport() {
    const exportBtn = document.querySelector('.table-controls .btn-primary');
    
    if (exportBtn && exportBtn.textContent.includes('Export')) {
        exportBtn.addEventListener('click', exportExecutionData);
    }
}

function exportExecutionData() {
    console.log('Exporting execution data...');
    // Would generate CSV export in real implementation
}
