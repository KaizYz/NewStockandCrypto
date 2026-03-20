// Unified server for StockandCrypto.
// Exposes static frontend and API routes on the same port (default: 9000).

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createAuthStore } = require('./server/auth-store');
const { createChatStore } = require('./server/chat-store');
const { createNotesStore } = require('./server/notes-store');
const { createPositionsStore } = require('./server/positions-store');
const { buildPolicyPacket, deriveLegacyPolicy, deriveLegacyTpSl } = require('./server/policy-engine');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 9000);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 5001);
const IS_RENDER_RUNTIME = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
const MODEL_EXPLORER_SCHEME = String(
    process.env.MODEL_EXPLORER_SCHEME || (IS_RENDER_RUNTIME ? 'https' : 'http')
).trim().toLowerCase() === 'https' ? 'https' : 'http';
const MODEL_EXPLORER_HOST = process.env.MODEL_EXPLORER_HOST || (
    IS_RENDER_RUNTIME ? 'newstockandcrypto-ml.onrender.com' : '127.0.0.1'
);
const MODEL_EXPLORER_PORT = Number(
    process.env.MODEL_EXPLORER_PORT || (IS_RENDER_RUNTIME ? 443 : 8000)
);
const WEB_ROOT = path.join(__dirname, 'web');
const APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, 'data');
const APP_VERSION = process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || 'local';
const SERVER_STARTED_AT = new Date();
const REQUEST_LOGGING_ENABLED = String(process.env.REQUEST_LOGGING || 'true').toLowerCase() !== 'false';

const CRYPTO_CACHE_TTL_MS = Number(process.env.CRYPTO_CACHE_TTL_MS || 9000);
const CN_CACHE_TTL_MS = Number(process.env.CN_CACHE_TTL_MS || 9000);
const CN_POLL_INTERVAL_SEC = Number(process.env.CN_POLL_INTERVAL_SEC || 10);
const CN_INDEX_HISTORY_CACHE_TTL_MS = Number(process.env.CN_INDEX_HISTORY_CACHE_TTL_MS || 60000);
const CN_INDEX_HISTORY_DEFAULT_INTERVAL = '1m';
const CN_INDEX_HISTORY_INTERVAL_ALLOW = new Set(['1m', '5m']);
const CN_INDEX_HISTORY_SESSION_ALLOW = new Set(['auto', 'today', 'last']);
const EASTMONEY_KLINE_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const SINA_CN_QUOTES_BASE = 'https://hq.sinajs.cn/list=';
const US_CACHE_TTL_MS = Number(process.env.US_CACHE_TTL_MS || 9000);
const US_POLL_INTERVAL_SEC = Number(process.env.US_POLL_INTERVAL_SEC || 10);
const US_INDEX_FAST_CACHE_TTL_MS = Number(process.env.US_INDEX_FAST_CACHE_TTL_MS || 5000);
const US_INDEX_FAST_POLL_INTERVAL_SEC = Number(process.env.US_INDEX_FAST_POLL_INTERVAL_SEC || 5);
const US_INDEX_HISTORY_CACHE_TTL_MS = Number(process.env.US_INDEX_HISTORY_CACHE_TTL_MS || 60000);
const US_INDEX_HISTORY_DEFAULT_RANGE = '2d';
const US_INDEX_HISTORY_DEFAULT_INTERVAL = '5m';
const BINANCE_US_URL = 'https://api.binance.us/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22%5D';
const BINANCE_US_KLINES_BASE = 'https://api.binance.us/api/v3/klines';
const EASTMONEY_ULIST_FIELDS = 'f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f20,f21,f47,f48,f100,f103,f115';
const EASTMONEY_ULIST_BASE = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const STOOQ_BATCH_BASE = 'https://stooq.com/q/l/?f=sd2t2ohlcv&h&e=csv&s=';
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_SPARK_BASE = 'https://query1.finance.yahoo.com/v7/finance/spark';
const US_YAHOO_SPARK_RANGE = '1d';
const US_YAHOO_SPARK_INTERVAL = '1m';
const US_YAHOO_SPARK_CHUNK_SIZE = Number(process.env.US_YAHOO_SPARK_CHUNK_SIZE || 20);
const US_MIN_LIVE_COVERAGE_PCT = Number(process.env.US_MIN_LIVE_COVERAGE_PCT || 95);
const SP500_SNAPSHOT_PATH = path.join(WEB_ROOT, 'assets', 'sp500-constituents.json');
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || '';
const US_ENABLE_ALPHA_FALLBACK = String(process.env.US_ENABLE_ALPHA_FALLBACK || 'true').toLowerCase() !== 'false';
const CSI300_SNAPSHOT_PATH = path.join(WEB_ROOT, 'assets', 'csi300-constituents.json');
const CRYPTO_SUPPORTED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
const CRYPTO_HISTORY_RANGE_CONFIG = {
    '1h': { interval: '1m', limit: 60, ttlMs: 30000, coingeckoDays: 1, windowMs: 60 * 60 * 1000 },
    '24h': { interval: '5m', limit: 288, ttlMs: 60000, coingeckoDays: 1, windowMs: 24 * 60 * 60 * 1000 },
    '7d': { interval: '1h', limit: 168, ttlMs: 120000, coingeckoDays: 7, windowMs: 7 * 24 * 60 * 60 * 1000 }
};
const CRYPTO_SESSION_CACHE_TTL_MS = Number(process.env.CRYPTO_SESSION_CACHE_TTL_MS || 9000);
const CRYPTO_SESSION_REFRESH_SEC = Number(process.env.CRYPTO_SESSION_REFRESH_SEC || 5);
const CRYPTO_SESSION_ORDER = ['asia', 'europe', 'us'];
const CRYPTO_SESSION_META = {
    asia: { code: 'asia', label: 'Asia Session', hoursBjt: '08:00-15:59', startMinute: 8 * 60, endMinute: 16 * 60 },
    europe: { code: 'europe', label: 'Europe Session', hoursBjt: '16:00-23:59', startMinute: 16 * 60, endMinute: 24 * 60 },
    us: { code: 'us', label: 'US Session', hoursBjt: '00:00-07:59', startMinute: 0, endMinute: 8 * 60 }
};
const INDEX_SECIDS = {
    '000001.SH': '1.000001',
    '000300.SH': '1.000300'
};
const INDEX_NAME_BY_CODE = {
    '000001.SH': 'SSE Composite',
    '000300.SH': 'CSI 300'
};
const CN_INDEX_HISTORY_SYMBOLS = {
    sse: { key: 'sse', code: '000001.SH', secid: INDEX_SECIDS['000001.SH'], name: 'SSE Composite' },
    csi300: { key: 'csi300', code: '000300.SH', secid: INDEX_SECIDS['000300.SH'], name: 'CSI 300' }
};
const MARKET_SESSION_TIMEZONE = 'Asia/Shanghai';
const MARKET_SESSION_TIMEZONE_LABEL = 'Beijing Time (CST, UTC+8)';
const CN_DELAY_NOTE = 'Data Source: EastMoney API | Delay: ~3-10s (Level-1)';
const CN_DISCLAIMER = 'Not for actual trading - Simulation only';
const CN_POLICY_SHORT_REASON = 'CN policy mode: strict no-short';
const US_DELAY_NOTE = 'US Level-1 quote feed; normal delay depends on venue';
const US_DISCLAIMER = 'Not for actual trading - simulation only';
const US_SESSION_TIMEZONE = 'America/New_York';
const US_BEIJING_LABEL = 'Beijing Time (CST, UTC+8)';
const US_MAX_LEVERAGE = 2.0;
const US_LIMIT_POSITION = 2.0;
const US_INDEX_SYMBOL_CONFIG = {
    '^DJI': { symbol: '^DJI', aliases: ['^DJI', 'DJI'], name: 'Dow Jones' },
    '^NDX': { symbol: '^NDX', aliases: ['^NDX', 'NDX'], name: 'Nasdaq 100' },
    '^SPX': { symbol: '^SPX', aliases: ['^SPX', 'SPX', '^GSPC', 'GSPC'], name: 'S&P 500' }
};
const US_HISTORY_RANGE_ALLOW = new Set(['1d', '2d', '5d', '1mo', '3mo', '6mo']);
const US_HISTORY_INTERVAL_ALLOW = new Set(['1m', '2m', '5m', '15m']);
const US_INDEX_HISTORY_SYMBOLS = {
    dow: '^DJI',
    nasdaq100: '^NDX',
    sp500: '^GSPC'
};
const US_INDEX_HISTORY_MODE_ALLOW = new Set(['regular_sessions']);
const TRACKING_REFRESH_INTERVAL_SEC = Number(process.env.TRACKING_REFRESH_INTERVAL_SEC || 10);
const TRACKING_CACHE_TTL_MS = Number(process.env.TRACKING_CACHE_TTL_MS || 5000);
const TRACKING_CRYPTO_CACHE_TTL_MS = Number(process.env.TRACKING_CRYPTO_CACHE_TTL_MS || 60000);
const TRACKING_CRYPTO_FAILURE_BACKOFF_MS = Number(process.env.TRACKING_CRYPTO_FAILURE_BACKOFF_MS || 120000);
const HOME_LANDING_CACHE_TTL_MS = Number(process.env.HOME_LANDING_CACHE_TTL_MS || 5000);
const TRACKING_DEFAULT_PAGE_SIZE = Number(process.env.TRACKING_DEFAULT_PAGE_SIZE || 20);
const TRACKING_ACTION_LOG_LIMIT = Number(process.env.TRACKING_ACTION_LOG_LIMIT || 100);
const TRACKING_ACTION_SEED_LIMIT = Number(process.env.TRACKING_ACTION_SEED_LIMIT || 6);
const TRACKING_SIMULATION_DEFAULT_TOP_N = Number(process.env.TRACKING_SIMULATION_DEFAULT_TOP_N || 10);
const CN_QUOTE_CHUNK_SIZE = Number(process.env.CN_QUOTE_CHUNK_SIZE || 60);
const SINA_CN_QUOTE_CHUNK_SIZE = Number(process.env.SINA_CN_QUOTE_CHUNK_SIZE || 150);
const CN_QUOTE_RETRY_LIMIT = Number(process.env.CN_QUOTE_RETRY_LIMIT || 2);
const CN_QUOTE_RETRY_DELAY_MS = Number(process.env.CN_QUOTE_RETRY_DELAY_MS || 350);
const CN_MIN_CONSTITUENT_COVERAGE_PCT = Number(process.env.CN_MIN_CONSTITUENT_COVERAGE_PCT || 85);
const CN_LIVE_FETCH_TIMEOUT_MS = Number(process.env.CN_LIVE_FETCH_TIMEOUT_MS || 6000);
const CN_FAILURE_BACKOFF_MS = Number(process.env.CN_FAILURE_BACKOFF_MS || 60000);
const COINGECKO_MARKETS_BASE = 'https://api.coingecko.com/api/v3/coins/markets';
const COINGECKO_MARKET_CHART_BASE = 'https://api.coingecko.com/api/v3/coins';
const TRACKING_CACHE_DIR = path.join(__dirname, 'output', 'tracking-cache');
const TRACKING_FACTOR_WEIGHTS = Object.freeze({
    momentum: 0.30,
    edge: 0.25,
    liquidity: 0.15,
    volatility: 0.15,
    coverage: 0.15
});
const TRACKING_TOTAL_SCORE_WEIGHTS = Object.freeze({
    factorScore: 0.50,
    pUp: 0.30,
    confidence: 0.20
});
const TRACKING_STABLECOIN_SYMBOLS = new Set([
    'USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDD', 'USDP', 'USDS', 'USYC', 'BUSD', 'PYUSD', 'LUSD', 'FRAX', 'GUSD', 'RLUSD', 'EURC'
]);
const TRACKING_STABLECOIN_IDS = new Set([
    'tether', 'usd-coin', 'dai', 'first-digital-usd', 'true-usd', 'ethena-usde', 'usdd', 'usds', 'circle-usyc', 'pax-dollar',
    'binance-usd', 'paypal-usd', 'liquity-usd', 'frax', 'gemini-dollar', 'ripple-usd', 'euro-coin'
]);
const TRACKING_STABLECOIN_NAME_KEYWORDS = [
    'stablecoin', 'usd coin', 'us dollar', 'digital usd', 'dollar', 'pax dollar', 'paypal usd', 'gemini dollar', 'circle usyc'
];
const CRYPTO_UNIVERSE_LIMIT = 50;
const LIMIT_STATUS_ORDER = {
    LIMIT_UP: 3,
    LIMIT_DOWN: 2,
    NORMAL: 1
};

let cryptoPriceCache = null;
let cryptoPriceCacheAt = 0;
const cryptoHistoryCache = new Map();
const cryptoPredictionCache = new Map();
const cryptoPerformanceCache = new Map();
const cryptoSessionCache = new Map();
const cryptoLastPriceBySymbol = new Map();
const cryptoReturnHistoryBySymbol = new Map();
let cnCache = null;
let cnCacheAt = 0;
let cnCachePromise = null;
let cnLastFailureAt = 0;
let cnLastFailureReason = null;
let cnIndicesHistoryCache = null;
let cnIndicesHistoryCacheAt = 0;
let cnIndicesHistoryCacheKey = '';
let usCache = null;
let usCacheAt = 0;
let usIndicesCache = null;
let usIndicesCacheAt = 0;
let usIndicesHistoryCache = null;
let usIndicesHistoryCacheAt = 0;
let usIndicesHistoryCacheKey = '';
let trackingCryptoUniverseCache = null;
let trackingCryptoUniverseCacheAt = 0;
let trackingCryptoUniversePromise = null;
let trackingCryptoLastFailureAt = 0;
let trackingCryptoLastFailureReason = null;
let trackingAggregateCache = null;
let trackingAggregateCacheAt = 0;
let trackingAggregatePromise = null;
let homeLandingCache = null;
let homeLandingCacheAt = 0;
let homeLandingPromise = null;
let trackingActionLog = [];
let trackingLatestActionAt = null;
let trackingPreviousTrackedState = new Map();
let trackingKnownUniverseSymbols = new Set();
const authStore = createAuthStore({ baseDir: __dirname, dataDir: APP_DATA_DIR });
const chatStore = createChatStore({ baseDir: __dirname, dataDir: APP_DATA_DIR });
const notesStore = createNotesStore({ baseDir: __dirname, dataDir: APP_DATA_DIR });
const positionsStore = createPositionsStore({ baseDir: __dirname, dataDir: APP_DATA_DIR });
const REQUEST_METRICS = {
    total: 0,
    inFlight: 0,
    byMethod: Object.create(null),
    byStatusClass: {
        '2xx': 0,
        '3xx': 0,
        '4xx': 0,
        '5xx': 0,
        other: 0
    },
    errors: 0,
    lastRequestAt: null,
    lastErrorAt: null
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    });
    res.end(body);
}

function logEvent(level, event, details = {}) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        event,
        ...details
    };
    const serialized = JSON.stringify(entry);
    if (level === 'error') {
        console.error(serialized);
        return;
    }
    console.log(serialized);
}

function buildServiceBaseUrl(scheme, host, port) {
    const normalizedScheme = String(scheme || 'http').toLowerCase() === 'https' ? 'https' : 'http';
    const normalizedHost = String(host || '').trim();
    const numericPort = Number(port);
    const isDefaultPort = (normalizedScheme === 'https' && numericPort === 443)
        || (normalizedScheme === 'http' && numericPort === 80);
    const portSuffix = normalizedHost && Number.isFinite(numericPort) && !isDefaultPort
        ? `:${numericPort}`
        : '';
    return `${normalizedScheme}://${normalizedHost}${portSuffix}`;
}

function getStatusClass(statusCode) {
    if (statusCode >= 200 && statusCode < 300) return '2xx';
    if (statusCode >= 300 && statusCode < 400) return '3xx';
    if (statusCode >= 400 && statusCode < 500) return '4xx';
    if (statusCode >= 500 && statusCode < 600) return '5xx';
    return 'other';
}

function beginRequestTracking(req, res) {
    const requestId = crypto.randomUUID();
    const startedAt = process.hrtime.bigint();
    REQUEST_METRICS.inFlight += 1;
    REQUEST_METRICS.byMethod[req.method] = (REQUEST_METRICS.byMethod[req.method] || 0) + 1;
    res.setHeader('X-Request-Id', requestId);

    res.once('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const statusClass = getStatusClass(res.statusCode || 0);
        REQUEST_METRICS.inFlight = Math.max(0, REQUEST_METRICS.inFlight - 1);
        REQUEST_METRICS.total += 1;
        REQUEST_METRICS.byStatusClass[statusClass] = (REQUEST_METRICS.byStatusClass[statusClass] || 0) + 1;
        REQUEST_METRICS.lastRequestAt = new Date().toISOString();

        if ((res.statusCode || 0) >= 500) {
            REQUEST_METRICS.errors += 1;
            REQUEST_METRICS.lastErrorAt = REQUEST_METRICS.lastRequestAt;
        }

        if (REQUEST_LOGGING_ENABLED) {
            logEvent((res.statusCode || 0) >= 500 ? 'error' : 'info', 'http_request', {
                requestId,
                method: req.method,
                path: req.url,
                statusCode: res.statusCode,
                durationMs: Number(elapsedMs.toFixed(2))
            });
        }
    });

    return requestId;
}

async function probeModelExplorerHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const target = `${buildServiceBaseUrl(MODEL_EXPLORER_SCHEME, MODEL_EXPLORER_HOST, MODEL_EXPLORER_PORT)}/health`;

    try {
        const response = await fetch(target, {
            method: 'GET',
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        return {
            ok: response.ok,
            statusCode: response.status,
            target
        };
    } catch (error) {
        return {
            ok: false,
            statusCode: null,
            target,
            error: error instanceof Error ? error.message : String(error)
        };
    } finally {
        clearTimeout(timeout);
    }
}

function buildMetricsSnapshot() {
    const memory = process.memoryUsage();
    return {
        ok: true,
        service: 'newstockandcrypto',
        version: APP_VERSION,
        startedAt: SERVER_STARTED_AT.toISOString(),
        uptimeSec: Math.round(process.uptime()),
        requests: {
            ...REQUEST_METRICS,
            byMethod: { ...REQUEST_METRICS.byMethod },
            byStatusClass: { ...REQUEST_METRICS.byStatusClass }
        },
        memory: {
            rss: memory.rss,
            heapTotal: memory.heapTotal,
            heapUsed: memory.heapUsed,
            external: memory.external
        },
        storage: {
            appDataDir: APP_DATA_DIR,
            authDbPath: authStore.dbPath,
            chatDbPath: chatStore.dbPath,
            notesDbPath: notesStore.dbPath,
            positionsDbPath: positionsStore.dbPath
        }
    };
}

async function buildHealthSnapshot() {
    const modelExplorer = await probeModelExplorerHealth();
    const authDbExists = fs.existsSync(authStore.dbPath);
    const chatDbExists = fs.existsSync(chatStore.dbPath);
    const notesDbExists = fs.existsSync(notesStore.dbPath);
    const positionsDbExists = fs.existsSync(positionsStore.dbPath);
    const storageReady = authDbExists && chatDbExists && notesDbExists && positionsDbExists;
    const degraded = !modelExplorer.ok;

    return {
        ok: storageReady,
        status: storageReady ? (degraded ? 'degraded' : 'ok') : 'error',
        service: 'newstockandcrypto',
        version: APP_VERSION,
        startedAt: SERVER_STARTED_AT.toISOString(),
        uptimeSec: Math.round(process.uptime()),
        dependencies: {
            storage: {
                appDataDir: APP_DATA_DIR,
                authDbExists,
                chatDbExists,
                notesDbExists,
                positionsDbExists
            },
            modelExplorer
        }
    };
}

async function handleSystemHealthRoute(req, res) {
    if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        return;
    }

    const payload = await buildHealthSnapshot();
    sendJson(res, payload.ok ? 200 : 503, payload);
}

function handleSystemMetricsRoute(req, res) {
    if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        return;
    }

    sendJson(res, 200, buildMetricsSnapshot());
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString('utf8');
            if (body.length > 1_000_000) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!body.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error(`Invalid JSON body: ${error.message}`));
            }
        });
        req.on('error', reject);
    });
}

function getAuthenticatedSiteUser(req) {
    return authStore.getSessionUser(req);
}

function requireAuthenticatedSiteUser(req, res) {
    const user = getAuthenticatedSiteUser(req);
    if (!user) {
        sendJson(res, 401, {
            success: false,
            error: 'UNAUTHORIZED',
            message: 'Sign in is required.'
        });
        return null;
    }
    return user;
}

function normalizeNotePayload(body = {}) {
    return {
        title: body.title,
        content: body.content,
        market: body.market,
        tags: body.tags,
        is_pinned: body.is_pinned,
        is_favorite: body.is_favorite,
        is_public: body.is_public
    };
}

function normalizePositionPayload(body = {}) {
    return {
        symbol: body.symbol,
        market: body.market,
        side: body.side,
        entry_price: body.entry_price,
        quantity: body.quantity,
        notes: body.notes
    };
}

function normalizeStopOrderPayload(body = {}) {
    return {
        position_id: body.position_id,
        order_type: body.order_type,
        trigger_price: body.trigger_price,
        trigger_type: body.trigger_type,
        trail_percent: body.trail_percent,
        highest_price: body.highest_price,
        lowest_price: body.lowest_price,
        quantity: body.quantity
    };
}

function normalizeChatBoardPayload(body = {}) {
    return {
        name: body.name,
        topic: body.topic,
        is_public: body.is_public
    };
}

function normalizeChatMessagePayload(body = {}) {
    return {
        content: body.content,
        reply_to: body.reply_to ?? body.replyTo ?? null,
        attachment_url: body.attachment_url ?? body.attachmentUrl ?? null,
        attachment_type: body.attachment_type ?? body.attachmentType ?? null,
        attachment_name: body.attachment_name ?? body.attachmentName ?? null
    };
}

async function handleNotesCollectionRoute(req, res, parsedUrl) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method === 'GET') {
        const notes = notesStore.listNotes(user.id, {
            market: parsedUrl.searchParams.get('market'),
            tag: parsedUrl.searchParams.get('tag'),
            search: parsedUrl.searchParams.get('search'),
            pinned: parsedUrl.searchParams.get('pinned'),
            favorite: parsedUrl.searchParams.get('favorite'),
            sortBy: parsedUrl.searchParams.get('sortBy') || parsedUrl.searchParams.get('orderBy'),
            sortOrder: parsedUrl.searchParams.get('sortOrder') || (parsedUrl.searchParams.get('ascending') === 'true' ? 'asc' : 'desc'),
            limit: parsedUrl.searchParams.get('limit'),
            offset: parsedUrl.searchParams.get('offset')
        });
        sendJson(res, 200, { success: true, notes });
        return;
    }

    if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const note = notesStore.createNote(user.id, normalizeNotePayload(body));
        sendJson(res, 201, { success: true, note });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleNoteItemRoute(req, res, noteId) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method === 'GET') {
        const note = notesStore.getNoteForUser(user.id, noteId);
        if (!note) {
            sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
            return;
        }
        sendJson(res, 200, { success: true, note });
        return;
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const note = notesStore.updateNote(user.id, noteId, normalizeNotePayload(body));
        if (!note) {
            sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
            return;
        }
        sendJson(res, 200, { success: true, note });
        return;
    }

    if (req.method === 'DELETE') {
        const deleted = notesStore.deleteNote(user.id, noteId);
        if (!deleted) {
            sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
            return;
        }
        sendJson(res, 200, { success: true });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleNoteVersionsRoute(req, res, noteId, parsedUrl) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const versions = notesStore.getNoteVersions(user.id, noteId, parsedUrl.searchParams.get('limit'));
    if (!versions) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
        return;
    }

    sendJson(res, 200, { success: true, versions });
}

async function handleNoteShareRoute(req, res, shareId) {
    if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const note = notesStore.getNoteByShareId(shareId);
    if (!note) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
        return;
    }

    sendJson(res, 200, { success: true, note });
}

async function handleSitePositionsCollectionRoute(req, res, parsedUrl) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method === 'GET') {
        const positions = positionsStore.listPositions(user.id, {
            status: parsedUrl.searchParams.get('status'),
            limit: parsedUrl.searchParams.get('limit')
        });
        sendJson(res, 200, { success: true, positions });
        return;
    }

    if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const position = positionsStore.createPosition(user.id, normalizePositionPayload(body));
        sendJson(res, 201, { success: true, position });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleSitePositionCloseRoute(req, res, positionId) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const body = await readJsonBody(req);
    const result = positionsStore.closePosition(user.id, positionId, {
        price: body.price,
        quantity: body.quantity,
        reason: body.reason
    });

    if (!result) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Position not found.' });
        return;
    }

    sendJson(res, 200, { success: true, ...result });
}

async function handleSitePositionHistoryRoute(req, res, positionId, parsedUrl) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const history = positionsStore.listPositionHistory(user.id, positionId, parsedUrl.searchParams.get('limit'));
    if (!history) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Position not found.' });
        return;
    }

    sendJson(res, 200, { success: true, history });
}

async function handleSiteStopOrdersCollectionRoute(req, res, parsedUrl) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method === 'GET') {
        const orders = positionsStore.listStopOrders(user.id, {
            status: parsedUrl.searchParams.get('status')
        });
        sendJson(res, 200, { success: true, orders });
        return;
    }

    if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const order = positionsStore.createStopOrder(user.id, normalizeStopOrderPayload(body));
        sendJson(res, 201, { success: true, order });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleSiteStopOrderCancelRoute(req, res, stopOrderId) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const cancelled = positionsStore.cancelStopOrder(user.id, stopOrderId);
    if (!cancelled) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Stop order not found.' });
        return;
    }

    sendJson(res, 200, { success: true });
}

async function handleCommunityIdeasRoute(req, res, parsedUrl) {
    if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const viewer = getAuthenticatedSiteUser(req);
    const ideas = notesStore.listIdeas(viewer?.id ?? null, {
        market: parsedUrl.searchParams.get('market'),
        tag: parsedUrl.searchParams.get('tag'),
        search: parsedUrl.searchParams.get('search'),
        visibility: parsedUrl.searchParams.get('visibility'),
        sortBy: parsedUrl.searchParams.get('sortBy') || parsedUrl.searchParams.get('orderBy'),
        sortOrder: parsedUrl.searchParams.get('sortOrder') || (parsedUrl.searchParams.get('ascending') === 'true' ? 'asc' : 'desc'),
        limit: parsedUrl.searchParams.get('limit'),
        offset: parsedUrl.searchParams.get('offset')
    });

    sendJson(res, 200, {
        success: true,
        ideas,
        viewer: viewer ? {
            id: viewer.id,
            displayName: viewer.displayName,
            email: viewer.email
        } : null
    });
}

async function handleCommunityNoteRoute(req, res, noteId) {
    if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const viewer = getAuthenticatedSiteUser(req);
    const note = notesStore.getNoteForViewer(viewer?.id ?? null, noteId);
    if (!note) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
        return;
    }

    const related = notesStore.getRelatedIdeas(viewer?.id ?? null, note, 4);
    sendJson(res, 200, {
        success: true,
        note,
        related
    });
}

async function handleCommunityShareRoute(req, res, shareId) {
    if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const note = notesStore.getSharedIdea(shareId);
    if (!note) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Note not found.' });
        return;
    }

    const related = notesStore.getRelatedIdeas(null, note, 4);
    sendJson(res, 200, {
        success: true,
        note,
        related
    });
}

async function handleChatBoardsRoute(req, res) {
    if (req.method === 'GET') {
        sendJson(res, 200, {
            success: true,
            boards: chatStore.listBoards()
        });
        return;
    }

    if (req.method === 'POST') {
        const user = requireAuthenticatedSiteUser(req, res);
        if (!user) {
            return;
        }

        const body = await readJsonBody(req);
        const board = chatStore.createBoard(user.id, normalizeChatBoardPayload(body));
        sendJson(res, 201, {
            success: true,
            board
        });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleChatBoardJoinRoute(req, res, boardId) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
        return;
    }

    const board = chatStore.joinBoard(user.id, boardId);
    if (!board) {
        sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Board not found.' });
        return;
    }

    chatStore.updatePresence(user.id, 'online', boardId);
    sendJson(res, 200, {
        success: true,
        board
    });
}

async function handleChatBoardMessagesRoute(req, res, boardId, parsedUrl) {
    if (req.method === 'GET') {
        sendJson(res, 200, {
            success: true,
            messages: chatStore.listMessages(boardId, parsedUrl.searchParams.get('limit'))
        });
        return;
    }

    if (req.method === 'POST') {
        const user = requireAuthenticatedSiteUser(req, res);
        if (!user) {
            return;
        }

        const body = await readJsonBody(req);
        const message = chatStore.sendMessage(user.id, boardId, normalizeChatMessagePayload(body));
        if (!message) {
            sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Board not found.' });
            return;
        }

        chatStore.updatePresence(user.id, 'online', boardId);
        sendJson(res, 201, {
            success: true,
            message
        });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleChatMessageItemRoute(req, res, messageId) {
    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const message = chatStore.editMessage(user.id, messageId, body.content);
        if (!message) {
            sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Message not found.' });
            return;
        }
        sendJson(res, 200, { success: true, message });
        return;
    }

    if (req.method === 'DELETE') {
        const deleted = chatStore.deleteMessage(user.id, messageId);
        if (!deleted) {
            sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: 'Message not found.' });
            return;
        }
        sendJson(res, 200, { success: true });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleChatMessageReactionsRoute(req, res, messageId, parsedUrl) {
    if (req.method === 'GET') {
        sendJson(res, 200, {
            success: true,
            reactions: chatStore.listReactions(messageId)
        });
        return;
    }

    const user = requireAuthenticatedSiteUser(req, res);
    if (!user) {
        return;
    }

    if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const reactions = chatStore.addReaction(user.id, messageId, body.emoji);
        sendJson(res, 200, { success: true, reactions });
        return;
    }

    if (req.method === 'DELETE') {
        const emoji = parsedUrl.searchParams.get('emoji');
        const reactions = chatStore.removeReaction(user.id, messageId, emoji);
        sendJson(res, 200, { success: true, reactions });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

async function handleChatPresenceRoute(req, res, parsedUrl) {
    if (req.method === 'GET') {
        const boardId = parsedUrl.searchParams.get('boardId');
        sendJson(res, 200, {
            success: true,
            users: chatStore.listOnlineUsers(boardId)
        });
        return;
    }

    if (req.method === 'POST') {
        const user = requireAuthenticatedSiteUser(req, res);
        if (!user) {
            return;
        }

        const body = await readJsonBody(req);
        chatStore.updatePresence(user.id, body.status, body.boardId ?? body.board_id ?? null);
        sendJson(res, 200, { success: true });
        return;
    }

    sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
}

function parseNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function readTrackingSnapshot(name) {
    try {
        const filePath = path.join(TRACKING_CACHE_DIR, `${name}.json`);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return null;
    }
}

function writeTrackingSnapshot(name, payload) {
    try {
        fs.mkdirSync(TRACKING_CACHE_DIR, { recursive: true });
        fs.writeFileSync(path.join(TRACKING_CACHE_DIR, `${name}.json`), JSON.stringify(payload));
    } catch (error) {
        console.warn(`tracking snapshot write failed for ${name}: ${error.message}`);
    }
}

function readTrackingBucketSnapshot(market) {
    return readTrackingSnapshot(market);
}

function writeTrackingBucketSnapshot(market, bucket) {
    writeTrackingSnapshot(market, bucket);
}

function markTrackingBucketStale(bucket, reason, fallbackSource = 'tracking') {
    const stalePayload = deepCopy(bucket);
    stalePayload.meta = {
        ...stalePayload.meta,
        source: stalePayload.meta?.source || fallbackSource,
        stale: true,
        staleReason: reason,
        timestamp: new Date().toISOString()
    };
    stalePayload.rows = Array.isArray(stalePayload.rows)
        ? stalePayload.rows.map((row) => ({
            ...row,
            stale: true,
            staleReason: reason,
            status: row.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'STALE'
        }))
        : [];
    return stalePayload;
}

function readCnLiveSnapshot() {
    return readTrackingSnapshot('cn-live');
}

function writeCnLiveSnapshot(payload) {
    writeTrackingSnapshot('cn-live', payload);
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toShanghaiNow(now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: MARKET_SESSION_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
        hour12: false
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const second = Number(parts.second);
    const weekday = parts.weekday;
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    const normalizedHour = hour === 24 ? 0 : hour;
    const date = new Date(Date.UTC(year, month - 1, day, normalizedHour - 8, minute, second));
    return { year, month, day, hour, minute, second, weekday, dateKey, date };
}

function makeShanghaiDate(dateKey, hour, minute, second = 0) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
    if (!match) {
        return new Date(Number.NaN);
    }
    const [, yearRaw, monthRaw, dayRaw] = match;
    const normalizedHour = Number(hour) === 24 ? 0 : Number(hour);
    return new Date(Date.UTC(
        Number(yearRaw),
        Number(monthRaw) - 1,
        Number(dayRaw),
        normalizedHour - 8,
        Number(minute),
        Number(second)
    ));
}

function nextTradingDateKey(currentDate) {
    const date = new Date(currentDate.getTime());
    while (true) {
        date.setUTCDate(date.getUTCDate() + 1);
        const shanghai = toShanghaiNow(date);
        if (shanghai.weekday !== 'Sat' && shanghai.weekday !== 'Sun') {
            return shanghai.dateKey;
        }
    }
}

function previousShanghaiTradingDateKey(currentDate) {
    const date = new Date(currentDate.getTime());
    while (true) {
        date.setUTCDate(date.getUTCDate() - 1);
        const shanghai = toShanghaiNow(date);
        if (shanghai.weekday !== 'Sat' && shanghai.weekday !== 'Sun') {
            return shanghai.dateKey;
        }
    }
}

function computeMarketSession(now = new Date()) {
    const shanghai = toShanghaiNow(now);
    const isWeekend = shanghai.weekday === 'Sat' || shanghai.weekday === 'Sun';

    const preOpenStart = makeShanghaiDate(shanghai.dateKey, 9, 15);
    const preOpenEnd = makeShanghaiDate(shanghai.dateKey, 9, 25);
    const amStart = makeShanghaiDate(shanghai.dateKey, 9, 30);
    const amEnd = makeShanghaiDate(shanghai.dateKey, 11, 30);
    const pmStart = makeShanghaiDate(shanghai.dateKey, 13, 0);
    const closeAuctionStart = makeShanghaiDate(shanghai.dateKey, 14, 57);
    const marketClose = makeShanghaiDate(shanghai.dateKey, 15, 0);

    const phases = [
        { code: 'PRE_OPEN_AUCTION', label: 'Pre-Open Auction', tone: 'warning', start: preOpenStart, end: preOpenEnd },
        { code: 'CONTINUOUS_AM', label: 'Continuous Trading', tone: 'success', start: amStart, end: amEnd },
        { code: 'LUNCH_BREAK', label: 'Lunch Break', tone: 'muted', start: amEnd, end: pmStart },
        { code: 'CONTINUOUS_PM', label: 'Continuous Trading', tone: 'success', start: pmStart, end: closeAuctionStart },
        { code: 'CLOSE_AUCTION', label: 'Close Auction', tone: 'warning', start: closeAuctionStart, end: marketClose }
    ];

    const nowMs = shanghai.date.getTime();
    let current = null;
    for (const phase of phases) {
        if (nowMs >= phase.start.getTime() && nowMs < phase.end.getTime()) {
            current = phase;
            break;
        }
    }

    let nextPhase = null;
    if (isWeekend) {
        const nextTrading = nextTradingDateKey(shanghai.date);
        nextPhase = {
            code: 'PRE_OPEN_AUCTION',
            label: 'Pre-Open Auction',
            at: makeShanghaiDate(nextTrading, 9, 15)
        };
    } else if (current) {
        const currentIndex = phases.findIndex((phase) => phase.code === current.code);
        if (currentIndex > -1 && currentIndex < phases.length - 1) {
            const candidate = phases[currentIndex + 1];
            nextPhase = { code: candidate.code, label: candidate.label, at: candidate.start };
        } else {
            const nextTrading = nextTradingDateKey(shanghai.date);
            nextPhase = {
                code: 'PRE_OPEN_AUCTION',
                label: 'Pre-Open Auction',
                at: makeShanghaiDate(nextTrading, 9, 15)
            };
        }
    } else {
        const upcomingToday = phases.find((phase) => nowMs < phase.start.getTime());
        if (upcomingToday) {
            nextPhase = { code: upcomingToday.code, label: upcomingToday.label, at: upcomingToday.start };
        } else {
            const nextTrading = nextTradingDateKey(shanghai.date);
            nextPhase = {
                code: 'PRE_OPEN_AUCTION',
                label: 'Pre-Open Auction',
                at: makeShanghaiDate(nextTrading, 9, 15)
            };
        }
    }

    const fallbackPhase = {
        code: 'CLOSED',
        label: 'Post-Market Closed',
        tone: 'danger'
    };
    const activePhase = current || fallbackPhase;
    const countdownSec = nextPhase ? Math.max(0, Math.floor((nextPhase.at.getTime() - nowMs) / 1000)) : 0;

    return {
        timezone: MARKET_SESSION_TIMEZONE,
        timezoneLabel: MARKET_SESSION_TIMEZONE_LABEL,
        phaseCode: activePhase.code,
        phaseLabel: activePhase.label,
        phaseTone: activePhase.tone,
        nextPhaseCode: nextPhase ? nextPhase.code : null,
        nextPhaseLabel: nextPhase ? nextPhase.label : null,
        nextPhaseAt: nextPhase ? nextPhase.at.toISOString() : null,
        countdownSec
    };
}

const US_HOLIDAYS_2026 = new Set([
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-04-03',
    '2026-05-25',
    '2026-07-03',
    '2026-09-07',
    '2026-11-26',
    '2026-12-25'
]);

const US_EARLY_CLOSE_2026 = new Set([
    '2026-07-03',
    '2026-11-27',
    '2026-12-24'
]);

function parseOffsetMinutes(offsetValue) {
    const normalized = String(offsetValue || '').replace('GMT', '').trim();
    const match = normalized.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * (hours * 60 + minutes);
}

function offsetMinutesToIso(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
}

function getTimeZoneOffsetMinutes(timeZone, refDate) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset'
    });
    const tzPart = formatter.formatToParts(refDate).find((part) => part.type === 'timeZoneName');
    return parseOffsetMinutes(tzPart?.value || 'GMT+0');
}

