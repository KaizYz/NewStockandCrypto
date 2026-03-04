// ========================================
// StockandCrypto - Main Application Logic
// ========================================

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeParticles();
    initializeCharts();
    initializeAnimations();
    loadMarketData();
});

// Navigation
function initializeNavigation() {
    if (window.SiteNav && typeof window.SiteNav.init === 'function') {
        window.SiteNav.init();
        return;
    }

    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');

    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            navToggle.classList.toggle('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) {
                navMenu.classList.remove('active');
                navToggle.classList.remove('active');
            }
        });
    }

    // Highlight active nav item
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
        }
    });
}

// Particle background animation
function initializeParticles() {
    const particlesContainer = document.getElementById('particles');
    if (!particlesContainer) return;

    const particleCount = 50;
    for (let i = 0; i < particleCount; i++) {
        createParticle(particlesContainer);
    }
}

function createParticle(container) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `${Math.random() * 100}%`;
    particle.style.animationDelay = `${Math.random() * 8}s`;
    particle.style.animationDuration = `${8 + Math.random() * 4}s`;
    container.appendChild(particle);
}

// Chart initialization
function initializeCharts() {
    // Initialize any charts on the page
    const accuracyCanvas = document.getElementById('accuracyChart');
    if (accuracyCanvas) {
        initializeAccuracyChart(accuracyCanvas);
    }

    const coverageCanvas = document.getElementById('coverageChart');
    if (coverageCanvas) {
        initializeCoverageChart(coverageCanvas);
    }

    const priceCanvas = document.getElementById('priceChart');
    if (priceCanvas) {
        initializePriceChart(priceCanvas);
    }

    const sessionCanvas = document.getElementById('sessionChart');
    if (sessionCanvas) {
        initializeSessionChart(sessionCanvas);
    }

    const equityCanvas = document.getElementById('equityChart');
    if (equityCanvas) {
        initializeEquityChart(equityCanvas);
    }

    const indexCanvas = document.getElementById('indexChart');
    if (indexCanvas) {
        initializeIndexChart(indexCanvas);
    }
}

