// Unified server for StockandCrypto.
// Exposes static frontend and API routes on the same port (default: 9000).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 9000);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 5001);
const MODEL_EXPLORER_HOST = process.env.MODEL_EXPLORER_HOST || '127.0.0.1';
const MODEL_EXPLORER_PORT = Number(process.env.MODEL_EXPLORER_PORT || 8000);
const WEB_ROOT = path.join(__dirname, 'web');

const CRYPTO_CACHE_TTL_MS = Number(process.env.CRYPTO_CACHE_TTL_MS || 9000);
const CN_CACHE_TTL_MS = Number(process.env.CN_CACHE_TTL_MS || 9000);
const CN_POLL_INTERVAL_SEC = Number(process.env.CN_POLL_INTERVAL_SEC || 10);
const CN_INDEX_HISTORY_CACHE_TTL_MS = Number(process.env.CN_INDEX_HISTORY_CACHE_TTL_MS || 60000);
const CN_INDEX_HISTORY_DEFAULT_INTERVAL = '1m';
const CN_INDEX_HISTORY_INTERVAL_ALLOW = new Set(['1m', '5m']);
const CN_INDEX_HISTORY_SESSION_ALLOW = new Set(['auto', 'today', 'last']);
const EASTMONEY_KLINE_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const US_CACHE_TTL_MS = Number(process.env.US_CACHE_TTL_MS || 9000);
const US_POLL_INTERVAL_SEC = Number(process.env.US_POLL_INTERVAL_SEC || 10);
const US_INDEX_FAST_CACHE_TTL_MS = Number(process.env.US_INDEX_FAST_CACHE_TTL_MS || 5000);
const US_INDEX_FAST_POLL_INTERVAL_SEC = Number(process.env.US_INDEX_FAST_POLL_INTERVAL_SEC || 5);
const US_INDEX_HISTORY_CACHE_TTL_MS = Number(process.env.US_INDEX_HISTORY_CACHE_TTL_MS || 60000);
const US_INDEX_HISTORY_DEFAULT_RANGE = '2d';
const US_INDEX_HISTORY_DEFAULT_INTERVAL = '5m';
const BINANCE_US_URL = 'https://api.binance.us/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22%5D';
const EASTMONEY_ULIST_FIELDS = 'f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f20,f21,f47,f48,f100,f103,f115';
const EASTMONEY_ULIST_BASE = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const STOOQ_BATCH_BASE = 'https://stooq.com/q/l/?f=sd2t2ohlcv&h&e=csv&s=';
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const SP500_SNAPSHOT_PATH = path.join(WEB_ROOT, 'assets', 'sp500-constituents.json');
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || '';
const US_ENABLE_ALPHA_FALLBACK = String(process.env.US_ENABLE_ALPHA_FALLBACK || 'true').toLowerCase() !== 'false';
const CSI300_SNAPSHOT_PATH = path.join(WEB_ROOT, 'assets', 'csi300-constituents.json');
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
const LIMIT_STATUS_ORDER = {
    LIMIT_UP: 3,
    LIMIT_DOWN: 2,
    NORMAL: 1
};

let cryptoPriceCache = null;
let cryptoPriceCacheAt = 0;
let cnCache = null;
let cnCacheAt = 0;
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

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
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
    const date = new Date(`${dateKey}T${parts.hour}:${parts.minute}:${parts.second}+08:00`);
    return { year, month, day, hour, minute, second, weekday, dateKey, date };
}