function toNewYorkNow(now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: US_SESSION_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hour12: false
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const second = Number(parts.second);
    const weekday = parts.weekday;
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    const offsetMinutes = getTimeZoneOffsetMinutes(US_SESSION_TIMEZONE, now);
    const isoOffset = offsetMinutesToIso(offsetMinutes);
    const date = new Date(`${dateKey}T${parts.hour}:${parts.minute}:${parts.second}${isoOffset}`);
    return { year, month, day, hour, minute, second, weekday, dateKey, date, offsetMinutes };
}

function makeNewYorkDate(dateKey, hour, minute, second = 0) {
    const [year, month, day] = String(dateKey).split('-').map((value) => Number(value));
    const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const offsetMinutes = getTimeZoneOffsetMinutes(US_SESSION_TIMEZONE, probe);
    const isoOffset = offsetMinutesToIso(offsetMinutes);
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    return new Date(`${dateKey}T${hh}:${mm}:${ss}${isoOffset}`);
}

function isUsTradingDate(dateKey, weekday) {
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    if (US_HOLIDAYS_2026.has(dateKey)) return false;
    return true;
}

function nextUsTradingDateKey(currentDate) {
    const date = new Date(currentDate.getTime());
    while (true) {
        date.setUTCDate(date.getUTCDate() + 1);
        const ny = toNewYorkNow(date);
        if (isUsTradingDate(ny.dateKey, ny.weekday)) {
            return ny.dateKey;
        }
    }
}

function previousUsTradingDateKey(currentDate) {
    const date = new Date(currentDate.getTime());
    while (true) {
        date.setUTCDate(date.getUTCDate() - 1);
        const ny = toNewYorkNow(date);
        if (isUsTradingDate(ny.dateKey, ny.weekday)) {
            return ny.dateKey;
        }
    }
}

function computeUsMarketSession(now = new Date()) {
    const ny = toNewYorkNow(now);
    const isTradingDate = isUsTradingDate(ny.dateKey, ny.weekday);
    const isEarlyClose = US_EARLY_CLOSE_2026.has(ny.dateKey);
    const regularCloseHour = isEarlyClose ? 13 : 16;

    const premarketStart = makeNewYorkDate(ny.dateKey, 4, 0);
    const regularStart = makeNewYorkDate(ny.dateKey, 9, 30);
    const regularEnd = makeNewYorkDate(ny.dateKey, regularCloseHour, 0);
    const afterHoursEnd = makeNewYorkDate(ny.dateKey, 20, 0);

    const phases = isTradingDate
        ? [
            { code: 'PREMARKET', label: 'Pre-market', tone: 'info', start: premarketStart, end: regularStart },
            { code: 'REGULAR', label: 'Regular Hours', tone: 'success', start: regularStart, end: regularEnd },
            { code: 'AFTER_HOURS', label: 'After-hours', tone: 'warning', start: regularEnd, end: afterHoursEnd }
        ]
        : [];

    const nowMs = ny.date.getTime();
    let current = null;
    for (const phase of phases) {
        if (nowMs >= phase.start.getTime() && nowMs < phase.end.getTime()) {
            current = phase;
            break;
        }
    }

    let nextPhase = null;
    if (current) {
        const currentIndex = phases.findIndex((phase) => phase.code === current.code);
        if (currentIndex > -1 && currentIndex < phases.length - 1) {
            const candidate = phases[currentIndex + 1];
            nextPhase = { code: candidate.code, label: candidate.label, at: candidate.start };
        } else {
            nextPhase = { code: 'CLOSED', label: 'Closed', at: afterHoursEnd };
        }
    } else if (isTradingDate && nowMs < premarketStart.getTime()) {
        nextPhase = { code: 'PREMARKET', label: 'Pre-market', at: premarketStart };
    } else {
        const nextDateKey = nextUsTradingDateKey(ny.date);
        nextPhase = {
            code: 'PREMARKET',
            label: 'Pre-market',
            at: makeNewYorkDate(nextDateKey, 4, 0)
        };
    }

    const fallbackPhase = { code: 'CLOSED', label: 'Closed', tone: 'danger' };
    const activePhase = current || fallbackPhase;
    const countdownSec = nextPhase ? Math.max(0, Math.floor((nextPhase.at.getTime() - nowMs) / 1000)) : 0;

    return {
        timezone: US_SESSION_TIMEZONE,
        timezoneLabel: 'New York Time (ET)',
        beijingLabel: US_BEIJING_LABEL,
        phaseCode: activePhase.code,
        phaseLabel: activePhase.label,
        phaseTone: activePhase.tone,
        nextPhaseCode: nextPhase ? nextPhase.code : null,
        nextPhaseLabel: nextPhase ? nextPhase.label : null,
        nextPhaseAt: nextPhase ? nextPhase.at.toISOString() : null,
        countdownSec,
        isHoliday: US_HOLIDAYS_2026.has(ny.dateKey),
        isEarlyClose
    };
}

function translateSectorToEnglish(rawSector) {
    const text = String(rawSector || '').trim();
    if (!text) return 'Other';
    if (/(\u94f6\u884c|bank)/i.test(text)) return 'Banking';
    if (/(\u4fdd\u9669|insurance)/i.test(text)) return 'Insurance';
    if (/(\u767d\u9152|\u98df\u54c1|\u996e\u6599|\u6d88\u8d39|consumer)/i.test(text)) return 'Consumer Staples';
    if (/(\u534a\u5bfc\u4f53|\u7535\u5b50|\u8f6f\u4ef6|\u901a\u4fe1|tech)/i.test(text)) return 'Technology';
    if (/(\u7535\u529b|\u80fd\u6e90|\u7164\u70ad|\u77f3\u6cb9|\u5929\u7136\u6c14|energy)/i.test(text)) return 'Energy';
    if (/(\u533b\u836f|\u533b\u7597|\u751f\u7269|health)/i.test(text)) return 'Healthcare';
    if (/(\u8bc1\u5238|\u91d1\u878d|financial)/i.test(text)) return 'Financials';
    if (/(\u5730\u4ea7|\u623f\u5730\u4ea7|real estate)/i.test(text)) return 'Real Estate';
    if (/(\u6709\u8272|\u94a2\u94c1|\u6750\u6599|\u5316\u5de5|material)/i.test(text)) return 'Materials';
    if (/(\u6c7d\u8f66|\u673a\u68b0|\u5236\u9020|\u519b\u5de5|industrial)/i.test(text)) return 'Industrials';
    if (/(\u5bb6\u7535|\u7eba\u7ec7|\u96f6\u552e|retail|discretionary)/i.test(text)) return 'Consumer Discretionary';
    if (/(\u516c\u7528|utility)/i.test(text)) return 'Utilities';
    return 'Other';
}

function detectBoardType(code) {
    if (String(code).startsWith('688')) return 'STAR';
    if (String(code).startsWith('300')) return 'CHINEXT';
    return 'MAIN';
}

function detectStFlag(name) {
    const upper = String(name || '').toUpperCase();
    return upper.includes('ST');
}

function resolveLimitPct(boardType, isSt) {
    if (isSt) return 0.05;
    if (boardType === 'STAR' || boardType === 'CHINEXT') return 0.20;
    return 0.10;
}

function computeLimitStatus(changePct, limitPct) {
    if (!Number.isFinite(changePct)) return 'NORMAL';
    const limitUpTrigger = limitPct * 100 - 0.1;
    const limitDownTrigger = -limitPct * 100 + 0.1;
    if (changePct >= limitUpTrigger) return 'LIMIT_UP';
    if (changePct <= limitDownTrigger) return 'LIMIT_DOWN';
    return 'NORMAL';
}

function normalizeTickerRows(rows) {
    if (!Array.isArray(rows)) {
        throw new Error('Unexpected Binance US payload');
    }

    const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));
    const extract = (symbol) => {
        const row = bySymbol[symbol];
        if (!row) throw new Error(`Missing symbol ${symbol}`);

        const price = parseNumber(row.lastPrice);
        const change = parseNumber(row.priceChangePercent);
        const volume = parseNumber(row.quoteVolume);
        if (price === null || change === null || volume === null) {
            throw new Error(`Invalid numeric field for ${symbol}`);
        }

        return { symbol, price, change, volume };
    };

    return {
        meta: {
            source: 'binance_us',
            timestamp: new Date().toISOString(),
            stale: false
        },
        btc: extract('BTCUSDT'),
        eth: extract('ETHUSDT'),
        sol: extract('SOLUSDT')
    };
}

