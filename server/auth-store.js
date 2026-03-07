const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const COOKIE_NAME = 'sc_session';
const SESSION_TTL_DAYS = 7;
const REMEMBER_ME_TTL_DAYS = 30;

function nowIso() {
    return new Date().toISOString();
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken() {
    return crypto.randomBytes(32).toString('hex');
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function parseCookies(headerValue) {
    const cookies = {};
    if (!headerValue) {
        return cookies;
    }

    headerValue.split(';').forEach((part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex === -1) {
            return;
        }
        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (!key) {
            return;
        }
        cookies[key] = decodeURIComponent(value);
    });

    return cookies;
}

function serializeCookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (options.maxAge) {
        parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    }
    if (options.expires) {
        parts.push(`Expires=${options.expires.toUTCString()}`);
    }
    parts.push(`Path=${options.path || '/'}`);
    if (options.httpOnly !== false) {
        parts.push('HttpOnly');
    }
    if (options.sameSite) {
        parts.push(`SameSite=${options.sameSite}`);
    }
    if (options.secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSecureRequest(req) {
    if (req.socket && req.socket.encrypted) {
        return true;
    }
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    return forwardedProto.includes('https');
}

function getClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwardedFor) {
        return forwardedFor;
    }
    return req.socket?.remoteAddress || null;
}

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
        });
    });
}

function verifyPassword(password, storedHash) {
    return new Promise((resolve, reject) => {
        const [scheme, saltHex, keyHex] = String(storedHash || '').split('$');
        if (scheme !== 'scrypt' || !saltHex || !keyHex) {
            resolve(false);
            return;
        }

        crypto.scrypt(password, Buffer.from(saltHex, 'hex'), 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }

            const expected = Buffer.from(keyHex, 'hex');
            if (expected.length !== derivedKey.length) {
                resolve(false);
                return;
            }

            resolve(crypto.timingSafeEqual(expected, derivedKey));
        });
    });
}

