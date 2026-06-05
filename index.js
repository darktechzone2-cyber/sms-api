const express = require('express');
const axios = require('axios');
const cors = require('cors');   // <-- ADD CORS
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());   // <-- THIS IS THE FIX

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

let sessionCookie = null;
let lastLogin = 0;
const SESSION_TTL = 60 * 60 * 1000;

function getCookieFromHeaders(setCookieArray) {
    if (!setCookieArray || !setCookieArray.length) return null;
    const first = setCookieArray[0];
    const match = first.match(/^([^=]+)=([^;]+)/);
    if (match) return `${match[1]}=${match[2]}`;
    return null;
}

async function login() {
    console.log("[LOGIN] Starting...");
    let currentCookie = null;
    const r1 = await axios.get(`${BASE_URL}/login`, { headers: HEADERS });
    currentCookie = getCookieFromHeaders(r1.headers['set-cookie']);
    const captchaMatch = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
    if (!captchaMatch) throw new Error("Captcha not found");
    const ans = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
    console.log("[LOGIN] Captcha answer:", ans);
    const form = new URLSearchParams();
    form.append("username", CREDENTIALS.username);
    form.append("password", CREDENTIALS.password);
    form.append("capt", ans);
    const loginHeaders = { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded", "Referer": `${BASE_URL}/login` };
    if (currentCookie) loginHeaders["Cookie"] = currentCookie;
    const r2 = await axios.post(`${BASE_URL}/signin`, form, { headers: loginHeaders, maxRedirects: 0, validateStatus: () => true });
    const updatedCookie = getCookieFromHeaders(r2.headers['set-cookie']);
    if (updatedCookie) currentCookie = updatedCookie;
    if (!currentCookie) throw new Error("No session cookie received");
    sessionCookie = currentCookie;
    lastLogin = Date.now();
    console.log("[LOGIN] Success, session cookie:", sessionCookie);
    return sessionCookie;
}

async function ensureSession() {
    if (!sessionCookie || (Date.now() - lastLogin) > SESSION_TTL) {
        await login();
    }
}

async function fetchNumbers() {
    await ensureSession();
    const ts = Date.now();
    const url = `${BASE_URL}/agent/res/data_smsnumbers.php?frange=&fagent=&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    const resp = await axios.get(url, {
        headers: { ...HEADERS, "Cookie": sessionCookie, "Referer": `${BASE_URL}/agent/MySMSNumbers2` }
    });
    const data = resp.data;
    const rawNumbers = (data.aaData || []).map(row => row[3]).filter(p => p);
    return rawNumbers;
}

// Country mapping (short version – you can keep your full list)
const COUNTRY_MAP = {
    '58': { code: '+58', name: 'Venezuela' },
    '92': { code: '+92', name: 'Pakistan' },
    '91': { code: '+91', name: 'India' },
    '1':  { code: '+1', name: 'USA/Canada' },
    '44': { code: '+44', name: 'United Kingdom' }
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
            <p>✅ Running (CORS enabled)</p>
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