function fetchJsonFromHttps(url, timeoutMs = 5000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                method: 'GET',
                agent: false,
                timeout: timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Accept: 'application/json,text/plain,*/*',
                    Connection: 'close'
                }
            },
            (upstream) => {
                let body = '';
                upstream.on('data', (chunk) => { body += chunk.toString('utf8'); });
                upstream.on('end', () => {
                    const statusCode = upstream.statusCode || 500;
                    if (statusCode >= 300 && statusCode <= 399 && upstream.headers.location) {
                        if (redirectCount >= 5) {
                            reject(new Error(`Too many upstream redirects from ${url}`));
                            return;
                        }
                        const nextUrl = new URL(upstream.headers.location, url).toString();
                        fetchJsonFromHttps(nextUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
                        return;
                    }
                    if (statusCode < 200 || statusCode > 299) {
                        reject(new Error(`Upstream status ${upstream.statusCode}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(body));
                    } catch (error) {
                        reject(new Error(`Invalid upstream JSON: ${error.message}`));
                    }
                });
            }
        );

        request.on('timeout', () => request.destroy(new Error('Upstream timeout')));
        request.on('error', reject);
        request.end();
    });
}

function fetchTextFromHttps(url, timeoutMs = 5000, redirectCount = 0, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                method: 'GET',
                agent: false,
                timeout: timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Accept: '*/*',
                    Connection: 'close',
                    ...headers
                }
            },
            (upstream) => {
                const chunks = [];
                upstream.on('data', (chunk) => { chunks.push(chunk); });
                upstream.on('end', () => {
                    const statusCode = upstream.statusCode || 500;
                    if (statusCode >= 300 && statusCode <= 399 && upstream.headers.location) {
                        if (redirectCount >= 5) {
                            reject(new Error(`Too many upstream redirects from ${url}`));
                            return;
                        }
                        const nextUrl = new URL(upstream.headers.location, url).toString();
                        fetchTextFromHttps(nextUrl, timeoutMs, redirectCount + 1, headers).then(resolve).catch(reject);
                        return;
                    }
                    if (statusCode < 200 || statusCode > 299) {
                        reject(new Error(`Upstream status ${upstream.statusCode}`));
                        return;
                    }
                    resolve(Buffer.concat(chunks).toString('utf8'));
                });
            }
        );

        request.on('timeout', () => request.destroy(new Error('Upstream timeout')));
        request.on('error', reject);
        request.end();
    });
}

function fetchBinanceUS() {
    return fetchJsonFromHttps(BINANCE_US_URL, 5000).then(normalizeTickerRows);
}

function resolveCryptoHistoryRange(rawRange) {
    const normalized = String(rawRange || '24h').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(CRYPTO_HISTORY_RANGE_CONFIG, normalized) ? normalized : null;
}

function buildBinanceKlinesUrl(symbol, interval, limit) {
    const query = new URLSearchParams({
        symbol,
        interval,
        limit: String(limit)
    });
    return `${BINANCE_US_KLINES_BASE}?${query.toString()}`;
}

function normalizeCryptoSymbol(rawSymbol) {
    const normalized = String(rawSymbol || '').trim().toUpperCase().replace(/\//g, '');
    if (!normalized) return null;
    if (normalized.endsWith('USDT')) return normalized;
    return `${normalized}USDT`;
}

function cryptoBaseSymbol(symbol) {
    const normalized = normalizeCryptoSymbol(symbol);
    if (!normalized) return null;
    return normalized.endsWith('USDT') ? normalized.slice(0, -4) : normalized;
}

function buildCoinGeckoMarketChartUrl(coinId, days) {
    const query = new URLSearchParams({
        vs_currency: 'usd',
        days: String(days)
    });
    return `${COINGECKO_MARKET_CHART_BASE}/${encodeURIComponent(coinId)}/market_chart?${query.toString()}`;
}

function normalizeKlineRows(rows) {
    if (!Array.isArray(rows)) {
        throw new Error('Unexpected Binance US kline payload');
    }

    const series = rows
        .map((row) => {
            if (!Array.isArray(row) || row.length < 7) return null;

            const openTime = Number(row[0]);
            const open = parseNumber(row[1]);
            const high = parseNumber(row[2]);
            const low = parseNumber(row[3]);
            const close = parseNumber(row[4]);
            const volume = parseNumber(row[5]);

            if (
                !Number.isFinite(openTime)
                || open === null
                || high === null
                || low === null
                || close === null
                || volume === null
            ) {
                return null;
            }

            return {
                ts: new Date(openTime).toISOString(),
                open,
                high,
                low,
                close,
                volume
            };
        })
        .filter((row) => row !== null)
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    if (!series.length) {
        throw new Error('No valid kline points from Binance US');
    }

    return series;
}

function normalizeCoinGeckoMarketChartRows(payload, windowMs = null, limit = 240) {
    const prices = Array.isArray(payload?.prices) ? payload.prices : [];
    const volumes = Array.isArray(payload?.total_volumes) ? payload.total_volumes : [];
    const floorTs = Number.isFinite(windowMs) && windowMs > 0 ? Date.now() - windowMs : 0;

    const series = prices.map((point, index) => {
        const openTime = parseNumber(point?.[0]);
        const price = parseNumber(point?.[1]);
        const volumePoint = Array.isArray(volumes[index]) ? volumes[index] : null;
        const volume = parseNumber(volumePoint?.[1]) ?? 0;
        if (!Number.isFinite(openTime) || !Number.isFinite(price)) {
            return null;
        }
        if (floorTs && openTime < floorTs) {
            return null;
        }
        return {
            ts: new Date(openTime).toISOString(),
            open: price,
            high: price,
            low: price,
            close: price,
            volume
        };
    }).filter((row) => row !== null);

    if (!series.length) {
        throw new Error('No valid CoinGecko market chart points');
    }

    const normalized = series.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    if (normalized.length <= limit) {
        return normalized;
    }
    return normalized.slice(normalized.length - limit);
}

async function getCryptoHistoryWithCache(symbol, range) {
    const config = CRYPTO_HISTORY_RANGE_CONFIG[range];
    if (!config) {
        throw new Error(`Unsupported crypto history range: ${range}`);
    }

    const cacheKey = `${symbol}:${range}`;
    const cacheEntry = cryptoHistoryCache.get(cacheKey);
    const now = Date.now();
    if (cacheEntry && now - cacheEntry.at <= config.ttlMs) {
        return deepCopy(cacheEntry.payload);
    }

    try {
        let payload;
        if (CRYPTO_SUPPORTED_SYMBOLS.has(symbol)) {
            const endpoint = buildBinanceKlinesUrl(symbol, config.interval, config.limit);
            const rawRows = await fetchJsonFromHttps(endpoint, 7000);
            const series = normalizeKlineRows(rawRows);
            payload = {
                meta: {
                    source: 'binance_us_klines',
                    timestamp: new Date().toISOString(),
                    stale: false,
                    range,
                    interval: config.interval
                },
                symbol,
                series
            };
        } else {
            const resolved = await findCryptoUniverseRowBySymbol(symbol);
            if (!resolved?.row?.coingeckoId) {
                throw new Error(`Crypto universe history unavailable for ${symbol}`);
            }
            const endpoint = buildCoinGeckoMarketChartUrl(resolved.row.coingeckoId, config.coingeckoDays);
            const rawPayload = await fetchJsonFromHttps(endpoint, 9000);
            const series = normalizeCoinGeckoMarketChartRows(rawPayload, config.windowMs, config.limit);
            payload = {
                meta: {
                    source: 'coingecko_market_chart',
                    timestamp: new Date().toISOString(),
                    stale: false,
                    range,
                    interval: config.interval
                },
                symbol: resolved.symbol,
                series
            };
        }
        cryptoHistoryCache.set(cacheKey, { payload, at: Date.now() });
        return deepCopy(payload);
    } catch (error) {
        if (cacheEntry) {
            const stalePayload = deepCopy(cacheEntry.payload);
            stalePayload.meta = {
                ...stalePayload.meta,
                stale: true,
                stale_reason: error.message,
                timestamp: new Date().toISOString()
            };
            return stalePayload;
        }
        throw error;
    }
}

function resolveCryptoSymbol(rawSymbol) {
    return normalizeCryptoSymbol(rawSymbol);
}

function listCryptoRows(payload) {
    return [payload?.btc, payload?.eth, payload?.sol].filter((row) => row && row.symbol);
}

function getCryptoRowBySymbol(payload, symbol) {
    const rows = listCryptoRows(payload);
    return rows.find((row) => row.symbol === symbol) || null;
}

function updateCryptoReturnHistory(payload) {
    listCryptoRows(payload).forEach((row) => {
        const prevPrice = cryptoLastPriceBySymbol.get(row.symbol);
        if (Number.isFinite(prevPrice) && prevPrice > 0 && Number.isFinite(row.price)) {
            const ret = (row.price - prevPrice) / prevPrice;
            const history = cryptoReturnHistoryBySymbol.get(row.symbol) || [];
            history.push(clamp(ret, -0.2, 0.2));
            if (history.length > 240) history.shift();
            cryptoReturnHistoryBySymbol.set(row.symbol, history);
        }
        cryptoLastPriceBySymbol.set(row.symbol, row.price);
    });
}

async function getCryptoPricesWithCache() {
    const now = Date.now();
    if (cryptoPriceCache && now - cryptoPriceCacheAt <= CRYPTO_CACHE_TTL_MS) {
        return deepCopy(cryptoPriceCache);
    }

    try {
        const payload = await fetchBinanceUS();
        updateCryptoReturnHistory(payload);
        cryptoPriceCache = payload;
        cryptoPriceCacheAt = Date.now();
        return deepCopy(payload);
    } catch (error) {
        if (cryptoPriceCache) {
            const stalePayload = deepCopy(cryptoPriceCache);
            stalePayload.meta = {
                ...stalePayload.meta,
                stale: true,
                stale_reason: error.message,
                timestamp: new Date().toISOString()
            };
            return stalePayload;
        }
        throw error;
    }
}

function buildCryptoTopFeaturesFromTrackingRow(row) {
    return Object.entries(row?.factors || {})
        .sort((a, b) => (row?.contribution?.[b[0]] ?? 0) - (row?.contribution?.[a[0]] ?? 0))
        .map(([key, value]) => ({
            feature: `${key.charAt(0).toUpperCase()}${key.slice(1)} Factor`,
            shap_value: signedTrackingFactor(value),
            contribution: row?.factorExplanations?.[key] || 'Live contribution signal.'
        }));
}

function buildCryptoPredictionPayloadFromTrackingRow(symbol, trackingRow, stale = false, staleReason = null) {
    const price = parseNumber(trackingRow?.price);
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Quote unavailable for ${symbol}`);
    }

    const pUp = clamp(parseNumber(trackingRow?.pUp) ?? 0.5, 0.05, 0.95);
    const confidence = clamp(parseNumber(trackingRow?.confidence) ?? 0.5, 0.05, 0.98);
    const pDown = clamp(1 - pUp, 0.05, 0.95);
    const rawChangePct = parseNumber(trackingRow?.rawChangePct) ?? ((parseNumber(trackingRow?.changePct) ?? 0) * 100);
    let q10 = clamp(parseNumber(trackingRow?.q10) ?? -0.01, -0.1, 0.1);
    let q50 = clamp(parseNumber(trackingRow?.q50) ?? 0, -0.09, 0.09);
    let q90 = clamp(parseNumber(trackingRow?.q90) ?? 0.01, -0.1, 0.1);
    [q10, q50, q90] = [q10, q50, q90].sort((a, b) => a - b);

    const trendComponent = clamp(rawChangePct / 8, -1, 1);
    const w0Raw = clamp(0.22 + trendComponent * 0.06 + (1 - confidence) * 0.05, 0.05, 0.55);
    const w1Raw = clamp(0.30 + trendComponent * 0.09 + confidence * 0.16, 0.08, 0.64);
    const w2Raw = clamp(0.28 - trendComponent * 0.04 + (1 - confidence) * 0.08, 0.08, 0.5);
    const w3Raw = Math.max(0.05, 1 - (w0Raw + w1Raw + w2Raw));
    const window = normalizeWindow(w0Raw, w1Raw, w2Raw, w3Raw);

    const mostLikely = Object.entries({
        W0: window.w0,
        W1: window.w1,
        W2: window.w2,
        W3: window.w3
    }).sort((a, b) => b[1] - a[1])[0][0];
    const expectedStart = mostLikely === 'W0'
        ? 'Immediate'
        : mostLikely === 'W1'
            ? 'Within 1 hour'
            : mostLikely === 'W2'
                ? 'Within 2 hours'
                : 'Within 3 hours';

    const estimatedOpen = price / Math.max(0.01, 1 + rawChangePct / 100);
    const { policyPacket, policy, tpSl } = buildUnifiedPolicyArtifacts({
        market: 'crypto',
        symbol,
        price,
        changePct: rawChangePct,
        open: estimatedOpen,
        high: price * (1 + Math.max(q90, 0)),
        low: price * (1 + Math.min(q10, 0)),
        volume: parseNumber(trackingRow?.meta?.totalVolume) ?? parseNumber(trackingRow?.liquidityProxy) ?? 0,
        pUp,
        confidence,
        q10,
        q50,
        q90,
        forecastTimestamp: new Date().toISOString(),
        inputSource: 'tracking-crypto-top50'
    });
    const action = derivePolicySignal(policyPacket.action);
    const actionable = action === 'LONG' || action === 'SHORT';
    const bandWidth = Math.max(q90 - q10, 0.0001);
    const sharpeRatio = clamp((q50 / bandWidth) * 0.9, -2.5, 2.5);
    const driftAlerts = Math.max(0, Math.round((0.65 - confidence) * 40));
    const healthStatus = stale ? 'IN REVIEW' : (driftAlerts > 12 ? 'IN REVIEW' : 'MONITORED');
    const reasonCodes = resolveCryptoReasonCodes(action === 'WAIT' ? 'FLAT' : action, pUp, confidence);
    const topFeatures = buildCryptoTopFeaturesFromTrackingRow(trackingRow).slice(0, 5);
    const summary = trackingRow?.actionTooltip
        ? `${trackingRow.actionTooltip}. Live top-50 ex-stablecoins universe context applied.`
        : 'Generated from live top-50 ex-stablecoins market regime.';

    const payload = {
        meta: {
            source: 'coingecko_top50_derived',
            timestamp: new Date().toISOString(),
            stale: Boolean(stale)
        },
        prediction: {
            symbol,
            p_up: Number(pUp.toFixed(4)),
            p_down: Number(pDown.toFixed(4)),
            confidence: Number(confidence.toFixed(4)),
            signal: action,
            start_window: {
                w0: Number(window.w0.toFixed(4)),
                w1: Number(window.w1.toFixed(4)),
                w2: Number(window.w2.toFixed(4)),
                w3: Number(window.w3.toFixed(4)),
                most_likely: mostLikely,
                expected_start: expectedStart
            },
            magnitude: {
                q10: Number(q10.toFixed(4)),
                q50: Number(q50.toFixed(4)),
                q90: Number(q90.toFixed(4))
            }
        },
        signal: {
            action,
            actionable,
            presentation: actionable ? 'TRADE' : 'NO_TRADE',
            position_size: Number((policy.positionSize || 0).toFixed(4)),
            entry_price: Number(price.toFixed(4)),
            reference_price: Number(price.toFixed(4)),
            long_trigger_p_up: CRYPTO_LONG_TRIGGER_P_UP,
            short_trigger_p_up: CRYPTO_SHORT_TRIGGER_P_UP,
            stop_loss: actionable ? tpSl.stopLoss : null,
            take_profit_1: actionable ? tpSl.takeProfit1 : null,
            take_profit_2: actionable ? tpSl.takeProfit2 : null,
            rr_1: actionable ? tpSl.rewardRisk1 : null,
            rr_2: actionable ? tpSl.rewardRisk2 : null
        },
        policyPacket,
        policy,
        tpSl,
        explanation: {
            summary,
            top_features: topFeatures,
            reason_codes: reasonCodes
        },
        health: {
            status: healthStatus,
            drift_alerts: driftAlerts,
            sharpe_ratio: Number(sharpeRatio.toFixed(4)),
            sharpe_stability: Number((bandWidth * 100).toFixed(4)),
            data_freshness: stale ? 'stale cache' : 'live',
            last_training: 'N/A (live derived)'
        },
        symbol,
        timestamp: new Date().toISOString()
    };

    if (staleReason) {
        payload.meta.stale_reason = staleReason;
    }
    return payload;
}

function buildCryptoUniverseRowFromTrackingRow(trackingRow, staleReason = null) {
    const symbol = normalizeCryptoSymbol(trackingRow?.symbol);
    const price = parseNumber(trackingRow?.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) {
        return null;
    }
    const predictionPayload = buildCryptoPredictionPayloadFromTrackingRow(
        symbol,
        trackingRow,
        Boolean(trackingRow?.stale),
        staleReason || trackingRow?.staleReason || null
    );
    return {
        symbol,
        baseSymbol: cryptoBaseSymbol(symbol),
        name: trackingRow?.name || cryptoBaseSymbol(symbol),
        price,
        change: parseNumber(trackingRow?.rawChangePct) ?? ((parseNumber(trackingRow?.changePct) ?? 0) * 100),
        volume: parseNumber(trackingRow?.meta?.totalVolume) ?? parseNumber(trackingRow?.liquidityProxy) ?? 0,
        marketCap: parseNumber(trackingRow?.meta?.marketCap) ?? 0,
        marketCapRank: parseInteger(trackingRow?.meta?.marketCapRank, null),
        pUp: parseNumber(trackingRow?.pUp) ?? 0.5,
        confidence: parseNumber(trackingRow?.confidence) ?? 0.5,
        q10: parseNumber(trackingRow?.q10) ?? -0.01,
        q50: parseNumber(trackingRow?.q50) ?? 0,
        q90: parseNumber(trackingRow?.q90) ?? 0.01,
        signal: predictionPayload.signal.action,
        status: trackingRow?.status === 'STALE' ? 'Stale' : trackingRow?.status === 'LIVE' ? 'Live' : 'Unavailable',
        stale: Boolean(trackingRow?.stale),
        staleReason: staleReason || trackingRow?.staleReason || null,
        timestamp: trackingRow?.timestamp || new Date().toISOString(),
        coingeckoId: trackingRow?.meta?.id || null,
        detail: {
            summary: predictionPayload.explanation.summary,
            topFeatures: predictionPayload.explanation.top_features,
            reasonCodes: predictionPayload.explanation.reason_codes
        }
    };
}

async function getCryptoUniverseWithCache() {
    const payload = await getTrackingCryptoUniverseWithCache();
    const rows = (payload?.rows || [])
        .slice(0, CRYPTO_UNIVERSE_LIMIT)
        .map((row) => buildCryptoUniverseRowFromTrackingRow(row, payload?.meta?.staleReason || null))
        .filter((row) => row !== null);
    return {
        meta: {
            source: payload?.meta?.source || 'tracking_crypto_universe',
            timestamp: payload?.meta?.timestamp || new Date().toISOString(),
            stale: Boolean(payload?.meta?.stale),
            stale_reason: payload?.meta?.staleReason || null
        },
        total: rows.length,
        rows
    };
}

async function findCryptoUniverseRowBySymbol(rawSymbol) {
    const symbol = normalizeCryptoSymbol(rawSymbol);
    if (!symbol) return null;
    const payload = await getCryptoUniverseWithCache();
    const row = payload.rows.find((item) => item.symbol === symbol || item.baseSymbol === cryptoBaseSymbol(symbol)) || null;
    if (!row) return null;
    return { symbol: row.symbol, row, payload };
}

function normalizeWindow(w0, w1, w2, w3) {
    const total = w0 + w1 + w2 + w3;
    if (!Number.isFinite(total) || total <= 0) {
        return { w0: 0.25, w1: 0.35, w2: 0.25, w3: 0.15 };
    }
    return {
        w0: w0 / total,
        w1: w1 / total,
        w2: w2 / total,
        w3: w3 / total
    };
}

function normalizePolicyMarketName(rawMarket) {
    const candidate = String(rawMarket || '').trim().toLowerCase();
    if (candidate === 'cn' || candidate === 'cn_equity') return 'cn_equity';
    if (candidate === 'us' || candidate === 'us_equity') return 'us_equity';
    if (candidate === 'crypto') return 'crypto';
    if (candidate.startsWith('session_')) return candidate;
    if (candidate === 'session') return 'session';
    return candidate || 'session';
}

function derivePolicySignal(packetAction) {
    const normalized = String(packetAction || '').trim().toUpperCase();
    if (normalized.includes('LONG')) return 'LONG';
    if (normalized.includes('SHORT')) return 'SHORT';
    if (normalized === 'WAIT') return 'WAIT';
    return 'FLAT';
}

function buildUnifiedPolicyArtifacts(input = {}) {
    const market = normalizePolicyMarketName(input.market);
    const policyPacket = buildPolicyPacket({
        market,
        symbol: input.symbol,
        price: input.price,
        changePct: input.changePct,
        open: input.open,
        high: input.high,
        low: input.low,
        volume: input.volume,
        pUp: input.pUp,
        confidence: input.confidence,
        q10: input.q10,
        q50: input.q50,
        q90: input.q90,
        forecastTimestamp: input.forecastTimestamp || new Date().toISOString(),
        inputSource: input.inputSource || 'unknown',
        sessionMeta: input.sessionMeta,
        regimeHints: input.regimeHints
    });
    return {
        policyPacket,
        policy: deriveLegacyPolicy(policyPacket, { market }),
        tpSl: deriveLegacyTpSl(policyPacket, input.price)
    };
}

function calculateRiskReward(entryPrice, stopLoss, takeProfit) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (!Number.isFinite(risk) || risk <= 0) return 0;
    return reward / risk;
}

const CRYPTO_LONG_TRIGGER_P_UP = 0.55;
const CRYPTO_SHORT_TRIGGER_P_UP = 0.45;
const CRYPTO_MIN_ACTIONABLE_CONFIDENCE = 0.45;

function resolveCryptoTradeSignal(pUp, confidence) {
    const normalizedPUp = clamp(Number.isFinite(pUp) ? pUp : 0.5, 0, 1);
    const normalizedConfidence = clamp(Number.isFinite(confidence) ? confidence : 0, 0, 1);
    if (normalizedConfidence >= CRYPTO_MIN_ACTIONABLE_CONFIDENCE && normalizedPUp >= CRYPTO_LONG_TRIGGER_P_UP) {
        return 'LONG';
    }
    if (normalizedConfidence >= CRYPTO_MIN_ACTIONABLE_CONFIDENCE && normalizedPUp <= CRYPTO_SHORT_TRIGGER_P_UP) {
        return 'SHORT';
    }
    return 'FLAT';
}

function resolveCryptoReasonCodes(action, pUp, confidence) {
    if (action === 'LONG') {
        return ['p_bull_gate', 'momentum_gate', 'volume_gate'];
    }
    if (action === 'SHORT') {
        return ['p_bear_gate', 'volatility_gate', 'risk_cap'];
    }

    const reasonCodes = [];
    if (pUp > CRYPTO_SHORT_TRIGGER_P_UP && pUp < CRYPTO_LONG_TRIGGER_P_UP) {
        reasonCodes.push('neutral_zone');
    }
    if ((pUp >= CRYPTO_LONG_TRIGGER_P_UP || pUp <= CRYPTO_SHORT_TRIGGER_P_UP) && confidence < CRYPTO_MIN_ACTIONABLE_CONFIDENCE) {
        reasonCodes.push('confidence_gate');
    }
    reasonCodes.push('risk_cap');
    return reasonCodes;
}

function buildCryptoPredictionPayload(symbol, row, stale = false, staleReason = null) {
    const changePct = Number.isFinite(row.change) ? row.change : 0;
    const volume = Math.max(Number.isFinite(row.volume) ? row.volume : 0, 1);

    const trendComponent = clamp(changePct / 8, -1, 1);
    const volumeComponent = clamp((Math.log10(volume) - 6.2) / 3.2, -1, 1);
    const pUp = clamp(0.5 + trendComponent * 0.24 + volumeComponent * 0.06, 0.05, 0.95);
    const pDown = clamp(1 - pUp, 0.05, 0.95);

    const distance = Math.abs(pUp - 0.5) * 2;
    const volatilityProxy = clamp(Math.abs(changePct) / 100 * 0.55 + 0.006, 0.004, 0.06);
    const confidence = clamp(
        0.42 + distance * 0.44 + clamp(Math.abs(changePct) / 18, 0, 0.2) - volatilityProxy * 1.4,
        0.25,
        0.98
    );

    const center = clamp((changePct / 100) * 0.22 + (pUp - 0.5) * 0.04, -0.08, 0.08);
    const spread = clamp(volatilityProxy * (0.8 + (1 - confidence) * 0.9), 0.008, 0.075);
    let q10 = clamp(center - spread * 0.9, -0.1, 0.1);
    let q50 = clamp(center, -0.09, 0.09);
    let q90 = clamp(center + spread * 0.9, -0.1, 0.1);
    [q10, q50, q90] = [q10, q50, q90].sort((a, b) => a - b);

    const w0Raw = clamp(0.22 + trendComponent * 0.06 + (1 - confidence) * 0.05, 0.05, 0.55);
    const w1Raw = clamp(0.30 + trendComponent * 0.09 + confidence * 0.16, 0.08, 0.64);
    const w2Raw = clamp(0.28 - trendComponent * 0.04 + (1 - confidence) * 0.08, 0.08, 0.5);
    const w3Raw = Math.max(0.05, 1 - (w0Raw + w1Raw + w2Raw));
    const window = normalizeWindow(w0Raw, w1Raw, w2Raw, w3Raw);

    const mostLikely = Object.entries({
        W0: window.w0,
        W1: window.w1,
        W2: window.w2,
        W3: window.w3
    }).sort((a, b) => b[1] - a[1])[0][0];
    const expectedStart = mostLikely === 'W0'
        ? 'Immediate'
        : mostLikely === 'W1'
            ? 'Within 1 hour'
            : mostLikely === 'W2'
                ? 'Within 2 hours'
                : 'Within 3 hours';

    const entryPrice = row.price;
    const estimatedOpen = entryPrice / Math.max(0.01, 1 + changePct / 100);
    const { policyPacket, policy, tpSl } = buildUnifiedPolicyArtifacts({
        market: 'crypto',
        symbol,
        price: entryPrice,
        changePct,
        open: estimatedOpen,
        high: entryPrice * (1 + Math.max(q90, 0)),
        low: entryPrice * (1 + Math.min(q10, 0)),
        volume,
        pUp,
        confidence,
        q10,
        q50,
        q90,
        forecastTimestamp: new Date().toISOString(),
        inputSource: 'binance-us-derived'
    });
    const action = derivePolicySignal(policyPacket.action);
    const actionable = action === 'LONG' || action === 'SHORT';

    const sharpeRatio = clamp((q50 / Math.max(spread, 0.001)) * 0.9, -2.5, 2.5);
    const driftAlerts = Math.max(0, Math.round((0.65 - confidence) * 40));
    const healthStatus = stale ? 'IN REVIEW' : (driftAlerts > 12 ? 'IN REVIEW' : 'MONITORED');

    const trendShap = Number((trendComponent * 0.32).toFixed(3));
    const volumeShap = Number((volumeComponent * 0.14).toFixed(3));
    const volatilityShap = Number((-(volatilityProxy - 0.02) * 7).toFixed(3));
    const reasonCodes = resolveCryptoReasonCodes(action === 'WAIT' ? 'FLAT' : action, pUp, confidence);

    const payload = {
        meta: {
            source: 'binance_us_derived',
            timestamp: new Date().toISOString(),
            stale: Boolean(stale)
        },
        prediction: {
            symbol,
            p_up: Number(pUp.toFixed(4)),
            p_down: Number(pDown.toFixed(4)),
            confidence: Number(confidence.toFixed(4)),
            signal: action,
            start_window: {
                w0: Number(window.w0.toFixed(4)),
                w1: Number(window.w1.toFixed(4)),
                w2: Number(window.w2.toFixed(4)),
                w3: Number(window.w3.toFixed(4)),
                most_likely: mostLikely,
                expected_start: expectedStart
            },
            magnitude: {
                q10: Number(q10.toFixed(4)),
                q50: Number(q50.toFixed(4)),
                q90: Number(q90.toFixed(4))
            }
        },
        signal: {
            action,
            actionable,
            presentation: actionable ? 'TRADE' : 'NO_TRADE',
            position_size: Number((policy.positionSize || 0).toFixed(4)),
            entry_price: Number(entryPrice.toFixed(4)),
            reference_price: Number(entryPrice.toFixed(4)),
            long_trigger_p_up: CRYPTO_LONG_TRIGGER_P_UP,
            short_trigger_p_up: CRYPTO_SHORT_TRIGGER_P_UP,
            stop_loss: actionable ? tpSl.stopLoss : null,
            take_profit_1: actionable ? tpSl.takeProfit1 : null,
            take_profit_2: actionable ? tpSl.takeProfit2 : null,
            rr_1: actionable ? tpSl.rewardRisk1 : null,
            rr_2: actionable ? tpSl.rewardRisk2 : null
        },
        policyPacket,
        policy,
        tpSl,
        explanation: {
            summary: 'Generated from live market regime and momentum factors.',
            top_features: [
                { feature: 'momentum_24h', shap_value: trendShap, contribution: '24h momentum contribution to direction bias.' },
                { feature: 'volume_regime', shap_value: volumeShap, contribution: 'Volume regime adjusts confidence and direction weight.' },
                { feature: 'volatility_proxy', shap_value: volatilityShap, contribution: 'Volatility proxy penalizes unstable regimes.' }
            ],
            reason_codes: reasonCodes
        },
        health: {
            status: healthStatus,
            drift_alerts: driftAlerts,
            sharpe_ratio: Number(sharpeRatio.toFixed(4)),
            sharpe_stability: Number((spread * 100).toFixed(4)),
            data_freshness: stale ? 'stale cache' : 'live',
            last_training: 'N/A (live derived)'
        },
        symbol,
        timestamp: new Date().toISOString()
    };

    if (staleReason) {
        payload.meta.stale_reason = staleReason;
    }
    return payload;
}

function getReturnHistoryStats(symbol) {
    const history = cryptoReturnHistoryBySymbol.get(symbol) || [];
    if (!history.length) {
        return { mean: 0, std: 0, winRate: 0.5 };
    }
    const mean = history.reduce((acc, value) => acc + value, 0) / history.length;
    const variance = history.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / history.length;
    const std = Math.sqrt(variance);
    const winRate = history.filter((value) => value > 0).length / history.length;
    return { mean, std, winRate };
}

function buildCryptoPerformancePayload(symbol, predictionPayload, stale = false, staleReason = null) {
    const pUp = predictionPayload?.prediction?.p_up ?? 0.5;
    const confidence = predictionPayload?.prediction?.confidence ?? 0.5;
    const q10 = predictionPayload?.prediction?.magnitude?.q10 ?? -0.01;
    const q50 = predictionPayload?.prediction?.magnitude?.q50 ?? 0;
    const q90 = predictionPayload?.prediction?.magnitude?.q90 ?? 0.01;
    const { mean, std, winRate } = getReturnHistoryStats(symbol);

    const directionAccuracy = clamp(0.5 + (pUp - 0.5) * 0.5 + (winRate - 0.5) * 0.25, 0.45, 0.9);
    const intervalCoverage = clamp(0.78 + confidence * 0.15 - std * 4, 0.6, 0.95);
    const sharpeRatio = std > 1e-6
        ? clamp((mean / std) * Math.sqrt(24), -3, 3)
        : clamp((q50 / Math.max(Math.abs(q90 - q10), 0.001)) * 0.9, -3, 3);
    const brierScore = clamp(0.30 - Math.abs(pUp - 0.5) * 0.22 + std * 1.5, 0.12, 0.42);

    const payload = {
        meta: {
            source: 'prediction_derived',
            timestamp: new Date().toISOString(),
            estimated: true,
            stale: Boolean(stale)
        },
        metrics: {
            direction_accuracy: Number(directionAccuracy.toFixed(4)),
            interval_coverage: Number(intervalCoverage.toFixed(4)),
            sharpe_ratio: Number(sharpeRatio.toFixed(4)),
            win_rate: Number(clamp(winRate, 0.01, 0.99).toFixed(4)),
            brier_score: Number(brierScore.toFixed(4))
        }
    };
    if (staleReason) {
        payload.meta.stale_reason = staleReason;
    }
    return payload;
}

function resolveCryptoSessionSymbol(rawSymbol) {
    const normalized = String(rawSymbol || '').trim().toUpperCase();
    if (!normalized) return 'BTCUSDT';
    if (CRYPTO_SUPPORTED_SYMBOLS.has(normalized)) return normalized;
    if (normalized === 'BTC') return 'BTCUSDT';
    if (normalized === 'ETH') return 'ETHUSDT';
    if (normalized === 'SOL') return 'SOLUSDT';
    return null;
}

function shanghaiMinuteOfDayFromIso(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    const shanghai = toShanghaiNow(date);
    return shanghai.hour * 60 + shanghai.minute;
}

function sessionCodeFromMinuteOfDay(minuteOfDay) {
    if (!Number.isFinite(minuteOfDay)) return 'asia';
    for (const code of CRYPTO_SESSION_ORDER) {
        const meta = CRYPTO_SESSION_META[code];
        if (minuteOfDay >= meta.startMinute && minuteOfDay < meta.endMinute) {
            return code;
        }
    }
    return 'asia';
}

function computeCryptoCurrentSession(now = new Date()) {
    const shanghai = toShanghaiNow(now);
    const minuteOfDay = shanghai.hour * 60 + shanghai.minute;
    const secondOfDay = minuteOfDay * 60 + shanghai.second;
    const code = sessionCodeFromMinuteOfDay(minuteOfDay);
    const currentMeta = CRYPTO_SESSION_META[code];
    const startSec = currentMeta.startMinute * 60;
    const endSec = currentMeta.endMinute * 60;
    const totalSec = Math.max(1, endSec - startSec);
    const elapsedSec = clamp(secondOfDay - startSec, 0, totalSec);
    const remainingSec = Math.max(0, endSec - secondOfDay);
    const elapsedRatio = clamp(elapsedSec / totalSec, 0, 1);
    const nextCode = code === 'asia' ? 'europe' : code === 'europe' ? 'us' : 'asia';
    const transitionSoon = remainingSec < 1800;
    const transitionText = transitionSoon
        ? `${currentMeta.label} Ending Soon - Prepare for ${CRYPTO_SESSION_META[nextCode].label}`
        : '';
    return {
        code,
        label: currentMeta.label,
        hoursBjt: currentMeta.hoursBjt,
        remainingSec,
        elapsedRatio,
        transitionSoon,
        transitionText,
        minuteOfDay
    };
}

function classifyCryptoRisk(volatilityPct, confidence) {
    if (volatilityPct >= 3.2 || confidence <= 0.42) return 'HIGH';
    if (volatilityPct >= 1.8 || confidence <= 0.58) return 'MEDIUM';
    return 'LOW';
}

function inferSessionStatus(code, currentMinute) {
    const meta = CRYPTO_SESSION_META[code];
    if (currentMinute >= meta.startMinute && currentMinute < meta.endMinute) return 'ACTIVE';
    if (code === 'us') {
        return currentMinute < meta.startMinute ? 'PENDING' : 'COMPLETED';
    }
    return currentMinute >= meta.endMinute ? 'COMPLETED' : 'PENDING';
}

function mean(values) {
    if (!Array.isArray(values) || !values.length) return 0;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function std(values, avg = mean(values)) {
    if (!Array.isArray(values) || !values.length) return 0;
    const variance = values.reduce((acc, value) => acc + ((value - avg) ** 2), 0) / values.length;
    return Math.sqrt(Math.max(0, variance));
}

function buildSessionBuckets(historySeries) {
    const buckets = {
        asia: { returns: [], ranges: [], closes: [] },
        europe: { returns: [], ranges: [], closes: [] },
        us: { returns: [], ranges: [], closes: [] }
    };
    for (const point of historySeries || []) {
        const minuteOfDay = shanghaiMinuteOfDayFromIso(point.ts);
        if (minuteOfDay === null) continue;
        const code = sessionCodeFromMinuteOfDay(minuteOfDay);
        const bucket = buckets[code];
        const open = Number(point.open);
        const close = Number(point.close);
        const high = Number(point.high);
        const low = Number(point.low);
        if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(close)) continue;
        bucket.returns.push(clamp((close - open) / open, -0.2, 0.2));
        if (Number.isFinite(high) && Number.isFinite(low)) {
            bucket.ranges.push(clamp((high - low) / open, 0, 0.25));
        }
        bucket.closes.push(close);
    }
    return buckets;
}

function buildSessionStat(code, bucket, basePrediction, changePct, minuteOfDay) {
    const returns = bucket?.returns || [];
    const ranges = bucket?.ranges || [];
    const winRate = returns.length ? returns.filter((value) => value > 0).length / returns.length : 0.5;
    const avgRet = mean(returns);
    const retStd = std(returns, avgRet);
    const avgRange = ranges.length ? mean(ranges) : Math.max(Math.abs(basePrediction.q90 - basePrediction.q10), 0.008);
    const trendBoost = clamp(changePct / 100, -0.12, 0.12);

    const pUp = clamp(
        basePrediction.pUp + avgRet * 13 + (winRate - 0.5) * 0.24 + trendBoost * 0.16,
        0.05,
        0.95
    );
    const confidence = clamp(
        basePrediction.confidence + Math.abs(avgRet) * 9 + (0.06 - retStd) * 1.6 - avgRange * 2.2,
        0.2,
        0.98
    );
    const q50 = clamp(basePrediction.q50 * 0.55 + avgRet * 1.35, -0.1, 0.1);
    const spread = clamp(retStd * 1.7 + avgRange * 0.8, 0.004, 0.08);
    const q10 = clamp(q50 - spread, -0.12, 0.12);
    const q90 = clamp(q50 + spread, -0.12, 0.12);
    const volatilityPct = Number(clamp(avgRange * 100 * 1.2, 0.2, 25).toFixed(2));
    const riskLevel = classifyCryptoRisk(volatilityPct, confidence);

    return {
        code,
        label: CRYPTO_SESSION_META[code].label,
        hoursBjt: CRYPTO_SESSION_META[code].hoursBjt,
        pUp: Number(pUp.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        volatilityPct,
        riskLevel,
        status: inferSessionStatus(code, minuteOfDay),
        q10: Number(q10.toFixed(4)),
        q50: Number(q50.toFixed(4)),
        q90: Number(q90.toFixed(4)),
        winRate: Number(winRate.toFixed(4)),
        meanReturn: Number(avgRet.toFixed(6))
    };
}

function sessionCodeFromHour(hour) {
    if (hour >= 8 && hour <= 15) return 'asia';
    if (hour >= 16) return 'europe';
    return 'us';
}

function extractHourFromShanghaiIso(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return toShanghaiNow(date).hour;
}

function buildHourlyRows(symbol, history7d, history24h, sessions, predictionPayload, currentPrice) {
    const byHour = new Map();
    for (const point of history7d || []) {
        const hour = extractHourFromShanghaiIso(point.ts);
        if (hour === null) continue;
        const open = Number(point.open);
        const close = Number(point.close);
        const high = Number(point.high);
        const low = Number(point.low);
        if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(close)) continue;
        const arr = byHour.get(hour) || [];
        arr.push({
            ret: clamp((close - open) / open, -0.2, 0.2),
            range: Number.isFinite(high) && Number.isFinite(low) ? clamp((high - low) / open, 0, 0.25) : 0,
            close
        });
        byHour.set(hour, arr);
    }

    const history24hByHour = new Map();
    for (const point of history24h || []) {
        const hour = extractHourFromShanghaiIso(point.ts);
        if (hour === null) continue;
        const close = Number(point.close);
        if (!Number.isFinite(close)) continue;
        const arr = history24hByHour.get(hour) || [];
        arr.push(close);
        history24hByHour.set(hour, arr);
    }

    const basePrediction = predictionPayload?.prediction || {};
    const baseQ10 = Number(basePrediction?.magnitude?.q10 ?? -0.01);
    const baseQ50 = Number(basePrediction?.magnitude?.q50 ?? 0);
    const baseQ90 = Number(basePrediction?.magnitude?.q90 ?? 0.01);

    const hourly = [];
    for (let hour = 0; hour < 24; hour += 1) {
        const code = sessionCodeFromHour(hour);
        const sessionStat = sessions.find((row) => row.code === code);
        const hourRows = byHour.get(hour) || [];
        const hourReturns = hourRows.map((row) => row.ret);
        const hourRanges = hourRows.map((row) => row.range);
        const avgRet = hourReturns.length ? mean(hourReturns) : sessionStat?.meanReturn || 0;
        const retStd = hourReturns.length ? std(hourReturns, avgRet) : Math.abs((sessionStat?.q90 || 0.01) - (sessionStat?.q10 || -0.01)) / 2;
        const avgRange = hourRanges.length ? mean(hourRanges) : (sessionStat?.volatilityPct || 1.2) / 100;

        const pUp = clamp((sessionStat?.pUp || basePrediction.p_up || 0.5) + avgRet * 8, 0.05, 0.95);
        const confidence = clamp((sessionStat?.confidence || basePrediction.confidence || 0.5) - avgRange * 1.8 + 0.08, 0.2, 0.98);
        const q50 = clamp((sessionStat?.q50 || baseQ50) * 0.6 + avgRet * 1.2, -0.12, 0.12);
        const spread = clamp(retStd * 1.6 + avgRange * 0.7 + Math.abs(baseQ90 - baseQ10) * 0.2, 0.004, 0.09);
        const q10 = clamp(q50 - spread, -0.15, 0.15);
        const q90 = clamp(q50 + spread, -0.15, 0.15);
        const volatilityForecastPct = Number(clamp(avgRange * 100 * 1.25, 0.2, 30).toFixed(2));
        const signal = pUp >= 0.65
            ? 'STRONG LONG'
            : pUp >= 0.55
                ? 'LONG'
                : pUp <= 0.35
                    ? 'STRONG SHORT'
                    : pUp <= 0.45
                        ? 'SHORT'
                        : 'FLAT';

        const hourPrices = history24hByHour.get(hour) || [];
        const sparkline = hourPrices.length >= 2
            ? hourPrices.slice(-8).map((value) => Number(value.toFixed(2)))
            : [];

        hourly.push({
            hourLabel: `${String(hour).padStart(2, '0')}:00`,
            sessionCode: code,
            pUp: Number(pUp.toFixed(4)),
            q10: Number(q10.toFixed(4)),
            q50: Number(q50.toFixed(4)),
            q90: Number(q90.toFixed(4)),
            volatilityForecastPct,
            signal,
            sparkline
        });
    }
    return hourly;
}

function leverageScale(leverage) {
    if (leverage >= 10) return 2.6;
    if (leverage >= 5) return 1.8;
    return 1;
}

function leverageCostScale(leverage) {
    if (leverage >= 10) return 1.7;
    if (leverage >= 5) return 1.35;
    return 1;
}

function buildDecisionByLeverage(decision) {
    const result = {};
    const entry = Number.isFinite(Number(decision.entry)) ? Number(decision.entry) : null;
    const baseStop = decision.stopLoss === null || decision.stopLoss === undefined
        ? null
        : (Number.isFinite(Number(decision.stopLoss)) ? Number(decision.stopLoss) : null);
    const baseTp1 = decision.takeProfit1 === null || decision.takeProfit1 === undefined
        ? null
        : (Number.isFinite(Number(decision.takeProfit1)) ? Number(decision.takeProfit1) : null);
    const baseTp2 = decision.takeProfit2 === null || decision.takeProfit2 === undefined
        ? null
        : (Number.isFinite(Number(decision.takeProfit2)) ? Number(decision.takeProfit2) : null);
    const action = String(decision.action || 'FLAT').toUpperCase();
    const actionable = Boolean(decision.actionable ?? (action.includes('LONG') || action.includes('SHORT')));
    const baseGross = Number(decision.grossReturnPct);
    const baseCost = Number(decision.costPct);
    const slPct = Number.isFinite(entry) && entry > 0 && Number.isFinite(baseStop) ? Math.abs(entry - baseStop) / entry : 0;
    const tp1Pct = Number.isFinite(entry) && entry > 0 && Number.isFinite(baseTp1) ? Math.abs(baseTp1 - entry) / entry : 0;
    const tp2Pct = Number.isFinite(entry) && entry > 0 && Number.isFinite(baseTp2) ? Math.abs(baseTp2 - entry) / entry : 0;

    for (const leverage of [1, 5, 10]) {
        const scale = leverageScale(leverage);
        const costScale = leverageCostScale(leverage);
        let stopLoss = baseStop;
        let takeProfit1 = baseTp1;
        let takeProfit2 = baseTp2;

        if (actionable && Number.isFinite(entry) && entry > 0) {
            if (action.includes('LONG')) {
                stopLoss = entry * (1 - slPct * scale);
                takeProfit1 = entry * (1 + tp1Pct * scale);
                takeProfit2 = entry * (1 + tp2Pct * scale);
            } else if (action.includes('SHORT')) {
                stopLoss = entry * (1 + slPct * scale);
                takeProfit1 = entry * (1 - tp1Pct * scale);
                takeProfit2 = entry * (1 - tp2Pct * scale);
            }
        } else {
            stopLoss = null;
            takeProfit1 = null;
            takeProfit2 = null;
        }

        const gross = baseGross * scale;
        const cost = baseCost * costScale;
        const net = gross - cost;
        result[String(leverage)] = {
            netEdgePct: Number(net.toFixed(2)),
            stopLoss: Number.isFinite(stopLoss) ? Number(stopLoss.toFixed(4)) : null,
            takeProfit1: Number.isFinite(takeProfit1) ? Number(takeProfit1.toFixed(4)) : null,
            takeProfit2: Number.isFinite(takeProfit2) ? Number(takeProfit2.toFixed(4)) : null
        };
    }
    return result;
}

function classifyEdgeReason(deltaPct, volatilityPct) {
    if (deltaPct <= -0.45 && volatilityPct >= 2.3) {
        return 'Volatility spike caused additional slippage';
    }
    if (deltaPct >= 0.45) {
        return 'Momentum persistence improved realized edge';
    }
    if (Math.abs(deltaPct) <= 0.2) {
        return 'Execution tracked forecast within expected noise';
    }
    return 'Order flow divergence reduced follow-through';
}

function buildSessionTradeLog(sessions) {
    const rows = [];
    for (const session of sessions) {
        const predictedEdgePct = Number((session.q50 * 100 - clamp(session.volatilityPct * 0.14, 0.18, 1.2)).toFixed(2));
        const realizedEdgePct = Number((session.meanReturn * 100 - clamp(session.volatilityPct * 0.1, 0.1, 1)).toFixed(2));
        const edgeDeltaPct = Number((realizedEdgePct - predictedEdgePct).toFixed(2));
        const outcome = realizedEdgePct > 0.25 ? 'ACHIEVED' : realizedEdgePct < -0.25 ? 'MISSED' : 'NEUTRAL';
        rows.push({
            sessionLabel: session.label,
            predictedEdgePct,
            realizedEdgePct,
            edgeDeltaPct,
            deltaReason: classifyEdgeReason(edgeDeltaPct, session.volatilityPct),
            outcome
        });
    }
    return rows;
}

function buildSessionTradeStats(tradeLogRows) {
    const rows = Array.isArray(tradeLogRows) ? tradeLogRows.slice(-10) : [];
    if (!rows.length) {
        return {
            last10WinRate: null,
            avgRealizedEdgePct: null,
            sampleSize: 0
        };
    }
    const achievedCount = rows.filter((row) => String(row.outcome).toUpperCase() === 'ACHIEVED').length;
    const avgRealized = mean(rows.map((row) => Number(row.realizedEdgePct) || 0));
    return {
        last10WinRate: Number(((achievedCount / rows.length) * 100).toFixed(2)),
        avgRealizedEdgePct: Number(avgRealized.toFixed(2)),
        sampleSize: rows.length
    };
}

function buildCryptoSessionPayload(symbol, quoteRow, predictionPayload, history7dPayload, history24hPayload, stale = false, staleReason = null) {
    const currentSession = computeCryptoCurrentSession();
    const prediction = predictionPayload?.prediction || {};
    const basePrediction = {
        pUp: Number(prediction.p_up ?? 0.5),
        confidence: Number(prediction.confidence ?? 0.5),
        q10: Number(prediction.magnitude?.q10 ?? -0.01),
        q50: Number(prediction.magnitude?.q50 ?? 0),
        q90: Number(prediction.magnitude?.q90 ?? 0.01)
    };
    const history7dSeries = Array.isArray(history7dPayload?.series) ? history7dPayload.series : [];
    const history24hSeries = Array.isArray(history24hPayload?.series) ? history24hPayload.series : [];
    const buckets = buildSessionBuckets(history7dSeries);
    const changePct = Number.isFinite(quoteRow?.change) ? quoteRow.change : 0;

    const sessions = CRYPTO_SESSION_ORDER.map((code) => buildSessionStat(code, buckets[code], basePrediction, changePct, currentSession.minuteOfDay));
    const activeSession = sessions.find((row) => row.code === currentSession.code) || sessions[0];
    const nextSessionCode = currentSession.code === 'asia'
        ? 'europe'
        : currentSession.code === 'europe'
            ? 'us'
            : 'asia';
    const nextSession = sessions.find((row) => row.code === nextSessionCode) || sessions[0];
    const sessionPolicyPacket = predictionPayload?.policyPacket || null;
    const sessionPacketGates = Array.isArray(sessionPolicyPacket?.gates) ? sessionPolicyPacket.gates : [];
    const sessionPacketReasons = Array.isArray(sessionPolicyPacket?.reasons) ? sessionPolicyPacket.reasons : [];
    const sessionBlockingGates = [];
    if (sessionPolicyPacket) {
        if (!sessionPacketGates.includes('cost_ok') || Number(sessionPolicyPacket.expectedNetEdgePct) <= 0) {
            sessionBlockingGates.push('net_edge');
        }
        if (!sessionPacketGates.includes('confidence_ok')) sessionBlockingGates.push('confidence');
        if (!sessionPacketGates.includes('regime_ok')) sessionBlockingGates.push('regime');
        if (!sessionPacketGates.includes('liquidity_ok')) sessionBlockingGates.push('liquidity');
        if ((sessionPolicyPacket.action === 'WAIT' || sessionPolicyPacket.action === 'FLAT') && Number(sessionPolicyPacket.expectedNetEdgePct) > 0) {
            sessionBlockingGates.push('policy_threshold');
        }
    }
    const costPct = Number(sessionPolicyPacket?.costPct ?? clamp(activeSession.volatilityPct * 0.16, 0.18, 1.5).toFixed(2));
    const grossReturnPct = Number((basePrediction.q50 * 100).toFixed(2));
    const action = String(predictionPayload?.signal?.action || derivePolicySignal(sessionPolicyPacket?.action) || prediction.signal || 'FLAT').toUpperCase();
    const actionable = action.includes('LONG') || action.includes('SHORT');
    const referencePrice = Number(Number(quoteRow.price).toFixed(4));

    const decision = {
        action,
        confidence: Number(basePrediction.confidence.toFixed(4)),
        actionable,
        presentation: actionable ? 'TRADE' : 'NO_TRADE',
        entry: referencePrice,
        referencePrice,
        longTriggerPUp: 0.55,
        shortTriggerPUp: 0.45,
        stopLoss: actionable ? Number(Number(predictionPayload?.signal?.stop_loss ?? sessionPolicyPacket?.stopLoss ?? quoteRow.price).toFixed(4)) : null,
        takeProfit1: actionable ? Number(Number(predictionPayload?.signal?.take_profit_1 ?? sessionPolicyPacket?.takeProfit1 ?? quoteRow.price).toFixed(4)) : null,
        takeProfit2: actionable ? Number(Number(predictionPayload?.signal?.take_profit_2 ?? sessionPolicyPacket?.takeProfit2 ?? quoteRow.price).toFixed(4)) : null,
        grossReturnPct,
        costPct,
        netEdgePct: Number(sessionPolicyPacket?.expectedNetEdgePct ?? (grossReturnPct - costPct).toFixed(2)),
        riskLevel: activeSession.riskLevel,
        rr1: actionable ? Number(predictionPayload?.signal?.rr_1 ?? sessionPolicyPacket?.rewardRisk1 ?? 0) : null,
        rr2: actionable ? Number(predictionPayload?.signal?.rr_2 ?? sessionPolicyPacket?.rewardRisk2 ?? 0) : null,
        regime: sessionPolicyPacket?.regime || null,
        tradeQualityScore: Number(sessionPolicyPacket?.tradeQualityScore ?? 0),
        tradeQualityBand: sessionPolicyPacket?.tradeQualityBand || null,
        previewPlan: sessionPolicyPacket?.previewPlan || null,
        passedGates: sessionPacketGates,
        blockingGates: sessionBlockingGates,
        engineVersion: sessionPolicyPacket?.engineVersion || null,
        reason: sessionPacketReasons.join(' ') || predictionPayload?.explanation?.summary || 'Generated from live model session engine.'
    };

    const tradeLog = buildSessionTradeLog(sessions);
    const tradeStats = buildSessionTradeStats(tradeLog);
    const payload = {
        meta: {
            source: 'model_session_engine',
            timestamp: new Date().toISOString(),
            stale: Boolean(stale),
            symbol,
            mode: stale ? 'stale' : 'live_model',
            refreshSec: CRYPTO_SESSION_REFRESH_SEC
        },
        currentSession: {
            code: currentSession.code,
            label: currentSession.label,
            hoursBjt: currentSession.hoursBjt,
            remainingSec: currentSession.remainingSec,
            elapsedRatio: Number(currentSession.elapsedRatio.toFixed(4)),
            transitionSoon: currentSession.transitionSoon,
            transitionText: currentSession.transitionText,
            nextSessionCode,
            nextSessionLabel: CRYPTO_SESSION_META[nextSessionCode].label,
            nextSessionStartsInSec: currentSession.remainingSec,
            nextSessionPreviewPUp: Number.isFinite(nextSession?.pUp) ? Number(nextSession.pUp.toFixed(4)) : null
        },
        currentPrice: {
            symbol,
            price: Number(Number(quoteRow.price).toFixed(4)),
            changePct: Number((Number(quoteRow.change || 0) / 100).toFixed(6)),
            volume: Number.isFinite(quoteRow.volume) ? quoteRow.volume : null
        },
        sessions,
        decision,
        policyPacket: sessionPolicyPacket,
        decisionByLeverage: buildDecisionByLeverage(decision),
        hourly: buildHourlyRows(
            symbol,
            history7dSeries,
            history24hSeries,
            sessions,
            predictionPayload,
            Number(quoteRow.price)
        ),
        tradeLog,
        tradeStats,
        health: predictionPayload?.health || null
    };

    if (staleReason) payload.meta.stale_reason = staleReason;
    return payload;
}

async function getCryptoSessionPayloadWithCache(symbol) {
    const cacheEntry = cryptoSessionCache.get(symbol);
    const now = Date.now();
    if (cacheEntry && now - cacheEntry.at <= CRYPTO_SESSION_CACHE_TTL_MS) {
        return deepCopy(cacheEntry.payload);
    }

    try {
        const pricePayload = await getCryptoPricesWithCache();
        const quote = getCryptoRowBySymbol(pricePayload, symbol);
        if (!quote) {
            throw new Error(`Quote unavailable for ${symbol}`);
        }
        const stale = Boolean(pricePayload?.meta?.stale);
        const staleReason = pricePayload?.meta?.stale_reason || null;
        const predictionPayload = buildCryptoPredictionPayload(symbol, quote, stale, staleReason);
        const [history7dPayload, history24hPayload] = await Promise.all([
            getCryptoHistoryWithCache(symbol, '7d'),
            getCryptoHistoryWithCache(symbol, '24h')
        ]);
        const payload = buildCryptoSessionPayload(
            symbol,
            quote,
            predictionPayload,
            history7dPayload,
            history24hPayload,
            stale || Boolean(history7dPayload?.meta?.stale) || Boolean(history24hPayload?.meta?.stale),
            staleReason || history7dPayload?.meta?.stale_reason || history24hPayload?.meta?.stale_reason || null
        );
        cryptoSessionCache.set(symbol, { payload, at: Date.now() });
        return deepCopy(payload);
    } catch (error) {
        if (cacheEntry) {
            const stalePayload = deepCopy(cacheEntry.payload);
            stalePayload.meta = {
                ...stalePayload.meta,
                stale: true,
                stale_reason: error.message,
                timestamp: new Date().toISOString()
            };
            return stalePayload;
        }
        throw error;
    }
}

function fetchTextFromHttps(url, timeoutMs = 5000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                method: 'GET',
                timeout: timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Accept: 'text/plain,text/csv,*/*'
                }
            },
            (upstream) => {
                let body = '';
                upstream.on('data', (chunk) => { body += chunk.toString('utf8'); });
                upstream.on('end', () => {
                    const statusCode = upstream.statusCode || 500;
                    if (statusCode >= 300 && statusCode <= 399 && upstream.headers.location) {
                        if (redirectCount >= 5) {
                            reject(new Error(`Too many upstream redirects from ${url}`));
                            return;
                        }
                        const nextUrl = new URL(upstream.headers.location, url).toString();
                        fetchTextFromHttps(nextUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
                        return;
                    }
                    if (statusCode < 200 || statusCode > 299) {
                        reject(new Error(`Upstream status ${upstream.statusCode}`));
                        return;
                    }
                    resolve(body);
                });
            }
        );

        request.on('timeout', () => request.destroy(new Error('Upstream timeout')));
        request.on('error', reject);
        request.end();
    });
}

function buildStooqBatchUrl(symbols) {
    const symbolPart = symbols.map((symbol) => encodeURIComponent(symbol)).join('+');
    return `${STOOQ_BATCH_BASE}${symbolPart}`;
}

function stooqSymbolToYahooSymbol(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (normalized === '^SPX') return '^GSPC';
    if (normalized.endsWith('.US')) {
        return normalized.replace(/\.US$/, '').replace(/\./g, '-');
    }
    return normalized;
}

function yahooSymbolToStooqSymbol(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (normalized === '^GSPC') return '^SPX';
    if (normalized.startsWith('^')) return normalized;
    return `${normalized}.US`;
}

function buildYahooSparkUrl(symbols, range = US_YAHOO_SPARK_RANGE, interval = US_YAHOO_SPARK_INTERVAL) {
    const symbolPart = symbols.map((symbol) => encodeURIComponent(symbol)).join(',');
    const rangePart = encodeURIComponent(range);
    const intervalPart = encodeURIComponent(interval);
    return `${YAHOO_SPARK_BASE}?symbols=${symbolPart}&range=${rangePart}&interval=${intervalPart}`;
}

function isStooqRateLimitText(payloadText) {
    const text = String(payloadText || '');
    return /daily hits limit/i.test(text) || /too many requests/i.test(text);
}

function parseStooqCsvRows(csvText) {
    const payloadText = String(csvText || '').trim();
    if (!payloadText) {
        throw new Error('Empty Stooq response');
    }
    if (isStooqRateLimitText(payloadText)) {
        throw new Error('Stooq daily hits limit exceeded');
    }
    const lines = payloadText.split(/\r?\n/);
    const header = String(lines[0] || '').replace(/^\uFEFF/, '').trim().toLowerCase();
    if (header !== 'symbol,date,time,open,high,low,close,volume') {
        throw new Error(`Unexpected Stooq CSV header: ${header || '<empty>'}`);
    }
    if (lines.length <= 1) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) continue;
        const cells = line.split(',');
        if (cells.length < 8) continue;
        const symbol = String(cells[0] || '').trim().toUpperCase();
        const date = String(cells[1] || '').trim();
        const time = String(cells[2] || '').trim();
        const open = parseNumber(cells[3]);
        const high = parseNumber(cells[4]);
        const low = parseNumber(cells[5]);
        const close = parseNumber(cells[6]);
        const volume = parseNumber(cells[7]);
        const changePct = Number.isFinite(open) && Number.isFinite(close) && open !== 0
            ? Number((((close - open) / open) * 100).toFixed(4))
            : null;
        rows.push({
            symbol,
            date,
            time,
            open,
            high,
            low,
            price: close,
            volume,
            changePct
        });
    }
    return rows;
}

