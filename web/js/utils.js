// ========================================
// StockandCrypto - Utility Functions
// ========================================

// Format number with commas
function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined) return '-';
    return parseFloat(num).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// Format currency
function formatCurrency(num, currency = 'USD', decimals = 2) {
    if (num === null || num === undefined) return '-';
    const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
    return formatter.format(num);
}

// Format percentage
function formatPercent(num, decimals = 2) {
    if (num === null || num === undefined) return '-';
    const sign = num >= 0 ? '+' : '';
    return `${sign}${(num * 100).toFixed(decimals)}%`;
}

// Format timestamp
function formatTimestamp(timestamp, format = 'full') {
    const date = new Date(timestamp);
    const options = {
        full: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
        short: { year: 'numeric', month: '2-digit', day: '2-digit' },
        time: { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    };
    return date.toLocaleString('en-US', options[format]);
}

// Calculate percentage change
function calcPercentChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Deep clone object
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Get query parameter
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

// Set query parameter
function setQueryParam(param, value) {
    const url = new URL(window.location.href);
    url.searchParams.set(param, value);
    window.history.pushState({}, '', url);
}

// Local storage helpers
const storage = {
    get(key) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.error('Error reading from localStorage', e);
            return null;
        }
    },
    
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error('Error writing to localStorage', e);
        }
    },
    
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.error('Error removing from localStorage', e);
        }
    }
};

// Session storage helpers
const session = {
    get(key) {
        try {
            const item = sessionStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.error('Error reading from sessionStorage', e);
            return null;
        }
    },
    
    set(key, value) {
        try {
            sessionStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error('Error writing to sessionStorage', e);
        }
    },
    
    remove(key) {
        try {
            sessionStorage.removeItem(key);
        } catch (e) {
            console.error('Error removing from sessionStorage', e);
        }
    }
};

// Show loading spinner
function showLoading(container) {
    const spinner = document.createElement('div');
    spinner.className = 'loading-overlay';
    spinner.innerHTML = '<div class="loading-spinner"></div>';
    container.appendChild(spinner);
    return spinner;
}

// Hide loading spinner
function hideLoading(spinner) {
    if (spinner && spinner.parentNode) {
        spinner.parentNode.removeChild(spinner);
    }
}

// Create skeleton loader
function createSkeleton(type = 'text') {
    const skeleton = document.createElement('div');
    skeleton.className = `skeleton skeleton-${type}`;
    return skeleton;
}

// Animate number counting
function animateNumber(element, start, end, duration = 1000) {
    const startTime = performance.now();
    const diff = end - start;
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = start + (diff * progress);
        element.textContent = formatNumber(current, 0);
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

// Get status badge class
function getStatusBadgeClass(status) {
    const statusMap = {
        'success': 'success',
        'active': 'success',
        'live': 'success',
        'long': 'success',
        'warning': 'warning',
        'pending': 'warning',
        'flat': 'warning',
        'hold': 'warning',
        'danger': 'danger',
        'error': 'danger',
        'short': 'danger',
        'closed': 'warning',
        'info': 'info',
        'open': 'success'
    };
    return statusMap[status.toLowerCase()] || 'info';
}

// Get signal color
function getSignalColor(signal) {
    if (signal >= 0.65) return 'success';
    if (signal >= 0.55) return 'success';
    if (signal >= 0.45) return 'warning';
    return 'danger';
}

// Get signal text
function getSignalText(pUp) {
    if (pUp >= 0.65) return 'STRONG LONG';
    if (pUp >= 0.55) return 'LONG';
    if (pUp <= 0.35) return 'STRONG SHORT';
    if (pUp <= 0.45) return 'SHORT';
    return 'FLAT';
}

// Export utilities
window.utils = {
    formatNumber,
    formatCurrency,
    formatPercent,
    formatTimestamp,
    calcPercentChange,
    debounce,
    throttle,
    deepClone,
    getQueryParam,
    setQueryParam,
    storage,
    session,
    showLoading,
    hideLoading,
    createSkeleton,
    animateNumber,
    getStatusBadgeClass,
    getSignalColor,
    getSignalText
};
