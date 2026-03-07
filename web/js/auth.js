(function initAuthModule() {
    const AUTH_BASE = `${window.location.origin}/api/auth`;
    let currentUser = null;
    let mePromise = null;

    async function request(endpoint, options = {}) {
        const response = await fetch(`${AUTH_BASE}${endpoint}`, {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            credentials: 'same-origin',
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = { success: false, error: 'INVALID_RESPONSE', message: 'Unexpected response format.' };
        }

        if (!response.ok) {
            const err = new Error(data.message || data.error || `HTTP ${response.status}`);
            err.status = response.status;
            err.payload = data;
            throw err;
        }

        return data;
    }

    function emitAuthChanged() {
        window.dispatchEvent(new CustomEvent('auth:changed', {
            detail: { user: currentUser }
        }));
    }

    function notify(type, message) {
        if (window.showToast?.[type]) {
            window.showToast[type](message, 2800);
        }
    }

    function ensureMessageContainer(form) {
        let container = form.querySelector('.auth-message');
        if (!container) {
            container = document.createElement('div');
            container.className = 'auth-message';
            container.style.marginBottom = '1rem';
            container.style.padding = '0.75rem 0.9rem';
            container.style.borderRadius = '10px';
            container.style.fontSize = '0.875rem';
            container.style.display = 'none';
            form.prepend(container);
        }
        return container;
    }

    function renderFormMessage(form, message, type = 'error') {
        const container = ensureMessageContainer(form);
        if (!message) {
            container.textContent = '';
            container.style.display = 'none';
            return;
        }
        container.textContent = message;
        container.style.display = 'block';
        if (type === 'success') {
            container.style.border = '1px solid rgba(16, 185, 129, 0.35)';
            container.style.background = 'rgba(16, 185, 129, 0.12)';
            container.style.color = '#A7F3D0';
            return;
        }
        container.style.border = '1px solid rgba(248, 113, 113, 0.35)';
        container.style.background = 'rgba(127, 29, 29, 0.18)';
        container.style.color = '#FECACA';
    }

    function setButtonBusy(button, busy, label) {
        if (!button) return;
        if (busy) {
            button.dataset.originalLabel = button.textContent;
            button.textContent = label || 'Please wait...';
            button.disabled = true;
            return;
        }
        button.textContent = button.dataset.originalLabel || button.textContent;
        button.disabled = false;
    }

    function renderNavActions() {
        const navActions = document.querySelectorAll('.nav-actions');
        if (!navActions.length) {
            return;
        }

        navActions.forEach((container) => {
            if (currentUser) {
                container.innerHTML = `
                    <span class="btn btn-secondary btn-sm" style="pointer-events:none; opacity:0.95;">Hi, ${escapeHtml(currentUser.displayName || currentUser.email)}</span>
                    <button type="button" class="btn btn-primary btn-sm" data-auth-logout>Logout</button>
                `;
            } else {
                container.innerHTML = `
                    <a href="login.html" class="btn btn-secondary btn-sm">Login</a>
                    <a href="register.html" class="btn btn-primary btn-sm">Sign Up</a>
                `;
            }
        });
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function me(force = false) {
        if (currentUser && !force) {
            return currentUser;
        }
        if (mePromise && !force) {
            return mePromise;
        }
        mePromise = request('/me?optional=1')
            .then((payload) => {
                currentUser = payload.user || null;
                renderNavActions();
                emitAuthChanged();
                return currentUser;
            })
            .catch((error) => {
                throw error;
            })
            .finally(() => {
                mePromise = null;
            });
        return mePromise;
    }

    async function login(payload) {
        const response = await request('/login', {
            method: 'POST',
            body: payload
        });
        currentUser = response.user || null;
        renderNavActions();
        emitAuthChanged();
        return response;
    }

    async function register(payload) {
        const response = await request('/register', {
            method: 'POST',
            body: payload
        });
        currentUser = response.user || null;
        renderNavActions();
        emitAuthChanged();
        return response;
    }

    async function logout() {
        await request('/logout', {
            method: 'POST',
            body: {}
        });
        currentUser = null;
        renderNavActions();
        emitAuthChanged();
    }

    function bindLogoutAction() {
        document.addEventListener('click', async (event) => {
            const target = event.target.closest('[data-auth-logout]');
            if (!target) {
                return;
            }
            event.preventDefault();
            target.disabled = true;
            try {
                await logout();
                notify('success', 'Signed out.');
                if (window.location.pathname.endsWith('/login.html') || window.location.pathname.endsWith('/register.html')) {
                    return;
                }
                window.location.reload();
            } catch (error) {
                target.disabled = false;
                notify('error', error.message || 'Failed to sign out.');
            }
        });
    }

    function bindLoginForm() {
        const form = document.getElementById('loginForm');
        if (!form) {
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            renderFormMessage(form, '');
            setButtonBusy(submitButton, true, 'Signing In...');
            try {
                await login({
                    email: form.querySelector('#email')?.value || '',
                    password: form.querySelector('#password')?.value || '',
                    rememberMe: Boolean(form.querySelector('#remember')?.checked)
                });
                renderFormMessage(form, 'Signed in. Redirecting...', 'success');
                window.location.href = 'index.html';
            } catch (error) {
                renderFormMessage(form, error.payload?.message || error.message || 'Login failed.');
            } finally {
                setButtonBusy(submitButton, false);
            }
        });
    }

    function bindRegisterForm() {
        const form = document.getElementById('registerForm');
        if (!form) {
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            renderFormMessage(form, '');
            setButtonBusy(submitButton, true, 'Creating Account...');
            try {
                await register({
                    fullName: form.querySelector('#fullname')?.value || '',
                    email: form.querySelector('#email')?.value || '',
                    password: form.querySelector('#password')?.value || '',
                    confirmPassword: form.querySelector('#confirmPassword')?.value || ''
                });
                renderFormMessage(form, 'Account created. Redirecting...', 'success');
                window.location.href = 'index.html';
            } catch (error) {
                renderFormMessage(form, error.payload?.message || error.message || 'Registration failed.');
            } finally {
                setButtonBusy(submitButton, false);
            }
        });
    }

    async function redirectIfAuthenticated() {
        const page = window.location.pathname.split('/').pop();
        if (page !== 'login.html' && page !== 'register.html') {
            return;
        }
        const user = await me();
        if (user) {
            window.location.replace('index.html');
        }
    }

    async function init() {
        bindLogoutAction();
        bindLoginForm();
        bindRegisterForm();
        renderNavActions();
        await me().catch(() => {
            currentUser = null;
            renderNavActions();
        });
        await redirectIfAuthenticated().catch(() => {});
    }

    window.Auth = {
        me,
        login,
        register,
        logout,
        getCurrentUser() {
            return currentUser;
        },
        renderNavActions
    };

    document.addEventListener('DOMContentLoaded', init);
})();