async function fetchStooqQuotes(sourceSymbols) {
    const CHUNK_SIZE = 40;
    const bySymbol = new Map();
    let totalRows = 0;
    for (let i = 0; i < sourceSymbols.length; i += CHUNK_SIZE) {
        const chunk = sourceSymbols.slice(i, i + CHUNK_SIZE);
        const csvText = await fetchTextFromHttps(buildStooqBatchUrl(chunk), 9000);
        const rows = parseStooqCsvRows(csvText);
        totalRows += rows.length;
        rows.forEach((row) => bySymbol.set(row.symbol, row));
    }
    if (totalRows === 0) {
        throw new Error('Stooq returned zero quote rows');
    }
    return bySymbol;
}

function firstFiniteNumber(values) {
    if (!Array.isArray(values)) return null;
    for (const value of values) {
        const parsed = parseNumber(value);
        if (parsed !== null) return parsed;
    }
    return null;
}

function lastFiniteNumber(values) {
    if (!Array.isArray(values)) return null;
    for (let i = values.length - 1; i >= 0; i -= 1) {
        const parsed = parseNumber(values[i]);
        if (parsed !== null) return parsed;
    }
    return null;
}

function minFiniteNumber(values) {
    if (!Array.isArray(values)) return null;
    const finite = values.map((value) => parseNumber(value)).filter((value) => value !== null);
    if (!finite.length) return null;
    return Math.min(...finite);
}

function maxFiniteNumber(values) {
    if (!Array.isArray(values)) return null;
    const finite = values.map((value) => parseNumber(value)).filter((value) => value !== null);
    if (!finite.length) return null;
    return Math.max(...finite);
}

function formatEpochToEtDateTime(epochSeconds) {
    if (!Number.isFinite(epochSeconds)) {
        return { date: null, time: null };
    }
    const dt = new Date(epochSeconds * 1000);
    if (!Number.isFinite(dt.getTime())) {
        return { date: null, time: null };
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: US_SESSION_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(dt);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!map.year || !map.month || !map.day) {
        return { date: null, time: null };
    }
    return {
        date: `${map.year}-${map.month}-${map.day}`,
        time: map.hour && map.minute && map.second ? `${map.hour}:${map.minute}:${map.second}` : null
    };
}

function parseYahooSparkQuoteRow(entry) {
    const yahooSymbol = String(entry?.symbol || '').trim().toUpperCase();
    if (!yahooSymbol) return null;
    const stooqSymbol = yahooSymbolToStooqSymbol(yahooSymbol);
    const response = Array.isArray(entry?.response) ? entry.response[0] : null;
    const meta = response?.meta || {};
    const closes = response?.indicators?.quote?.[0]?.close || [];
    const firstClose = firstFiniteNumber(closes);
    const lastClose = lastFiniteNumber(closes);
    const price = parseNumber(meta.regularMarketPrice) ?? lastClose;
    if (price === null) return null;
    const high = parseNumber(meta.regularMarketDayHigh) ?? maxFiniteNumber(closes);
    const low = parseNumber(meta.regularMarketDayLow) ?? minFiniteNumber(closes);
    const open = firstClose ?? parseNumber(meta.chartPreviousClose) ?? parseNumber(meta.previousClose);
    const volume = parseNumber(meta.regularMarketVolume);
    const previousClose = parseNumber(meta.previousClose) ?? parseNumber(meta.chartPreviousClose);
    const changePct = previousClose !== null && previousClose !== 0
        ? Number((((price - previousClose) / previousClose) * 100).toFixed(4))
        : null;
    const marketTime = parseNumber(meta.regularMarketTime);
    const dateTime = formatEpochToEtDateTime(marketTime);
    return {
        symbol: stooqSymbol,
        date: dateTime.date,
        time: dateTime.time,
        open,
        high,
        low,
        price,
        volume,
        changePct
    };
}

async function fetchYahooSparkQuotes(stooqSymbols, range = US_YAHOO_SPARK_RANGE, interval = US_YAHOO_SPARK_INTERVAL) {
    const bySymbol = new Map();
    const yahooSymbols = Array.from(new Set(stooqSymbols.map((symbol) => stooqSymbolToYahooSymbol(symbol)).filter(Boolean)));
    const chunkSize = clamp(US_YAHOO_SPARK_CHUNK_SIZE, 1, 20);
    for (let i = 0; i < yahooSymbols.length; i += chunkSize) {
        const chunk = yahooSymbols.slice(i, i + chunkSize);
        const payload = await fetchJsonFromHttps(buildYahooSparkUrl(chunk, range, interval), 9000);
        if (payload?.spark?.error) {
            throw new Error(`Yahoo Spark error: ${payload.spark.error}`);
        }
        const results = payload?.spark?.result;
        if (!Array.isArray(results)) {
            throw new Error('Unexpected Yahoo Spark payload');
        }
        for (const entry of results) {
            const parsed = parseYahooSparkQuoteRow(entry);
            if (!parsed || !parsed.symbol) continue;
            bySymbol.set(parsed.symbol, parsed);
        }
    }
    return bySymbol;
}

function parseAlphaGlobalQuote(payload) {
    const row = payload?.['Global Quote'];
    if (!row || typeof row !== 'object') return null;
    const price = parseNumber(row['05. price']);
    if (price === null) return null;
    const open = parseNumber(row['02. open']);
    const high = parseNumber(row['03. high']);
    const low = parseNumber(row['04. low']);
    const volume = parseNumber(row['06. volume']);
    const changePctRaw = String(row['10. change percent'] || '').replace('%', '').trim();
    const changePct = parseNumber(changePctRaw);
    return {
        symbol: String(row['01. symbol'] || '').toUpperCase(),
        open,
        high,
        low,
        price,
        volume,
        changePct
    };
}

async function fetchAlphaGlobalQuote(symbol) {
    if (!ALPHA_VANTAGE_API_KEY || !US_ENABLE_ALPHA_FALLBACK) return null;
    const endpoint = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(ALPHA_VANTAGE_API_KEY)}`;
    const payload = await fetchJsonFromHttps(endpoint, 9000);
    return parseAlphaGlobalQuote(payload);
}

async function fetchAlphaIndexQuote(indexSymbol) {
    if (!ALPHA_VANTAGE_API_KEY || !US_ENABLE_ALPHA_FALLBACK) return null;
    const probesByIndex = {
        '^DJI': ['^DJI', 'DJI'],
        '^NDX': ['^NDX', 'NDX'],
        '^SPX': ['^SPX', 'SPX', '^GSPC', 'GSPC']
    };
    const probes = probesByIndex[indexSymbol] || [indexSymbol];
    for (const probe of probes) {
        try {
            const quote = await fetchAlphaGlobalQuote(probe);
            if (quote && quote.price !== null) return quote;
        } catch (error) {
            // Continue probing aliases.
        }
    }
    return null;
}

function loadCsi300Snapshot() {
    if (!fs.existsSync(CSI300_SNAPSHOT_PATH)) {
        throw new Error(`Missing CSI300 snapshot file: ${CSI300_SNAPSHOT_PATH}`);
    }

    let parsed;
    try {
        const raw = fs.readFileSync(CSI300_SNAPSHOT_PATH, 'utf8').replace(/^\uFEFF/, '');
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to parse CSI300 snapshot: ${error.message}`);
    }

    if (!Array.isArray(parsed.constituents)) {
        throw new Error('Invalid CSI300 snapshot format: constituents must be an array');
    }

    if (parsed.constituents.length !== 300) {
        throw new Error(`Invalid CSI300 snapshot size: expected 300, got ${parsed.constituents.length}`);
    }

    const seenSecids = new Set();
    return parsed.constituents.map((row, index) => {
        const code = String(row.code || '').trim();
        const name = String(row.name || '').trim();
        const market = String(row.market || '').toUpperCase();
        const secid = String(row.secid || '').trim();
        const expectedSecid = `${market === 'SH' ? 1 : 0}.${code}`;

        if (!/^\d{6}$/.test(code)) {
            throw new Error(`Invalid code at row ${index + 1}: ${code}`);
        }
        if (market !== 'SH' && market !== 'SZ') {
            throw new Error(`Invalid market at row ${index + 1}: ${market}`);
        }
        if (secid !== expectedSecid) {
            throw new Error(`Invalid secid at row ${index + 1}: ${secid}, expected ${expectedSecid}`);
        }
        if (seenSecids.has(secid)) {
            throw new Error(`Duplicate secid at row ${index + 1}: ${secid}`);
        }
        seenSecids.add(secid);

        return { code, name, market, secid };
    });
}

function normalizeUsSourceSymbol(symbol) {
    return `${String(symbol || '').trim().toUpperCase().replace(/\./g, '-')}.US`;
}

function normalizeUsSymbol(rawSymbol) {
    return String(rawSymbol || '')
        .trim()
        .toUpperCase()
        .replace(/\.US$/, '')
        .replace(/-/g, '.');
}

