(function initAuthModule() {
    'use strict';

    const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    const SUPABASE_CLIENT_URL = 'js/supabase-client.js';
    const LEGACY_AUTH_BASE_URL = `${window.location.origin}/api/auth`;
    const LEGACY_AUTH_ME_URL = `${LEGACY_AUTH_BASE_URL}/me?optional=1`;
    const LEGACY_AUTH_LOGOUT_URL = `${LEGACY_AUTH_BASE_URL}/logout`;

    const authState = {
        ready: false,
        loading: false,
        user: null,
        session: null,
        legacyUser: null,
        legacyMismatch: false
    };

    let initPromise = null;
    let authSubscription = null;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getBaseFileName(pathname = window.location.pathname) {
        const fileName = pathname.split('/').pop();
        return fileName || 'index.html';
    }

    function isAuthPage() {
        const page = getBaseFileName();
        return page === 'login.html' || page === 'register.html';
    }

    function getRedirectTarget() {
        const params = new URLSearchParams(window.location.search);
        const redirect = params.get('redirect');
        return redirect || 'index.html';
    }

    function getDisplayName(user = authState.user) {
        if (!user && authState.legacyUser) {
            return authState.legacyUser.displayName || authState.legacyUser.email?.split('@')[0] || 'User';
        }
        if (!user) return '';
        const metadata = user.user_metadata || {};
        return metadata.full_name
            || metadata.username
            || metadata.name
            || user.email?.split('@')[0]
            || 'User';
    }

    function getCompactDisplayName(maxLength = 14) {
        const displayName = getDisplayName();
        if (!displayName) return 'User';
        return displayName.length > maxLength ? `${displayName.slice(0, maxLength - 1)}...` : displayName;
    }

    function notify(type, message) {
        if (window.showToast?.[type]) {
            window.showToast[type](message, 2800);
        }
    }

    function withTimeout(promise, timeoutMs, fallbackValue = null) {
        return Promise.race([
            promise,
            new Promise((resolve) => {
                window.setTimeout(() => resolve(fallbackValue), timeoutMs);
            })
        ]);
    }

    async function requestLegacy(endpoint, options = {}) {
        const response = await fetch(`${LEGACY_AUTH_BASE_URL}${endpoint}`, {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(options.headers || {})
            },
            credentials: 'same-origin',
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.message || payload.error || `Legacy auth HTTP ${response.status}`);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    function normalizeAuthError(error, mode = 'login') {
        const raw = error?.message || error?.error_description || error?.description || 'Authentication failed.';
        const message = String(raw);
        const lower = message.toLowerCase();

        if (lower.includes('email address') && lower.includes('invalid')) {
            return 'Use a real deliverable email address. Demo or fake domains may be rejected by Supabase.';
        }

        if (lower.includes('invalid login credentials')) {
            return 'Invalid login credentials. If this account was created with the local site account flow, use that password and the app will keep you on the local community session.';
        }

        if (lower.includes('email not confirmed')) {
            return 'Check your inbox and confirm the email address before signing in.';
        }

        if (lower.includes('email rate limit exceeded')) {
            return 'Too many confirmation emails were requested. Wait a few minutes before trying again.';
        }

        if (mode === 'register' && lower.includes('user already registered')) {
            return 'This email is already registered. Try signing in instead.';
        }

        return message;
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
        if (type === 'success' || type === 'info') {
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

    function dispatchAuthChange() {
        const detail = {
            ...authState,
            displayName: getDisplayName()
        };
        window.dispatchEvent(new CustomEvent('auth:changed', { detail }));
        window.dispatchEvent(new CustomEvent('auth:state-changed', { detail }));
    }

    function renderNavActions() {
        const containers = document.querySelectorAll('.nav-actions');
        if (!containers.length) return;

        const displayName = escapeHtml(getDisplayName());
        const compactDisplayName = escapeHtml(getCompactDisplayName());
        containers.forEach((container) => {
            if (authState.user) {
                container.innerHTML = `
                    <a href="profile.html" class="btn btn-secondary btn-sm" id="profileBtn" title="${displayName}">Hi, ${compactDisplayName}</a>
                    <button type="button" class="btn btn-primary btn-sm" id="logoutBtn" data-auth-logout>Logout</button>
                `;
                return;
            }

            if (authState.legacyMismatch) {
                container.innerHTML = `
                    <span class="btn btn-secondary btn-sm" style="pointer-events:none; opacity:0.95;" id="profileBtn" title="${displayName} (Legacy)">Legacy: ${compactDisplayName}</span>
                    <a href="login.html?reason=legacy-session" class="btn btn-secondary btn-sm" id="loginBtn">Upgrade</a>
                    <button type="button" class="btn btn-primary btn-sm" id="logoutBtn" data-auth-logout>Logout</button>
                `;
                return;
            }

            container.innerHTML = `
                <a href="login.html" class="btn btn-secondary btn-sm" id="loginBtn">Login</a>
                <a href="register.html" class="btn btn-primary btn-sm">Sign Up</a>
            `;
        });
    }

    function getSupabaseClient() {
        if (window.SupabaseClient?.supabase) {
            return window.SupabaseClient.supabase;
        }
        if (typeof window.SupabaseClient?.getSupabase === 'function') {
            return window.SupabaseClient.getSupabase();
        }
        return null;
    }

    function waitFor(predicate, timeout = 10000, intervalMs = 100) {
        return new Promise((resolve, reject) => {
            const existing = predicate();
            if (existing) {
                resolve(existing);
                return;
            }

            const startedAt = Date.now();
            const timer = window.setInterval(() => {
                const result = predicate();
                if (result) {
                    window.clearInterval(timer);
                    resolve(result);
                    return;
                }

                if (Date.now() - startedAt > timeout) {
                    window.clearInterval(timer);
                    reject(new Error('Timed out while waiting for auth dependencies.'));
                }
            }, intervalMs);
        });
    }

    function injectScript(src, id) {
        return new Promise((resolve, reject) => {
            if (id && document.getElementById(id)) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            if (id) script.id = id;
            script.src = src;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    async function ensureSupabaseDependencies() {
        if (!(window.supabase && typeof window.supabase.createClient === 'function')) {
            await injectScript(SUPABASE_SDK_URL, 'supabase-sdk');
            await waitFor(() => window.supabase && typeof window.supabase.createClient === 'function');
        }

        if (!window.SupabaseClient) {
            const clientUrl = new URL(SUPABASE_CLIENT_URL, document.baseURI).href;
            await injectScript(clientUrl, 'supabase-client-script');
            await waitFor(() => window.SupabaseClient);
        }

        if (typeof window.SupabaseClient.init === 'function') {
            await window.SupabaseClient.init();
        }

        return window.SupabaseClient;
    }

    async function fetchLegacyUser() {
        try {
            const response = await fetch(LEGACY_AUTH_ME_URL, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            if (!response.ok) {
                return null;
            }

            const payload = await response.json().catch(() => ({}));
            return payload.user || null;
        } catch (error) {
            return null;
        }
    }

    async function clearLegacySession() {
        try {
            await fetch(LEGACY_AUTH_LOGOUT_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: '{}'
            });
        } catch (error) {
            // Legacy session cleanup is best-effort only.
        }
    }

    async function legacyLogin(email, password, rememberMe = false) {
        return requestLegacy('/login', {
            method: 'POST',
            body: { email, password, rememberMe }
        });
    }

    async function legacyRegister(fullName, email, password, confirmPassword) {
        return requestLegacy('/register', {
            method: 'POST',
            body: { fullName, email, password, confirmPassword }
        });
    }

    async function ensureLegacySession({ fullName, email, password, rememberMe = false }) {
        try {
            const response = await legacyLogin(email, password, rememberMe);
            authState.legacyUser = response.user || null;
            authState.legacyMismatch = !authState.user && Boolean(authState.legacyUser);
            return { mode: 'login', user: authState.legacyUser };
        } catch (loginError) {
            const status = Number(loginError?.status || 0);
            if (status !== 401) {
                throw loginError;
            }
        }

        try {
            const registration = await legacyRegister(
                fullName || email.split('@')[0],
                email,
                password,
                password
            );
            authState.legacyUser = registration.user || null;
            authState.legacyMismatch = !authState.user && Boolean(authState.legacyUser);
            return { mode: 'register', user: authState.legacyUser };
        } catch (registerError) {
            const payloadError = String(registerError?.payload?.error || '');
            if (payloadError !== 'EMAIL_ALREADY_EXISTS') {
                throw registerError;
            }

            const response = await legacyLogin(email, password, rememberMe);
            authState.legacyUser = response.user || null;
            authState.legacyMismatch = !authState.user && Boolean(authState.legacyUser);
            return { mode: 'login', user: authState.legacyUser };
        }
    }

    function isInvalidCredentialsError(error) {
        const message = String(error?.message || '').toLowerCase();
        return message.includes('invalid login credentials');
    }

    async function tryLegacyMigration(email, password, fullName = '') {
        try {
            const result = await signUpWithSupabase({ fullName, email, password });
            if (result.pendingConfirmation) {
                return { status: 'pending_confirmation' };
            }
            return { status: 'complete' };
        } catch (error) {
            const normalized = String(error?.message || '').toLowerCase();

            if (normalized.includes('user already registered')) {
                try {
                    await signInWithSupabase(email, password);
                    return { status: 'complete' };
                } catch (signInError) {
                    return { status: 'registered_but_password_mismatch', error: signInError };
                }
            }

            if (normalized.includes('email rate limit exceeded')) {
                return { status: 'rate_limited', error };
            }

            if (normalized.includes('email not confirmed')) {
                return { status: 'pending_confirmation', error };
            }

            return { status: 'failed', error };
        }
    }

    async function subscribeToSupabaseAuth() {
        if (authSubscription) return;

        const supabase = getSupabaseClient();
        if (!supabase?.auth?.onAuthStateChange) return;

        const subscriptionPayload = supabase.auth.onAuthStateChange(async () => {
            await syncAuthState(false);
        });

        authSubscription = subscriptionPayload?.data?.subscription || subscriptionPayload?.subscription || null;
    }

    async function syncAuthState(includeLegacy = true) {
        authState.loading = true;

        try {
            const supabase = getSupabaseClient();
            if (!supabase?.auth) {
                throw new Error('Supabase auth client is unavailable.');
            }

            const [{ data: sessionData }, { data: userData }, legacyUser] = await Promise.all([
                supabase.auth.getSession(),
                supabase.auth.getUser(),
                includeLegacy ? fetchLegacyUser() : Promise.resolve(authState.legacyUser)
            ]);

            authState.session = sessionData?.session || null;
            authState.user = userData?.user || null;
            authState.legacyUser = legacyUser || null;
            authState.legacyMismatch = !authState.user && Boolean(authState.legacyUser);
            authState.ready = true;
            authState.loading = false;

            renderNavActions();
            dispatchAuthChange();
            return { ...authState };
        } catch (error) {
            authState.session = null;
            authState.user = null;
            authState.ready = true;
            authState.loading = false;
            authState.legacyUser = includeLegacy ? await fetchLegacyUser() : authState.legacyUser;
            authState.legacyMismatch = Boolean(authState.legacyUser);
            renderNavActions();
            dispatchAuthChange();
            return { ...authState };
        }
    }

    async function ready() {
        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            await ensureSupabaseDependencies();
            await subscribeToSupabaseAuth();
            return syncAuthState(true);
        })();

        return initPromise;
    }

    async function safeReady() {
        try {
            return await ready();
        } catch (error) {
            console.warn('Supabase auth dependencies unavailable, continuing with local auth only:', error);
            authState.session = null;
            authState.user = null;
            authState.ready = true;
            authState.loading = false;
            authState.legacyUser = await fetchLegacyUser();
            authState.legacyMismatch = Boolean(authState.legacyUser);
            renderNavActions();
            dispatchAuthChange();
            return { ...authState };
        }
    }

    async function signInWithSupabase(email, password) {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await syncAuthState(true);
        return data;
    }

    async function signUpWithSupabase({ fullName, email, password }) {
        const supabase = getSupabaseClient();
        const username = (fullName || '').trim() || email.split('@')[0];
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username,
                    full_name: (fullName || '').trim()
                }
            }
        });

        if (error) throw error;

        if (!data.session) {
            await syncAuthState(true);
            return {
                ...data,
                pendingConfirmation: true
            };
        }

        await syncAuthState(true);
        return data;
    }

    async function logout() {
        const supabase = getSupabaseClient();
        if (supabase?.auth) {
            try {
                const result = await withTimeout(supabase.auth.signOut(), 3000, { error: null, timedOut: true });
                if (result?.error) {
                    throw result.error;
                }
            } catch (error) {
                console.warn('Supabase sign-out fallback:', error);
            }
        }

        await withTimeout(clearLegacySession(), 3000, null);
        authState.user = null;
        authState.session = null;
        authState.legacyUser = null;
        authState.legacyMismatch = false;
        renderNavActions();
        dispatchAuthChange();
    }

    function renderAuthPageNotice(form, state) {
        if (!form) return;

        const params = new URLSearchParams(window.location.search);
        const reason = params.get('reason');
        if (reason === 'legacy-session' || state?.legacyMismatch) {
            renderFormMessage(
                form,
                'Your local site session is still valid for Notes and Market Lounges. Sign in here only if you want to refresh the optional Supabase community session.',
                'info'
            );
        }
    }

    function bindLogoutAction() {
        document.addEventListener('click', async (event) => {
            const target = event.target.closest('[data-auth-logout]');
            if (!target) return;

            event.preventDefault();
            target.disabled = true;

            try {
                await logout();
                notify('success', 'Signed out.');
                if (isAuthPage()) return;
                window.location.href = 'index.html';
            } catch (error) {
                target.disabled = false;
                notify('error', error.message || 'Failed to sign out.');
            }
        });
    }

    function bindLoginForm() {
        const form = document.getElementById('loginForm');
        if (!form) return;

        const submitButton = form.querySelector('button[type="submit"]');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            renderFormMessage(form, '');
            setButtonBusy(submitButton, true, 'Signing In...');

            try {
                const email = form.querySelector('#email')?.value?.trim() || '';
                const password = form.querySelector('#password')?.value || '';
                const rememberMe = Boolean(form.querySelector('#remember')?.checked);

                try {
                    const legacyResponse = await legacyLogin(email, password, rememberMe);
                    authState.legacyUser = legacyResponse.user || null;
                    authState.legacyMismatch = Boolean(authState.legacyUser);
                    renderNavActions();
                    dispatchAuthChange();

                    renderFormMessage(form, 'Signed in with your local site account. Redirecting...', 'success');

                    window.setTimeout(() => {
                        window.location.href = getRedirectTarget();
                    }, 1200);
                    return;
                } catch (legacyError) {
                    if (Number(legacyError?.status || 0) && Number(legacyError?.status || 0) !== 401) {
                        throw legacyError;
                    }
                }

                await safeReady();

                try {
                    if (!getSupabaseClient()?.auth) {
                        throw new Error('SUPABASE_AUTH_UNAVAILABLE');
                    }
                    await signInWithSupabase(email, password);
                    try {
                        await ensureLegacySession({
                            email,
                            password,
                            rememberMe
                        });
                    } catch (legacySyncError) {
                        console.warn('Legacy session sync skipped after Supabase sign-in:', legacySyncError);
                    }
                } catch (error) {
                    const lowerMessage = String(error?.message || '').toLowerCase();
                    const shouldSurfaceSupabaseError = !(
                        lowerMessage.includes('supabase_auth_unavailable')
                        || lowerMessage.includes('supabase auth client is unavailable')
                        || lowerMessage.includes('timed out')
                        || isInvalidCredentialsError(error)
                        || lowerMessage.includes('email not confirmed')
                    );
                    if (shouldSurfaceSupabaseError) {
                        throw error;
                    }

                    throw new Error('Invalid login credentials. Check your email and password, or create a local account first.');
                }

                renderFormMessage(form, 'Signed in. Redirecting...', 'success');
                window.location.href = getRedirectTarget();
            } catch (error) {
                renderFormMessage(form, normalizeAuthError(error, 'login'));
            } finally {
                setButtonBusy(submitButton, false);
            }
        });
    }

    function bindRegisterForm() {
        const form = document.getElementById('registerForm');
        if (!form) return;

        const submitButton = form.querySelector('button[type="submit"]');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            renderFormMessage(form, '');

            const fullName = form.querySelector('#fullname')?.value?.trim() || '';
            const email = form.querySelector('#email')?.value?.trim() || '';
            const password = form.querySelector('#password')?.value || '';
            const confirmPassword = form.querySelector('#confirmPassword')?.value || '';

            if (password !== confirmPassword) {
                renderFormMessage(form, 'Passwords do not match.');
                return;
            }

            setButtonBusy(submitButton, true, 'Creating Account...');

            try {
                await safeReady();
                try {
                    await legacyRegister(fullName, email, password, confirmPassword);
                    const loginResponse = await legacyLogin(email, password, true);
                    authState.legacyUser = loginResponse.user || null;
                    authState.legacyMismatch = Boolean(authState.legacyUser);
                    renderNavActions();
                    dispatchAuthChange();
                } catch (legacyError) {
                    renderFormMessage(form, legacyError?.payload?.message || normalizeAuthError(legacyError, 'register'));
                    return;
                }

                renderFormMessage(
                    form,
                    'Account created. Local account is ready now, and Notes plus Market Lounges will work immediately. Redirecting...',
                    'success'
                );
                window.setTimeout(() => {
                    window.location.href = getRedirectTarget();
                }, 1200);
            } catch (error) {
                renderFormMessage(form, normalizeAuthError(error, 'register'));
            } finally {
                setButtonBusy(submitButton, false);
            }
        });
    }

    async function redirectIfAuthenticated(state) {
        if (!isAuthPage()) return;
        if (!state?.user && !state?.legacyUser) return;
        window.location.replace(getRedirectTarget());
    }

    async function init() {
        bindLogoutAction();
        bindLoginForm();
        bindRegisterForm();
        renderNavActions();

        const state = await safeReady();

        if (isAuthPage()) {
            const form = document.getElementById('loginForm') || document.getElementById('registerForm');
            renderAuthPageNotice(form, state);
        }

        await redirectIfAuthenticated(state);
    }

    window.Auth = {
        ready,
        async refresh() {
            await ready();
            return syncAuthState(true);
        },
        async me() {
            const state = await ready();
            return state.user || state.legacyUser;
        },
        async login(payload) {
            await ready();
            return signInWithSupabase(payload.email, payload.password);
        },
        async register(payload) {
            await ready();
            return signUpWithSupabase({
                fullName: payload.fullName,
                email: payload.email,
                password: payload.password
            });
        },
        logout,
        getCurrentUser() {
            return authState.user || authState.legacyUser;
        },
        getState() {
            return { ...authState, displayName: getDisplayName() };
        },
        isLegacyMismatch() {
            return authState.legacyMismatch;
        },
        renderNavActions
    };

    document.addEventListener('DOMContentLoaded', init);
})();
