// ========================================
// StockandCrypto - Session Crypto Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeSessionCryptoPage();
});

async function initializeSessionCryptoPage() {
    await loadSessionData();
    updateCurrentTime();
    setInterval(updateCurrentTime, 60000);
}

async function loadSessionData() {
    try {
        const data = await api.getCryptoSessionForecast();
        updateSessionUI(data);
    } catch (error) {
        console.log('Using simulated session data');
    }
}

function updateCurrentTime() {
    const now = new Date();
    const beijingTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const hour = beijingTime.getHours();
    
    // Update current session indicator
    updateActiveSession(hour);
}

function updateActiveSession(hour) {
    const sessions = document.querySelectorAll('.metric-card');
    
    sessions.forEach(card => {
        const label = card.querySelector('.metric-label');
        if (!label) return;
        
        const sessionName = label.textContent.toLowerCase();
        let isActive = false;
        
        if (sessionName.includes('asia') && hour >= 8 && hour < 16) {
            isActive = true;
        } else if (sessionName.includes('europe') && hour >= 16 && hour < 24) {
            isActive = true;
        } else if (sessionName.includes('us') && (hour >= 0 && hour < 8)) {
            isActive = true;
        }
        
        const badge = card.querySelector('.status-badge');
        if (badge) {
            if (isActive) {
                badge.className = 'status-badge success';
                badge.textContent = 'Active';
            } else {
                badge.className = 'status-badge info';
                badge.textContent = 'Pending';
            }
        }
    });
}

function updateSessionUI(data) {
    // Update current price
    if (data && data.currentPrice) {
        const priceEl = document.getElementById('currentPrice');
        if (priceEl) {
            priceEl.textContent = utils.formatCurrency(data.currentPrice);
        }
    }
    
    if (data && data.priceChange) {
        const changeEl = document.getElementById('priceChange');
        if (changeEl) {
            changeEl.textContent = utils.formatPercent(data.priceChange);
            changeEl.className = `metric-change ${data.priceChange >= 0 ? 'positive' : 'negative'}`;
        }
    }
}
