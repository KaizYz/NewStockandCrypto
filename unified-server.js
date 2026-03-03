// Unified server for StockandCrypto.
// Exposes static frontend and API proxy on the same port (default: 9000).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 9000);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 5001);
const WEB_ROOT = path.join(__dirname, 'web');

const CRYPTO_CACHE_TTL_MS = Number(process.env.CRYPTO_CACHE_TTL_MS || 9000);
const BINANCE_US_URL = 'https://api.binance.us/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22%5D';

let cryptoPriceCache = null;
let cryptoPriceCacheAt = 0;

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

function parseNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

function fetchBinanceUS() {
    return new Promise((resolve, reject) => {
        const req = https.request(BINANCE_US_URL, { method: 'GET', timeout: 5000 }, (upstream) => {
            let body = '';
            upstream.on('data', (chunk) => { body += chunk.toString('utf8'); });
            upstream.on('end', () => {
                if (upstream.statusCode < 200 || upstream.statusCode > 299) {
                    reject(new Error(`Upstream status ${upstream.statusCode}`));
                    return;
                }

                try {
                    const rows = JSON.parse(body);
                    resolve(normalizeTickerRows(rows));
                } catch (error) {
                    reject(new Error(`Invalid upstream JSON: ${error.message}`));
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('Upstream timeout')));
        req.on('error', reject);
        req.end();
    });
}

async function handleCryptoPrices(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const now = Date.now();
    if (cryptoPriceCache && now - cryptoPriceCacheAt <= CRYPTO_CACHE_TTL_MS) {
        sendJson(res, 200, cryptoPriceCache);
        return;
    }

    try {
        const payload = await fetchBinanceUS();
        cryptoPriceCache = payload;
        cryptoPriceCacheAt = Date.now();
        sendJson(res, 200, payload);
    } catch (error) {
        if (cryptoPriceCache) {
            sendJson(res, 200, {
                ...cryptoPriceCache,
                meta: {
                    ...cryptoPriceCache.meta,
                    stale: true,
                    stale_reason: error.message
                }
            });
            return;
        }
        sendJson(res, 502, {
            error: 'Failed to fetch crypto prices from Binance US',
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

const server = http.createServer((req, res) => {
    if (!req.url) {
        sendJson(res, 400, { error: 'Empty URL' });
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (parsedUrl.pathname === '/api/crypto/prices') {
        handleCryptoPrices(req, res);
        return;
    }

    if (parsedUrl.pathname === '/api/alerts') {
        handleAlertContract(req, res);
        return;
    }

    if (parsedUrl.pathname.startsWith('/api/')) {
        proxyApi(req, res);
        return;
    }

    serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
    console.log(`Unified server listening at http://${HOST}:${PORT}`);
    console.log(`API proxy target: http://${API_HOST}:${API_PORT}`);
    console.log(`Web root: ${WEB_ROOT}`);
});