function makeShanghaiDate(dateKey, hour, minute, second = 0) {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    return new Date(`${dateKey}T${hh}:${mm}:${ss}+08:00`);
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
                timeout: timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Accept: 'application/json,text/plain,*/*'
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

function fetchBinanceUS() {
    return fetchJsonFromHttps(BINANCE_US_URL, 5000).then(normalizeTickerRows);
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

function parseStooqCsvRows(csvText) {
    const lines = String(csvText || '').trim().split(/\r?\n/);
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
    for (let i = 0; i < sourceSymbols.length; i += CHUNK_SIZE) {
        const chunk = sourceSymbols.slice(i, i + CHUNK_SIZE);
        const csvText = await fetchTextFromHttps(buildStooqBatchUrl(chunk), 9000);
        const rows = parseStooqCsvRows(csvText);
        rows.forEach((row) => bySymbol.set(row.symbol, row));
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

async function fetchEastMoneyQuotes(secids) {
    const CHUNK_SIZE = 60;
    const allRows = [];
    for (let i = 0; i < secids.length; i += CHUNK_SIZE) {
        const chunk = secids.slice(i, i + CHUNK_SIZE);
        const rows = await fetchEastMoneyQuotesForChunk(chunk);
        allRows.push(...rows);
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
    return bySecid;
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
    const policy = calculatePolicy(prediction);
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
        policy: {
            action: policy.action,
            positionSize: policy.positionSize,
            shortAllowed: false,
            leverage: 1.0,
            shortEligible: false,
            marginEligible,
            shortReason: CN_POLICY_SHORT_REASON,
            tPlusOneApplied: true
        },
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

async function fetchCnLivePayload() {
    const secids = [...Object.values(INDEX_SECIDS), ...csi300Secids];
    const quoteMap = await fetchEastMoneyQuotes(secids);
    const sseQuote = quoteMap.get(INDEX_SECIDS['000001.SH']);
    const csiQuote = quoteMap.get(INDEX_SECIDS['000300.SH']);
    if (!sseQuote || !csiQuote) {
        throw new Error('Missing critical CN index quotes from upstream');
    }

    const rows = csi300Snapshot.map((constituent) => asUniverseRow(constituent, quoteMap.get(constituent.secid)));
    const marketSession = computeMarketSession();

    return {
        meta: {
            source: 'eastmoney',
            timestamp: new Date().toISOString(),
            stale: false,
            pollIntervalSec: CN_POLL_INTERVAL_SEC,
            delayNote: CN_DELAY_NOTE,
            disclaimer: CN_DISCLAIMER
        },
        marketSession,
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

async function getCnPayloadWithCache() {
    const now = Date.now();
    if (cnCache && now - cnCacheAt <= CN_CACHE_TTL_MS) {
        return deepCopy(cnCache);
    }

    try {
        const payload = await fetchCnLivePayload();
        cnCache = payload;
        cnCacheAt = Date.now();
        return deepCopy(payload);
    } catch (error) {
        if (cnCache) {
            const stalePayload = deepCopy(cnCache);
            stalePayload.meta.stale = true;
            stalePayload.meta.staleReason = error.message;
            stalePayload.meta.timestamp = new Date().toISOString();
            return stalePayload;
        }
        throw error;
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
        const policy = calculatePolicy(prediction);
        const tpSl = calculateTpSl(indexData.price || 0, prediction, policy.signal);

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
            policy: {
                action: policy.action,
                signal: policy.signal,
                positionSize: policy.positionSize,
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

        const policySignal = row.policy.action.includes('Buy') ? 'LONG' : 'FLAT';
        const tpSl = calculateTpSl(row.price || 0, row.prediction, policySignal);

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
            tpSl
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
    const policy = calculateUsPolicy(prediction);
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
        policy,
        valuation: {
            marketCap: null,
            peTtm: null
        },
        status: quote.price === null ? 'ERROR' : status
    };
}

async function fetchUsLivePayload() {
    const indexSymbols = ['^DJI', '^NDX', '^SPX'];
    const allSymbols = [...new Set([...indexSymbols, ...sp500SourceSymbols])];
    const quoteMap = await fetchStooqQuotes(allSymbols);
    let source = 'stooq';

    const indices = {};
    for (const canonical of indexSymbols) {
        const config = US_INDEX_SYMBOL_CONFIG[canonical];
        const row = quoteMap.get(canonical);
        let quote = usQuoteFromStooqRow(row);
        if ((!quote || quote.price === null) && US_ENABLE_ALPHA_FALLBACK && ALPHA_VANTAGE_API_KEY) {
            const alphaQuote = await fetchAlphaIndexQuote(canonical);
            if (alphaQuote && alphaQuote.price !== null) {
                quote = alphaQuote;
                source = 'stooq+alpha';
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
    const marketSession = computeUsMarketSession();

    return {
        meta: {
            source,
            timestamp: new Date().toISOString(),
            stale: false,
            pollIntervalSec: US_POLL_INTERVAL_SEC,
            delayNote: US_DELAY_NOTE,
            disclaimer: US_DISCLAIMER
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
    const quoteMap = await fetchStooqQuotes(indexSymbols);
    let source = 'stooq';

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
                source = 'stooq+alpha';
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

    return {
        meta: {
            source,
            timestamp: new Date().toISOString(),
            stale: false,
            pollIntervalSec: US_INDEX_FAST_POLL_INTERVAL_SEC,
            delayNote: US_DELAY_NOTE,
            disclaimer: US_DISCLAIMER
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
        universe.rows = universe.rows.map((row) => ({ ...row, status: row.price === null ? 'ERROR' : status }));

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
        universe.rows = universe.rows.map((row) => ({ ...row, status: row.price === null ? 'ERROR' : status }));

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
        const policy = calculateUsPolicy(prediction);
        const tpSl = calculateUsTpSl(indexData.price || 0, prediction, policy.signal);

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

        const prediction = calculateUsPrediction(row);
        const policy = calculateUsPolicy(prediction);
        const tpSl = calculateUsTpSl(row.price || 0, prediction, policy.signal);

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
                pUp: prediction.pUp,
                pDown: prediction.pDown,
                confidence: prediction.confidence,
                signal: prediction.signal,
                q10: prediction.q10,
                q50: prediction.q50,
                q90: prediction.q90,
                window: prediction.window
            },
            policy,
            tpSl,
            valuation: row.valuation,
            status: row.price === null ? 'ERROR' : (payload.meta.stale ? 'STALE' : 'LIVE')
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

    const proxyReq = http.request(
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

    if (parsedUrl.pathname === '/api/cn-equity/prices') {
        handleCnPrices(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/indices/history') {
        handleCnIndicesHistory(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/csi300/quotes') {
        handleCnQuotes(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/csi300/ranking') {
        handleCnRanking(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/cn-equity/prediction/')) {
        const indexCode = decodeURIComponent(parsedUrl.pathname.replace('/api/cn-equity/prediction/', ''));
        handleCnIndexPrediction(req, res, indexCode);
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/cn-equity/stock/')) {
        const stockCode = decodeURIComponent(parsedUrl.pathname.replace('/api/cn-equity/stock/', ''));
        handleCnStock(req, res, stockCode);
        return;
    }
    if (parsedUrl.pathname === '/api/cn-equity/predictions') {
        handleCnPredictionsAlias(req, res, parsedUrl);
        return;
    }

    if (parsedUrl.pathname === '/api/us-equity/prices') {
        handleUsPrices(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/indices/history') {
        handleUsIndicesHistory(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/indices') {
        handleUsIndices(req, res);
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/sp500/quotes') {
        handleUsSp500Quotes(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/top-movers') {
        handleUsTopMovers(req, res, parsedUrl);
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/us-equity/prediction/')) {
        const indexSymbol = decodeURIComponent(parsedUrl.pathname.replace('/api/us-equity/prediction/', ''));
        handleUsIndexPrediction(req, res, indexSymbol);
        return;
    }
    if (parsedUrl.pathname.startsWith('/api/us-equity/stock/')) {
        const symbol = decodeURIComponent(parsedUrl.pathname.replace('/api/us-equity/stock/', ''));
        handleUsStock(req, res, symbol);
        return;
    }
    if (parsedUrl.pathname === '/api/us-equity/predictions') {
        handleUsPredictionsAlias(req, res, parsedUrl);
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

    serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
    console.log(`Unified server listening at http://${HOST}:${PORT}`);
    console.log(`API proxy target: http://${API_HOST}:${API_PORT}`);
    console.log(`Model explorer proxy target: http://${MODEL_EXPLORER_HOST}:${MODEL_EXPLORER_PORT}`);
    console.log(`Web root: ${WEB_ROOT}`);
    console.log(`Loaded CSI300 snapshot rows: ${csi300Snapshot.length}`);
    console.log(`Loaded S&P 500 snapshot rows: ${sp500Snapshot.length}`);
});
