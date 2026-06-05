const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const CREDENTIALS = {
    username: "Ak_78600",
    password: "112233"
};
const BASE_URL = "http://51.89.99.105/NumberPanel";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Accept-Language": "en-US,en;q=0.9"
};

let cookie = null;
let lastLogin = 0;
const SESSION_TTL = 60 * 60 * 1000;

async function login() {
    console.log("[LOGIN] Starting...");
    const session = axios.create({ withCredentials: true });
    session.defaults.headers.common = HEADERS;

    // Step 1: Get login page (captcha)
    const r1 = await session.get(`${BASE_URL}/login`);
    console.log("[DEBUG] Login page status:", r1.status);
    console.log("[DEBUG] Set-Cookie headers (login page):", r1.headers['set-cookie']);

    const captchaMatch = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
    if (!captchaMatch) throw new Error("Captcha not found");
    const ans = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
    console.log("[LOGIN] Captcha answer:", ans);

    // Step 2: Submit login
    const form = new URLSearchParams();
    form.append("username", CREDENTIALS.username);
    form.append("password", CREDENTIALS.password);
    form.append("capt", ans);
    const r2 = await session.post(`${BASE_URL}/signin`, form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": `${BASE_URL}/login` },
        maxRedirects: 0,
        validateStatus: () => true
    });
    console.log("[DEBUG] Login POST status:", r2.status);
    console.log("[DEBUG] Set-Cookie headers (login POST):", r2.headers['set-cookie']);

    // Step 3: Try to get PHPSESSID from any cookie
    let extractedCookie = null;
    const allSetCookies = [...(r1.headers['set-cookie'] || []), ...(r2.headers['set-cookie'] || [])];
    for (const c of allSetCookies) {
        // Look for any cookie name containing 'session' or 'PHPSESSID'
        const match = c.match(/^([^=]+)=([^;]+)/);
        if (match) {
            const name = match[1];
            const value = match[2];
            if (name.toLowerCase().includes('session') || name === 'PHPSESSID') {
                extractedCookie = `${name}=${value}`;
                break;
            }
        }
    }
    if (!extractedCookie) {
        // Also try to get from the session's cookie jar
        const cookieHeader = session.defaults.headers.Cookie || '';
        console.log("[DEBUG] Cookie header from session:", cookieHeader);
        const match = cookieHeader.match(/(PHPSESSID|session)=([^;]+)/);
        if (match) extractedCookie = `${match[1]}=${match[2]}`;
    }
    if (!extractedCookie) throw new Error("No session cookie received");
    cookie = extractedCookie;
    lastLogin = Date.now();
    console.log("[LOGIN] Success, cookie:", cookie);
    return cookie;
}

async function ensureSession() {
    if (!cookie || (Date.now() - lastLogin) > SESSION_TTL) {
        console.log("[SESSION] Expired, re-logging...");
        await login();
    }
}

async function fetchNumbers() {
    await ensureSession();
    const ts = Date.now();
    const url = `${BASE_URL}/agent/res/data_smsnumbers.php?frange=&fagent=&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    const response = await axios.get(url, {
        headers: {
            ...HEADERS,
            "Cookie": cookie,
            "Referer": `${BASE_URL}/agent/MySMSNumbers2`
        }
    });
    const data = response.data;
    const rawNumbers = (data.aaData || []).map(row => row[3]).filter(p => p);
    return rawNumbers;
}

// Country mapping (same as before)
const COUNTRY_MAP = {
    '58': { code: '+58', name: 'Venezuela' },
    '92': { code: '+92', name: 'Pakistan' },
    '91': { code: '+91', name: 'India' },
    '1':  { code: '+1', name: 'USA/Canada' },
    '44': { code: '+44', name: 'United Kingdom' },
    // add more as needed
};

function getCountry(phoneDigits) {
    for (let len = 4; len > 0; len--) {
        const prefix = phoneDigits.substring(0, len);
        if (COUNTRY_MAP[prefix]) return COUNTRY_MAP[prefix];
    }
    return null;
}

function cleanNumber(raw) {
    const digits = raw.replace(/\D/g, '');
    if (!digits || digits.length < 7) return null;
    const info = getCountry(digits);
    if (info) {
        let rest = digits;
        const cc = info.code.replace('+', '');
        if (digits.startsWith(cc)) rest = digits.substring(cc.length);
        if (rest.length < 7) return null;
        return { phone: info.code + rest, country: info.name };
    }
    return { phone: '+' + digits, country: 'Unknown' };
}

app.get('/api/numbers', async (req, res) => {
    try {
        const raw = await fetchNumbers();
        const cleaned = raw.map(n => cleanNumber(n)).filter(n => n);
        res.json({ success: true, count: cleaned.length, numbers: cleaned });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

login().catch(err => {
    console.error("Initial login failed:", err.message);
    process.exit(1);
});