function loadSp500Snapshot() {
    if (!fs.existsSync(SP500_SNAPSHOT_PATH)) {
        throw new Error(`Missing S&P 500 snapshot file: ${SP500_SNAPSHOT_PATH}`);
    }

    let parsed;
    try {
        const raw = fs.readFileSync(SP500_SNAPSHOT_PATH, 'utf8').replace(/^\uFEFF/, '');
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to parse S&P 500 snapshot: ${error.message}`);
    }

    if (!Array.isArray(parsed.constituents)) {
        throw new Error('Invalid S&P 500 snapshot format: constituents must be an array');
    }
    if (parsed.constituents.length !== 500) {
        throw new Error(`Invalid S&P 500 snapshot size: expected 500, got ${parsed.constituents.length}`);
    }

    const seen = new Set();
    return parsed.constituents.map((row, index) => {
        const symbol = normalizeUsSymbol(row.symbol);
        const name = String(row.name || '').trim();
        const sector = String(row.sector || '').trim() || 'Other';
        const sourceSymbol = String(row.sourceSymbol || normalizeUsSourceSymbol(symbol)).trim().toUpperCase();

        if (!symbol || !/^[A-Z0-9.]+$/.test(symbol)) {
            throw new Error(`Invalid symbol at row ${index + 1}: ${row.symbol}`);
        }
        if (!name) {
            throw new Error(`Missing security name at row ${index + 1}`);
        }
        if (!sourceSymbol.endsWith('.US')) {
            throw new Error(`Invalid sourceSymbol at row ${index + 1}: ${sourceSymbol}`);
        }
        if (seen.has(symbol)) {
            throw new Error(`Duplicate symbol at row ${index + 1}: ${symbol}`);
        }
        seen.add(symbol);

        return { symbol, name, sector, sourceSymbol };
    });
}

const csi300Snapshot = loadCsi300Snapshot();
const csi300ByCode = new Map(csi300Snapshot.map((row) => [row.code, row]));
const csi300Secids = csi300Snapshot.map((row) => row.secid);
const sp500Snapshot = loadSp500Snapshot();
const sp500BySymbol = new Map(sp500Snapshot.map((row) => [row.symbol, row]));
const sp500SourceSymbols = sp500Snapshot.map((row) => row.sourceSymbol);

async function handleCryptoPrices(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    try {
        const payload = await getCryptoPricesWithCache();
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch crypto prices from Binance US',
            detail: error.message
        });
    }
}

async function handleCryptoUniverse(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    try {
        const payload = await getCryptoUniverseWithCache();
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build crypto top-50 universe',
            detail: error.message
        });
    }
}

async function handleCryptoHistory(req, res, parsedUrl, rawSymbol) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const resolved = await findCryptoUniverseRowBySymbol(rawSymbol);
    if (!resolved) {
        sendJson(res, 404, { error: `Unsupported crypto symbol: ${rawSymbol}` });
        return;
    }
    const symbol = resolved.symbol;

    const range = resolveCryptoHistoryRange(parsedUrl.searchParams.get('range') || '24h');
    if (!range) {
        sendJson(res, 400, { error: 'Invalid range. Allowed values: 1h, 24h, 7d.' });
        return;
    }

    try {
        const payload = await getCryptoHistoryWithCache(symbol, range);
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch crypto history from Binance US',
            detail: error.message
        });
    }
}

async function handleCryptoPrediction(req, res, rawSymbol) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const resolved = await findCryptoUniverseRowBySymbol(rawSymbol);
    if (!resolved) {
        sendJson(res, 404, { error: `Unsupported crypto symbol: ${rawSymbol}` });
        return;
    }
    const symbol = resolved.symbol;
    const universeRow = resolved.row;

    const cacheEntry = cryptoPredictionCache.get(symbol);
    const now = Date.now();
    if (cacheEntry && now - cacheEntry.at <= CRYPTO_CACHE_TTL_MS) {
        sendJson(res, 200, deepCopy(cacheEntry.payload));
        return;
    }

    try {
        let predictionSourceRow = universeRow;
        if (CRYPTO_SUPPORTED_SYMBOLS.has(symbol)) {
            const pricePayload = await getCryptoPricesWithCache();
            const quote = getCryptoRowBySymbol(pricePayload, symbol);
            if (quote) {
                predictionSourceRow = {
                    ...universeRow,
                    price: quote.price,
                    rawChangePct: quote.change,
                    changePct: (quote.change || 0) / 100,
                    meta: {
                        ...(universeRow.meta || {}),
                        totalVolume: quote.volume
                    }
                };
            }
        }
        const payload = buildCryptoPredictionPayloadFromTrackingRow(
            symbol,
            predictionSourceRow,
            Boolean(predictionSourceRow?.stale),
            predictionSourceRow?.staleReason || resolved.payload?.meta?.stale_reason || null
        );
        cryptoPredictionCache.set(symbol, { payload, at: Date.now() });
        sendJson(res, 200, payload);
    } catch (error) {
        if (cacheEntry) {
            const stalePayload = deepCopy(cacheEntry.payload);
            stalePayload.meta = {
                ...stalePayload.meta,
                stale: true,
                stale_reason: error.message,
                timestamp: new Date().toISOString()
            };
            sendJson(res, 200, stalePayload);
            return;
        }
        sendJson(res, 502, {
            error: 'Failed to build crypto prediction',
            detail: error.message
        });
    }
}

async function handleCryptoPerformance(req, res, rawSymbol) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const resolved = await findCryptoUniverseRowBySymbol(rawSymbol);
    if (!resolved) {
        sendJson(res, 404, { error: `Unsupported crypto symbol: ${rawSymbol}` });
        return;
    }
    const symbol = resolved.symbol;
    const universeRow = resolved.row;

    const cacheEntry = cryptoPerformanceCache.get(symbol);
    const now = Date.now();
    if (cacheEntry && now - cacheEntry.at <= CRYPTO_CACHE_TTL_MS) {
        sendJson(res, 200, deepCopy(cacheEntry.payload));
        return;
    }

    try {
        let predictionSourceRow = universeRow;
        if (CRYPTO_SUPPORTED_SYMBOLS.has(symbol)) {
            const pricePayload = await getCryptoPricesWithCache();
            const quote = getCryptoRowBySymbol(pricePayload, symbol);
            if (quote) {
                predictionSourceRow = {
                    ...universeRow,
                    price: quote.price,
                    rawChangePct: quote.change,
                    changePct: (quote.change || 0) / 100,
                    meta: {
                        ...(universeRow.meta || {}),
                        totalVolume: quote.volume
                    }
                };
            }
        }
        const predictionPayload = buildCryptoPredictionPayloadFromTrackingRow(
            symbol,
            predictionSourceRow,
            Boolean(predictionSourceRow?.stale),
            predictionSourceRow?.staleReason || resolved.payload?.meta?.stale_reason || null
        );
        const payload = buildCryptoPerformancePayload(
            symbol,
            predictionPayload,
            Boolean(predictionSourceRow?.stale),
            predictionSourceRow?.staleReason || resolved.payload?.meta?.stale_reason || null
        );
        cryptoPerformanceCache.set(symbol, { payload, at: Date.now() });
        sendJson(res, 200, payload);
    } catch (error) {
        if (cacheEntry) {
            const stalePayload = deepCopy(cacheEntry.payload);
            stalePayload.meta = {
                ...stalePayload.meta,
                stale: true,
                stale_reason: error.message,
                timestamp: new Date().toISOString()
            };
            sendJson(res, 200, stalePayload);
            return;
        }
        sendJson(res, 502, {
            error: 'Failed to build crypto performance metrics',
            detail: error.message
        });
    }
}

async function handleCryptoSessionForecast(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const requested = parsedUrl.searchParams.get('symbol') || 'BTCUSDT';
    const symbol = resolveCryptoSessionSymbol(requested);
    if (!symbol) {
        sendJson(res, 404, { error: `Unsupported crypto symbol: ${requested}` });
        return;
    }

    try {
        const payload = await getCryptoSessionPayloadWithCache(symbol);
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build crypto session forecast',
            detail: error.message
        });
    }
}

function buildEastMoneyUListUrl(secids) {
    const secidsParam = encodeURIComponent(secids.join(','));
    return `${EASTMONEY_ULIST_BASE}?fltt=2&invt=2&fields=${EASTMONEY_ULIST_FIELDS}&secids=${secidsParam}`;
}

async function fetchEastMoneyQuotesForChunk(secids) {
    const payload = await fetchJsonFromHttps(buildEastMoneyUListUrl(secids), 9000);
    const diff = payload?.data?.diff;
    if (!Array.isArray(diff)) {
        throw new Error('Unexpected EastMoney quote payload');
    }
    return diff;
}

function isRetryableCnQuoteError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('socket hang up')
        || message.includes('timeout')
        || message.includes('econnreset')
        || message.includes('upstream status 5')
        || message.includes('temporary')
    );
}

async function fetchEastMoneyQuotesForChunkWithRetry(secids) {
    let lastError = null;
    for (let attempt = 0; attempt <= CN_QUOTE_RETRY_LIMIT; attempt += 1) {
        try {
            return await fetchEastMoneyQuotesForChunk(secids);
        } catch (error) {
            lastError = error;
            const canRetry = attempt < CN_QUOTE_RETRY_LIMIT && isRetryableCnQuoteError(error);
            if (!canRetry) {
                throw error;
            }
            await sleep(CN_QUOTE_RETRY_DELAY_MS * (attempt + 1));
        }
    }
    throw lastError || new Error('Failed to fetch EastMoney quote chunk');
}

async function fetchEastMoneyQuotes(secids) {
    const CHUNK_SIZE = CN_QUOTE_CHUNK_SIZE;
    const chunks = [];
    for (let i = 0; i < secids.length; i += CHUNK_SIZE) {
        chunks.push({
            index: Math.floor(i / CHUNK_SIZE),
            secids: secids.slice(i, i + CHUNK_SIZE)
        });
    }

    const settled = await Promise.all(chunks.map(async (chunkInfo) => {
        try {
            const rows = await fetchEastMoneyQuotesForChunkWithRetry(chunkInfo.secids);
            return { status: 'fulfilled', chunkInfo, rows };
        } catch (error) {
            return { status: 'rejected', chunkInfo, error };
        }
    }));

    const allRows = [];
    const failedChunks = [];
    for (const result of settled) {
        if (result.status === 'fulfilled') {
            allRows.push(...result.rows);
            continue;
        }
        failedChunks.push({
            index: result.chunkInfo.index,
            secids: result.chunkInfo.secids,
            error: result.error.message
        });
    }

    if (!allRows.length) {
        throw new Error(failedChunks[0]?.error || 'No CN quotes available from upstream');
    }

    const bySecid = new Map();
    for (const item of allRows) {
        const code = String(item.f12 || '').padStart(6, '0');
        const marketId = Number(item.f13);
        const secid = `${marketId}.${code}`;
        bySecid.set(secid, {
            code,
            secid,
            market: marketId === 1 ? 'SH' : marketId === 0 ? 'SZ' : '',
            name: String(item.f14 || ''),
            price: parseNumber(item.f2),
            changePct: parseNumber(item.f3),
            changeAmount: parseNumber(item.f4),
            high: parseNumber(item.f15),
            low: parseNumber(item.f16),
            open: parseNumber(item.f17),
            prevClose: parseNumber(item.f18),
            marketCap: parseNumber(item.f20),
            floatMarketCap: parseNumber(item.f21),
            volume: parseNumber(item.f47),
            turnover: parseNumber(item.f48),
            sectorRaw: String(item.f100 || ''),
            conceptTagsRaw: String(item.f103 || ''),
            peTtm: parseNumber(item.f115)
        });
    }
    return {
        quoteMap: bySecid,
        failedChunks,
        totalChunks: chunks.length,
        successfulChunks: chunks.length - failedChunks.length,
        source: 'eastmoney'
    };
}

function toSinaCnSymbol(secid) {
    const [marketIdRaw, codeRaw] = String(secid || '').split('.');
    const marketId = Number(marketIdRaw);
    const code = String(codeRaw || '').padStart(6, '0');
    const prefix = marketId === 1 ? 'sh' : 'sz';
    return `${prefix}${code}`;
}

function buildSinaCnQuotesUrl(symbols) {
    return `${SINA_CN_QUOTES_BASE}${symbols.join(',')}`;
}

function fetchSinaText(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Referer: 'https://finance.sina.com.cn',
                    Accept: '*/*'
                },
                timeout: timeoutMs
            },
            (upstream) => {
                const chunks = [];
                upstream.on('data', (chunk) => { chunks.push(chunk); });
                upstream.on('end', () => {
                    const statusCode = upstream.statusCode || 500;
                    if (statusCode < 200 || statusCode > 299) {
                        reject(new Error(`Upstream status ${statusCode}`));
                        return;
                    }
                    resolve(Buffer.concat(chunks).toString('utf8'));
                });
            }
        );
        request.on('timeout', () => request.destroy(new Error('Upstream timeout')));
        request.on('error', reject);
        request.end();
    });
}

function normalizeSinaCnQuote(symbol, fields) {
    const normalizedSymbol = String(symbol || '').trim().toLowerCase();
    const market = normalizedSymbol.startsWith('sh') ? 'SH' : 'SZ';
    const code = normalizedSymbol.slice(2).padStart(6, '0');
    const secid = `${market === 'SH' ? 1 : 0}.${code}`;
    const open = parseNumber(fields[1]);
    const prevClose = parseNumber(fields[2]);
    const price = parseNumber(fields[3]);
    const high = parseNumber(fields[4]);
    const low = parseNumber(fields[5]);
    const changeAmount = Number.isFinite(price) && Number.isFinite(prevClose) ? roundTrackingNumber(price - prevClose, 4) : null;
    const changePct = Number.isFinite(price) && Number.isFinite(prevClose) && Math.abs(prevClose) > 1e-9
        ? roundTrackingNumber(((price - prevClose) / prevClose) * 100, 4)
        : null;
    return {
        code,
        secid,
        market,
        name: fields[0] || '',
        price,
        changePct,
        changeAmount,
        high,
        low,
        open,
        prevClose,
        marketCap: null,
        floatMarketCap: null,
        volume: parseNumber(fields[8]),
        turnover: parseNumber(fields[9]),
        sectorRaw: '',
        conceptTagsRaw: '',
        peTtm: null
    };
}

function parseSinaCnQuoteResponse(body) {
    const bySecid = new Map();
    const lines = String(body || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/var hq_str_([a-z]{2}\d{6})=\"([^\"]*)\";/i);
        if (!match) continue;
        const fields = match[2].split(',');
        const quote = normalizeSinaCnQuote(match[1], fields);
        bySecid.set(quote.secid, quote);
    }
    return bySecid;
}

async function fetchSinaCnQuotes(secids) {
    const CHUNK_SIZE = SINA_CN_QUOTE_CHUNK_SIZE;
    const chunks = [];
    for (let i = 0; i < secids.length; i += CHUNK_SIZE) {
        chunks.push({
            index: Math.floor(i / CHUNK_SIZE),
            symbols: secids.slice(i, i + CHUNK_SIZE).map((secid) => toSinaCnSymbol(secid))
        });
    }

    const bySecid = new Map();
    const failedChunks = [];
    for (const chunk of chunks) {
        let body = null;
        let lastError = null;
        for (let attempt = 0; attempt <= CN_QUOTE_RETRY_LIMIT; attempt += 1) {
            try {
                body = await fetchSinaText(buildSinaCnQuotesUrl(chunk.symbols), 12000);
                break;
            } catch (error) {
                lastError = error;
                if (attempt >= CN_QUOTE_RETRY_LIMIT) break;
                await sleep(CN_QUOTE_RETRY_DELAY_MS * (attempt + 1));
            }
        }

        if (!body) {
            console.warn(`Sina CN chunk failed idx=${chunk.index} symbols=${chunk.symbols.length} error=${lastError?.message || 'unknown'}`);
            failedChunks.push({
                index: chunk.index,
                secids: chunk.symbols,
                error: lastError?.message || 'Sina CN quote fetch failed'
            });
            continue;
        }

        const chunkMap = parseSinaCnQuoteResponse(body);
        for (const [secid, quote] of chunkMap.entries()) {
            bySecid.set(secid, quote);
        }
    }

    if (!bySecid.size) {
        throw new Error(failedChunks[0]?.error || 'No CN quotes available from Sina');
    }

    return {
        quoteMap: bySecid,
        failedChunks,
        totalChunks: chunks.length,
        successfulChunks: chunks.length - failedChunks.length,
        source: 'sina'
    };
}

function buildEastMoneyKlineUrl(secid, interval) {
    const klt = interval === '5m' ? 5 : 1;
    const fields1 = 'f1,f2,f3,f4,f5,f6';
    const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
    return `${EASTMONEY_KLINE_BASE}?secid=${encodeURIComponent(secid)}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=${fields1}&fields2=${fields2}&klt=${klt}&fqt=1&beg=0&end=20500000`;
}

function parseEastMoneyKlinePoints(payload) {
    const rows = payload?.data?.klines;
    if (!Array.isArray(rows)) {
        throw new Error('Unexpected EastMoney index history payload');
    }
    const points = [];
    for (const row of rows) {
        if (typeof row !== 'string') continue;
        const cells = row.split(',');
        if (cells.length < 3) continue;
        const tsRaw = String(cells[0] || '').trim();
        const close = parseNumber(cells[2]);
        if (!tsRaw || close === null) continue;
        const ts = new Date(`${tsRaw.replace(' ', 'T')}+08:00`);
        if (!Number.isFinite(ts.getTime())) continue;
        const dateKey = ts.toISOString().slice(0, 10);
        points.push({
            ts: ts.toISOString(),
            dateKey,
            price: close
        });
    }
    points.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    return points;
}

function parseCnHistorySymbols(rawSymbols) {
    if (!rawSymbols) return ['sse', 'csi300'];
    const requested = String(rawSymbols)
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    const allowed = requested.filter((item) => item === 'sse' || item === 'csi300');
    return allowed.length ? Array.from(new Set(allowed)) : ['sse', 'csi300'];
}

function parseCnIndicesHistoryQuery(parsedUrl) {
    const sessionCandidate = String(parsedUrl.searchParams.get('session') || 'auto').toLowerCase();
    const session = CN_INDEX_HISTORY_SESSION_ALLOW.has(sessionCandidate) ? sessionCandidate : 'auto';
    const intervalCandidate = String(parsedUrl.searchParams.get('interval') || CN_INDEX_HISTORY_DEFAULT_INTERVAL).toLowerCase();
    const interval = CN_INDEX_HISTORY_INTERVAL_ALLOW.has(intervalCandidate) ? intervalCandidate : CN_INDEX_HISTORY_DEFAULT_INTERVAL;
    const symbols = parseCnHistorySymbols(parsedUrl.searchParams.get('symbols'));
    return { session, interval, symbols };
}

function buildCnRegularSessionWindow(dateKey) {
    const amStart = makeShanghaiDate(dateKey, 9, 30);
    const amEnd = makeShanghaiDate(dateKey, 11, 30);
    const pmStart = makeShanghaiDate(dateKey, 13, 0);
    const pmEnd = makeShanghaiDate(dateKey, 15, 0);
    return {
        dateKey,
        amStart,
        amEnd,
        pmStart,
        pmEnd,
        startIso: amStart.toISOString(),
        endIso: pmEnd.toISOString()
    };
}

function filterCnSeriesByWindow(points, window) {
    if (!Array.isArray(points) || !points.length) return [];
    const amStartMs = window.amStart.getTime();
    const amEndMs = window.amEnd.getTime();
    const pmStartMs = window.pmStart.getTime();
    const pmEndMs = window.pmEnd.getTime();
    return points
        .filter((point) => {
            const ts = Date.parse(point.ts);
            if (!Number.isFinite(ts)) return false;
            const inAm = ts >= amStartMs && ts <= amEndMs;
            const inPm = ts >= pmStartMs && ts <= pmEndMs;
            return inAm || inPm;
        })
        .map((point) => ({
            ts: point.ts,
            price: point.price
        }));
}

function isShanghaiTradingDate(shanghaiNow) {
    return shanghaiNow.weekday !== 'Sat' && shanghaiNow.weekday !== 'Sun';
}

function resolveCnHistoryTarget(querySession, now = new Date()) {
    const shanghai = toShanghaiNow(now);
    const marketSession = computeMarketSession(now);
    const isTradingDay = isShanghaiTradingDate(shanghai);
    const marketClose = makeShanghaiDate(shanghai.dateKey, 15, 0);
    const afterClose = isTradingDay && shanghai.date.getTime() >= marketClose.getTime();

    let selectedType = 'TODAY_REGULAR';
    let targetDateKey = shanghai.dateKey;

    if (querySession === 'today') {
        if (!isTradingDay) {
            selectedType = 'LAST_REGULAR';
            targetDateKey = previousShanghaiTradingDateKey(shanghai.date);
        }
    } else if (querySession === 'last') {
        selectedType = 'LAST_REGULAR';
        targetDateKey = afterClose ? shanghai.dateKey : previousShanghaiTradingDateKey(shanghai.date);
    } else {
        const inRegularSession = ['CONTINUOUS_AM', 'CONTINUOUS_PM', 'CLOSE_AUCTION'].includes(String(marketSession.phaseCode || '').toUpperCase());
        if (inRegularSession) {
            selectedType = 'TODAY_REGULAR';
            targetDateKey = shanghai.dateKey;
        } else {
            selectedType = 'LAST_REGULAR';
            targetDateKey = afterClose ? shanghai.dateKey : previousShanghaiTradingDateKey(shanghai.date);
        }
    }

    const window = buildCnRegularSessionWindow(targetDateKey);
    return { marketSession, selectedType, targetDateKey, window, shanghaiNow: shanghai };
}

function buildCnSessionLabel(selectedType) {
    if (selectedType === 'LAST_REGULAR') return 'Last Regular Session (09:30-15:00 CST)';
    return 'Regular Session (09:30-15:00 CST)';
}

function buildCnOpenClose(seriesPoints, isFinalClose) {
    if (!Array.isArray(seriesPoints) || !seriesPoints.length) {
        return {
            open: null,
            close: null,
            isFinalClose
        };
    }
    return {
        open: Number(seriesPoints[0].price.toFixed(2)),
        close: Number(seriesPoints[seriesPoints.length - 1].price.toFixed(2)),
        isFinalClose
    };
}

async function fetchCnIndicesHistoryPayload(query, preResolved = null) {
    const resolved = preResolved || resolveCnHistoryTarget(query.session, new Date());
    const symbols = Array.isArray(query.symbols) && query.symbols.length ? query.symbols : ['sse', 'csi300'];
    const rawSeries = {};

    await Promise.all(symbols.map(async (symbolKey) => {
        const symbolMeta = CN_INDEX_HISTORY_SYMBOLS[symbolKey];
        if (!symbolMeta) return;
        const payload = await fetchJsonFromHttps(buildEastMoneyKlineUrl(symbolMeta.secid, query.interval), 9000);
        rawSeries[symbolKey] = parseEastMoneyKlinePoints(payload);
    }));

    let selectedType = resolved.selectedType;
    let selectedWindow = resolved.window;
    let series = {};

    const applyWindow = (window) => {
        const nextSeries = {};
        symbols.forEach((symbolKey) => {
            const points = rawSeries[symbolKey] || [];
            nextSeries[symbolKey] = filterCnSeriesByWindow(points, window);
        });
        return nextSeries;
    };

    series = applyWindow(selectedWindow);

    const allEmpty = symbols.every((symbolKey) => !series[symbolKey] || series[symbolKey].length === 0);
    if (selectedType === 'TODAY_REGULAR' && allEmpty) {
        selectedType = 'LAST_REGULAR';
        const fallbackDateKey = previousShanghaiTradingDateKey(makeShanghaiDate(resolved.targetDateKey, 12, 0));
        selectedWindow = buildCnRegularSessionWindow(fallbackDateKey);
        series = applyWindow(selectedWindow);
    }

    const nowMs = resolved.shanghaiNow.date.getTime();
    const isFinalClose = selectedType === 'LAST_REGULAR' || nowMs >= selectedWindow.pmEnd.getTime();
    const openClose = {};
    symbols.forEach((symbolKey) => {
        openClose[symbolKey] = buildCnOpenClose(series[symbolKey] || [], isFinalClose);
    });

    return {
        meta: {
            source: 'eastmoney_trends',
            timestamp: new Date().toISOString(),
            stale: false
        },
        marketSession: {
            phaseCode: resolved.marketSession.phaseCode,
            timezoneLabel: resolved.marketSession.timezoneLabel
        },
        selectedSession: {
            type: selectedType,
            label: buildCnSessionLabel(selectedType),
            startCst: selectedWindow.startIso,
            endCst: selectedWindow.endIso
        },
        series,
        openClose
    };
}

function buildSyntheticCnSeriesFromIndex(indexData, window, interval) {
    const open = parseNumber(indexData?.open);
    const price = parseNumber(indexData?.price);
    const prevClose = parseNumber(indexData?.prevClose);
    const high = parseNumber(indexData?.high);
    const low = parseNumber(indexData?.low);
    const startValue = Number.isFinite(open) ? open : (Number.isFinite(prevClose) ? prevClose : price);
    const endValue = Number.isFinite(price) ? price : (Number.isFinite(open) ? open : prevClose);
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
        return [];
    }

    const stepsPerLeg = interval === '5m' ? 10 : 16;
    const anchors = [
        { ts: window.amStart.getTime(), price: startValue },
        { ts: window.amEnd.getTime(), price: Number.isFinite(low) ? low : ((startValue + endValue) / 2) },
        { ts: window.pmStart.getTime(), price: Number.isFinite(high) ? high : ((startValue + endValue) / 2) },
        { ts: window.pmEnd.getTime(), price: endValue }
    ];

    const points = [];
    for (let segmentIndex = 0; segmentIndex < anchors.length - 1; segmentIndex += 1) {
        const current = anchors[segmentIndex];
        const next = anchors[segmentIndex + 1];
        for (let step = 0; step < stepsPerLeg; step += 1) {
            if (segmentIndex > 0 && step === 0) continue;
            const ratio = step / stepsPerLeg;
            const ts = current.ts + ((next.ts - current.ts) * ratio);
            const pricePoint = current.price + ((next.price - current.price) * ratio);
            points.push({
                ts: new Date(Math.round(ts)).toISOString(),
                price: Number(pricePoint.toFixed(3))
            });
        }
    }
    points.push({
        ts: new Date(window.pmEnd.getTime()).toISOString(),
        price: Number(endValue.toFixed(3))
    });
    return points;
}

function buildCnIndicesHistoryFallbackPayload(query, reason, livePayload = null) {
    const resolved = resolveCnHistoryTarget(query.session, new Date());
    const selectedType = resolved.selectedType;
    const selectedWindow = resolved.window;
    const sourcePayload = livePayload || cnCache || readCnLiveSnapshot();
    if (!sourcePayload?.indices) {
        return null;
    }

    const symbols = Array.isArray(query.symbols) && query.symbols.length ? query.symbols : ['sse', 'csi300'];
    const series = {};
    const openClose = {};
    symbols.forEach((symbolKey) => {
        const symbolMeta = CN_INDEX_HISTORY_SYMBOLS[symbolKey];
        if (!symbolMeta) return;
        const indexData = sourcePayload.indices[symbolKey];
        series[symbolKey] = buildSyntheticCnSeriesFromIndex(indexData, selectedWindow, query.interval);
        openClose[symbolKey] = buildCnOpenClose(series[symbolKey], true);
    });

    const hasSeries = symbols.some((symbolKey) => Array.isArray(series[symbolKey]) && series[symbolKey].length > 0);
    if (!hasSeries) {
        return null;
    }

    return {
        meta: {
            source: 'cn_live_snapshot_synthetic_history',
            timestamp: new Date().toISOString(),
            stale: true,
            staleReason: reason,
            synthesized: true
        },
        marketSession: {
            phaseCode: sourcePayload.marketSession?.phaseCode || resolved.marketSession.phaseCode,
            timezoneLabel: sourcePayload.marketSession?.timezoneLabel || resolved.marketSession.timezoneLabel
        },
        selectedSession: {
            type: selectedType,
            label: buildCnSessionLabel(selectedType),
            startCst: selectedWindow.startIso,
            endCst: selectedWindow.endIso
        },
        series,
        openClose
    };
}

function buildCnIndicesHistoryCacheKey(query) {
    const resolved = resolveCnHistoryTarget(query.session, new Date());
    const symbolsKey = (query.symbols || ['sse', 'csi300']).join(',');
    return `${query.session}|${query.interval}|${symbolsKey}|${resolved.selectedType}|${resolved.targetDateKey}`;
}

async function getCnIndicesHistoryWithCache(query) {
    const now = Date.now();
    const cacheKey = buildCnIndicesHistoryCacheKey(query);
    if (
        cnIndicesHistoryCache &&
        cnIndicesHistoryCacheKey === cacheKey &&
        now - cnIndicesHistoryCacheAt <= CN_INDEX_HISTORY_CACHE_TTL_MS
    ) {
        return deepCopy(cnIndicesHistoryCache);
    }

    try {
        const payload = await fetchCnIndicesHistoryPayload(query);
        cnIndicesHistoryCache = payload;
        cnIndicesHistoryCacheAt = Date.now();
        cnIndicesHistoryCacheKey = cacheKey;
        return deepCopy(payload);
    } catch (error) {
        if (cnIndicesHistoryCache && cnIndicesHistoryCacheKey === cacheKey) {
            const stalePayload = deepCopy(cnIndicesHistoryCache);
            stalePayload.meta.stale = true;
            stalePayload.meta.staleReason = error.message;
            stalePayload.meta.timestamp = new Date().toISOString();
            return stalePayload;
        }
        const fallbackPayload = buildCnIndicesHistoryFallbackPayload(query, error.message);
        if (fallbackPayload) {
            cnIndicesHistoryCache = fallbackPayload;
            cnIndicesHistoryCacheAt = Date.now();
            cnIndicesHistoryCacheKey = cacheKey;
            return deepCopy(fallbackPayload);
        }
        throw error;
    }
}

function calculatePrediction(quote) {
    const changePct = quote.changePct ?? 0;
    const prevClose = quote.prevClose || quote.price || 1;
    const intradayPct = prevClose > 0 && quote.open !== null && quote.price !== null
        ? ((quote.price - quote.open) / prevClose) * 100
        : 0;
    const high = quote.high ?? quote.price ?? prevClose;
    const low = quote.low ?? quote.price ?? prevClose;
    const rangePct = prevClose > 0 ? (high - low) / prevClose : 0;

    const trendComponent = clamp(changePct / 6, -1, 1);
    const intradayComponent = clamp(intradayPct / 4, -1, 1);
    const pUpRaw = 0.5 + trendComponent * 0.22 + intradayComponent * 0.18;
    const pUp = clamp(pUpRaw, 0.05, 0.95);
    const pDown = clamp(1 - pUp, 0.05, 0.95);

    const distance = Math.abs(pUp - 0.5) * 2;
    const rangePenalty = clamp(rangePct / 0.08, 0, 1);
    const confidence = clamp(0.45 + distance * 0.5 - rangePenalty * 0.15, 0.4, 0.98);

    const center = clamp((changePct / 100) * 0.45 + (pUp - 0.5) * 0.08, -0.09, 0.09);
    const spread = clamp(0.012 + rangePct * 0.6 + (1 - confidence) * 0.04, 0.01, 0.08);
    let q10 = clamp(center - spread * 0.9, -0.1, 0.1);
    let q50 = clamp(center, -0.09, 0.09);
    let q90 = clamp(center + spread * 0.9, -0.1, 0.1);
    const sorted = [q10, q50, q90].sort((a, b) => a - b);
    [q10, q50, q90] = sorted;

    const trendBias = clamp((pUp - 0.5) * 2, -1, 1);
    let w1 = clamp(0.24 + 0.18 * trendBias + 0.10 * confidence, 0.05, 0.60);
    let w2 = clamp(0.21 + 0.08 * trendBias + 0.06 * confidence, 0.05, 0.45);
    let w3 = clamp(0.20 - 0.05 * trendBias + 0.05 * (1 - confidence), 0.05, 0.40);
    let w4 = clamp(0.13 - 0.04 * trendBias + 0.06 * (1 - confidence), 0.03, 0.30);
    let w0 = Math.max(0.01, 1 - (w1 + w2 + w3 + w4));
    const total = w0 + w1 + w2 + w3 + w4;
    w0 /= total;
    w1 /= total;
    w2 /= total;
    w3 /= total;
    w4 /= total;

    const windowValues = { W0: w0, W1: w1, W2: w2, W3: w3, W4: w4 };
    const mostLikelyWindow = Object.entries(windowValues).sort((a, b) => b[1] - a[1])[0][0];
    const signal = pUp >= 0.55 ? 'LONG' : 'FLAT';

    return {
        pUp: Number(pUp.toFixed(4)),
        pDown: Number(pDown.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        signal,
        q10: Number(q10.toFixed(4)),
        q50: Number(q50.toFixed(4)),
        q90: Number(q90.toFixed(4)),
        window: {
            W0: Number(w0.toFixed(4)),
            W1: Number(w1.toFixed(4)),
            W2: Number(w2.toFixed(4)),
            W3: Number(w3.toFixed(4)),
            W4: Number(w4.toFixed(4)),
            mostLikely: mostLikelyWindow
        }
    };
}

function calculatePolicy(prediction) {
    const pUp = prediction.pUp;
    const confidence = prediction.confidence;
    const uncertainty = prediction.q90 - prediction.q10;

    let signal = 'FLAT';
    let action = 'Hold';
    if (pUp >= 0.55 && confidence >= 0.85) {
        signal = 'LONG';
        action = 'Buy';
    } else if (pUp >= 0.55) {
        signal = 'LONG';
        action = 'Buy (Reduced Size)';
    } else if (pUp <= 0.45) {
        signal = 'FLAT';
        action = 'Sell Existing Position';
    }

    let sizeMultiplier = 0.9;
    if (uncertainty > 0.05) {
        sizeMultiplier = 0.5;
    } else if (uncertainty > 0.03) {
        sizeMultiplier = 0.7;
    }

    const positionSize = clamp(confidence * sizeMultiplier, 0, 1);
    return {
        signal,
        action,
        shortAllowed: false,
        leverage: 1.0,
        positionSize: Number(positionSize.toFixed(4))
    };
}

function calculateTpSl(entryPrice, prediction, signal) {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return {
            entryPrice: null,
            stopLoss: null,
            stopLossPct: null,
            takeProfit1: null,
            takeProfit1Pct: null,
            takeProfit2: null,
            takeProfit2Pct: null
        };
    }

    const q10 = prediction.q10;
    const q50 = prediction.q50;
    const q90 = prediction.q90;
    let stopLossPct;
    let takeProfit1Pct;
    let takeProfit2Pct;
    if (signal === 'LONG') {
        stopLossPct = Math.max(q10 * 0.8, -0.09);
        takeProfit1Pct = Math.min(q50 * 0.8, 0.09);
        takeProfit2Pct = Math.min(q90 * 0.7, 0.09);
    } else {
        stopLossPct = Math.min(Math.abs(q90) * 0.8, 0.09);
        takeProfit1Pct = Math.max(Math.abs(q50) * 0.8, 0.005);
        takeProfit2Pct = Math.max(Math.abs(q10) * 0.7, 0.008);
    }

    return {
        entryPrice: Number(entryPrice.toFixed(4)),
        stopLoss: Number((entryPrice * (1 + stopLossPct)).toFixed(4)),
        stopLossPct: Number(stopLossPct.toFixed(4)),
        takeProfit1: Number((entryPrice * (1 + takeProfit1Pct)).toFixed(4)),
        takeProfit1Pct: Number(takeProfit1Pct.toFixed(4)),
        takeProfit2: Number((entryPrice * (1 + takeProfit2Pct)).toFixed(4)),
        takeProfit2Pct: Number(takeProfit2Pct.toFixed(4))
    };
}

function asUniverseRow(constituent, quote) {
    const merged = quote || {
        code: constituent.code,
        secid: constituent.secid,
        market: constituent.market,
        name: constituent.name,
        price: null,
        changePct: null,
        changeAmount: null,
        high: null,
        low: null,
        open: null,
        prevClose: null,
        marketCap: null,
        floatMarketCap: null,
        volume: null,
        turnover: null,
        sectorRaw: '',
        conceptTagsRaw: '',
        peTtm: null
    };
    const prediction = calculatePrediction(merged);
    const { policyPacket, policy, tpSl } = buildUnifiedPolicyArtifacts({
        market: 'cn_equity',
        symbol: constituent.code,
        price: merged.price,
        changePct: merged.changePct,
        open: merged.open,
        high: merged.high,
        low: merged.low,
        volume: merged.volume || merged.turnover,
        pUp: prediction.pUp,
        confidence: prediction.confidence,
        q10: prediction.q10,
        q50: prediction.q50,
        q90: prediction.q90,
        forecastTimestamp: new Date().toISOString(),
        inputSource: 'cn-universe-derived'
    });
    const boardType = detectBoardType(constituent.code);
    const isSt = detectStFlag(merged.name || constituent.name);
    const limitPct = resolveLimitPct(boardType, isSt);
    const limitStatus = computeLimitStatus(merged.changePct, limitPct);
    const marginEligible = /\u878d\u8d44\u878d\u5238/.test(merged.conceptTagsRaw || '');
    const sector = translateSectorToEnglish(merged.sectorRaw);
    const totalScore = clamp(
        prediction.pUp * 0.5 + prediction.confidence * 0.3 + clamp(((merged.changePct ?? 0) + 5) / 10, 0, 1) * 0.2,
        0,
        1
    );

    return {
        code: constituent.code,
        name: constituent.name || merged.name || '',
        market: constituent.market,
        secid: constituent.secid,
        price: merged.price,
        changePct: merged.changePct,
        changeAmount: merged.changeAmount,
        open: merged.open,
        high: merged.high,
        low: merged.low,
        prevClose: merged.prevClose,
        sector,
        sectorRaw: merged.sectorRaw || '',
        conceptTagsRaw: merged.conceptTagsRaw || '',
        isSt,
        boardType,
        limitPct,
        limitUpThresholdPct: Number((limitPct * 100 - 0.1).toFixed(2)),
        limitDownThresholdPct: Number((-limitPct * 100 + 0.1).toFixed(2)),
        limitStatus,
        marginEligible,
        shortEligible: false,
        shortReason: CN_POLICY_SHORT_REASON,
        valuation: {
            peTtm: merged.peTtm,
            marketCap: merged.marketCap,
            floatMarketCap: merged.floatMarketCap
        },
        volume: merged.volume,
        turnover: merged.turnover,
        prediction: {
            pUp: prediction.pUp,
            pDown: prediction.pDown,
            confidence: prediction.confidence,
            signal: prediction.signal,
            q10: prediction.q10,
            q50: prediction.q50,
            q90: prediction.q90
        },
        policyPacket,
        policy: {
            ...policy,
            shortAllowed: false,
            leverage: 1.0,
            shortEligible: false,
            marginEligible,
            shortReason: CN_POLICY_SHORT_REASON,
            tPlusOneApplied: true
        },
        tpSl,
        totalScore: Number(totalScore.toFixed(4)),
        status: Number.isFinite(merged.price) ? 'LIVE' : 'ERROR'
    };
}

function normalizeIndex(indexCode, quote) {
    return {
        code: indexCode,
        name: INDEX_NAME_BY_CODE[indexCode],
        price: quote?.price ?? null,
        changePct: quote?.changePct ?? null,
        open: quote?.open ?? null,
        high: quote?.high ?? null,
        low: quote?.low ?? null,
        prevClose: quote?.prevClose ?? null,
        volume: quote?.volume ?? null,
        turnover: quote?.turnover ?? null
    };
}

function markCnPayloadStale(payload, reason) {
    const stalePayload = deepCopy(payload);
    stalePayload.meta = {
        ...stalePayload.meta,
        source: stalePayload.meta?.source || 'eastmoney',
        stale: true,
        staleReason: reason,
        timestamp: new Date().toISOString(),
        pollIntervalSec: stalePayload.meta?.pollIntervalSec || CN_POLL_INTERVAL_SEC,
        delayNote: stalePayload.meta?.delayNote || CN_DELAY_NOTE,
        disclaimer: stalePayload.meta?.disclaimer || CN_DISCLAIMER
    };
    return stalePayload;
}

function buildCnLivePayloadFromQuoteResult(quoteResult, primaryProviderError = null) {
    const quoteMap = quoteResult.quoteMap;
    const source = quoteResult.source || 'eastmoney';
    const delayNote = source === 'sina'
        ? 'Data Source: Sina HQ fallback | Delay: ~3-10s (Level-1)'
        : CN_DELAY_NOTE;
    const sseQuote = quoteMap.get(INDEX_SECIDS['000001.SH']);
    const csiQuote = quoteMap.get(INDEX_SECIDS['000300.SH']);
    if (!sseQuote || !csiQuote) {
        throw new Error('Missing critical CN index quotes from upstream');
    }

    const rows = csi300Snapshot.map((constituent) => asUniverseRow(constituent, quoteMap.get(constituent.secid)));
    const availableConstituents = rows.filter((row) => Number.isFinite(row.price)).length;
    const constituentCoveragePct = csi300Snapshot.length ? (availableConstituents / csi300Snapshot.length) * 100 : 0;
    if (constituentCoveragePct < CN_MIN_CONSTITUENT_COVERAGE_PCT) {
        throw new Error(`CN constituent coverage ${roundTrackingNumber(constituentCoveragePct, 1)}% below minimum ${CN_MIN_CONSTITUENT_COVERAGE_PCT}%`);
    }

    return {
        meta: {
            source,
            primaryProviderError,
            timestamp: new Date().toISOString(),
            stale: false,
            pollIntervalSec: CN_POLL_INTERVAL_SEC,
            delayNote,
            disclaimer: CN_DISCLAIMER,
            coveragePct: roundTrackingNumber(constituentCoveragePct, 1),
            availableConstituents,
            totalConstituents: csi300Snapshot.length,
            failedChunks: quoteResult.failedChunks?.length || 0,
            successfulChunks: quoteResult.successfulChunks ?? 0,
            totalChunks: quoteResult.totalChunks ?? 0
        },
        marketSession: computeMarketSession(),
        indices: {
            sse: normalizeIndex('000001.SH', sseQuote),
            csi300: normalizeIndex('000300.SH', csiQuote)
        },
        universe: {
            total: csi300Snapshot.length,
            rows
        }
    };
}

async function fetchCnLivePayload() {
    const secids = [...Object.values(INDEX_SECIDS), ...csi300Secids];
    try {
        const quoteResult = await fetchSinaCnQuotes(secids);
        return buildCnLivePayloadFromQuoteResult(quoteResult);
    } catch (primaryError) {
        console.warn(`CN live primary provider failed: ${primaryError.message}`);
        try {
            const fallbackResult = await fetchEastMoneyQuotes(secids);
            return buildCnLivePayloadFromQuoteResult(fallbackResult, primaryError.message);
        } catch (fallbackError) {
            console.warn(`CN live fallback provider failed: ${fallbackError.message}`);
            throw fallbackError;
        }
    }
}

async function getCnPayloadWithCache() {
    const now = Date.now();
    if (cnCache && now - cnCacheAt <= CN_CACHE_TTL_MS) {
        return deepCopy(cnCache);
    }
    const snapshot = readCnLiveSnapshot();
    const shouldUseBackoffSnapshot = Boolean(
        snapshot?.universe?.rows?.length
        && cnLastFailureAt
        && (now - cnLastFailureAt) <= CN_FAILURE_BACKOFF_MS
    );
    if (shouldUseBackoffSnapshot) {
        return markCnPayloadStale(snapshot, cnLastFailureReason || `CN live fetch backoff ${CN_FAILURE_BACKOFF_MS}ms`);
    }
    if (cnCachePromise) {
        const payload = await cnCachePromise;
        return deepCopy(payload);
    }

    const inFlight = (async () => {
        try {
            const payload = await withTimeout(
                fetchCnLivePayload(),
                CN_LIVE_FETCH_TIMEOUT_MS,
                `CN live fetch timeout after ${CN_LIVE_FETCH_TIMEOUT_MS}ms`
            );
            cnCache = payload;
            cnCacheAt = Date.now();
            cnLastFailureAt = 0;
            cnLastFailureReason = null;
            writeCnLiveSnapshot(payload);
            return payload;
        } catch (error) {
            cnLastFailureAt = Date.now();
            cnLastFailureReason = error.message;
            if (cnCache) {
                return markCnPayloadStale(cnCache, error.message);
            }
            if (snapshot?.universe?.rows?.length) {
                return markCnPayloadStale(snapshot, error.message);
            }
            throw error;
        }
    })();
    cnCachePromise = inFlight;
    try {
        const payload = await inFlight;
        return deepCopy(payload);
    } finally {
        if (cnCachePromise === inFlight) {
            cnCachePromise = null;
        }
    }
}

function getSortValue(row, sortKey) {
    switch (sortKey) {
    case 'code': return row.code;
    case 'name': return row.name;
    case 'sector': return row.sector;
    case 'limitStatus': return LIMIT_STATUS_ORDER[row.limitStatus] || 0;
    case 'price': return row.price ?? Number.NEGATIVE_INFINITY;
    case 'changePct': return row.changePct ?? Number.NEGATIVE_INFINITY;
    case 'volume': return row.volume ?? Number.NEGATIVE_INFINITY;
    case 'pUp': return row.prediction.pUp;
    case 'totalScore': return row.totalScore;
    default: return row.prediction.pUp;
    }
}

function applyUniverseQuery(rows, search, sort, direction, page, pageSize, limitFilter) {
    const keyword = (search || '').trim().toLowerCase();
    const filteredBySearch = keyword
        ? rows.filter((row) => row.code.includes(keyword) || row.name.toLowerCase().includes(keyword) || row.sector.toLowerCase().includes(keyword))
        : [...rows];

    const normalizedFilter = String(limitFilter || 'all').toLowerCase();
    const filtered = filteredBySearch.filter((row) => {
        if (normalizedFilter === 'limit_up') return row.limitStatus === 'LIMIT_UP';
        if (normalizedFilter === 'limit_down') return row.limitStatus === 'LIMIT_DOWN';
        if (normalizedFilter === 'st') return row.isSt;
        return true;
    });

    const directionFactor = direction === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
        const av = getSortValue(a, sort);
        const bv = getSortValue(b, sort);
        if (typeof av === 'string' && typeof bv === 'string') {
            return av.localeCompare(bv) * directionFactor;
        }
        if (av === bv) return 0;
        return av > bv ? directionFactor : -directionFactor;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = clamp(page, 1, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedRows = filtered.slice(start, start + pageSize);

    return {
        total,
        page: safePage,
        pageSize,
        totalPages,
        rows: pagedRows
    };
}

function parseCnListQuery(parsedUrl) {
    const page = parseInteger(parsedUrl.searchParams.get('page'), 1);
    const pageSize = clamp(parseInteger(parsedUrl.searchParams.get('pageSize'), 50), 10, 100);
    const sort = parsedUrl.searchParams.get('sort') || 'pUp';
    const direction = (parsedUrl.searchParams.get('direction') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const search = parsedUrl.searchParams.get('search') || '';
    const limitFilter = parsedUrl.searchParams.get('limitFilter') || 'all';
    return { page, pageSize, sort, direction, search, limitFilter };
}

function normalizeIndexCode(rawCode) {
    const candidate = String(rawCode || '').trim().toUpperCase();
    if (candidate === '000001.SH' || candidate === '000001' || candidate === 'SSE') return '000001.SH';
    if (candidate === '000300.SH' || candidate === '000300' || candidate === 'CSI300') return '000300.SH';
    return null;
}

async function handleCnPrices(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = parseCnListQuery(parsedUrl);
    try {
        const payload = await getCnPayloadWithCache();
        const universe = applyUniverseQuery(
            payload.universe.rows,
            query.search,
            query.sort,
            query.direction,
            query.page,
            query.pageSize,
            query.limitFilter
        );
        const status = payload.meta.stale ? 'STALE' : 'LIVE';
        universe.rows = universe.rows.map((row) => ({ ...row, status }));

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            indices: payload.indices,
            universe
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch CN equity prices from EastMoney',
            detail: error.message
        });
    }
}

async function handleCnLive(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    try {
        const payload = await getCnPayloadWithCache();
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch CN equity live payload from EastMoney',
            detail: error.message
        });
    }
}

async function handleCnQuotes(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = parseCnListQuery(parsedUrl);
    try {
        const payload = await getCnPayloadWithCache();
        const universe = applyUniverseQuery(
            payload.universe.rows,
            query.search,
            query.sort,
            query.direction,
            query.page,
            query.pageSize,
            query.limitFilter
        );
        const status = payload.meta.stale ? 'STALE' : 'LIVE';
        universe.rows = universe.rows.map((row) => ({ ...row, status }));

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            universe
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch CN equity quotes',
            detail: error.message
        });
    }
}

async function handleCnIndicesHistory(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = parseCnIndicesHistoryQuery(parsedUrl);
    try {
        const payload = await getCnIndicesHistoryWithCache(query);
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch CN index history from EastMoney',
            detail: error.message
        });
    }
}

async function handleCnIndexPrediction(req, res, rawIndexCode) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const indexCode = normalizeIndexCode(rawIndexCode);
    if (!indexCode) {
        sendJson(res, 404, { error: `Unsupported index code: ${rawIndexCode}` });
        return;
    }

    try {
        const payload = await getCnPayloadWithCache();
        const indexData = indexCode === '000001.SH' ? payload.indices.sse : payload.indices.csi300;
        const quoteLike = {
            price: indexData.price,
            changePct: indexData.changePct,
            open: indexData.open,
            high: indexData.high,
            low: indexData.low,
            prevClose: indexData.prevClose
        };
        const prediction = calculatePrediction(quoteLike);
        const { policyPacket, policy, tpSl } = buildUnifiedPolicyArtifacts({
            market: 'cn_equity',
            symbol: indexCode,
            price: indexData.price,
            changePct: indexData.changePct,
            open: indexData.open,
            high: indexData.high,
            low: indexData.low,
            volume: indexData.volume || indexData.turnover,
            pUp: prediction.pUp,
            confidence: prediction.confidence,
            q10: prediction.q10,
            q50: prediction.q50,
            q90: prediction.q90,
            forecastTimestamp: payload.meta?.timestamp || new Date().toISOString(),
            inputSource: 'cn-index-derived'
        });

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            indexCode,
            indexName: INDEX_NAME_BY_CODE[indexCode],
            currentValue: indexData.price,
            prediction: {
                direction: {
                    pUp: prediction.pUp,
                    pDown: prediction.pDown,
                    confidence: prediction.confidence,
                    signal: prediction.signal,
                    horizon: '1d'
                },
                window: prediction.window,
                magnitude: {
                    q10: prediction.q10,
                    q50: prediction.q50,
                    q90: prediction.q90
                }
            },
            policyPacket,
            policy: {
                ...policy,
                shortAllowed: false,
                leverage: 1.0,
                shortEligible: false,
                marginEligible: false,
                shortReason: CN_POLICY_SHORT_REASON,
                tPlusOneApplied: true
            },
            tpSl
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to generate index prediction',
            detail: error.message
        });
    }
}

async function handleCnStock(req, res, rawStockCode) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const stockCode = String(rawStockCode || '').trim().replace(/[^0-9]/g, '').padStart(6, '0');
    if (!/^\d{6}$/.test(stockCode)) {
        sendJson(res, 400, { error: 'Invalid stock code' });
        return;
    }
    const constituent = csi300ByCode.get(stockCode);
    if (!constituent) {
        sendJson(res, 404, { error: `Stock ${stockCode} is not in CSI 300 snapshot` });
        return;
    }

    try {
        const payload = await getCnPayloadWithCache();
        const row = payload.universe.rows.find((item) => item.code === stockCode);
        if (!row) {
            sendJson(res, 404, { error: `Stock ${stockCode} quote unavailable` });
            return;
        }

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            code: row.code,
            name: row.name,
            market: row.market,
            secid: row.secid,
            currentPrice: row.price,
            changePct: row.changePct,
            volume: row.volume,
            turnover: row.turnover,
            sector: row.sector,
            isSt: row.isSt,
            boardType: row.boardType,
            limitPct: row.limitPct,
            limitStatus: row.limitStatus,
            marginEligible: row.marginEligible,
            shortEligible: false,
            shortReason: CN_POLICY_SHORT_REASON,
            valuation: row.valuation,
            prediction: row.prediction,
            policy: row.policy,
            policyPacket: row.policyPacket || null,
            tpSl: row.tpSl || null
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to generate stock prediction',
            detail: error.message
        });
    }
}

async function handleCnPredictionsAlias(req, res, parsedUrl) {
    const code = parsedUrl.searchParams.get('code');
    if (!code) {
        sendJson(res, 400, { error: 'Missing required query param: code' });
        return;
    }
    await handleCnStock(req, res, code);
}

async function handleCnRanking(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const top = clamp(parseInteger(parsedUrl.searchParams.get('top'), 20), 1, 100);
    try {
        const payload = await getCnPayloadWithCache();
        const status = payload.meta.stale ? 'STALE' : 'LIVE';
        const rankings = [...payload.universe.rows]
            .sort((a, b) => b.totalScore - a.totalScore)
            .slice(0, top)
            .map((row, index) => ({
                rank: index + 1,
                code: row.code,
                name: row.name,
                market: row.market,
                price: row.price,
                changePct: row.changePct,
                pUp: row.prediction.pUp,
                confidence: row.prediction.confidence,
                momentum: row.changePct === null ? null : Number((row.changePct / 100).toFixed(4)),
                totalScore: row.totalScore,
                signal: row.prediction.signal,
                status
            }));

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            date: payload.meta.timestamp.slice(0, 10),
            rankings
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to compute CSI300 ranking',
            detail: error.message
        });
    }
}

function normalizeUsIndexSymbol(rawIndexSymbol) {
    const candidate = String(rawIndexSymbol || '').trim().toUpperCase();
    if (!candidate) return null;
    for (const config of Object.values(US_INDEX_SYMBOL_CONFIG)) {
        if (config.aliases.includes(candidate)) return config.symbol;
    }
    return null;
}

function usQuoteFromStooqRow(stooqRow) {
    if (!stooqRow) return null;
    return {
        open: stooqRow.open,
        high: stooqRow.high,
        low: stooqRow.low,
        price: stooqRow.price,
        volume: stooqRow.volume,
        changePct: stooqRow.changePct,
        quoteDate: stooqRow.date || null,
        quoteTime: stooqRow.time || null,
        quoteTimezone: 'ET'
    };
}

function appendProviderSource(baseSource, providerTag) {
    const parts = String(baseSource || '')
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean);
    if (!parts.includes(providerTag)) {
        parts.push(providerTag);
    }
    return parts.join('+');
}

function buildUsCoverageStats(quoteMap, symbols) {
    const total = symbols.length;
    if (!total) {
        return { total: 0, live: 0, pct: 0 };
    }
    let live = 0;
    for (const symbol of symbols) {
        const quote = usQuoteFromStooqRow(quoteMap.get(symbol));
        if (quote && Number.isFinite(quote.price)) {
            live += 1;
        }
    }
    const pct = Number(((live / total) * 100).toFixed(2));
    return { total, live, pct };
}

async function fetchUsQuoteMapWithFallback(symbols, options = {}) {
    const minCoveragePct = Number.isFinite(options.minCoveragePct) ? options.minCoveragePct : US_MIN_LIVE_COVERAGE_PCT;
    const requiredSymbols = Array.isArray(options.requiredSymbols) ? options.requiredSymbols : [];
    let source = 'stooq';
    let providerFallbackUsed = false;
    let quoteMap = new Map();
    let stooqError = null;

    try {
        quoteMap = await fetchStooqQuotes(symbols);
    } catch (error) {
        stooqError = error;
        quoteMap = new Map();
    }

    const stooqCoverage = buildUsCoverageStats(quoteMap, symbols);
    const hasRequired = requiredSymbols.every((symbol) => {
        const quote = usQuoteFromStooqRow(quoteMap.get(symbol));
        return quote && Number.isFinite(quote.price);
    });
    const needFallback = Boolean(stooqError) || !hasRequired || stooqCoverage.pct < minCoveragePct;

    if (needFallback) {
        const missingSymbols = symbols.filter((symbol) => {
            const quote = usQuoteFromStooqRow(quoteMap.get(symbol));
            return !(quote && Number.isFinite(quote.price));
        });
        const fallbackTargets = stooqError ? symbols : (missingSymbols.length ? missingSymbols : symbols);
        try {
            const yahooMap = await fetchYahooSparkQuotes(fallbackTargets, US_YAHOO_SPARK_RANGE, US_YAHOO_SPARK_INTERVAL);
            providerFallbackUsed = true;
            yahooMap.forEach((row, symbol) => {
                const current = usQuoteFromStooqRow(quoteMap.get(symbol));
                if (!current || !Number.isFinite(current.price)) {
                    quoteMap.set(symbol, row);
                }
            });
            source = stooqError ? 'yahoo_spark' : 'stooq+yahoo_spark';
        } catch (yahooError) {
            if (stooqError) {
                throw new Error(`US quote providers failed: stooq=${stooqError.message}; yahoo=${yahooError.message}`);
            }
            source = 'stooq';
        }
    }

    const finalCoverage = buildUsCoverageStats(quoteMap, symbols);
    return {
        quoteMap,
        source,
        providerFallbackUsed,
        liveCoveragePct: finalCoverage.pct,
        liveCount: finalCoverage.live,
        totalCount: finalCoverage.total
    };
}

function calculateUsPrediction(quote) {
    const price = quote?.price ?? null;
    const open = quote?.open ?? price ?? null;
    const high = quote?.high ?? price ?? null;
    const low = quote?.low ?? price ?? null;
    const changePct = quote?.changePct ?? 0;

    const intradayPct = Number.isFinite(price) && Number.isFinite(open) && open !== 0
        ? ((price - open) / open) * 100
        : 0;
    const rangePct = Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(open) && open !== 0
        ? (high - low) / open
        : 0;

    const trendComponent = clamp(changePct / 5, -1, 1);
    const intradayComponent = clamp(intradayPct / 4, -1, 1);
    const pUp = clamp(0.5 + trendComponent * 0.24 + intradayComponent * 0.16, 0.02, 0.98);
    const pDown = clamp(1 - pUp, 0.02, 0.98);

    const distance = Math.abs(pUp - 0.5) * 2;
    const rangePenalty = clamp(rangePct / 0.07, 0, 1);
    const confidence = clamp(0.82 + distance * 0.18 - rangePenalty * 0.10, 0.75, 0.99);

    const center = clamp((changePct / 100) * 0.38 + (pUp - 0.5) * 0.06, -0.11, 0.11);
    const spread = clamp(0.012 + rangePct * 0.55 + (1 - confidence) * 0.05, 0.01, 0.09);
    let q10 = clamp(center - spread * 0.95, -0.15, 0.15);
    let q50 = clamp(center, -0.12, 0.12);
    let q90 = clamp(center + spread * 0.95, -0.15, 0.15);
    [q10, q50, q90] = [q10, q50, q90].sort((a, b) => a - b);

    let signal = 'FLAT';
    if (pUp >= 0.65 && confidence >= 0.95) signal = 'STRONG LONG';
    else if (pUp >= 0.55 && confidence >= 0.90) signal = 'LONG';
    else if (pUp <= 0.35 && confidence >= 0.95) signal = 'STRONG SHORT';
    else if (pUp <= 0.45 && confidence >= 0.90) signal = 'SHORT';

    let w1 = clamp(0.26 + (pUp - 0.5) * 0.35, 0.08, 0.55);
    let w2 = clamp(0.28 + distance * 0.12, 0.10, 0.50);
    let w3 = clamp(0.24 + (0.5 - Math.abs(pUp - 0.5)) * 0.12, 0.08, 0.45);
    let w0 = Math.max(0.02, 1 - (w1 + w2 + w3));
    const total = w0 + w1 + w2 + w3;
    w0 /= total;
    w1 /= total;
    w2 /= total;
    w3 /= total;
    const window = {
        W0: Number(w0.toFixed(4)),
        W1: Number(w1.toFixed(4)),
        W2: Number(w2.toFixed(4)),
        W3: Number(w3.toFixed(4)),
        mostLikely: Object.entries({ W0: w0, W1: w1, W2: w2, W3: w3 }).sort((a, b) => b[1] - a[1])[0][0]
    };

    return {
        pUp: Number(pUp.toFixed(4)),
        pDown: Number(pDown.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        signal,
        q10: Number(q10.toFixed(4)),
        q50: Number(q50.toFixed(4)),
        q90: Number(q90.toFixed(4)),
        window
    };
}

function calculateUsPolicy(prediction) {
    const pUp = prediction.pUp;
    const confidence = prediction.confidence;
    const q10 = prediction.q10;
    const q50 = prediction.q50;

    let signal = 'FLAT';
    let action = 'Hold';
    if (pUp >= 0.65 && confidence >= 0.95) {
        signal = 'STRONG LONG';
        action = 'Buy (aggressive)';
    } else if (pUp >= 0.55 && confidence >= 0.90) {
        signal = 'LONG';
        action = 'Buy';
    } else if (pUp <= 0.35 && confidence >= 0.95) {
        signal = 'STRONG SHORT';
        action = 'Sell short (aggressive)';
    } else if (pUp <= 0.45 && confidence >= 0.90) {
        signal = 'SHORT';
        action = 'Sell short';
    }

    let positionSize = 0;
    if (signal !== 'FLAT') {
        const isLong = signal.includes('LONG');
        const winProb = isLong ? pUp : 1 - pUp;
        const winReturn = Math.max(isLong ? q50 : Math.abs(q10), 0.001);
        const lossReturn = Math.max(isLong ? Math.abs(q10) : q50, 0.001);
        const kelly = (winProb * winReturn - (1 - winProb) * lossReturn) / winReturn;
        const capped = clamp(Math.abs(kelly), 0, US_LIMIT_POSITION);
        positionSize = clamp(capped * confidence, 0, US_LIMIT_POSITION);
    }

    return {
        signal,
        action,
        positionSize: Number(positionSize.toFixed(4)),
        shortAllowed: true,
        leverage: US_MAX_LEVERAGE
    };
}

function calculateUsTpSl(entryPrice, prediction, signal) {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return {
            entryPrice: null,
            stopLoss: null,
            stopLossPct: null,
            takeProfit1: null,
            takeProfit1Pct: null,
            takeProfit2: null,
            takeProfit2Pct: null
        };
    }

    const q10 = prediction.q10;
    const q50 = prediction.q50;
    const q90 = prediction.q90;
    if (signal === 'FLAT') {
        return {
            entryPrice: Number(entryPrice.toFixed(4)),
            stopLoss: null,
            stopLossPct: null,
            takeProfit1: null,
            takeProfit1Pct: null,
            takeProfit2: null,
            takeProfit2Pct: null
        };
    }

    const isLong = signal.includes('LONG');
    const stopLossPct = isLong ? q10 * 0.9 : -q90 * 0.9;
    const takeProfit1Pct = isLong ? q50 * 0.8 : -q10 * 0.8;
    const takeProfit2Pct = isLong ? q90 * 0.7 : -q10 * 1.5;

    return {
        entryPrice: Number(entryPrice.toFixed(4)),
        stopLoss: Number((entryPrice * (1 + stopLossPct)).toFixed(4)),
        stopLossPct: Number(stopLossPct.toFixed(4)),
        takeProfit1: Number((entryPrice * (1 + takeProfit1Pct)).toFixed(4)),
        takeProfit1Pct: Number(takeProfit1Pct.toFixed(4)),
        takeProfit2: Number((entryPrice * (1 + takeProfit2Pct)).toFixed(4)),
        takeProfit2Pct: Number(takeProfit2Pct.toFixed(4))
    };
}

function asUsUniverseRow(constituent, stooqRow, status) {
    const quote = usQuoteFromStooqRow(stooqRow) || {
        open: null, high: null, low: null, price: null, volume: null, changePct: null
    };
    const prediction = calculateUsPrediction(quote);
    const { policyPacket, policy, tpSl } = buildUnifiedPolicyArtifacts({
        market: 'us_equity',
        symbol: constituent.symbol,
        price: quote.price,
        changePct: quote.changePct,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        pUp: prediction.pUp,
        confidence: prediction.confidence,
        q10: prediction.q10,
        q50: prediction.q50,
        q90: prediction.q90,
        forecastTimestamp: new Date().toISOString(),
        inputSource: 'us-universe-derived'
    });
    return {
        symbol: constituent.symbol,
        name: constituent.name,
        sector: constituent.sector,
        sourceSymbol: constituent.sourceSymbol,
        price: quote.price,
        changePct: quote.changePct,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        prediction: {
            pUp: prediction.pUp,
            pDown: prediction.pDown,
            confidence: prediction.confidence,
            signal: prediction.signal,
            q10: prediction.q10,
            q50: prediction.q50,
            q90: prediction.q90,
            window: prediction.window
        },
        policyPacket,
        policy,
        tpSl,
        valuation: {
            marketCap: null,
            peTtm: null
        },
        status: quote.price === null ? 'UNAVAILABLE' : status
    };
}

async function fetchUsLivePayload() {
    const indexSymbols = ['^DJI', '^NDX', '^SPX'];
    const allSymbols = [...new Set([...indexSymbols, ...sp500SourceSymbols])];
    const quoteBundle = await fetchUsQuoteMapWithFallback(allSymbols, {
        minCoveragePct: US_MIN_LIVE_COVERAGE_PCT,
        requiredSymbols: indexSymbols
    });
    const quoteMap = quoteBundle.quoteMap;
    let source = quoteBundle.source;
    let providerFallbackUsed = quoteBundle.providerFallbackUsed;

    const indices = {};
    for (const canonical of indexSymbols) {
        const config = US_INDEX_SYMBOL_CONFIG[canonical];
        const row = quoteMap.get(canonical);
        let quote = usQuoteFromStooqRow(row);
        if ((!quote || quote.price === null) && US_ENABLE_ALPHA_FALLBACK && ALPHA_VANTAGE_API_KEY) {
            const alphaQuote = await fetchAlphaIndexQuote(canonical);
            if (alphaQuote && alphaQuote.price !== null) {
                quote = alphaQuote;
                source = appendProviderSource(source, 'alpha');
                providerFallbackUsed = true;
            }
        }
        indices[canonical] = {
            symbol: canonical,
            name: config.name,
            price: quote?.price ?? null,
            changePct: quote?.changePct ?? null,
            open: quote?.open ?? null,
            high: quote?.high ?? null,
            low: quote?.low ?? null,
            volume: quote?.volume ?? null,
            quoteDate: quote?.quoteDate ?? null,
            quoteTime: quote?.quoteTime ?? null,
            quoteTimezone: quote?.quoteTimezone ?? 'ET'
        };
    }

    const status = 'LIVE';
    const rows = sp500Snapshot.map((constituent) => asUsUniverseRow(constituent, quoteMap.get(constituent.sourceSymbol), status));
    const liveRows = rows.filter((row) => Number.isFinite(row.price)).length;
    const liveCoveragePct = Number(((liveRows / Math.max(1, rows.length)) * 100).toFixed(2));
    if (!Object.values(indices).every((item) => Number.isFinite(item.price))) {
        throw new Error('US index quotes unavailable from upstream providers');
    }
    if (liveRows === 0) {
        throw new Error('US constituent quotes unavailable from upstream providers');
    }
    const marketSession = computeUsMarketSession();

    return {
        meta: {
            source,
            timestamp: new Date().toISOString(),
            stale: false,
            pollIntervalSec: US_POLL_INTERVAL_SEC,
            delayNote: US_DELAY_NOTE,
            disclaimer: US_DISCLAIMER,
            providerFallbackUsed,
            liveCoveragePct
        },
        marketSession,
        indices: {
            dow: indices['^DJI'],
            nasdaq100: indices['^NDX'],
            sp500: indices['^SPX']
        },
        universe: {
            total: sp500Snapshot.length,
            rows
        }
    };
}

async function fetchUsIndicesPayload() {
    const indexSymbols = ['^DJI', '^NDX', '^SPX'];
    const quoteBundle = await fetchUsQuoteMapWithFallback(indexSymbols, {
        minCoveragePct: 100,
        requiredSymbols: indexSymbols
    });
    const quoteMap = quoteBundle.quoteMap;
    let source = quoteBundle.source;
    let providerFallbackUsed = quoteBundle.providerFallbackUsed;

    const indices = {};
    for (const canonical of indexSymbols) {
        const config = US_INDEX_SYMBOL_CONFIG[canonical];
        const row = quoteMap.get(canonical);
        let quote = usQuoteFromStooqRow(row);
        if ((!quote || quote.price === null) && US_ENABLE_ALPHA_FALLBACK && ALPHA_VANTAGE_API_KEY) {
            const alphaQuote = await fetchAlphaIndexQuote(canonical);
            if (alphaQuote && alphaQuote.price !== null) {
                quote = {
                    ...alphaQuote,
                    quoteDate: null,
                    quoteTime: null,
                    quoteTimezone: 'ET'
                };
                source = appendProviderSource(source, 'alpha');
                providerFallbackUsed = true;
            }
        }
        indices[canonical] = {
            symbol: canonical,
            name: config.name,
            price: quote?.price ?? null,
            changePct: quote?.changePct ?? null,
            open: quote?.open ?? null,
            high: quote?.high ?? null,
            low: quote?.low ?? null,
            volume: quote?.volume ?? null,
            quoteDate: quote?.quoteDate ?? null,
            quoteTime: quote?.quoteTime ?? null,
            quoteTimezone: quote?.quoteTimezone ?? 'ET'
        };
    }
    const liveCount = Object.values(indices).filter((item) => Number.isFinite(item.price)).length;
    const liveCoveragePct = Number(((liveCount / indexSymbols.length) * 100).toFixed(2));
    if (liveCount === 0) {
        throw new Error('US index quotes unavailable from upstream providers');
    }

    return {
        meta: {
            source,
            timestamp: new Date().toISOString(),
            stale: false,
            pollIntervalSec: US_INDEX_FAST_POLL_INTERVAL_SEC,
            delayNote: US_DELAY_NOTE,
            disclaimer: US_DISCLAIMER,
            providerFallbackUsed,
            liveCoveragePct
        },
        marketSession: computeUsMarketSession(),
        indices: {
            dow: indices['^DJI'],
            nasdaq100: indices['^NDX'],
            sp500: indices['^SPX']
        }
    };
}

function parseUsIndicesHistoryQuery(parsedUrl) {
    const modeCandidate = String(parsedUrl.searchParams.get('mode') || 'regular_sessions').toLowerCase();
    const mode = US_INDEX_HISTORY_MODE_ALLOW.has(modeCandidate) ? modeCandidate : 'regular_sessions';
    const sessionsRaw = parseInteger(parsedUrl.searchParams.get('sessions'), 1);
    const sessions = clamp(sessionsRaw, 1, 22);
    const rangeParam = parsedUrl.searchParams.get('range');
    const defaultRangeBySessions = sessions >= 5 ? '1mo' : US_INDEX_HISTORY_DEFAULT_RANGE;
    const rangeCandidate = String(rangeParam || defaultRangeBySessions).toLowerCase();
    const intervalCandidate = String(parsedUrl.searchParams.get('interval') || US_INDEX_HISTORY_DEFAULT_INTERVAL).toLowerCase();
    const range = US_HISTORY_RANGE_ALLOW.has(rangeCandidate) ? rangeCandidate : US_INDEX_HISTORY_DEFAULT_RANGE;
    const interval = US_HISTORY_INTERVAL_ALLOW.has(intervalCandidate) ? intervalCandidate : US_INDEX_HISTORY_DEFAULT_INTERVAL;
    return { mode, sessions, range, interval };
}

function buildYahooChartUrl(symbol, range, interval) {
    const encodedSymbol = encodeURIComponent(symbol);
    const encodedRange = encodeURIComponent(range);
    const encodedInterval = encodeURIComponent(interval);
    return `${YAHOO_CHART_BASE}${encodedSymbol}?range=${encodedRange}&interval=${encodedInterval}&includePrePost=true&events=div,split`;
}

function parseYahooIndexHistoryPoints(payload) {
    const result = payload?.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
    const points = [];
    const size = Math.min(timestamps.length, closes.length);
    for (let i = 0; i < size; i += 1) {
        const tsSec = Number(timestamps[i]);
        const price = parseNumber(closes[i]);
        if (!Number.isFinite(tsSec) || price === null) continue;
        points.push({
            ts: new Date(tsSec * 1000).toISOString(),
            price
        });
    }
    points.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    return points;
}

function resolveUsHistorySessionTarget(now = new Date()) {
    const marketSession = computeUsMarketSession(now);
    const ny = toNewYorkNow(now);
    const isTradingDate = isUsTradingDate(ny.dateKey, ny.weekday);
    const premarketStartToday = makeNewYorkDate(ny.dateKey, 4, 0);
    const afterHoursEndToday = makeNewYorkDate(ny.dateKey, 20, 0);

    let selectedType = 'TODAY_REGULAR';
    let targetDateKey = ny.dateKey;

    if (marketSession.phaseCode === 'CLOSED') {
        selectedType = 'LAST_REGULAR';
        const nowMs = ny.date.getTime();
        if (isTradingDate && nowMs >= afterHoursEndToday.getTime()) {
            targetDateKey = ny.dateKey;
        } else if (isTradingDate && nowMs >= premarketStartToday.getTime()) {
            targetDateKey = ny.dateKey;
        } else {
            targetDateKey = previousUsTradingDateKey(ny.date);
        }
    }

    const isEarlyClose = US_EARLY_CLOSE_2026.has(targetDateKey);
    const regularCloseHour = isEarlyClose ? 13 : 16;
    const sessionStart = makeNewYorkDate(targetDateKey, 9, 30);
    const sessionEnd = makeNewYorkDate(targetDateKey, regularCloseHour, 0);

    return {
        marketSession,
        selectedType,
        targetDateKey,
        sessionStart,
        sessionEnd
    };
}

function filterSeriesBySession(points, sessionStart, sessionEnd) {
    if (!Array.isArray(points) || !points.length) return [];
    const startMs = sessionStart.getTime();
    const endMs = sessionEnd.getTime();
    return points.filter((point) => {
        const pointMs = Date.parse(point.ts);
        return Number.isFinite(pointMs) && pointMs >= startMs && pointMs <= endMs;
    });
}

function makeNoonEtDate(dateKey) {
    return makeNewYorkDate(dateKey, 12, 0);
}

function buildRegularSessionWindow(dateKey) {
    const isEarlyClose = US_EARLY_CLOSE_2026.has(dateKey);
    const closeHour = isEarlyClose ? 13 : 16;
    const start = makeNewYorkDate(dateKey, 9, 30);
    const end = makeNewYorkDate(dateKey, closeHour, 0);
    return {
        dateEt: dateKey,
        startEt: start.toISOString(),
        endEt: end.toISOString(),
        isEarlyClose,
        startMs: start.getTime(),
        endMs: end.getTime()
    };
}

function buildRegularSessionWindows(targetDateKey, sessions) {
    const windows = [];
    let cursorDateKey = targetDateKey;
    for (let i = 0; i < sessions; i += 1) {
        windows.push(buildRegularSessionWindow(cursorDateKey));
        const cursorDate = makeNoonEtDate(cursorDateKey);
        cursorDateKey = previousUsTradingDateKey(cursorDate);
    }
    windows.reverse();
    return windows;
}

function filterSeriesBySessionWindows(points, windows) {
    if (!Array.isArray(points) || !points.length || !Array.isArray(windows) || !windows.length) return [];
    return points.filter((point) => {
        const pointMs = Date.parse(point.ts);
        if (!Number.isFinite(pointMs)) return false;
        for (const window of windows) {
            if (pointMs >= window.startMs && pointMs <= window.endMs) {
                return true;
            }
        }
        return false;
    });
}

function formatEtTimeHm(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: US_SESSION_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return formatter.format(date);
}

async function fetchUsIndicesHistoryPayload(query) {
    const mode = query?.mode || 'regular_sessions';
    const sessions = clamp(parseInteger(query?.sessions, 1), 1, 22);
    const range = query?.range || US_INDEX_HISTORY_DEFAULT_RANGE;
    const interval = query?.interval || US_INDEX_HISTORY_DEFAULT_INTERVAL;
    const targets = Object.entries(US_INDEX_HISTORY_SYMBOLS);
    const series = {
        dow: [],
        nasdaq100: [],
        sp500: []
    };
    const [dowPayload, ndxPayload, spxPayload] = await Promise.all(targets.map(([, symbol]) => fetchJsonFromHttps(buildYahooChartUrl(symbol, range, interval), 9000)));
    series.dow = parseYahooIndexHistoryPoints(dowPayload);
    series.nasdaq100 = parseYahooIndexHistoryPoints(ndxPayload);
    series.sp500 = parseYahooIndexHistoryPoints(spxPayload);

    const target = resolveUsHistorySessionTarget();
    let selectedType = target.selectedType;
    let sessionWindows = buildRegularSessionWindows(target.targetDateKey, sessions);

    series.dow = filterSeriesBySessionWindows(series.dow, sessionWindows);
    series.nasdaq100 = filterSeriesBySessionWindows(series.nasdaq100, sessionWindows);
    series.sp500 = filterSeriesBySessionWindows(series.sp500, sessionWindows);

    if (selectedType === 'TODAY_REGULAR' && !series.dow.length && !series.nasdaq100.length && !series.sp500.length) {
        const fallbackDateKey = previousUsTradingDateKey(makeNoonEtDate(target.targetDateKey));
        sessionWindows = buildRegularSessionWindows(fallbackDateKey, sessions);
        series.dow = filterSeriesBySessionWindows(parseYahooIndexHistoryPoints(dowPayload), sessionWindows);
        series.nasdaq100 = filterSeriesBySessionWindows(parseYahooIndexHistoryPoints(ndxPayload), sessionWindows);
        series.sp500 = filterSeriesBySessionWindows(parseYahooIndexHistoryPoints(spxPayload), sessionWindows);
        selectedType = 'LAST_REGULAR';
    }

    const sessionStartIso = sessionWindows[0]?.startEt || null;
    const sessionEndIso = sessionWindows[sessionWindows.length - 1]?.endEt || null;
    const selectedLabel = sessions > 1
        ? `Regular Sessions (last ${sessions})`
        : `${selectedType === 'LAST_REGULAR' ? 'Last Regular Session' : 'Regular Session'} (${formatEtTimeHm(new Date(sessionStartIso))}-${formatEtTimeHm(new Date(sessionEndIso))} ET)`;

    return {
        meta: {
            source: 'yahoo_chart',
            timestamp: new Date().toISOString(),
            stale: false,
            mode,
            sessions,
            range,
            interval
        },
        marketSession: {
            phaseCode: target.marketSession.phaseCode,
            timezoneLabel: target.marketSession.timezoneLabel
        },
        series,
        selectedSession: {
            type: selectedType,
            startEt: sessionStartIso,
            endEt: sessionEndIso,
            label: selectedLabel
        },
        sessionWindows: sessionWindows.map((window) => ({
            dateEt: window.dateEt,
            startEt: window.startEt,
            endEt: window.endEt,
            isEarlyClose: window.isEarlyClose
        }))
    };
}

async function getUsIndicesHistoryWithCache(query) {
    const now = Date.now();
    const mode = query?.mode || 'regular_sessions';
    const sessions = clamp(parseInteger(query?.sessions, 1), 1, 22);
    const range = query?.range || US_INDEX_HISTORY_DEFAULT_RANGE;
    const interval = query?.interval || US_INDEX_HISTORY_DEFAULT_INTERVAL;
    const cacheKey = `${mode}|${sessions}|${range}|${interval}`;
    if (usIndicesHistoryCache && usIndicesHistoryCacheKey === cacheKey && now - usIndicesHistoryCacheAt <= US_INDEX_HISTORY_CACHE_TTL_MS) {
        return deepCopy(usIndicesHistoryCache);
    }

    try {
        const payload = await fetchUsIndicesHistoryPayload({ mode, sessions, range, interval });
        usIndicesHistoryCache = payload;
        usIndicesHistoryCacheAt = Date.now();
        usIndicesHistoryCacheKey = cacheKey;
        return deepCopy(payload);
    } catch (error) {
        if (usIndicesHistoryCache && usIndicesHistoryCacheKey === cacheKey) {
            const stalePayload = deepCopy(usIndicesHistoryCache);
            stalePayload.meta.stale = true;
            stalePayload.meta.staleReason = error.message;
            stalePayload.meta.timestamp = new Date().toISOString();
            return stalePayload;
        }
        throw error;
    }
}

async function getUsPayloadWithCache() {
    const now = Date.now();
    if (usCache && now - usCacheAt <= US_CACHE_TTL_MS) {
        return deepCopy(usCache);
    }

    try {
        const payload = await fetchUsLivePayload();
        usCache = payload;
        usCacheAt = Date.now();
        return deepCopy(payload);
    } catch (error) {
        if (usCache) {
            const stalePayload = deepCopy(usCache);
            stalePayload.meta.stale = true;
            stalePayload.meta.staleReason = error.message;
            stalePayload.meta.timestamp = new Date().toISOString();
            return stalePayload;
        }
        throw error;
    }
}

function getUsSortValue(row, sortKey) {
    switch (sortKey) {
    case 'symbol': return row.symbol;
    case 'name': return row.name;
    case 'sector': return row.sector;
    case 'price': return row.price ?? Number.NEGATIVE_INFINITY;
    case 'changePct': return row.changePct ?? Number.NEGATIVE_INFINITY;
    case 'volume': return row.volume ?? Number.NEGATIVE_INFINITY;
    case 'confidence': return row.prediction.confidence;
    case 'pUp':
    default:
        return row.prediction.pUp;
    }
}

function applyUsUniverseQuery(rows, search, sector, sort, direction, page, pageSize) {
    const keyword = String(search || '').trim().toLowerCase();
    const sectorFilter = String(sector || 'all').trim().toLowerCase();

    const filtered = rows.filter((row) => {
        const searchMatch = !keyword || row.symbol.toLowerCase().includes(keyword) || row.name.toLowerCase().includes(keyword) || row.sector.toLowerCase().includes(keyword);
        const sectorMatch = sectorFilter === 'all' || row.sector.toLowerCase() === sectorFilter;
        return searchMatch && sectorMatch;
    });

    const directionFactor = direction === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
        const aUnavailable = String(a.status || '').toUpperCase() === 'UNAVAILABLE';
        const bUnavailable = String(b.status || '').toUpperCase() === 'UNAVAILABLE';
        if (aUnavailable !== bUnavailable) {
            return aUnavailable ? 1 : -1;
        }
        const av = getUsSortValue(a, sort);
        const bv = getUsSortValue(b, sort);
        if (typeof av === 'string' && typeof bv === 'string') {
            return av.localeCompare(bv) * directionFactor;
        }
        if (av === bv) return 0;
        return av > bv ? directionFactor : -directionFactor;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = clamp(page, 1, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedRows = filtered.slice(start, start + pageSize);
    return {
        total,
        page: safePage,
        pageSize,
        totalPages,
        rows: pagedRows
    };
}

function parseUsListQuery(parsedUrl) {
    const page = parseInteger(parsedUrl.searchParams.get('page'), 1);
    const pageSize = clamp(parseInteger(parsedUrl.searchParams.get('pageSize'), 50), 10, 100);
    const sort = parsedUrl.searchParams.get('sort') || 'pUp';
    const direction = (parsedUrl.searchParams.get('direction') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const search = parsedUrl.searchParams.get('search') || '';
    const sector = parsedUrl.searchParams.get('sector') || 'all';
    return { page, pageSize, sort, direction, search, sector };
}

async function handleUsPrices(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = parseUsListQuery(parsedUrl);
    try {
        const payload = await getUsPayloadWithCache();
        const universe = applyUsUniverseQuery(payload.universe.rows, query.search, query.sector, query.sort, query.direction, query.page, query.pageSize);
        const status = payload.meta.stale ? 'STALE' : 'LIVE';
        universe.rows = universe.rows.map((row) => {
            const baseStatus = row.price === null ? 'UNAVAILABLE' : String(row.status || 'LIVE').toUpperCase();
            const resolvedStatus = baseStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : status;
            return { ...row, status: resolvedStatus };
        });

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            indices: payload.indices,
            universe
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch US equity prices from upstream',
            detail: error.message
        });
    }
}

async function handleUsIndices(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const now = Date.now();
    if (usIndicesCache && now - usIndicesCacheAt <= US_INDEX_FAST_CACHE_TTL_MS) {
        sendJson(res, 200, deepCopy(usIndicesCache));
        return;
    }

    try {
        const payload = await fetchUsIndicesPayload();
        usIndicesCache = payload;
        usIndicesCacheAt = Date.now();
        sendJson(res, 200, payload);
    } catch (error) {
        if (usIndicesCache) {
            const stalePayload = deepCopy(usIndicesCache);
            stalePayload.meta.stale = true;
            stalePayload.meta.staleReason = error.message;
            stalePayload.meta.timestamp = new Date().toISOString();
            sendJson(res, 200, stalePayload);
            return;
        }
        sendJson(res, 502, {
            error: 'Failed to fetch US indices from upstream',
            detail: error.message
        });
    }
}

async function handleUsIndicesHistory(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = parseUsIndicesHistoryQuery(parsedUrl);
    try {
        const payload = await getUsIndicesHistoryWithCache(query);
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch US index history from upstream',
            detail: error.message
        });
    }
}

async function handleUsSp500Quotes(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = parseUsListQuery(parsedUrl);
    try {
        const payload = await getUsPayloadWithCache();
        const universe = applyUsUniverseQuery(payload.universe.rows, query.search, query.sector, query.sort, query.direction, query.page, query.pageSize);
        const status = payload.meta.stale ? 'STALE' : 'LIVE';
        universe.rows = universe.rows.map((row) => {
            const baseStatus = row.price === null ? 'UNAVAILABLE' : String(row.status || 'LIVE').toUpperCase();
            const resolvedStatus = baseStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : status;
            return { ...row, status: resolvedStatus };
        });

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            universe
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to fetch S&P 500 quotes',
            detail: error.message
        });
    }
}

function indexKeyFromCanonicalSymbol(symbol) {
    if (symbol === '^DJI') return 'dow';
    if (symbol === '^NDX') return 'nasdaq100';
    if (symbol === '^SPX') return 'sp500';
    return null;
}

async function handleUsIndexPrediction(req, res, rawIndexSymbol) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const canonical = normalizeUsIndexSymbol(rawIndexSymbol);
    if (!canonical) {
        sendJson(res, 404, { error: `Unsupported US index symbol: ${rawIndexSymbol}` });
        return;
    }

    try {
        const payload = await getUsPayloadWithCache();
        const indexKey = indexKeyFromCanonicalSymbol(canonical);
        const indexData = payload.indices[indexKey];
        if (!indexData) {
            sendJson(res, 404, { error: `Index quote unavailable for ${canonical}` });
            return;
        }

        const prediction = calculateUsPrediction(indexData);
        const { policyPacket, policy, tpSl } = buildUnifiedPolicyArtifacts({
            market: 'us_equity',
            symbol: canonical,
            price: indexData.price,
            changePct: indexData.changePct,
            open: indexData.open,
            high: indexData.high,
            low: indexData.low,
            volume: indexData.volume,
            pUp: prediction.pUp,
            confidence: prediction.confidence,
            q10: prediction.q10,
            q50: prediction.q50,
            q90: prediction.q90,
            forecastTimestamp: payload.meta?.timestamp || new Date().toISOString(),
            inputSource: 'us-index-derived'
        });

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            symbol: canonical,
            name: indexData.name,
            currentValue: indexData.price,
            prediction: {
                direction: {
                    pUp: prediction.pUp,
                    pDown: prediction.pDown,
                    confidence: prediction.confidence,
                    signal: prediction.signal,
                    horizon: '1d'
                },
                window: prediction.window,
                magnitude: {
                    q10: prediction.q10,
                    q50: prediction.q50,
                    q90: prediction.q90
                }
            },
            policyPacket,
            policy,
            tpSl
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to generate US index prediction',
            detail: error.message
        });
    }
}

async function handleUsStock(req, res, rawSymbol) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const symbol = normalizeUsSymbol(rawSymbol);
    const constituent = sp500BySymbol.get(symbol);
    if (!constituent) {
        sendJson(res, 404, { error: `Symbol ${symbol} is not in S&P 500 snapshot` });
        return;
    }

    try {
        const payload = await getUsPayloadWithCache();
        let row = payload.universe.rows.find((item) => item.symbol === symbol);
        if ((!row || row.price === null) && US_ENABLE_ALPHA_FALLBACK && ALPHA_VANTAGE_API_KEY) {
            const alphaQuote = await fetchAlphaGlobalQuote(symbol);
            if (alphaQuote && alphaQuote.price !== null) {
                row = asUsUniverseRow(constituent, alphaQuote, payload.meta.stale ? 'STALE' : 'LIVE');
            }
        }
        if (!row) {
            sendJson(res, 404, { error: `Quote unavailable for ${symbol}` });
            return;
        }

        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            symbol: row.symbol,
            name: row.name,
            sector: row.sector,
            sourceSymbol: row.sourceSymbol,
            currentPrice: row.price,
            changePct: row.changePct,
            open: row.open,
            high: row.high,
            low: row.low,
            volume: row.volume,
            prediction: {
                pUp: row.prediction?.pUp,
                pDown: row.prediction?.pDown,
                confidence: row.prediction?.confidence,
                signal: row.prediction?.signal,
                q10: row.prediction?.q10,
                q50: row.prediction?.q50,
                q90: row.prediction?.q90,
                window: row.prediction?.window
            },
            policyPacket: row.policyPacket || null,
            policy: row.policy,
            tpSl: row.tpSl || null,
            valuation: row.valuation,
            status: row.price === null ? 'UNAVAILABLE' : (payload.meta.stale ? 'STALE' : 'LIVE')
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to generate US stock prediction',
            detail: error.message
        });
    }
}

async function handleUsTopMovers(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const limit = clamp(parseInteger(parsedUrl.searchParams.get('limit'), 20), 1, 100);
    try {
        const payload = await getUsPayloadWithCache();
        const rows = payload.universe.rows.filter((row) => Number.isFinite(row.changePct));
        const topGainers = [...rows]
            .sort((a, b) => b.changePct - a.changePct)
            .slice(0, limit)
            .map((row) => ({
                symbol: row.symbol,
                name: row.name,
                changePct: row.changePct,
                pUp: row.prediction.pUp,
                signal: row.prediction.signal
            }));
        const topLosers = [...rows]
            .sort((a, b) => a.changePct - b.changePct)
            .slice(0, limit)
            .map((row) => ({
                symbol: row.symbol,
                name: row.name,
                changePct: row.changePct,
                pUp: row.prediction.pUp,
                signal: row.prediction.signal
            }));
        sendJson(res, 200, {
            meta: payload.meta,
            marketSession: payload.marketSession,
            date: payload.meta.timestamp.slice(0, 10),
            topGainers,
            topLosers
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to compute US top movers',
            detail: error.message
        });
    }
}

async function handleUsPredictionsAlias(req, res, parsedUrl) {
    const symbol = parsedUrl.searchParams.get('symbol');
    if (!symbol) {
        sendJson(res, 400, { error: 'Missing required query param: symbol' });
        return;
    }
    await handleUsStock(req, res, symbol);
}

function roundTrackingNumber(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function roundTrackingPrice(value, market = 'all') {
    if (!Number.isFinite(value)) return null;
    const abs = Math.abs(value);
    if (market === 'crypto') {
        if (abs < 0.001) return Number(value.toFixed(10));
        if (abs < 0.01) return Number(value.toFixed(8));
        if (abs < 1) return Number(value.toFixed(6));
    }
    return Number(value.toFixed(4));
}

function signedTrackingFactor(value) {
    return roundTrackingNumber((clamp(Number.isFinite(value) ? value : 0.5, 0, 1) - 0.5) * 2, 2);
}

function formatTrackingSigned(value) {
    if (!Number.isFinite(value)) return '+0.00';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function normalizeTrackingMarket(raw) {
    const candidate = String(raw || 'all').trim().toLowerCase();
    if (candidate === 'crypto') return 'crypto';
    if (candidate === 'cn' || candidate === 'cn a-shares' || candidate === 'cn_equity') return 'cn';
    if (candidate === 'us' || candidate === 'us equities' || candidate === 'us_equity') return 'us';
    return 'all';
}

function normalizeTrackingAction(raw) {
    const candidate = String(raw || 'all').trim().toLowerCase();
    if (candidate === 'strong_buy' || candidate === 'strong buy') return 'strong_buy';
    if (candidate === 'buy') return 'buy';
    if (candidate === 'hold') return 'hold';
    if (candidate === 'reduce') return 'reduce';
    return 'all';
}

function normalizeTrackingActionType(raw) {
    const candidate = String(raw || 'all').trim().toLowerCase();
    if (candidate === 'added') return 'added';
    if (candidate === 'reduced') return 'reduced';
    if (candidate === 'new_coverage' || candidate === 'new coverage') return 'new_coverage';
    return 'all';
}

function normalizeTrackingSortBy(raw) {
    const candidate = String(raw || 'totalScore').trim().toLowerCase();
    if (candidate === 'symbol') return 'symbol';
    if (candidate === 'market') return 'market';
    if (candidate === 'pup' || candidate === 'p_up') return 'pUp';
    if (candidate === 'factorscore' || candidate === 'factor_score') return 'factorScore';
    if (candidate === 'netedge' || candidate === 'net_edge' || candidate === 'expectednetedgepct') return 'expectedNetEdgePct';
    if (candidate === 'tradequality' || candidate === 'trade_quality' || candidate === 'tradequalityscore') return 'tradeQualityScore';
    if (candidate === 'regime') return 'regime';
    if (candidate === 'cost' || candidate === 'costpct') return 'costPct';
    if (candidate === 'rr' || candidate === 'rewardrisk2') return 'rewardRisk2';
    return 'totalScore';
}

function normalizeTrackingView(raw) {
    return String(raw || '').trim().toLowerCase() === 'all' ? 'all' : 'top';
}

function normalizeTrackingPageSize(raw) {
    return clamp(parseInteger(raw, TRACKING_DEFAULT_PAGE_SIZE), 1, 100);
}

function trackingRowKey(row) {
    return `${row.market}:${String(row.symbol || '').toUpperCase()}`;
}

function buildCoinGeckoMarketsUrl(page = 1, perPage = 120) {
    const query = new URLSearchParams({
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: String(perPage),
        page: String(page),
        sparkline: 'false',
        price_change_percentage: '24h'
    });
    return `${COINGECKO_MARKETS_BASE}?${query.toString()}`;
}

function isStablecoinCoinGeckoRow(row) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    const id = String(row?.id || '').trim().toLowerCase();
    const name = String(row?.name || '').trim().toLowerCase();
    const price = Number(row?.current_price ?? row?.price ?? NaN);
    const combined = `${id} ${name} ${symbol.toLowerCase()}`;
    if (TRACKING_STABLECOIN_SYMBOLS.has(symbol) || TRACKING_STABLECOIN_IDS.has(id)) return true;
    if (TRACKING_STABLECOIN_NAME_KEYWORDS.some((keyword) => combined.includes(keyword))) return true;
    if (Number.isFinite(price) && price > 0.75 && price < 1.25) {
        if (symbol.endsWith('USD')) return true;
        if (/(^|[^a-z])(usd|usdt|usdc|usde|usdd|usdp|usds|usyc|fdusd|tusd|dai|pyusd|rlusd|lusd|frax|gusd)([^a-z]|$)/.test(combined)) {
            return true;
        }
    }
    return false;
}

function liquidityFactorFromProxy(proxyValue) {
    if (!Number.isFinite(proxyValue) || proxyValue <= 0) return 0.35;
    return clamp((Math.log10(proxyValue) - 6) / 6, 0.1, 1);
}

function coverageFactorFromCompleteness(values, stale) {
    const total = Array.isArray(values) ? values.length : 0;
    const available = total
        ? values.filter((value) => value !== null && value !== undefined && Number.isFinite(value)).length
        : 0;
    const completeness = total ? available / total : 0.4;
    return clamp(completeness - (stale ? 0.18 : 0), 0.1, 1);
}

function computeTrackingFactors(base) {
    const momentum = clamp(0.5 + (base.changePct || 0) / 16, 0.02, 0.98);
    const q50Component = clamp(0.5 + (base.q50 || 0) * 5, 0, 1);
    const edge = clamp(base.pUp * 0.55 + base.confidence * 0.35 + q50Component * 0.10, 0.02, 0.98);
    const liquidity = liquidityFactorFromProxy(base.liquidityProxy);
    const volatilityPenalty = clamp((base.bandWidth || 0.02) / 0.18, 0, 1);
    const changePenalty = clamp(Math.abs(base.changePct || 0) / 18, 0, 0.22);
    const volatility = clamp(1 - volatilityPenalty * 0.82 - changePenalty, 0.05, 0.98);
    const coverage = coverageFactorFromCompleteness(base.coverageInputs, base.stale);
    const factors = { momentum, edge, liquidity, volatility, coverage };
    const weighted = Object.fromEntries(
        Object.entries(factors).map(([key, value]) => [key, value * TRACKING_FACTOR_WEIGHTS[key]])
    );
    const weightedSum = Object.values(weighted).reduce((sum, value) => sum + value, 0);
    const factorScore = clamp(weightedSum, 0, 1);
    const totalScore = clamp(
        factorScore * TRACKING_TOTAL_SCORE_WEIGHTS.factorScore
            + base.pUp * TRACKING_TOTAL_SCORE_WEIGHTS.pUp
            + base.confidence * TRACKING_TOTAL_SCORE_WEIGHTS.confidence,
        0,
        1
    );
    const contributionTotal = Math.max(1e-6, weightedSum);
    const contribution = Object.fromEntries(
        Object.entries(weighted).map(([key, value]) => [key, roundTrackingNumber((value / contributionTotal) * 100, 1)])
    );
    return {
        factors: Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, roundTrackingNumber(value, 4)])),
        factorScore: roundTrackingNumber(factorScore, 4),
        totalScore: roundTrackingNumber(totalScore, 4),
        contribution
    };
}

function buildTrackingFactorExplanations(row, factors) {
    const signedValues = Object.fromEntries(
        Object.entries(factors).map(([key, value]) => [key, formatTrackingSigned(signedTrackingFactor(value))])
    );
    return {
        momentum: `Momentum Factor ${signedValues.momentum}: Strong recent price trend -> ${factors.momentum >= 0.6 ? 'Bullish bias' : 'Muted trend bias'}.`,
        edge: `Edge Factor ${signedValues.edge}: Live edge combines P(UP) ${row.pUp.toFixed(2)} and confidence ${(row.confidence * 100).toFixed(0)}%.`,
        liquidity: `Liquidity Factor ${signedValues.liquidity}: Deeper tradable flow supports faster execution reliability.`,
        volatility: `Volatility Factor ${signedValues.volatility}: Controlled return band ${(row.bandWidth * 100).toFixed(2)}% improves score stability.`,
        coverage: `Coverage Factor ${signedValues.coverage}: Freshness and field completeness support live decision quality.`
    };
}

function trackingActionPriority(actionKey) {
    switch (actionKey) {
    case 'strong_buy': return 4;
    case 'buy': return 3;
    case 'hold': return 2;
    case 'reduce': return 1;
    default: return 0;
    }
}

function resolveTrackingActionDescriptor(row) {
    if (row.policyPacket) {
        const packetAction = String(row.policyPacket.action || 'FLAT').toUpperCase();
        const packetReasons = Array.isArray(row.policyPacket.reasons) ? row.policyPacket.reasons : [];
        const tooltip = packetReasons.length
            ? packetReasons.join(' ')
            : `Policy packet action ${packetAction}.`;
        if (packetAction === 'STRONG_LONG') {
            return { action: 'STRONG BUY', actionKey: 'strong_buy', actionTone: 'success', actionTooltip: tooltip };
        }
        if (packetAction === 'LONG') {
            return { action: 'BUY', actionKey: 'buy', actionTone: 'success', actionTooltip: tooltip };
        }
        if (packetAction === 'SHORT' || packetAction === 'STRONG_SHORT') {
            return { action: 'REDUCE', actionKey: 'reduce', actionTone: 'danger', actionTooltip: tooltip };
        }
        return { action: 'HOLD', actionKey: 'hold', actionTone: 'warning', actionTooltip: tooltip };
    }

    let action = 'HOLD';
    let actionKey = 'hold';
    let actionTone = 'warning';
    if (row.totalScore >= 0.78 && row.pUp >= 0.60 && row.confidence >= 0.58) {
        action = 'STRONG BUY';
        actionKey = 'strong_buy';
        actionTone = 'success';
    } else if (row.totalScore >= 0.64 && row.pUp >= 0.54 && row.confidence >= 0.48) {
        action = 'BUY';
        actionKey = 'buy';
        actionTone = 'success';
    } else if (row.totalScore < 0.46 || row.pUp <= 0.44 || row.confidence <= 0.34) {
        action = 'REDUCE';
        actionKey = 'reduce';
        actionTone = 'danger';
    }

    const momentumText = formatTrackingSigned(signedTrackingFactor(row.factors.momentum));
    const tooltip = action === 'STRONG BUY'
        ? `Strong bullish signal detected (Momentum ${momentumText}, P(UP) ${row.pUp.toFixed(2)})`
        : action === 'BUY'
            ? `Constructive live edge detected (Momentum ${momentumText}, P(UP) ${row.pUp.toFixed(2)})`
            : action === 'REDUCE'
                ? `Edge deteriorating (Momentum ${momentumText}, P(UP) ${row.pUp.toFixed(2)})`
                : `Monitor only (Momentum ${momentumText}, P(UP) ${row.pUp.toFixed(2)})`;
    return { action, actionKey, actionTone, actionTooltip: tooltip };
}

function buildTrackingRow(base) {
    const factorBundle = computeTrackingFactors(base);
    const policyPacket = base.policyPacket || null;
    const expectedNetEdgePct = roundTrackingNumber(policyPacket?.expectedNetEdgePct ?? null, 2);
    const tradeQualityScore = roundTrackingNumber(policyPacket?.tradeQualityScore ?? null, 1);
    const tradeQualityBand = policyPacket?.tradeQualityBand || null;
    const regime = policyPacket?.regime || null;
    const costPct = roundTrackingNumber(policyPacket?.costPct ?? null, 2);
    const rewardRisk2 = roundTrackingNumber(policyPacket?.rewardRisk2 ?? null, 2);
    const regimeScore = roundTrackingNumber(policyPacket?.regimeScore ?? null, 4);
    const edgeRank = clamp(((policyPacket?.expectedNetEdgePct ?? 0) + 0.5) / 1.5, 0, 1);
    const rrRank = clamp((policyPacket?.rewardRisk2 ?? 0) / 4, 0, 1);
    const qualityRank = clamp((policyPacket?.tradeQualityScore ?? 0) / 100, 0, 1);
    const packetRankScore = policyPacket
        ? roundTrackingNumber(
            clamp(
                qualityRank * 0.45
                + edgeRank * 0.35
                + rrRank * 0.10
                + clamp(policyPacket?.regimeScore ?? 0, 0, 1) * 0.10,
                0,
                1
            ),
            4
        )
        : null;
    const row = {
        symbol: base.symbol,
        name: base.name,
        market: base.market,
        marketLabel: base.marketLabel,
        price: roundTrackingPrice(base.price, base.market),
        changePct: roundTrackingNumber((base.changePct || 0) / 100, 4),
        rawChangePct: roundTrackingNumber(base.changePct || 0, 2),
        pUp: roundTrackingNumber(base.pUp, 4),
        confidence: roundTrackingNumber(base.confidence, 4),
        q10: roundTrackingNumber(base.q10, 4),
        q50: roundTrackingNumber(base.q50, 4),
        q90: roundTrackingNumber(base.q90, 4),
        bandWidth: roundTrackingNumber(base.bandWidth, 4),
        factors: factorBundle.factors,
        factorScore: factorBundle.factorScore,
        legacyTotalScore: factorBundle.totalScore,
        totalScore: packetRankScore ?? factorBundle.totalScore,
        contribution: factorBundle.contribution,
        signalSource: base.signalSource,
        timestamp: base.timestamp,
        stale: Boolean(base.stale),
        staleReason: base.staleReason || null,
        status: base.status,
        liquidityProxy: roundTrackingNumber(base.liquidityProxy, 2),
        policyPacket,
        expectedNetEdgePct,
        tradeQualityScore,
        tradeQualityBand,
        regime,
        regimeScore,
        costPct,
        rewardRisk2,
        packetRankScore,
        meta: base.meta || {}
    };
    row.factorExplanations = buildTrackingFactorExplanations(row, row.factors);
    Object.assign(row, resolveTrackingActionDescriptor(row));
    return row;
}

function buildTrackingCryptoRow(coin, stale = false, staleReason = null, timestamp = new Date().toISOString()) {
    const price = parseNumber(coin?.current_price);
    const volume = parseNumber(coin?.total_volume) ?? 0;
    const marketCap = parseNumber(coin?.market_cap) ?? 0;
    const changePct = parseNumber(coin?.price_change_percentage_24h_in_currency ?? coin?.price_change_percentage_24h) ?? 0;
    const predictionPayload = buildCryptoPredictionPayload(
        String(coin?.symbol || '').trim().toUpperCase(),
        { price, volume, change: changePct },
        stale,
        staleReason
    );
    return buildTrackingRow({
        symbol: String(coin?.symbol || '').trim().toUpperCase(),
        name: coin?.name || String(coin?.symbol || '').trim().toUpperCase(),
        market: 'crypto',
        marketLabel: 'Crypto',
        price,
        changePct,
        pUp: predictionPayload.prediction.p_up,
        confidence: predictionPayload.prediction.confidence,
        q10: predictionPayload.prediction.magnitude.q10,
        q50: predictionPayload.prediction.magnitude.q50,
        q90: predictionPayload.prediction.magnitude.q90,
        bandWidth: predictionPayload.prediction.magnitude.q90 - predictionPayload.prediction.magnitude.q10,
        liquidityProxy: marketCap || volume,
        policyPacket: predictionPayload.policyPacket || null,
        coverageInputs: [price, volume, marketCap, changePct, predictionPayload.prediction.p_up, predictionPayload.prediction.confidence],
        signalSource: 'derived_live',
        stale,
        staleReason,
        timestamp,
        status: Number.isFinite(price) ? (stale ? 'STALE' : 'LIVE') : 'UNAVAILABLE',
        meta: {
            marketCap: roundTrackingNumber(marketCap, 2),
            totalVolume: roundTrackingNumber(volume, 2),
            marketCapRank: parseInteger(coin?.market_cap_rank, null),
            id: coin?.id || null
        }
    });
}

function buildTrackingCnRow(row, stale = false, timestamp = new Date().toISOString(), staleReason = null) {
    return buildTrackingRow({
        symbol: row.code,
        name: row.name,
        market: 'cn',
        marketLabel: 'CN A-Shares',
        price: row.price,
        changePct: row.changePct,
        pUp: row.prediction?.pUp ?? 0.5,
        confidence: row.prediction?.confidence ?? 0.5,
        q10: row.prediction?.q10 ?? -0.01,
        q50: row.prediction?.q50 ?? 0,
        q90: row.prediction?.q90 ?? 0.01,
        bandWidth: (row.prediction?.q90 ?? 0.01) - (row.prediction?.q10 ?? -0.01),
        liquidityProxy: row.turnover || row.valuation?.marketCap || row.volume || 0,
        policyPacket: row.policyPacket || null,
        coverageInputs: [row.price, row.changePct, row.volume, row.turnover, row.prediction?.pUp, row.prediction?.confidence],
        signalSource: 'derived_live',
        stale,
        staleReason,
        timestamp,
        status: row.price === null ? 'UNAVAILABLE' : (stale ? 'STALE' : 'LIVE'),
        meta: {
            sector: row.sector || '',
            limitPct: row.limitPct ?? null,
            marginEligible: Boolean(row.marginEligible),
            valuation: row.valuation || null
        }
    });
}

function buildTrackingUsRow(row, stale = false, timestamp = new Date().toISOString(), staleReason = null) {
    const liquidityProxy = row.valuation?.marketCap || ((row.volume ?? 0) * (row.price ?? 0)) || row.volume || 0;
    return buildTrackingRow({
        symbol: row.symbol,
        name: row.name,
        market: 'us',
        marketLabel: 'US Equities',
        price: row.price,
        changePct: row.changePct,
        pUp: row.prediction?.pUp ?? 0.5,
        confidence: row.prediction?.confidence ?? 0.5,
        q10: row.prediction?.q10 ?? -0.01,
        q50: row.prediction?.q50 ?? 0,
        q90: row.prediction?.q90 ?? 0.01,
        bandWidth: (row.prediction?.q90 ?? 0.01) - (row.prediction?.q10 ?? -0.01),
        liquidityProxy,
        policyPacket: row.policyPacket || null,
        coverageInputs: [row.price, row.changePct, row.volume, liquidityProxy, row.prediction?.pUp, row.prediction?.confidence],
        signalSource: 'derived_live',
        stale,
        staleReason,
        timestamp,
        status: row.price === null ? 'UNAVAILABLE' : (stale ? 'STALE' : 'LIVE'),
        meta: {
            sector: row.sector || '',
            valuation: row.valuation || null
        }
    });
}

function buildTrackingCryptoBenchmarkRow(quote, stale = false, staleReason = null, timestamp = new Date().toISOString()) {
    const symbol = normalizeCryptoSymbol(quote?.symbol);
    if (!symbol || !Number.isFinite(quote?.price)) {
        return null;
    }
    const baseSymbol = cryptoBaseSymbol(symbol);
    const predictionPayload = buildCryptoPredictionPayload(symbol, quote, stale, staleReason);
    const displayName = ({
        BTC: 'Bitcoin',
        ETH: 'Ethereum',
        SOL: 'Solana'
    })[baseSymbol] || baseSymbol;

    return buildTrackingRow({
        symbol,
        name: displayName,
        market: 'crypto',
        marketLabel: 'Crypto',
        price: quote.price,
        changePct: Number.isFinite(quote.change) ? quote.change : 0,
        pUp: predictionPayload.prediction.p_up,
        confidence: predictionPayload.prediction.confidence,
        q10: predictionPayload.prediction.magnitude.q10,
        q50: predictionPayload.prediction.magnitude.q50,
        q90: predictionPayload.prediction.magnitude.q90,
        bandWidth: predictionPayload.prediction.magnitude.q90 - predictionPayload.prediction.magnitude.q10,
        liquidityProxy: Number.isFinite(quote.volume) ? quote.volume : 0,
        policyPacket: predictionPayload.policyPacket || null,
        coverageInputs: [quote.price, quote.volume, quote.change, predictionPayload.prediction.p_up, predictionPayload.prediction.confidence],
        signalSource: 'binance_us_benchmark',
        stale,
        staleReason,
        timestamp,
        status: stale ? 'STALE' : 'LIVE',
        meta: {
            marketCap: null,
            totalVolume: roundTrackingNumber(Number.isFinite(quote.volume) ? quote.volume : 0, 2),
            marketCapRank: ({
                BTC: 1,
                ETH: 2,
                SOL: 7
            })[baseSymbol] || null,
            id: ({
                BTC: 'bitcoin',
                ETH: 'ethereum',
                SOL: 'solana'
            })[baseSymbol] || null
        }
    });
}

async function fetchTrackingCryptoUniverse() {
    const endpoint = buildCoinGeckoMarketsUrl(1, 120);
    const payload = await fetchJsonFromHttps(endpoint, 9000);
    if (!Array.isArray(payload)) {
        throw new Error('Unexpected CoinGecko markets payload');
    }
    const rows = payload.filter((row) => !isStablecoinCoinGeckoRow(row)).slice(0, 50);
    if (rows.length < 50) {
        throw new Error(`Filtered CoinGecko universe too small (${rows.length}/50)`);
    }
    return rows;
}

async function getTrackingCryptoUniverseWithCache() {
    const now = Date.now();
    if (trackingCryptoUniverseCache && now - trackingCryptoUniverseCacheAt <= TRACKING_CRYPTO_CACHE_TTL_MS) {
        return deepCopy(trackingCryptoUniverseCache);
    }

    const diskSnapshot = readTrackingSnapshot('crypto');
    const snapshotCandidate = trackingCryptoUniverseCache?.rows?.length
        ? trackingCryptoUniverseCache
        : (diskSnapshot?.rows?.length ? diskSnapshot : null);
    const shouldUseBackoffSnapshot = Boolean(
        snapshotCandidate?.rows?.length
        && trackingCryptoLastFailureAt
        && (now - trackingCryptoLastFailureAt) <= TRACKING_CRYPTO_FAILURE_BACKOFF_MS
    );
    if (shouldUseBackoffSnapshot) {
        return markTrackingBucketStale(
            snapshotCandidate,
            trackingCryptoLastFailureReason || `CoinGecko fetch backoff ${TRACKING_CRYPTO_FAILURE_BACKOFF_MS}ms`,
            'coingecko_markets'
        );
    }
    if (trackingCryptoUniversePromise) {
        const payload = await trackingCryptoUniversePromise;
        return deepCopy(payload);
    }

    const inFlight = (async () => {
        try {
            const timestamp = new Date().toISOString();
            const rawRows = await fetchTrackingCryptoUniverse();
            const rows = rawRows.map((row) => buildTrackingCryptoRow(row, false, null, timestamp));
            const payload = {
                meta: {
                    source: 'coingecko_markets',
                    timestamp,
                    stale: false
                },
                rows
            };
            trackingCryptoUniverseCache = payload;
            trackingCryptoUniverseCacheAt = Date.now();
            trackingCryptoLastFailureAt = 0;
            trackingCryptoLastFailureReason = null;
            writeTrackingSnapshot('crypto', payload);
            return payload;
        } catch (error) {
            trackingCryptoLastFailureAt = Date.now();
            trackingCryptoLastFailureReason = error.message;

            if (trackingCryptoUniverseCache?.rows?.length) {
                return markTrackingBucketStale(trackingCryptoUniverseCache, error.message, 'coingecko_markets');
            }
            if (diskSnapshot?.rows?.length) {
                return markTrackingBucketStale(diskSnapshot, error.message, 'coingecko_markets');
            }
            try {
                const benchmarkPayload = await getCryptoPricesWithCache();
                const timestamp = new Date().toISOString();
                const rows = listCryptoRows(benchmarkPayload)
                    .map((quote) => buildTrackingCryptoBenchmarkRow(quote, true, error.message, timestamp))
                    .filter((row) => row !== null);
                if (rows.length) {
                    const stalePayload = {
                        meta: {
                            source: 'binance_us_benchmark',
                            timestamp,
                            stale: true,
                            staleReason: error.message
                        },
                        rows
                    };
                    trackingCryptoUniverseCache = stalePayload;
                    trackingCryptoUniverseCacheAt = Date.now();
                    return stalePayload;
                }
            } catch (benchmarkError) {
                console.warn(`crypto benchmark fallback failed: ${benchmarkError.message}`);
            }
            throw error;
        }
    })();
    trackingCryptoUniversePromise = inFlight;
    try {
        const payload = await inFlight;
        return deepCopy(payload);
    } finally {
        if (trackingCryptoUniversePromise === inFlight) {
            trackingCryptoUniversePromise = null;
        }
    }
}

function getTrackingSortValue(row, sortBy) {
    switch (sortBy) {
    case 'symbol': return row.symbol;
    case 'market': return row.marketLabel;
    case 'factorScore': return row.factorScore;
    case 'pUp': return row.pUp;
    case 'expectedNetEdgePct': return row.expectedNetEdgePct ?? -Infinity;
    case 'tradeQualityScore': return row.tradeQualityScore ?? -Infinity;
    case 'regime': return row.regime || '';
    case 'costPct': return row.costPct ?? Infinity;
    case 'rewardRisk2': return row.rewardRisk2 ?? -Infinity;
    case 'totalScore':
    default:
        return row.totalScore;
    }
}

function applyTrackingUniverseQuery(rows, options = {}) {
    const market = normalizeTrackingMarket(options.market);
    const action = normalizeTrackingAction(options.action);
    const search = String(options.search || '').trim().toLowerCase();
    const sortBy = normalizeTrackingSortBy(options.sortBy || options.sort);
    const sortDir = String(options.sortDir || options.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const view = normalizeTrackingView(options.view);
    const page = clamp(parseInteger(options.page, 1), 1, 1000);
    const pageSize = normalizeTrackingPageSize(options.pageSize);

    const filtered = rows.filter((row) => {
        const marketMatch = market === 'all' || row.market === market;
        const actionMatch = action === 'all' || row.actionKey === action;
        const searchMatch = !search
            || row.symbol.toLowerCase().includes(search)
            || row.name.toLowerCase().includes(search)
            || row.marketLabel.toLowerCase().includes(search);
        return marketMatch && actionMatch && searchMatch;
    });

    const directionFactor = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
        const av = getTrackingSortValue(a, sortBy);
        const bv = getTrackingSortValue(b, sortBy);
        if (typeof av === 'string' && typeof bv === 'string') {
            const cmp = av.localeCompare(bv);
            if (cmp !== 0) return cmp * directionFactor;
        } else if (av !== bv) {
            return av > bv ? directionFactor : -directionFactor;
        }
        if (a.totalScore !== b.totalScore) return a.totalScore > b.totalScore ? -1 : 1;
        return a.symbol.localeCompare(b.symbol);
    });

    const total = filtered.length;
    const allRows = view === 'all';
    const effectivePageSize = allRows ? Math.max(total, pageSize) || total : pageSize;
    const totalPages = allRows ? 1 : Math.max(1, Math.ceil(total / effectivePageSize));
    const safePage = allRows ? 1 : clamp(page, 1, totalPages);
    const start = allRows ? 0 : (safePage - 1) * effectivePageSize;
    const windowRows = filtered.slice(start, start + effectivePageSize).map((row, index) => ({
        ...row,
        rank: start + index + 1
    }));

    return {
        total,
        page: safePage,
        pageSize: effectivePageSize,
        totalPages,
        hasMore: !allRows && safePage < totalPages,
        rows: windowRows
    };
}

function buildTrackingCoverageRow(market, marketLabel, rows, stale = false) {
    const total = rows.length;
    const available = rows.filter((row) => Number.isFinite(row.price) && row.status !== 'UNAVAILABLE').length;
    const coveragePct = total ? (available / total) * 100 : 0;
    const qualityPct = total
        ? rows.reduce((sum, row) => sum + ((row.factors?.coverage ?? 0) * 100), 0) / total
        : 0;
    const missingPct = Math.max(0, 100 - coveragePct);
    const qualityText = qualityPct >= 95 ? 'High' : qualityPct >= 80 ? 'Moderate' : 'Low';
    return {
        market,
        marketLabel,
        totalSymbols: total,
        coveragePct: roundTrackingNumber(coveragePct, 1),
        missingPct: roundTrackingNumber(missingPct, 1),
        qualityPct: roundTrackingNumber(qualityPct, 1),
        qualityText,
        stale,
        tooltip: `Avg Quality ${roundTrackingNumber(qualityPct, 1)}%: ${qualityPct >= 95 ? 'High across this market, minimal missing data' : qualityPct >= 80 ? 'Usable coverage with some degraded fields' : 'Coverage degraded, review stale inputs'}.`
    };
}

function buildTrackingActionEntry(type, row, reason, timestamp) {
    return {
        id: `${type}_${trackingRowKey(row)}_${timestamp}`,
        type,
        label: type === 'added' ? 'Added to Watchlist' : type === 'reduced' ? 'Position Reduced' : 'New Coverage',
        tone: type === 'added' ? 'success' : type === 'reduced' ? 'warning' : 'info',
        market: row.market,
        marketLabel: row.marketLabel,
        symbol: row.symbol,
        name: row.name,
        action: row.action,
        reason,
        timestamp,
        symbolDetail: {
            pUp: row.pUp,
            confidence: row.confidence,
            totalScore: row.totalScore,
            factorScore: row.factorScore,
            factors: row.factors,
            whyAdded: reason
        }
    };
}

function appendTrackingAction(entry) {
    const entryTime = Date.parse(entry.timestamp);
    const duplicate = trackingActionLog.find((item) => (
        item.type === entry.type
        && item.market === entry.market
        && item.symbol === entry.symbol
        && item.reason === entry.reason
        && Math.abs(Date.parse(item.timestamp) - entryTime) < 60000
    ));
    if (duplicate) {
        return;
    }
    trackingActionLog.unshift(entry);
    trackingActionLog = trackingActionLog.slice(0, TRACKING_ACTION_LOG_LIMIT);
    trackingLatestActionAt = entry.timestamp;
}

function updateTrackingActionLog(rows, timestamp) {
    const rankedRows = [...rows]
        .sort((a, b) => (b.totalScore - a.totalScore) || (b.pUp - a.pUp) || a.symbol.localeCompare(b.symbol))
        .slice(0, TRACKING_DEFAULT_PAGE_SIZE);
    const nextTrackedState = new Map(rankedRows.map((row) => [trackingRowKey(row), row]));

    if (!trackingPreviousTrackedState.size) {
        rankedRows
            .filter((row) => trackingActionPriority(row.actionKey) >= trackingActionPriority('buy'))
            .slice(0, TRACKING_ACTION_SEED_LIMIT)
            .forEach((row) => appendTrackingAction(buildTrackingActionEntry('added', row, row.actionTooltip, timestamp)));
        trackingPreviousTrackedState = nextTrackedState;
        trackingKnownUniverseSymbols = new Set(rows.map((row) => trackingRowKey(row)));
        return;
    }

    const newCoverageRows = [];
    rows.forEach((row) => {
        const key = trackingRowKey(row);
        if (!trackingKnownUniverseSymbols.has(key)) {
            trackingKnownUniverseSymbols.add(key);
            newCoverageRows.push(row);
        }
    });
    newCoverageRows
        .sort((a, b) => (b.totalScore - a.totalScore) || (b.pUp - a.pUp) || a.symbol.localeCompare(b.symbol))
        .slice(0, TRACKING_ACTION_SEED_LIMIT)
        .forEach((row) => appendTrackingAction(buildTrackingActionEntry('new_coverage', row, `Fresh live coverage detected for ${row.symbol}.`, timestamp)));

    nextTrackedState.forEach((row, key) => {
        const prev = trackingPreviousTrackedState.get(key);
        const nextPriority = trackingActionPriority(row.actionKey);
        const prevPriority = prev ? trackingActionPriority(prev.actionKey) : 0;
        if (!prev && nextPriority >= trackingActionPriority('buy')) {
            appendTrackingAction(buildTrackingActionEntry('added', row, row.actionTooltip, timestamp));
            return;
        }
        if (prev && nextPriority > prevPriority && nextPriority >= trackingActionPriority('buy')) {
            appendTrackingAction(buildTrackingActionEntry('added', row, `${row.symbol} upgraded to ${row.action}.`, timestamp));
            return;
        }
        if (prev && nextPriority < prevPriority && prevPriority >= trackingActionPriority('buy')) {
            appendTrackingAction(buildTrackingActionEntry('reduced', row, `${row.symbol} downgraded to ${row.action}.`, timestamp));
        }
    });

    trackingPreviousTrackedState.forEach((row, key) => {
        if (!nextTrackedState.has(key) && trackingActionPriority(row.actionKey) >= trackingActionPriority('buy')) {
            appendTrackingAction(buildTrackingActionEntry('reduced', row, `${row.symbol} dropped out of the active ranked universe.`, timestamp));
        }
    });

    trackingPreviousTrackedState = nextTrackedState;
}

function buildTrackingAggregateFromBuckets(buckets, staleReasons = []) {
    const timestamp = new Date().toISOString();
    const rows = [
        ...(buckets.crypto?.rows || []),
        ...(buckets.cn?.rows || []),
        ...(buckets.us?.rows || [])
    ];
    updateTrackingActionLog(rows, timestamp);

    const coverageRows = [
        buildTrackingCoverageRow('crypto', 'Crypto', buckets.crypto?.rows || [], Boolean(buckets.crypto?.meta?.stale)),
        buildTrackingCoverageRow('cn', 'CN A-Shares', buckets.cn?.rows || [], Boolean(buckets.cn?.meta?.stale)),
        buildTrackingCoverageRow('us', 'US Equities', buckets.us?.rows || [], Boolean(buckets.us?.meta?.stale))
    ];
    const totalSymbols = rows.length;
    const totalLiveRows = rows.filter((row) => Number.isFinite(row.price) && row.status !== 'UNAVAILABLE').length;
    const totalCoveragePct = totalSymbols ? (totalLiveRows / totalSymbols) * 100 : 0;
    const averageQualityPct = coverageRows.length
        ? coverageRows.reduce((sum, row) => sum + row.qualityPct, 0) / coverageRows.length
        : 0;
    const stale = buckets.crypto?.meta?.stale || buckets.cn?.meta?.stale || buckets.us?.meta?.stale || staleReasons.length > 0;

    return {
        meta: {
            timestamp,
            lastUpdatedAt: timestamp,
            refreshIntervalSec: TRACKING_REFRESH_INTERVAL_SEC,
            stale: Boolean(stale),
            staleReasons
        },
        buckets,
        allRows: rows,
        summary: {
            cryptoCount: buckets.crypto?.rows?.length || 0,
            cnCount: buckets.cn?.rows?.length || 0,
            usCount: buckets.us?.rows?.length || 0,
            totalSymbols,
            totalCoveragePct: roundTrackingNumber(totalCoveragePct, 1),
            averageQualityPct: roundTrackingNumber(averageQualityPct, 1),
            latestActionAt: trackingLatestActionAt,
            lastUpdatedAt: timestamp,
            refreshIntervalSec: TRACKING_REFRESH_INTERVAL_SEC,
            stale: Boolean(stale)
        },
        coverage: {
            rows: coverageRows,
            totalSymbols,
            averageQualityPct: roundTrackingNumber(averageQualityPct, 1),
            summaryTooltip: `Avg Quality ${roundTrackingNumber(averageQualityPct, 1)}%: High across all markets, minimal missing data.`
        },
        actions: {
            latestActionAt: trackingLatestActionAt,
            items: deepCopy(trackingActionLog)
        }
    };
}

async function buildTrackingAggregate() {
    const previousBuckets = {
        crypto: trackingAggregateCache?.buckets?.crypto || readTrackingBucketSnapshot('crypto'),
        cn: trackingAggregateCache?.buckets?.cn || readTrackingBucketSnapshot('cn'),
        us: trackingAggregateCache?.buckets?.us || readTrackingBucketSnapshot('us')
    };
    const staleReasons = [];

    const [cryptoResult, cnResult, usResult] = await Promise.allSettled([
        getTrackingCryptoUniverseWithCache(),
        getCnPayloadWithCache(),
        getUsPayloadWithCache()
    ]);

    let cryptoBucket;
    if (cryptoResult.status === 'fulfilled') {
        cryptoBucket = {
            rows: cryptoResult.value.rows,
            meta: {
                ...cryptoResult.value.meta,
                stale: Boolean(cryptoResult.value.meta?.stale)
            }
        };
        if (cryptoBucket.meta.stale && cryptoBucket.meta.staleReason) {
            staleReasons.push(`crypto: ${cryptoBucket.meta.staleReason}`);
        }
        writeTrackingBucketSnapshot('crypto', cryptoBucket);
    } else if (previousBuckets.crypto) {
        staleReasons.push(`crypto: ${cryptoResult.reason.message}`);
        cryptoBucket = deepCopy(previousBuckets.crypto);
        cryptoBucket.meta = {
            ...cryptoBucket.meta,
            stale: true,
            staleReason: cryptoResult.reason.message,
            timestamp: new Date().toISOString()
        };
        cryptoBucket.rows = cryptoBucket.rows.map((row) => ({
            ...row,
            stale: true,
            staleReason: cryptoResult.reason.message,
            status: row.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'STALE'
        }));
    } else {
        staleReasons.push(`crypto: ${cryptoResult.reason.message}`);
        cryptoBucket = { rows: [], meta: { source: 'coingecko_markets', timestamp: new Date().toISOString(), stale: true, staleReason: cryptoResult.reason.message } };
    }

    let cnBucket;
    if (cnResult.status === 'fulfilled') {
        const timestamp = cnResult.value.meta?.timestamp || new Date().toISOString();
        const stale = Boolean(cnResult.value.meta?.stale);
        cnBucket = {
            rows: cnResult.value.universe.rows.map((row) => buildTrackingCnRow(row, stale, timestamp, cnResult.value.meta?.staleReason || null)),
            meta: { ...cnResult.value.meta, stale }
        };
        if (cnBucket.meta.stale && cnBucket.meta.staleReason) {
            staleReasons.push(`cn: ${cnBucket.meta.staleReason}`);
        }
        writeTrackingBucketSnapshot('cn', cnBucket);
    } else if (previousBuckets.cn) {
        staleReasons.push(`cn: ${cnResult.reason.message}`);
        cnBucket = deepCopy(previousBuckets.cn);
        cnBucket.meta = {
            ...cnBucket.meta,
            stale: true,
            staleReason: cnResult.reason.message,
            timestamp: new Date().toISOString()
        };
        cnBucket.rows = cnBucket.rows.map((row) => ({
            ...row,
            stale: true,
            staleReason: cnResult.reason.message,
            status: row.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'STALE'
        }));
    } else {
        staleReasons.push(`cn: ${cnResult.reason.message}`);
        cnBucket = { rows: [], meta: { source: 'cn_equity_live', timestamp: new Date().toISOString(), stale: true, staleReason: cnResult.reason.message } };
    }

    let usBucket;
    if (usResult.status === 'fulfilled') {
        const timestamp = usResult.value.meta?.timestamp || new Date().toISOString();
        const stale = Boolean(usResult.value.meta?.stale);
        usBucket = {
            rows: usResult.value.universe.rows.map((row) => buildTrackingUsRow(row, stale, timestamp, usResult.value.meta?.staleReason || null)),
            meta: { ...usResult.value.meta, stale }
        };
        if (usBucket.meta.stale && usBucket.meta.staleReason) {
            staleReasons.push(`us: ${usBucket.meta.staleReason}`);
        }
        writeTrackingBucketSnapshot('us', usBucket);
    } else if (previousBuckets.us) {
        staleReasons.push(`us: ${usResult.reason.message}`);
        usBucket = deepCopy(previousBuckets.us);
        usBucket.meta = {
            ...usBucket.meta,
            stale: true,
            staleReason: usResult.reason.message,
            timestamp: new Date().toISOString()
        };
        usBucket.rows = usBucket.rows.map((row) => ({
            ...row,
            stale: true,
            staleReason: usResult.reason.message,
            status: row.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'STALE'
        }));
    } else {
        staleReasons.push(`us: ${usResult.reason.message}`);
        usBucket = { rows: [], meta: { source: 'us_equity_live', timestamp: new Date().toISOString(), stale: true, staleReason: usResult.reason.message } };
    }

    const aggregate = buildTrackingAggregateFromBuckets({ crypto: cryptoBucket, cn: cnBucket, us: usBucket }, staleReasons);
    if (!aggregate.allRows.length && trackingAggregateCache) {
        const staleAggregate = deepCopy(trackingAggregateCache);
        staleAggregate.meta = {
            ...staleAggregate.meta,
            stale: true,
            staleReasons,
            timestamp: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString()
        };
        return staleAggregate;
    }
    return aggregate;
}

async function getTrackingAggregateWithCache() {
    const now = Date.now();
    if (trackingAggregateCache && now - trackingAggregateCacheAt <= TRACKING_CACHE_TTL_MS) {
        return deepCopy(trackingAggregateCache);
    }
    if (trackingAggregatePromise) {
        const payload = await trackingAggregatePromise;
        return deepCopy(payload);
    }

    const inFlight = (async () => {
        const payload = await buildTrackingAggregate();
        trackingAggregateCache = payload;
        trackingAggregateCacheAt = Date.now();
        return payload;
    })();
    trackingAggregatePromise = inFlight;
    try {
        const payload = await inFlight;
        return deepCopy(payload);
    } finally {
        if (trackingAggregatePromise === inFlight) {
            trackingAggregatePromise = null;
        }
    }
}

function findTrackingRow(aggregate, symbol, market = 'all') {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedMarket = normalizeTrackingMarket(market);
    return aggregate.allRows.find((row) => {
        const marketMatch = normalizedMarket === 'all' || row.market === normalizedMarket;
        if (!marketMatch) {
            return false;
        }

        const rowSymbol = String(row.symbol || '').trim().toUpperCase();
        if (rowSymbol === normalizedSymbol) {
            return true;
        }

        if (normalizedMarket === 'crypto' || row.market === 'crypto') {
            return cryptoBaseSymbol(rowSymbol) === cryptoBaseSymbol(normalizedSymbol);
        }

        return false;
    }) || null;
}

function buildTrackingFactorPayloadFromRow(row, aggregate, options = {}) {
    const marketRows = aggregate.allRows.filter((item) => item.market === row.market);
    const marketAverageFactors = Object.keys(TRACKING_FACTOR_WEIGHTS).reduce((acc, key) => {
        acc[key] = roundTrackingNumber(
            marketRows.reduce((sum, item) => sum + (item.factors?.[key] ?? 0), 0) / Math.max(1, marketRows.length),
            4
        );
        return acc;
    }, {});
    const leader = aggregate.allRows.slice().sort((a, b) => b.totalScore - a.totalScore)[0] || null;
    const factors = Object.entries(row.factors || {}).map(([key, value]) => ({
        key,
        label: `${key.charAt(0).toUpperCase()}${key.slice(1)}`,
        value,
        explanation: row.factorExplanations?.[key] || '',
        contributionPct: row.contribution?.[key] ?? 0
    }));
    const rankedFactors = factors.slice().sort((a, b) => (b.contributionPct || 0) - (a.contributionPct || 0));
    const dominantFactor = rankedFactors[0] || null;
    const defaultExplanation = [
        options.leadIn || '',
        row.actionTooltip || '',
        dominantFactor?.explanation || ''
    ].filter(Boolean).join(' ');

    return {
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        marketLabel: row.marketLabel,
        totalScore: row.totalScore,
        factorScore: row.factorScore,
        action: row.action,
        actionTone: row.actionTone,
        stale: Boolean(row.stale),
        title: options.title || row.name,
        subtitle: options.subtitle || `${row.marketLabel} | ${row.symbol}`,
        badge: options.badge || (row.stale ? 'Stale Snapshot' : 'Live Factors'),
        factors,
        contribution: row.contribution,
        explanation: options.explanation || defaultExplanation || `${row.name} live factor snapshot.`,
        actionTooltip: options.actionTooltip || row.actionTooltip,
        compare: {
            marketAverageFactors,
            leader
        }
    };
}

function buildHomeUnavailableCard(cardKey, label, market, marketLabel, displayKind = 'number') {
    return {
        cardKey,
        label,
        symbol: null,
        name: null,
        market,
        marketLabel,
        price: null,
        changePct: null,
        pUp: null,
        confidence: null,
        totalScore: null,
        action: 'UNAVAILABLE',
        actionTone: 'danger',
        signalSource: null,
        stale: true,
        timestamp: new Date().toISOString(),
        unavailable: true,
        displayKind,
        leaderMeta: null
    };
}

function buildHomeCardFromRow(cardKey, label, row, extra = {}) {
    if (!row) {
        return buildHomeUnavailableCard(
            cardKey,
            label,
            extra.market || 'all',
            extra.marketLabel || 'Unavailable',
            extra.displayKind || 'number'
        );
    }
    return {
        cardKey,
        label,
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        marketLabel: row.marketLabel,
        price: row.price,
        changePct: row.changePct,
        pUp: row.pUp,
        confidence: row.confidence,
        totalScore: row.totalScore,
        action: row.action,
        actionTone: row.actionTone,
        signalSource: row.signalSource,
        stale: Boolean(row.stale),
        timestamp: row.timestamp,
        unavailable: row.status === 'UNAVAILABLE',
        displayKind: extra.displayKind || 'number',
        leaderMeta: extra.leaderMeta || null
    };
}

function buildHomeCnIndexRow(payload, indexCode = '000001.SH') {
    const indexData = indexCode === '000001.SH' ? payload?.indices?.sse : payload?.indices?.csi300;
    if (!indexData || !Number.isFinite(indexData.price)) return null;

    const quoteLike = {
        price: indexData.price,
        changePct: indexData.changePct,
        open: indexData.open,
        high: indexData.high,
        low: indexData.low,
        prevClose: indexData.prevClose
    };
    const prediction = calculatePrediction(quoteLike);
    const stale = Boolean(payload?.meta?.stale);
    return buildTrackingRow({
        symbol: indexCode,
        name: INDEX_NAME_BY_CODE[indexCode] || indexCode,
        market: 'cn',
        marketLabel: 'CN A-Shares',
        price: indexData.price,
        changePct: indexData.changePct,
        pUp: prediction.pUp,
        confidence: prediction.confidence,
        q10: prediction.q10,
        q50: prediction.q50,
        q90: prediction.q90,
        bandWidth: prediction.q90 - prediction.q10,
        liquidityProxy: indexData.turnover || indexData.volume || ((indexData.price || 0) * 100000000),
        coverageInputs: [
            indexData.price,
            indexData.changePct,
            indexData.open,
            indexData.high,
            indexData.low,
            indexData.prevClose,
            prediction.pUp,
            prediction.confidence
        ],
        signalSource: 'derived_live',
        stale,
        staleReason: payload?.meta?.staleReason || payload?.meta?.stale_reason || null,
        timestamp: payload?.meta?.timestamp || new Date().toISOString(),
        status: stale ? 'STALE' : 'LIVE',
        meta: {
            kind: 'index',
            indexCode
        }
    });
}

function buildHomeUsIndexRow(payload, symbol) {
    const key = indexKeyFromCanonicalSymbol(symbol);
    const indexData = key ? payload?.indices?.[key] : null;
    if (!indexData || !Number.isFinite(indexData.price)) return null;

    const prediction = calculateUsPrediction(indexData);
    const stale = Boolean(payload?.meta?.stale);
    return buildTrackingRow({
        symbol,
        name: indexData.name || symbol,
        market: 'us',
        marketLabel: 'US Equities',
        price: indexData.price,
        changePct: indexData.changePct,
        pUp: prediction.pUp,
        confidence: prediction.confidence,
        q10: prediction.q10,
        q50: prediction.q50,
        q90: prediction.q90,
        bandWidth: prediction.q90 - prediction.q10,
        liquidityProxy: indexData.volume || ((indexData.price || 0) * 100000000),
        coverageInputs: [
            indexData.price,
            indexData.changePct,
            indexData.open,
            indexData.high,
            indexData.low,
            prediction.pUp,
            prediction.confidence
        ],
        signalSource: 'derived_live',
        stale,
        staleReason: payload?.meta?.staleReason || payload?.meta?.stale_reason || null,
        timestamp: payload?.meta?.timestamp || new Date().toISOString(),
        status: stale ? 'STALE' : 'LIVE',
        meta: {
            kind: 'index',
            indexSymbol: symbol
        }
    });
}

function buildHomeCompositeDetailLeadIn(cardKey, row) {
    if (!row) return '';
    if (cardKey === 'cnComposite') {
        return `CN Composite currently led by ${row.symbol} ${row.name}.`;
    }
    if (cardKey === 'usComposite') {
        return `US Composite currently led by ${row.symbol} ${row.name}.`;
    }
    return '';
}

function buildPreferredHomeCryptoRow(aggregate, benchmarkPayload, symbol) {
    const trackedRow = findTrackingRow(aggregate, symbol, 'crypto');
    const benchmarkQuote = benchmarkPayload
        ? getCryptoRowBySymbol(benchmarkPayload, normalizeCryptoSymbol(symbol))
        : null;
    const benchmarkRow = benchmarkQuote
        ? buildTrackingCryptoBenchmarkRow(
            benchmarkQuote,
            Boolean(benchmarkPayload?.meta?.stale),
            benchmarkPayload?.meta?.stale_reason || benchmarkPayload?.meta?.staleReason || null,
            benchmarkPayload?.meta?.timestamp || new Date().toISOString()
        )
        : null;

    if (benchmarkRow && !benchmarkRow.stale && (!trackedRow || trackedRow.stale || trackedRow.signalSource === 'binance_us_benchmark')) {
        return benchmarkRow;
    }
    return trackedRow || benchmarkRow || null;
}

async function buildHomeLandingPayload() {
    const aggregate = await getTrackingAggregateWithCache();
    const [cnResult, usResult, cryptoBenchmarkResult] = await Promise.allSettled([
        getCnPayloadWithCache(),
        getUsPayloadWithCache(),
        getCryptoPricesWithCache()
    ]);

    const cryptoBenchmarkPayload = cryptoBenchmarkResult.status === 'fulfilled' ? cryptoBenchmarkResult.value : null;
    const cryptoBtc = buildPreferredHomeCryptoRow(aggregate, cryptoBenchmarkPayload, 'BTC');
    const cryptoEth = buildPreferredHomeCryptoRow(aggregate, cryptoBenchmarkPayload, 'ETH');
    const cryptoSol = buildPreferredHomeCryptoRow(aggregate, cryptoBenchmarkPayload, 'SOL');

    const cnRows = aggregate.allRows.filter((row) => row.market === 'cn').sort((a, b) => b.totalScore - a.totalScore);
    const usRows = aggregate.allRows.filter((row) => row.market === 'us').sort((a, b) => b.totalScore - a.totalScore);
    const cnLeader = cnRows[0] || null;
    const usLeader = usRows[0] || null;

    const sseRow = cnResult.status === 'fulfilled' ? buildHomeCnIndexRow(cnResult.value, '000001.SH') : null;
    const spxRow = usResult.status === 'fulfilled' ? buildHomeUsIndexRow(usResult.value, '^SPX') : null;
    const djiRow = usResult.status === 'fulfilled' ? buildHomeUsIndexRow(usResult.value, '^DJI') : null;
    const ndxRow = usResult.status === 'fulfilled' ? buildHomeUsIndexRow(usResult.value, '^NDX') : null;

    const cards = [
        buildHomeCardFromRow('btc', 'BTC/USDT', cryptoBtc, { displayKind: 'usd' }),
        buildHomeCardFromRow('eth', 'ETH/USDT', cryptoEth, { displayKind: 'usd' }),
        buildHomeCardFromRow('sol', 'SOL/USDT', cryptoSol, { displayKind: 'usd' }),
        buildHomeCardFromRow('sse', 'SSE COMPOSITE', sseRow, { market: 'cn', marketLabel: 'CN A-Shares', displayKind: 'number' }),
        buildHomeCardFromRow('cnComposite', 'CN COMPOSITE', cnLeader, {
            market: 'cn',
            marketLabel: 'CN A-Shares',
            displayKind: 'cny',
            leaderMeta: cnLeader ? { symbol: cnLeader.symbol, name: cnLeader.name, market: cnLeader.market } : null
        }),
        buildHomeCardFromRow('usComposite', 'US COMPOSITE', usLeader, {
            market: 'us',
            marketLabel: 'US Equities',
            displayKind: 'usd',
            leaderMeta: usLeader ? { symbol: usLeader.symbol, name: usLeader.name, market: usLeader.market } : null
        }),
        buildHomeCardFromRow('spx', 'S&P 500', spxRow, { market: 'us', marketLabel: 'US Equities', displayKind: 'number' }),
        buildHomeCardFromRow('dji', 'DOW JONES', djiRow, { market: 'us', marketLabel: 'US Equities', displayKind: 'number' }),
        buildHomeCardFromRow('ndx', 'NASDAQ', ndxRow, { market: 'us', marketLabel: 'US Equities', displayKind: 'number' })
    ];

    const cardRows = {
        btc: cryptoBtc,
        eth: cryptoEth,
        sol: cryptoSol,
        sse: sseRow,
        cnComposite: cnLeader,
        usComposite: usLeader,
        spx: spxRow,
        dji: djiRow,
        ndx: ndxRow
    };

    const detailsByCard = Object.fromEntries(
        cards.map((card) => {
            const row = cardRows[card.cardKey];
            if (!row) {
                return [card.cardKey, {
                    title: card.label,
                    subtitle: 'Data unavailable',
                    badge: 'Unavailable',
                    factors: [],
                    contribution: {},
                    explanation: `${card.label} is currently unavailable.`,
                    actionTooltip: 'Live data unavailable',
                    action: 'UNAVAILABLE',
                    actionTone: 'danger',
                    stale: true
                }];
            }
            const leadIn = buildHomeCompositeDetailLeadIn(card.cardKey, row);
            return [card.cardKey, buildTrackingFactorPayloadFromRow(row, aggregate, {
                title: card.label,
                subtitle: card.leaderMeta ? `${card.leaderMeta.symbol} | ${card.leaderMeta.name}` : `${row.marketLabel} | ${row.symbol}`,
                badge: row.stale ? 'Stale Snapshot' : 'Live Factors',
                leadIn
            })];
        })
    );

    const featuredCard = cards
        .filter((card) => Number.isFinite(card.totalScore))
        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))[0] || cards[0];

    return {
        meta: {
            ...aggregate.meta,
            lastUpdatedAt: aggregate.meta?.lastUpdatedAt || aggregate.summary?.lastUpdatedAt || new Date().toISOString(),
            refreshIntervalSec: aggregate.meta?.refreshIntervalSec || aggregate.summary?.refreshIntervalSec || TRACKING_REFRESH_INTERVAL_SEC
        },
        hero: {
            liveCoveragePct: aggregate.summary?.totalCoveragePct || 0,
            assetsCovered: aggregate.summary?.totalSymbols || 0,
            actionableSignals: aggregate.allRows.filter((row) => row.action === 'STRONG BUY' || row.action === 'BUY').length,
            strongBuyCount: aggregate.allRows.filter((row) => row.action === 'STRONG BUY').length,
            buyCount: aggregate.allRows.filter((row) => row.action === 'BUY').length,
            latestActionAt: aggregate.summary?.latestActionAt || null
        },
        overview: { cards },
        detailsByCard,
        featuredCardKey: featuredCard?.cardKey || 'btc'
    };
}

async function getHomeLandingWithCache() {
    const now = Date.now();
    if (homeLandingCache && now - homeLandingCacheAt <= HOME_LANDING_CACHE_TTL_MS) {
        return deepCopy(homeLandingCache);
    }
    if (homeLandingPromise) {
        const payload = await homeLandingPromise;
        return deepCopy(payload);
    }

    const inFlight = (async () => {
        const payload = await buildHomeLandingPayload();
        homeLandingCache = payload;
        homeLandingCacheAt = Date.now();
        return payload;
    })();
    homeLandingPromise = inFlight;
    try {
        const payload = await inFlight;
        return deepCopy(payload);
    } finally {
        homeLandingPromise = null;
    }
}

function buildTrackingSimulation(rows, topN) {
    const picks = rows.slice(0, topN);
    const count = picks.length;
    const expectedReturn = count ? picks.reduce((sum, row) => sum + (row.q50 || 0), 0) / count : 0;
    const downside = count ? picks.reduce((sum, row) => sum + (row.q10 || 0), 0) / count : 0;
    const upside = count ? picks.reduce((sum, row) => sum + (row.q90 || 0), 0) / count : 0;
    const dispersion = count
        ? Math.sqrt(picks.reduce((sum, row) => sum + (((row.q50 || 0) - expectedReturn) ** 2), 0) / count)
        : 0;
    const sharpe = dispersion > 1e-6 ? expectedReturn / dispersion : expectedReturn / 0.01;
    const capital = 100000;
    const pnlUsd = capital * expectedReturn;
    return {
        topN: count,
        expectedReturnPct: roundTrackingNumber(expectedReturn * 100, 2),
        downsidePct: roundTrackingNumber(downside * 100, 2),
        upsidePct: roundTrackingNumber(upside * 100, 2),
        sharpe: roundTrackingNumber(sharpe, 2),
        pnlUsd: roundTrackingNumber(pnlUsd, 2),
        holdings: picks.map((row) => ({
            symbol: row.symbol,
            market: row.market,
            weightPct: roundTrackingNumber((1 / Math.max(1, count)) * 100, 1),
            q50Pct: roundTrackingNumber((row.q50 || 0) * 100, 2),
            totalScore: row.totalScore
        }))
    };
}

async function handleTrackingSummary(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    try {
        const aggregate = await getTrackingAggregateWithCache();
        sendJson(res, 200, {
            meta: aggregate.meta,
            summary: aggregate.summary
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build tracking summary',
            detail: error.message
        });
    }
}

async function handleTrackingUniverse(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    try {
        const aggregate = await getTrackingAggregateWithCache();
        const universe = applyTrackingUniverseQuery(aggregate.allRows, {
            market: parsedUrl.searchParams.get('market'),
            action: parsedUrl.searchParams.get('action'),
            search: parsedUrl.searchParams.get('search'),
            sortBy: parsedUrl.searchParams.get('sortBy'),
            sort: parsedUrl.searchParams.get('sort'),
            sortDir: parsedUrl.searchParams.get('sortDir'),
            direction: parsedUrl.searchParams.get('direction'),
            page: parsedUrl.searchParams.get('page'),
            pageSize: parsedUrl.searchParams.get('pageSize'),
            view: parsedUrl.searchParams.get('view')
        });
        sendJson(res, 200, {
            meta: aggregate.meta,
            summary: aggregate.summary,
            universe
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build tracking universe',
            detail: error.message
        });
    }
}

async function handleTrackingFactors(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    const symbol = parsedUrl.searchParams.get('symbol');
    if (!symbol) {
        sendJson(res, 400, { error: 'Missing required query param: symbol' });
        return;
    }
    try {
        const aggregate = await getTrackingAggregateWithCache();
        const market = parsedUrl.searchParams.get('market');
        const row = findTrackingRow(aggregate, symbol, market);
        if (!row) {
            sendJson(res, 404, { error: `Tracking row not found for ${symbol}` });
            return;
        }
        sendJson(res, 200, {
            meta: aggregate.meta,
            ...buildTrackingFactorPayloadFromRow(row, aggregate)
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build tracking factor payload',
            detail: error.message
        });
    }
}

async function handleHomeLanding(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    try {
        const payload = await getHomeLandingWithCache();
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build home landing payload',
            detail: error.message
        });
    }
}

async function handleTrackingCoverage(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    try {
        const aggregate = await getTrackingAggregateWithCache();
        sendJson(res, 200, {
            meta: aggregate.meta,
            coverage: aggregate.coverage
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build tracking coverage matrix',
            detail: error.message
        });
    }
}

async function handleTrackingActions(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    try {
        const aggregate = await getTrackingAggregateWithCache();
        const limit = clamp(parseInteger(parsedUrl.searchParams.get('limit'), 20), 1, 100);
        const type = normalizeTrackingActionType(parsedUrl.searchParams.get('type'));
        const filtered = type === 'all'
            ? aggregate.actions.items
            : aggregate.actions.items.filter((item) => item.type === type);
        sendJson(res, 200, {
            meta: aggregate.meta,
            latestActionAt: aggregate.actions.latestActionAt,
            total: filtered.length,
            items: filtered.slice(0, limit)
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to build tracking actions feed',
            detail: error.message
        });
    }
}

async function handleTrackingSimulate(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }
    try {
        const body = await readJsonBody(req);
        const aggregate = await getTrackingAggregateWithCache();
        const filtered = applyTrackingUniverseQuery(aggregate.allRows, {
            market: body.market,
            action: body.action,
            search: body.search,
            sortBy: body.sortBy,
            sortDir: body.sortDir,
            page: 1,
            pageSize: 100,
            view: 'all'
        }).rows;
        const topN = clamp(parseInteger(body.topN, TRACKING_SIMULATION_DEFAULT_TOP_N), 1, 20);
        sendJson(res, 200, {
            meta: aggregate.meta,
            simulation: buildTrackingSimulation(filtered, topN)
        });
    } catch (error) {
        sendJson(res, 502, {
            error: 'Failed to simulate tracking portfolio',
            detail: error.message
        });
    }
}

function handleAlertContract(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }

    const contract = {
        route: '/api/alerts',
        status: 'not_implemented',
        storage: 'planned_server_storage',
        current_mode: 'client_local_storage',
        schema: {
            id: 'string',
            symbol: 'BTCUSDT|ETHUSDT|SOLUSDT|...',
            type: 'move_gt_pct_24h',
            thresholdPct: 'number',
            enabled: 'boolean',
            lastTriggeredAt: 'ISO8601|null',
            createdAt: 'ISO8601'
        }
    };

    if (req.method === 'GET') {
        sendJson(res, 501, {
            ...contract,
            message: 'Use localStorage key "crypto_alerts_v1" for this phase.'
        });
        return;
    }

    if (req.method === 'POST') {
        sendJson(res, 501, {
            ...contract,
            expected_request: {
                symbol: 'BTCUSDT',
                type: 'move_gt_pct_24h',
                thresholdPct: 5,
                enabled: true
            }
        });
        return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
}

function proxyApi(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }

    const proxyReq = http.request(
        {
            hostname: API_HOST,
            port: API_PORT,
            path: req.url,
            method: req.method,
            headers: {
                ...req.headers,
                host: `${API_HOST}:${API_PORT}`
            }
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
            });
            proxyRes.pipe(res);
        }
    );

    proxyReq.on('error', (error) => {
        sendJson(res, 502, {
            error: 'API proxy failed',
            detail: error.message
        });
    });

    req.pipe(proxyReq);
}

function proxyModelExplorer(req, res, parsedUrl) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }

    const rewrittenPathname = parsedUrl.pathname.replace(/^\/api\/model-explorer/, '') || '/';
    const upstreamPath = `${rewrittenPathname}${parsedUrl.search || ''}`;
    const requestClient = MODEL_EXPLORER_SCHEME === 'https' ? https : http;

    const proxyReq = requestClient.request(
        {
            hostname: MODEL_EXPLORER_HOST,
            port: MODEL_EXPLORER_PORT,
            path: upstreamPath,
            method: req.method,
            headers: {
                ...req.headers,
                host: `${MODEL_EXPLORER_HOST}:${MODEL_EXPLORER_PORT}`
            }
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
            });
            proxyRes.pipe(res);
        }
    );

    proxyReq.on('error', (error) => {
        sendJson(res, 502, {
            error: 'Model explorer proxy failed',
            detail: error.message
        });
    });

    req.pipe(proxyReq);
}

function safeJoin(basePath, targetPath) {
    const resolvedPath = path.normalize(path.join(basePath, targetPath));
    if (!resolvedPath.startsWith(basePath)) {
        return null;
    }
    return resolvedPath;
}

function serveStatic(req, res) {
    const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = safeJoin(WEB_ROOT, decodeURIComponent(requestPath));

    if (!filePath) {
        sendJson(res, 400, { error: 'Invalid path' });
        return;
    }

    const targetPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
        ? path.join(filePath, 'index.html')
        : filePath;

    fs.readFile(targetPath, (error, data) => {
        if (error) {
            if (error.code === 'ENOENT') {
                sendJson(res, 404, { error: 'Not found' });
            } else {
                sendJson(res, 500, { error: 'File read failed', detail: error.message });
            }
            return;
        }

        const extension = path.extname(targetPath).toLowerCase();
        const contentType = MIME_TYPES[extension] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function handleAsyncRoute(res, promise, errorCode = 'REQUEST_FAILED') {
    Promise.resolve(promise).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${errorCode}: ${message}`);
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        if (res.writableEnded) {
            return;
        }
        sendJson(res, 500, {
            success: false,
            error: errorCode,
            message
        });
    });
}

