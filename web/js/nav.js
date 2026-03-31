// ========================================
// StockandCrypto - Shared Navigation Controller
// ========================================
(function initSiteNavigationModule() {
    const MOBILE_BREAKPOINT = 1180;
    const NAV_ITEMS = [
        { type: 'link', href: 'index.html', label: 'Home' },
        {
            type: 'dropdown',
            label: 'Markets',
            items: [
                { href: 'crypto.html', title: 'Crypto', description: '24/7 benchmark tape' },
                { href: 'cn-equity.html', title: 'CN Equity', description: 'A-share breadth and leaders' },
                { href: 'us-equity.html', title: 'US Equity', description: 'Composite trend and follow-through' }
            ]
        },
        {
            type: 'dropdown',
            label: 'Research',
            items: [
                { href: 'model-explorer.html', title: 'Models', description: 'Conviction, horizons, and drivers' },
                { href: 'backtest-lab.html', title: 'Backtest', description: 'Validate ideas across regimes' },
                { href: 'risk-engine.html', title: 'Risk', description: 'Position sizing and guardrails' }
            ]
        },
        {
            type: 'dropdown',
            label: 'Sessions',
            items: [
                { href: 'session-crypto.html', title: 'Crypto Sessions', description: 'Asia, Europe, and US handoffs' },
                { href: 'session-index.html', title: 'A-Share Sessions', description: 'Session-based index framing' },
                { href: 'session-index-us.html', title: 'US Sessions', description: 'Index rhythm through the US day' }
            ]
        },
        { type: 'link', href: 'notes.html', label: 'Notes' },
        {
            type: 'dropdown',
            label: 'Community',
            items: [
                { href: 'chat.html', title: 'Market Lounges', description: 'Live discussion and desk chat' }
            ]
        },
        {
            type: 'dropdown',
            label: 'Portfolio',
            items: [
                { href: 'tracking.html', title: 'Tracking', description: 'Selection, ranking, and monitoring' },
                { href: 'positions.html', title: 'Positions', description: 'Journaled trades and exposure' },
                { href: 'execution.html', title: 'Execution', description: 'Decision packets and paper flow' }
            ]
        }
    ];

    const PAGE_ALIASES = {
        'login.html': 'index.html',
        'register.html': 'index.html',
        'note-detail.html': 'notes.html',
        'note-view.html': 'notes.html',
        'dm.html': 'chat.html',
        'profile.html': 'positions.html'
    };

    function isMobileViewport() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function getCurrentPage() {
        const file = window.location.pathname.split('/').pop();
        const currentPage = file || 'index.html';
        return PAGE_ALIASES[currentPage] || currentPage;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildMenuMarkup() {
        return NAV_ITEMS.map((item) => {
            if (item.type === 'link') {
                return `<li><a href="${item.href}" class="nav-link" data-nav-page="${item.href}">${item.label}</a></li>`;
            }

            const menuId = `${item.label.toLowerCase().replace(/\s+/g, '-')}-menu`;
            const itemsMarkup = item.items.map((entry) => `
                <li>
                    <a href="${entry.href}" class="nav-link nav-submenu-link" data-nav-page="${entry.href}">
                        <span class="nav-link-title">${escapeHtml(entry.title)}</span>
                        <span class="nav-link-desc">${escapeHtml(entry.description)}</span>
                    </a>
                </li>
            `).join('');

            return `
                <li class="nav-dropdown" data-nav-group="${item.label}">
                    <button class="nav-link nav-dropdown-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="${menuId}">
                        ${escapeHtml(item.label)}
                    </button>
                    <ul class="nav-dropdown-menu" id="${menuId}">
                        ${itemsMarkup}
                    </ul>
                </li>
            `;
        }).join('');
    }

    function ensureNavScaffold(nav) {
        nav.innerHTML = '';

        const navToggle = document.createElement('button');
        navToggle.type = 'button';
        navToggle.id = 'navToggle';
        navToggle.className = 'nav-toggle';
        navToggle.setAttribute('aria-label', 'Toggle navigation');
        navToggle.setAttribute('aria-controls', 'navMenu');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.innerHTML = '<span></span><span></span><span></span>';

        const navMenu = document.createElement('ul');
        navMenu.id = 'navMenu';
        navMenu.classList.add('nav-menu');
        navMenu.innerHTML = buildMenuMarkup();

        const mobileActionsShell = document.createElement('li');
        mobileActionsShell.className = 'nav-mobile-actions-shell';
        mobileActionsShell.setAttribute('aria-hidden', 'true');
        mobileActionsShell.innerHTML = '<div class="nav-mobile-actions"></div>';
        navMenu.appendChild(mobileActionsShell);

        const navBackdrop = document.createElement('button');
        navBackdrop.type = 'button';
        navBackdrop.className = 'nav-backdrop';
        navBackdrop.setAttribute('aria-label', 'Close navigation');

        nav.appendChild(navToggle);
        nav.appendChild(navMenu);
        nav.appendChild(navBackdrop);

        const logoIcon = document.querySelector('.logo-icon');
        if (logoIcon) {
            logoIcon.textContent = '◇';
        }

        return {
            navMenu,
            navToggle,
            navBackdrop,
            mobileActionsShell,
            mobileActions: mobileActionsShell.querySelector('.nav-mobile-actions')
        };
    }

    const SiteNav = {
        isInitialized: false,

        init() {
            if (this.isInitialized) {
                return;
            }

            const nav = document.querySelector('.nav');
            if (!nav) {
                return;
            }

            const {
                navMenu,
                navToggle,
                navBackdrop,
                mobileActionsShell,
                mobileActions
            } = ensureNavScaffold(nav);
            const dropdowns = Array.from(navMenu.querySelectorAll('.nav-dropdown'));
            const closeTimers = new WeakMap();
            const desktopActions = nav.closest('.header-container')?.querySelector(':scope > .nav-actions')
                || document.querySelector('.header-container > .nav-actions');

            const syncHeaderMetrics = () => {
                const header = document.querySelector('.header');
                const headerHeight = Math.ceil(header?.getBoundingClientRect().height || 78);
                document.documentElement.style.setProperty('--mobile-nav-offset', `${headerHeight + 12}px`);
                document.documentElement.style.setProperty('--mobile-nav-max-height', `calc(100vh - ${headerHeight + 24}px)`);
            };

            const syncMobileActions = () => {
                if (!mobileActions || !mobileActionsShell) {
                    return;
                }

                if (!desktopActions || !desktopActions.innerHTML.trim()) {
                    mobileActions.innerHTML = '';
                    mobileActionsShell.hidden = true;
                    mobileActionsShell.setAttribute('aria-hidden', 'true');
                    return;
                }

                const temp = document.createElement('div');
                temp.innerHTML = desktopActions.innerHTML;
                temp.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
                mobileActions.innerHTML = temp.innerHTML;
                const hasContent = Boolean(mobileActions.textContent.trim());
                mobileActionsShell.hidden = !hasContent;
                mobileActionsShell.setAttribute('aria-hidden', hasContent ? 'false' : 'true');
            };

            const clearCloseTimer = (dropdown) => {
                const timer = closeTimers.get(dropdown);
                if (timer) {
                    window.clearTimeout(timer);
                    closeTimers.delete(dropdown);
                }
            };

            const scheduleClose = (dropdown, toggle, delay = 180) => {
                clearCloseTimer(dropdown);
                const timer = window.setTimeout(() => {
                    dropdown.classList.remove('open');
                    toggle.setAttribute('aria-expanded', 'false');
                    closeTimers.delete(dropdown);
                }, delay);
                closeTimers.set(dropdown, timer);
            };

            const closeDropdowns = (keepOpen = null) => {
                dropdowns.forEach((dropdown) => {
                    if (keepOpen && keepOpen === dropdown) {
                        clearCloseTimer(dropdown);
                        return;
                    }
                    clearCloseTimer(dropdown);
                    dropdown.classList.remove('open');
                    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
                    if (toggle) {
                        toggle.setAttribute('aria-expanded', 'false');
                    }
                });
            };

            const closeMobileMenu = () => {
                nav.classList.remove('menu-open');
                navToggle.classList.remove('active');
                navToggle.setAttribute('aria-expanded', 'false');
                closeDropdowns();
                syncHeaderMetrics();
            };

            const toggleMobileMenu = () => {
                const willOpen = !nav.classList.contains('menu-open');
                nav.classList.toggle('menu-open', willOpen);
                navToggle.classList.toggle('active', willOpen);
                navToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                syncHeaderMetrics();
                if (!willOpen) {
                    closeDropdowns();
                }
            };

            navToggle.addEventListener('click', () => {
                if (isMobileViewport()) {
                    toggleMobileMenu();
                    return;
                }
                closeDropdowns();
            });

            navBackdrop.addEventListener('click', closeMobileMenu);

            dropdowns.forEach((dropdown) => {
                const toggle = dropdown.querySelector('.nav-dropdown-toggle');
                if (!toggle) {
                    return;
                }

                toggle.addEventListener('click', (event) => {
                    event.preventDefault();
                    const isOpen = dropdown.classList.contains('open');
                    closeDropdowns(isOpen ? null : dropdown);
                    dropdown.classList.toggle('open', !isOpen);
                    toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
                });

                toggle.addEventListener('mouseenter', () => {
                    if (isMobileViewport()) {
                        return;
                    }
                    clearCloseTimer(dropdown);
                    closeDropdowns(dropdown);
                    dropdown.classList.add('open');
                    toggle.setAttribute('aria-expanded', 'true');
                });

                toggle.addEventListener('focus', () => {
                    if (isMobileViewport()) {
                        return;
                    }
                    clearCloseTimer(dropdown);
                    closeDropdowns(dropdown);
                    dropdown.classList.add('open');
                    toggle.setAttribute('aria-expanded', 'true');
                });

                dropdown.addEventListener('mouseenter', () => {
                    if (isMobileViewport()) {
                        return;
                    }
                    clearCloseTimer(dropdown);
                    closeDropdowns(dropdown);
                    dropdown.classList.add('open');
                    toggle.setAttribute('aria-expanded', 'true');
                });

                toggle.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        closeDropdowns();
                        toggle.blur();
                        return;
                    }

                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle.click();
                    }
                });

                dropdown.addEventListener('mouseleave', () => {
                    if (isMobileViewport()) {
                        return;
                    }
                    scheduleClose(dropdown, toggle);
                });

                dropdown.addEventListener('focusout', (event) => {
                    if (isMobileViewport()) {
                        return;
                    }
                    if (dropdown.contains(event.relatedTarget)) {
                        return;
                    }
                    scheduleClose(dropdown, toggle, 120);
                });
            });

            navMenu.querySelectorAll('a.nav-link').forEach((link) => {
                link.addEventListener('click', () => {
                    if (isMobileViewport()) {
                        closeMobileMenu();
                    }
                });
            });

            mobileActions?.addEventListener('click', (event) => {
                const trigger = event.target.closest('a, button');
                if (!trigger || !isMobileViewport()) {
                    return;
                }
                if (trigger.matches('[data-auth-logout]')) {
                    closeMobileMenu();
                    return;
                }
                if (trigger.tagName === 'A') {
                    closeMobileMenu();
                }
            });

            document.addEventListener('click', (event) => {
                if (!nav.contains(event.target)) {
                    closeDropdowns();
                    closeMobileMenu();
                }
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeDropdowns();
                    closeMobileMenu();
                }
            });

            window.addEventListener('resize', () => {
                closeDropdowns();
                if (!isMobileViewport()) {
                    nav.classList.remove('menu-open');
                    navToggle.classList.remove('active');
                    navToggle.setAttribute('aria-expanded', 'false');
                }
                syncHeaderMetrics();
            });

            window.addEventListener('auth:changed', () => {
                syncHeaderMetrics();
                syncMobileActions();
            });

            const currentPage = getCurrentPage();
            navMenu.querySelectorAll('.nav-link').forEach((link) => {
                link.classList.remove('active');
            });
            navMenu.querySelectorAll('.nav-dropdown-toggle').forEach((toggle) => {
                toggle.classList.remove('active');
            });

            const activeLink = navMenu.querySelector(`.nav-link[data-nav-page="${currentPage}"]`);
            if (activeLink) {
                activeLink.classList.add('active');
                const parentDropdown = activeLink.closest('.nav-dropdown');
                if (parentDropdown) {
                    const toggle = parentDropdown.querySelector('.nav-dropdown-toggle');
                    if (toggle) {
                        toggle.classList.add('active');
                    }
                }
            }

            syncHeaderMetrics();
            syncMobileActions();
            this.isInitialized = true;
        }
    };

    window.SiteNav = SiteNav;
    document.addEventListener('DOMContentLoaded', () => SiteNav.init());
})();
