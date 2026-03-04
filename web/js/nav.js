// ========================================
// StockandCrypto - Shared Navigation Controller
// ========================================
(function initSiteNavigationModule() {
    const MOBILE_BREAKPOINT = 991;

    function isMobileViewport() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function getCurrentPage() {
        const file = window.location.pathname.split('/').pop();
        return file || 'index.html';
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

            const navMenu = nav.querySelector('#navMenu, .nav-menu');
            const navToggle = nav.querySelector('#navToggle, .nav-toggle');
            if (!navMenu || !navToggle) {
                return;
            }

            const navBackdrop = nav.querySelector('.nav-backdrop');
            const dropdowns = Array.from(navMenu.querySelectorAll('.nav-dropdown'));

            const closeDropdowns = (keepOpen = null) => {
                dropdowns.forEach((dropdown) => {
                    if (keepOpen && keepOpen === dropdown) {
                        return;
                    }
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
            };

            const toggleMobileMenu = () => {
                const willOpen = !nav.classList.contains('menu-open');
                nav.classList.toggle('menu-open', willOpen);
                navToggle.classList.toggle('active', willOpen);
                navToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
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

            if (navBackdrop) {
                navBackdrop.addEventListener('click', closeMobileMenu);
            }

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

                toggle.addEventListener('focus', () => {
                    if (isMobileViewport()) {
                        return;
                    }
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

                dropdown.addEventListener('focusout', (event) => {
                    if (isMobileViewport()) {
                        return;
                    }
                    if (dropdown.contains(event.relatedTarget)) {
                        return;
                    }
                    dropdown.classList.remove('open');
                    toggle.setAttribute('aria-expanded', 'false');
                });
            });

            navMenu.querySelectorAll('.nav-link').forEach((link) => {
                link.addEventListener('click', () => {
                    if (isMobileViewport()) {
                        closeMobileMenu();
                    }
                });
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
            });

            const currentPage = getCurrentPage();
            navMenu.querySelectorAll('.nav-link').forEach((link) => {
                link.classList.remove('active');
            });
            navMenu.querySelectorAll('.nav-dropdown-toggle').forEach((toggle) => {
                toggle.classList.remove('active');
            });

            const activeLink = navMenu.querySelector(`.nav-link[href="${currentPage}"]`);
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

            this.isInitialized = true;
        }
    };

    window.SiteNav = SiteNav;
    document.addEventListener('DOMContentLoaded', () => SiteNav.init());
})();