const server = http.createServer((req, res) => {
    if (!req.url) {
        sendJson(res, 400, { error: 'Empty URL' });
        return;
    }

    beginRequestTracking(req, res);
    const parsedUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (parsedUrl.pathname === '/healthz' || parsedUrl.pathname === '/api/system/health') {
        handleAsyncRoute(res, handleSystemHealthRoute(req, res), 'SYSTEM_HEALTH_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/system/metrics') {
        handleSystemMetricsRoute(req, res);
        return;
    }

    if (parsedUrl.pathname === '/api/auth/register') {
        handleAsyncRoute(res, authStore.handleRegister(req, res, sendJson, readJsonBody), 'REGISTER_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/auth/login') {
        handleAsyncRoute(res, authStore.handleLogin(req, res, sendJson, readJsonBody), 'LOGIN_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/auth/me') {
        authStore.handleMe(req, res, sendJson, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/auth/logout') {
        authStore.handleLogout(req, res, sendJson);
        return;
    }
    if (parsedUrl.pathname === '/api/chat/boards') {
        handleAsyncRoute(res, handleChatBoardsRoute(req, res), 'CHAT_BOARDS_FAILED');
        return;
    }
    if (/^\/api\/chat\/boards\/\d+\/join$/.test(parsedUrl.pathname)) {
        const boardId = Number(parsedUrl.pathname.split('/')[4]);
        handleAsyncRoute(res, handleChatBoardJoinRoute(req, res, boardId), 'CHAT_JOIN_FAILED');
        return;
    }
    if (/^\/api\/chat\/boards\/\d+\/messages$/.test(parsedUrl.pathname)) {
        const boardId = Number(parsedUrl.pathname.split('/')[4]);
        handleAsyncRoute(res, handleChatBoardMessagesRoute(req, res, boardId, parsedUrl), 'CHAT_MESSAGES_FAILED');
        return;
    }
    if (/^\/api\/chat\/messages\/\d+\/reactions$/.test(parsedUrl.pathname)) {
        const messageId = Number(parsedUrl.pathname.split('/')[4]);
        handleAsyncRoute(res, handleChatMessageReactionsRoute(req, res, messageId, parsedUrl), 'CHAT_REACTIONS_FAILED');
        return;
    }
    if (/^\/api\/chat\/messages\/\d+$/.test(parsedUrl.pathname)) {
        const messageId = Number(parsedUrl.pathname.split('/')[4]);
        handleAsyncRoute(res, handleChatMessageItemRoute(req, res, messageId), 'CHAT_MESSAGE_ITEM_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/chat/presence') {
        handleAsyncRoute(res, handleChatPresenceRoute(req, res, parsedUrl), 'CHAT_PRESENCE_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/notes') {
        handleAsyncRoute(res, handleNotesCollectionRoute(req, res, parsedUrl), 'NOTES_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/notes/share/')) {
        const shareId = decodeURIComponent(parsedUrl.pathname.replace('/api/notes/share/', ''));
        handleAsyncRoute(res, handleNoteShareRoute(req, res, shareId), 'NOTE_SHARE_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/community/ideas') {
        handleAsyncRoute(res, handleCommunityIdeasRoute(req, res, parsedUrl), 'COMMUNITY_IDEAS_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/community/notes/share/')) {
        const shareId = decodeURIComponent(parsedUrl.pathname.replace('/api/community/notes/share/', ''));
        handleAsyncRoute(res, handleCommunityShareRoute(req, res, shareId), 'COMMUNITY_SHARE_FAILED');
        return;
    }
    if (/^\/api\/community\/notes\/\d+$/.test(parsedUrl.pathname)) {
        const noteId = Number(parsedUrl.pathname.split('/')[4]);
        handleAsyncRoute(res, handleCommunityNoteRoute(req, res, noteId), 'COMMUNITY_NOTE_FAILED');
        return;
    }
    if (/^\/api\/notes\/\d+\/versions$/.test(parsedUrl.pathname)) {
        const noteId = Number(parsedUrl.pathname.split('/')[3]);
        handleAsyncRoute(res, handleNoteVersionsRoute(req, res, noteId, parsedUrl), 'NOTE_VERSIONS_FAILED');
        return;
    }
    if (/^\/api\/notes\/\d+$/.test(parsedUrl.pathname)) {
        const noteId = Number(parsedUrl.pathname.split('/')[3]);
        handleAsyncRoute(res, handleNoteItemRoute(req, res, noteId), 'NOTE_ITEM_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/site-positions') {
        handleAsyncRoute(res, handleSitePositionsCollectionRoute(req, res, parsedUrl), 'SITE_POSITIONS_FAILED');
        return;
    }
    if (/^\/api\/site-positions\/\d+\/close$/.test(parsedUrl.pathname)) {
        const positionId = Number(parsedUrl.pathname.split('/')[3]);
        handleAsyncRoute(res, handleSitePositionCloseRoute(req, res, positionId), 'SITE_POSITION_CLOSE_FAILED');
        return;
    }
    if (/^\/api\/site-positions\/\d+\/history$/.test(parsedUrl.pathname)) {
        const positionId = Number(parsedUrl.pathname.split('/')[3]);
        handleAsyncRoute(res, handleSitePositionHistoryRoute(req, res, positionId, parsedUrl), 'SITE_POSITION_HISTORY_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/site-stop-orders') {
        handleAsyncRoute(res, handleSiteStopOrdersCollectionRoute(req, res, parsedUrl), 'SITE_STOP_ORDERS_FAILED');
        return;
    }
    if (/^\/api\/site-stop-orders\/\d+\/cancel$/.test(parsedUrl.pathname)) {
        const stopOrderId = Number(parsedUrl.pathname.split('/')[3]);
        handleAsyncRoute(res, handleSiteStopOrderCancelRoute(req, res, stopOrderId), 'SITE_STOP_ORDER_CANCEL_FAILED');
        return;
    }

    if (parsedUrl.pathname === '/api/crypto/prices') {
        handleAsyncRoute(res, handleCryptoPrices(req, res), 'CRYPTO_PRICES_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/crypto/universe') {
        handleAsyncRoute(res, handleCryptoUniverse(req, res), 'CRYPTO_UNIVERSE_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/crypto/history/')) {
        const symbol = decodeURIComponent(parsedUrl.pathname.replace('/api/crypto/history/', ''));
        handleAsyncRoute(res, handleCryptoHistory(req, res, parsedUrl, symbol), 'CRYPTO_HISTORY_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/crypto/prediction/')) {
        const symbol = decodeURIComponent(parsedUrl.pathname.replace('/api/crypto/prediction/', ''));
        handleAsyncRoute(res, handleCryptoPrediction(req, res, symbol), 'CRYPTO_PREDICTION_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/crypto/performance/')) {
        const symbol = decodeURIComponent(parsedUrl.pathname.replace('/api/crypto/performance/', ''));
        handleAsyncRoute(res, handleCryptoPerformance(req, res, symbol), 'CRYPTO_PERFORMANCE_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/session/crypto') {
        handleAsyncRoute(res, handleCryptoSessionForecast(req, res, parsedUrl), 'CRYPTO_SESSION_FAILED');
        return;
    }

    if (parsedUrl.pathname === '/api/cn-equity/live') {
        handleAsyncRoute(res, handleCnLive(req, res), 'CN_LIVE_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/prices') {
        handleAsyncRoute(res, handleCnPrices(req, res, parsedUrl), 'CN_PRICES_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/indices/history') {
        handleAsyncRoute(res, handleCnIndicesHistory(req, res, parsedUrl), 'CN_INDICES_HISTORY_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/csi300/quotes') {
        handleAsyncRoute(res, handleCnQuotes(req, res, parsedUrl), 'CN_QUOTES_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/csi300/ranking') {
        handleAsyncRoute(res, handleCnRanking(req, res, parsedUrl), 'CN_RANKING_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/cn-equity/prediction/')) {
        const indexCode = decodeURIComponent(parsedUrl.pathname.replace('/api/cn-equity/prediction/', ''));
        handleAsyncRoute(res, handleCnIndexPrediction(req, res, indexCode), 'CN_PREDICTION_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/cn-equity/stock/')) {
        const stockCode = decodeURIComponent(parsedUrl.pathname.replace('/api/cn-equity/stock/', ''));
        handleAsyncRoute(res, handleCnStock(req, res, stockCode), 'CN_STOCK_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/predictions') {
        handleAsyncRoute(res, handleCnPredictionsAlias(req, res, parsedUrl), 'CN_PREDICTIONS_FAILED');
        return;
    }

    if (parsedUrl.pathname === '/api/us-equity/prices') {
        handleAsyncRoute(res, handleUsPrices(req, res, parsedUrl), 'US_PRICES_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/indices/history') {
        handleAsyncRoute(res, handleUsIndicesHistory(req, res, parsedUrl), 'US_INDICES_HISTORY_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/indices') {
        handleAsyncRoute(res, handleUsIndices(req, res), 'US_INDICES_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/sp500/quotes') {
        handleAsyncRoute(res, handleUsSp500Quotes(req, res, parsedUrl), 'US_SP500_QUOTES_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/top-movers') {
        handleAsyncRoute(res, handleUsTopMovers(req, res, parsedUrl), 'US_TOP_MOVERS_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/us-equity/prediction/')) {
        const indexSymbol = decodeURIComponent(parsedUrl.pathname.replace('/api/us-equity/prediction/', ''));
        handleAsyncRoute(res, handleUsIndexPrediction(req, res, indexSymbol), 'US_PREDICTION_FAILED');
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/us-equity/stock/')) {
        const symbol = decodeURIComponent(parsedUrl.pathname.replace('/api/us-equity/stock/', ''));
        handleAsyncRoute(res, handleUsStock(req, res, symbol), 'US_STOCK_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/predictions') {
        handleAsyncRoute(res, handleUsPredictionsAlias(req, res, parsedUrl), 'US_PREDICTIONS_FAILED');
        return;
    }

    if (parsedUrl.pathname === '/api/tracking/summary') {
        handleAsyncRoute(res, handleTrackingSummary(req, res), 'TRACKING_SUMMARY_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/tracking/universe') {
        handleAsyncRoute(res, handleTrackingUniverse(req, res, parsedUrl), 'TRACKING_UNIVERSE_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/tracking/factors') {
        handleAsyncRoute(res, handleTrackingFactors(req, res, parsedUrl), 'TRACKING_FACTORS_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/tracking/coverage') {
        handleAsyncRoute(res, handleTrackingCoverage(req, res), 'TRACKING_COVERAGE_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/tracking/actions') {
        handleAsyncRoute(res, handleTrackingActions(req, res, parsedUrl), 'TRACKING_ACTIONS_FAILED');
        return;
    }
    if (parsedUrl.pathname === '/api/tracking/simulate') {
        handleAsyncRoute(res, handleTrackingSimulate(req, res), 'TRACKING_SIMULATE_FAILED');
        return;
    }

    if (parsedUrl.pathname === '/api/home/landing') {
        handleAsyncRoute(res, handleHomeLanding(req, res), 'HOME_LANDING_FAILED');
        return;
    }

    if (parsedUrl.pathname === '/api/alerts') {
        handleAlertContract(req, res);
        return;
    }

    if (parsedUrl.pathname.startsWith('/api/model-explorer')) {
        proxyModelExplorer(req, res, parsedUrl);
        return;
    }

    if (parsedUrl.pathname.startsWith('/api/')) {
        proxyApi(req, res);
        return;
    }

    if (parsedUrl.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    serveStatic(req, res);
});

process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`UNHANDLED_REJECTION: ${message}`);
});

server.listen(PORT, HOST, () => {
    console.log(`Unified server listening at http://${HOST}:${PORT}`);
    console.log(`API proxy target: http://${API_HOST}:${API_PORT}`);
    console.log(`Model explorer proxy target: ${MODEL_EXPLORER_SCHEME}://${MODEL_EXPLORER_HOST}:${MODEL_EXPLORER_PORT}`);
    console.log(`Web root: ${WEB_ROOT}`);
    console.log(`App data dir: ${APP_DATA_DIR}`);
    console.log(`App version: ${APP_VERSION}`);
    console.log(`Loaded CSI300 snapshot rows: ${csi300Snapshot.length}`);
    console.log(`Loaded S&P 500 snapshot rows: ${sp500Snapshot.length}`);
});