function createAuthStore(options = {}) {
    const baseDir = options.baseDir || process.cwd();
    const dataDir = path.join(baseDir, 'data');
    const dbPath = path.join(dataDir, 'stockandcrypto.db');
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_token_hash TEXT NOT NULL UNIQUE,
            remember_me INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            revoked_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);

    const statements = {
        getUserByEmail: db.prepare(`
            SELECT id, email, display_name, password_hash, created_at, updated_at, last_login_at
            FROM users
            WHERE email = ?
        `),
        getUserById: db.prepare(`
            SELECT id, email, display_name, created_at, last_login_at
            FROM users
            WHERE id = ?
        `),
        insertUser: db.prepare(`
            INSERT INTO users (email, display_name, password_hash, created_at, updated_at, last_login_at)
            VALUES (@email, @display_name, @password_hash, @created_at, @updated_at, @last_login_at)
        `),
        updateLastLogin: db.prepare(`
            UPDATE users
            SET last_login_at = ?, updated_at = ?
            WHERE id = ?
        `),
        insertSession: db.prepare(`
            INSERT INTO sessions (
                user_id,
                session_token_hash,
                remember_me,
                expires_at,
                created_at,
                last_seen_at,
                ip_address,
                user_agent,
                revoked_at
            ) VALUES (
                @user_id,
                @session_token_hash,
                @remember_me,
                @expires_at,
                @created_at,
                @last_seen_at,
                @ip_address,
                @user_agent,
                NULL
            )
        `),
        getSessionWithUser: db.prepare(`
            SELECT
                sessions.id AS session_id,
                sessions.user_id,
                sessions.expires_at,
                sessions.revoked_at,
                users.id,
                users.email,
                users.display_name,
                users.created_at,
                users.last_login_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.session_token_hash = ?
              AND sessions.revoked_at IS NULL
            LIMIT 1
        `),
        updateSessionLastSeen: db.prepare(`
            UPDATE sessions
            SET last_seen_at = ?
            WHERE id = ?
        `),
        revokeSessionByHash: db.prepare(`
            UPDATE sessions
            SET revoked_at = ?
            WHERE session_token_hash = ? AND revoked_at IS NULL
        `),
        deleteExpiredSessions: db.prepare(`
            DELETE FROM sessions
            WHERE expires_at <= ? OR revoked_at IS NOT NULL
        `)
    };

    function cleanupExpiredSessions() {
        statements.deleteExpiredSessions.run(nowIso());
    }

    function toPublicUser(row) {
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            email: row.email,
            displayName: row.display_name,
            createdAt: row.created_at,
            lastLoginAt: row.last_login_at
        };
    }

    function setSessionCookie(req, res, token, rememberMe) {
        const maxAgeSeconds = (rememberMe ? REMEMBER_ME_TTL_DAYS : SESSION_TTL_DAYS) * 24 * 60 * 60;
        const cookie = serializeCookie(COOKIE_NAME, token, {
            maxAge: rememberMe ? maxAgeSeconds : undefined,
            expires: rememberMe ? new Date(Date.now() + (maxAgeSeconds * 1000)) : undefined,
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            secure: isSecureRequest(req)
        });
        res.setHeader('Set-Cookie', cookie);
    }

    function clearSessionCookie(req, res) {
        const cookie = serializeCookie(COOKIE_NAME, '', {
            maxAge: 0,
            expires: new Date(0),
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            secure: isSecureRequest(req)
        });
        res.setHeader('Set-Cookie', cookie);
    }

    function createSessionForUser(userId, req, rememberMe) {
        const rawToken = randomToken();
        const sessionTokenHash = hashToken(rawToken);
        const createdAt = nowIso();
        const expiresAt = new Date(Date.now() + ((rememberMe ? REMEMBER_ME_TTL_DAYS : SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000)).toISOString();
        statements.insertSession.run({
            user_id: userId,
            session_token_hash: sessionTokenHash,
            remember_me: rememberMe ? 1 : 0,
            expires_at: expiresAt,
            created_at: createdAt,
            last_seen_at: createdAt,
            ip_address: getClientIp(req),
            user_agent: String(req.headers['user-agent'] || '').slice(0, 512)
        });
        return rawToken;
    }

    async function register({ email, fullName, password }) {
        const normalizedEmail = normalizeEmail(email);
        const timestamp = nowIso();
        const passwordHash = await hashPassword(password);
        const result = statements.insertUser.run({
            email: normalizedEmail,
            display_name: fullName.trim(),
            password_hash: passwordHash,
            created_at: timestamp,
            updated_at: timestamp,
            last_login_at: timestamp
        });
        return statements.getUserById.get(result.lastInsertRowid);
    }

    async function authenticate(email, password) {
        const userRow = statements.getUserByEmail.get(normalizeEmail(email));
        if (!userRow) {
            return null;
        }
        const isMatch = await verifyPassword(password, userRow.password_hash);
        if (!isMatch) {
            return null;
        }
        const timestamp = nowIso();
        statements.updateLastLogin.run(timestamp, timestamp, userRow.id);
        return statements.getUserById.get(userRow.id);
    }

    function getSessionUser(req) {
        cleanupExpiredSessions();
        const cookies = parseCookies(req.headers.cookie || '');
        const rawToken = cookies[COOKIE_NAME];
        if (!rawToken) {
            return null;
        }

        const row = statements.getSessionWithUser.get(hashToken(rawToken));
        if (!row) {
            return null;
        }

        if (new Date(row.expires_at).getTime() <= Date.now()) {
            statements.revokeSessionByHash.run(nowIso(), hashToken(rawToken));
            return null;
        }

        statements.updateSessionLastSeen.run(nowIso(), row.session_id);
        return toPublicUser(row);
    }

    function revokeSession(req) {
        const cookies = parseCookies(req.headers.cookie || '');
        const rawToken = cookies[COOKIE_NAME];
        if (!rawToken) {
            return;
        }
        statements.revokeSessionByHash.run(nowIso(), hashToken(rawToken));
    }

    function validateRegistration(body) {
        const email = normalizeEmail(body.email);
        const fullName = String(body.fullName || '').trim();
        const password = String(body.password || '');
        const confirmPassword = String(body.confirmPassword || '');

        if (!email || !fullName || !password || !confirmPassword) {
            return { ok: false, error: 'VALIDATION_ERROR', message: 'Email, full name, password, and confirm password are required.' };
        }
        if (!isValidEmail(email)) {
            return { ok: false, error: 'VALIDATION_ERROR', message: 'Please enter a valid email address.' };
        }
        if (fullName.length < 1 || fullName.length > 80) {
            return { ok: false, error: 'VALIDATION_ERROR', message: 'Full name must be between 1 and 80 characters.' };
        }
        if (password.length < 8) {
            return { ok: false, error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters long.' };
        }
        if (password !== confirmPassword) {
            return { ok: false, error: 'PASSWORD_MISMATCH', message: 'Password confirmation does not match.' };
        }
        if (statements.getUserByEmail.get(email)) {
            return { ok: false, error: 'EMAIL_ALREADY_EXISTS', message: 'An account with this email already exists.' };
        }
        return { ok: true, email, fullName, password };
    }

    function validateLogin(body) {
        const email = normalizeEmail(body.email);
        const password = String(body.password || '');
        const rememberMe = Boolean(body.rememberMe);

        if (!email || !password) {
            return { ok: false, error: 'VALIDATION_ERROR', message: 'Email and password are required.' };
        }
        if (!isValidEmail(email)) {
            return { ok: false, error: 'VALIDATION_ERROR', message: 'Please enter a valid email address.' };
        }
        return { ok: true, email, password, rememberMe };
    }

    return {
        dbPath,
        getSessionUser,
        clearSessionCookie,
        revokeSession,
        async handleRegister(req, res, sendJson, readJsonBody) {
            if (req.method !== 'POST') {
                sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
                return;
            }

            const body = await readJsonBody(req);
            const validation = validateRegistration(body);
            if (!validation.ok) {
                sendJson(res, 400, { success: false, error: validation.error, message: validation.message });
                return;
            }

            let user;
            try {
                user = await register(validation);
            } catch (error) {
                if (String(error.code || '').includes('SQLITE_CONSTRAINT')) {
                    sendJson(res, 400, { success: false, error: 'EMAIL_ALREADY_EXISTS', message: 'An account with this email already exists.' });
                    return;
                }
                throw error;
            }
            const rawToken = createSessionForUser(user.id, req, false);
            setSessionCookie(req, res, rawToken, false);
            sendJson(res, 201, { success: true, user: toPublicUser(user) });
        },
        async handleLogin(req, res, sendJson, readJsonBody) {
            if (req.method !== 'POST') {
                sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
                return;
            }

            const body = await readJsonBody(req);
            const validation = validateLogin(body);
            if (!validation.ok) {
                sendJson(res, 400, { success: false, error: validation.error, message: validation.message });
                return;
            }

            const user = await authenticate(validation.email, validation.password);
            if (!user) {
                sendJson(res, 401, { success: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
                return;
            }

            const rawToken = createSessionForUser(user.id, req, validation.rememberMe);
            setSessionCookie(req, res, rawToken, validation.rememberMe);
            sendJson(res, 200, { success: true, user: toPublicUser(user) });
        },
        handleMe(req, res, sendJson, parsedUrl) {
            if (req.method !== 'GET') {
                sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
                return;
            }

            const user = getSessionUser(req);
            if (!user) {
                if (parsedUrl?.searchParams?.get('optional') === '1') {
                    sendJson(res, 200, { success: true, user: null });
                    return;
                }
                sendJson(res, 401, { success: false, error: 'UNAUTHORIZED', message: 'Authentication required.' });
                return;
            }

            sendJson(res, 200, { success: true, user });
        },
        handleLogout(req, res, sendJson) {
            if (req.method !== 'POST') {
                sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
                return;
            }

            revokeSession(req);
            clearSessionCookie(req, res);
            sendJson(res, 200, { success: true });
        }
    };
}

module.exports = {
    COOKIE_NAME,
    createAuthStore
};
