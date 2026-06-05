const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIGURATION ==========
const CREDENTIALS = {
    username: "Ak_78600",
    password: "112233"
};

const BASE_URL = "http://51.89.99.105/NumberPanel";
const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Accept-Language": "en-US,en;q=0.9,ur-PK;q=0.8,ur;q=0.7"
};

// ========== GLOBAL STATE ==========
let STATE = {
    lastLoginTime: 0,
    cookie: null,
    sessKey: null,
    loginPromise: null
};

let numbersCache = { data: null, lastFetch: 0, date: null };
const CACHE_TTL = 16000; // 16 seconds
const SESSION_TTL = 60 * 60 * 1000; // 1 hour

function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function extractKey(html) {
    let match = html.match(/sesskey=([^&"']+)/);
    if (match) return match[1];
    match = html.match(/sesskey\s*[:=]\s*["']([^"']+)["']/);
    if (match) return match[1];
    return null;
}

async function performLogin() {
    if (STATE.loginPromise) return STATE.loginPromise;
    STATE.loginPromise = (async () => {
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            console.log(`🔐 Login attempt ${attempt}/${MAX_RETRIES}...`);
            try {
                const instance = axios.create({ headers: COMMON_HEADERS, timeout: 15000, withCredentials: true });
                // 1. Get login page + captcha
                const r1 = await instance.get(`${BASE_URL}/login`);
                let tempCookie = "";
                if (r1.headers['set-cookie']) {
                    const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
                    if (c) tempCookie = c.split(';')[0];
                }
                const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
                if (!match) throw new Error("Captcha not found");
                const ans = parseInt(match[1]) + parseInt(match[2]);
                console.log("🔢 Captcha:", ans);

                // 2. Submit login
                const r2 = await instance.post(`${BASE_URL}/signin`, new URLSearchParams({
                    username: CREDENTIALS.username,
                    password: CREDENTIALS.password,
                    capt: ans
                }), {
                    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": tempCookie, "Referer": `${BASE_URL}/login` },
                    maxRedirects: 0,
                    validateStatus: () => true
                });

                // Update cookie
                if (r2.headers['set-cookie']) {
                    const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
                    STATE.cookie = newC ? newC.split(';')[0] : tempCookie;
                } else {
                    STATE.cookie = tempCookie;
                }

                // 3. IMPORTANT: Use the numbers page to extract sesskey (same as original working code)
                const numbersUrl = `${BASE_URL}/agent/MySMSNumbers`;
                const r3 = await axios.get(numbersUrl, {
                    headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": `${BASE_URL}/agent/MySMSNumbers2` },
                    timeout: 15000
                });
                if (r3.data.includes('id="loginform"')) {
                    throw new Error("Login rejected — still on login page");
                }
                const key = extractKey(r3.data);
                if (!key) throw new Error("sessKey not found in /agent/MySMSNumbers");
                STATE.sessKey = key;
                STATE.lastLoginTime = Date.now();
                console.log(`✅ Login complete! sessKey: ${key}`);
                return;
            } catch(e) {
                console.error(`❌ Login attempt ${attempt} failed: ${e.message}`);
                STATE.cookie = null;
                STATE.sessKey = null;
                if (attempt < MAX_RETRIES) {
                    const delay = attempt * 2000;
                    console.log(`⏳ Retrying in ${delay/1000}s...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw new Error(`Login failed after ${MAX_RETRIES} attempts: ${e.message}`);
                }
            }
        }
    })();
    await STATE.loginPromise;
    STATE.loginPromise = null;
}

async function fetchWithRelogin(urlFn, referer) {
    const MAX = 3;
    for (let attempt = 1; attempt <= MAX; attempt++) {
        const sessionAge = Date.now() - STATE.lastLoginTime;
        if (STATE.cookie && STATE.sessKey && sessionAge > SESSION_TTL) {
            console.log(`⏰ Session expired — relogin...`);
            STATE.cookie = null;
            STATE.sessKey = null;
        }

        if (!STATE.cookie || !STATE.sessKey) {
            console.log(`🔁 No session (attempt ${attempt}/${MAX}) — logging in...`);
            await performLogin();
            if (!STATE.sessKey) {
                if (attempt < MAX) continue;
                throw new Error("Login succeeded but sessKey missing");
            }
        }

        const url = typeof urlFn === 'function' ? urlFn() : urlFn;
        try {
            const response = await axios.get(url, {
                headers: { ...COMMON_HEADERS, "Cookie": STATE.cookie, "Referer": referer },
                timeout: 20000
            });
            const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            if (body.includes('Direct Script') || body.includes('id="loginform"')) {
                console.warn(`⚠️ Session expired (attempt ${attempt}/${MAX}) — relogin...`);
                STATE.cookie = null;
                STATE.sessKey = null;
                if (attempt < MAX) {
                    await performLogin();
                    continue;
                }
                throw new Error("Session expired — relogin failed");
            }
            return response.data;
        } catch(e) {
            if (e.response?.status === 403) {
                console.warn(`⚠️ 403 (attempt ${attempt}/${MAX}) — relogin...`);
                STATE.cookie = null;
                STATE.sessKey = null;
                if (attempt < MAX) {
                    await performLogin();
                    continue;
                }
            }
            throw e;
        }
    }
}

// ========== CLEANING & COUNTRY DETECTION ==========
const COUNTRY_MAP = {
    '58': { code: '+58', name: 'Venezuela' },
    '92': { code: '+92', name: 'Pakistan' },
    '91': { code: '+91', name: 'India' },
    '1':  { code: '+1',  name: 'USA/Canada' },
    '44': { code: '+44', name: 'United Kingdom' },
};

function getCountryFromNumber(phoneDigits) {
    for (let len = 4; len > 0; len--) {
        const prefix = phoneDigits.substring(0, len);
        if (COUNTRY_MAP[prefix]) return COUNTRY_MAP[prefix];
    }
    return null;
}

function cleanNumber(rawPhone) {
    const digits = (rawPhone || '').replace(/\D/g, '');
    if (!digits || digits.length < 7) return null;
    const info = getCountryFromNumber(digits);
    if (info) {
        let countryCode = info.code.replace('+', '');
        let rest = digits;
        if (digits.startsWith(countryCode)) rest = digits.substring(countryCode.length);
        if (rest.length < 7) return null;
        return { phone: info.code + rest, country: info.name };
    }
    return { phone: '+' + digits, country: 'Unknown' };
}

// ========== FETCH NUMBERS ==========
async function fetchNumbers() {
    const ts = Date.now();
    const url = `${BASE_URL}/agent/res/data_smsnumbers.php?frange=&fagent=&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    const referer = `${BASE_URL}/agent/MySMSNumbers2`;
    const raw = await fetchWithRelogin(() => url, referer);
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // Transform aaData (same as original fixNumbers)
    if (data.aaData) {
        data.aaData = data.aaData.map(row => [
            row[1], "", row[3],
            (row[4] || "").replace(/<[^>]+>/g, "").trim(),
            (row[7] || "").replace(/<[^>]+>/g, "").trim()
        ]);
    }
    const rawNumbers = (data.aaData || []).map(row => row[2]).filter(p => p);
    const cleaned = rawNumbers.map(raw => cleanNumber(raw)).filter(n => n);
    return cleaned;
}

// ========== API ENDPOINT ==========
app.get('/api/numbers', async (req, res) => {
    const now = Date.now();
    const today = getTodayDate();

    if (numbersCache.data && numbersCache.date === today && (now - numbersCache.lastFetch) < CACHE_TTL) {
        console.log(`📦 Cache hit – ${numbersCache.data.length} numbers`);
        return res.json({ success: true, cached: true, count: numbersCache.data.length, numbers: numbersCache.data });
    }

    try {
        const numbers = await fetchNumbers();
        numbersCache = { data: numbers, lastFetch: now, date: today };
        res.json({ success: true, cached: false, count: numbers.length, numbers });
    } catch (err) {
        console.error('❌ Fetch error:', err.message);
        if (numbersCache.data) {
            res.json({ success: true, cached: true, stale: true, count: numbersCache.data.length, numbers: numbersCache.data });
        } else {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Dark Tech Zone Numbers API</title></head>
        <body style="background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;">
            <h1>🔐 Dark Tech Zone Virtual Numbers API</h1>
            <p>✅ Running</p>
            <p><code>GET /api/numbers</code> – returns cleaned numbers with country</p>
            <p>© Dark Tech Zone — Advanced Security Division</p>
        </body>
        </html>
    `);
});

// ========== AUTO-RELOGIN SCHEDULER ==========
async function doAutoRelogin() {
    console.log("⏰ Auto relogin triggered...");
    STATE.cookie = null;
    STATE.sessKey = null;
    try {
        await performLogin();
        console.log("✅ Auto relogin successful");
    } catch(e) {
        console.error("❌ Auto relogin failed:", e.message);
    }
}

function scheduleNextRelogin() {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const msUntilNext = nextHour - now;
    console.log(`🕐 Next auto relogin at ${nextHour.toLocaleTimeString()} (in ${Math.round(msUntilNext/1000)}s)`);
    setTimeout(async () => {
        await doAutoRelogin();
        scheduleNextRelogin();
    }, msUntilNext);
}

// ========== START ==========
performLogin().catch(e => console.error("Initial login error:", e.message));
scheduleNextRelogin();

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