// Accuracy Chart
function initializeAccuracyChart(canvas) {
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
            datasets: [{
                label: 'Hourly',
                data: [0.51, 0.52, 0.507, 0.515, 0.523, 0.518],
                borderColor: '#00d4ff',
                backgroundColor: 'rgba(0, 212, 255, 0.1)',
                tension: 0.4,
                fill: true
            }, {
                label: 'Daily',
                data: [0.58, 0.62, 0.65, 0.67, 0.64, 0.67],
                borderColor: '#00ff88',
                backgroundColor: 'rgba(0, 255, 136, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 0.4,
                    max: 0.8,
                    ticks: {
                        color: '#6c6c8a'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#6c6c8a'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Coverage Chart
function initializeCoverageChart(canvas) {
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
            datasets: [{
                label: 'Actual Coverage',
                data: [0.78, 0.82, 0.79, 0.81, 0.83, 0.80, 0.81],
                borderColor: '#00d4ff',
                backgroundColor: 'rgba(0, 212, 255, 0.3)',
                tension: 0.4,
                fill: true
            }, {
                label: 'Target (80%)',
                data: [0.80, 0.80, 0.80, 0.80, 0.80, 0.80, 0.80],
                borderColor: '#ff3366',
                borderDash: [5, 5],
                tension: 0,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 0.7,
                    max: 0.9,
                    ticks: {
                        color: '#6c6c8a',
                        callback: (value) => `${(value * 100).toFixed(0)}%`
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#6c6c8a'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Price Chart (for crypto)
function initializePriceChart(canvas) {
    const ctx = canvas.getContext('2d');
    const labels = [];
    const data = [];
    
    // Generate mock data for last 24 hours
    for (let i = 24; i >= 0; i--) {
        const hour = new Date();
        hour.setHours(hour.getHours() - i);
        labels.push(hour.getHours() + ':00');
        data.push(67000 + Math.random() * 1000);
    }
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'BTC/USDT',
                data: data,
                borderColor: '#00d4ff',
                backgroundColor: 'rgba(0, 212, 255, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    ticks: {
                        color: '#6c6c8a',
                        callback: (value) => '$' + value.toLocaleString()
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#6c6c8a',
                        maxTicksLimit: 8
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Session Chart
function initializeSessionChart(canvas) {
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'],
            datasets: [{
                label: 'P(UP)',
                data: [0.62, 0.58, 0.65, 0.55, 0.52, 0.54, 0.51, 0.48, 0.45, 0.42, 0.48, 0.51, 0.55, 0.58, 0.62, 0.65, 0.68, 0.72, 0.69, 0.65, 0.62, 0.58, 0.55, 0.52],
                backgroundColor: function(context) {
                    const value = context.raw;
                    return value >= 0.55 ? 'rgba(0, 255, 136, 0.6)' : 
                           value <= 0.45 ? 'rgba(255, 51, 102, 0.6)' : 
                           'rgba(255, 204, 0, 0.6)';
                },
                borderColor: function(context) {
                    const value = context.raw;
                    return value >= 0.55 ? '#00ff88' : 
                           value <= 0.45 ? '#ff3366' : 
                           '#ffcc00';
                },
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 0.3,
                    max: 0.8,
                    ticks: {
                        color: '#6c6c8a'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#6c6c8a',
                        maxTicksLimit: 12
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Equity Chart
function initializeEquityChart(canvas) {
    const ctx = canvas.getContext('2d');
    const labels = [];
    const data = [];
    
    // Generate mock equity curve
    for (let i = 30; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        data.push(100000 + (30 - i) * 400 + Math.random() * 200 - 100);
    }
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Equity',
                data: data,
                borderColor: '#00ff88',
                backgroundColor: 'rgba(0, 255, 136, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    ticks: {
                        color: '#6c6c8a',
                        callback: (value) => '$' + value.toLocaleString()
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#6c6c8a',
                        maxTicksLimit: 7
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Index Chart
function initializeIndexChart(canvas) {
    const ctx = canvas.getContext('2d');
    const labels = [];
    const data = [];
    
    // Generate mock index data
    for (let i = 30; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        data.push(3124 + Math.random() * 50 - 25);
    }
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'SSE Composite',
                data: data,
                borderColor: '#00d4ff',
                backgroundColor: 'rgba(0, 212, 255, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    ticks: {
                        color: '#6c6c8a'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#6c6c8a',
                        maxTicksLimit: 7
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Scroll animations
function initializeAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Animate elements with data-delay attribute
    document.querySelectorAll('[data-delay]').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = `opacity 0.6s ease ${el.dataset.delay}ms, transform 0.6s ease ${el.dataset.delay}ms`;
        observer.observe(el);
    });

    // Animate stat counters
    document.querySelectorAll('.stat-value[data-count]').forEach(el => {
        const target = parseFloat(el.dataset.count);
        animateCounter(el, target);
    });
}

function animateCounter(element, target) {
    const duration = 2000;
    const start = 0;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = start + (target - start) * easeOutQuart(progress);
        
        if (target % 1 === 0) {
            element.textContent = Math.floor(current);
        } else {
            element.textContent = current.toFixed(1);
        }
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

// Load market data
async function loadMarketData() {
    try {
        // Update crypto prices if on relevant page
        if (document.getElementById('btcPrice')) {
            const cryptoData = await api.getCryptoPrices();
            updateCryptoPrices(cryptoData);
        }
    } catch (error) {
        console.log('Using simulated data for demo');
    }
}

function updateCryptoPrices(data) {
    if (data && data.btc) {
        const btcElement = document.getElementById('btcPrice');
        if (btcElement) {
            btcElement.textContent = utils.formatCurrency(data.btc.price);
        }
    }
}

// Export functions
window.initializeApp = initializeNavigation;
window.initializeCharts = initializeCharts;
