const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = 'DarkZone2025';

app.use(cors());
app.use(express.json());

// ========== SQLite Database ==========
const db = new sqlite3.Database('./numbers.db');
db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// ========== ST Panel Credentials ==========
const ST_CREDENTIALS = {
  username: 'Ak_78600',
  password: '112233'
};
const BASE_URL = 'http://51.89.99.105/NumberPanel';
const NUMBERS_ENDPOINT = `${BASE_URL}/agent/res/data_smsnumbers.php`;

// ========== Country prefix mapping (prefix → { code, name }) ==========
const COUNTRY_MAP = {
  '58':  { code: '+58', name: 'Venezuela' },
  '92':  { code: '+92', name: 'Pakistan' },
  '91':  { code: '+91', name: 'India' },
  '1':   { code: '+1',  name: 'USA/Canada' },
  '44':  { code: '+44', name: 'United Kingdom' },
  '55':  { code: '+55', name: 'Brazil' },
  '54':  { code: '+54', name: 'Argentina' },
  '57':  { code: '+57', name: 'Colombia' },
  '52':  { code: '+52', name: 'Mexico' },
  '33':  { code: '+33', name: 'France' },
  '49':  { code: '+49', name: 'Germany' },
  '34':  { code: '+34', name: 'Spain' },
  '39':  { code: '+39', name: 'Italy' },
  '7':   { code: '+7',  name: 'Russia/Kazakhstan' },
  '81':  { code: '+81', name: 'Japan' },
  '86':  { code: '+86', name: 'China' },
  '82':  { code: '+82', name: 'South Korea' },
  '966': { code: '+966', name: 'Saudi Arabia' },
  '971': { code: '+971', name: 'UAE' },
  '20':  { code: '+20', name: 'Egypt' },
  '234': { code: '+234', name: 'Nigeria' },
  '27':  { code: '+27', name: 'South Africa' },
  '61':  { code: '+61', name: 'Australia' },
  '64':  { code: '+64', name: 'New Zealand' },
  '84':  { code: '+84', name: 'Vietnam' },
  '62':  { code: '+62', name: 'Indonesia' },
  '66':  { code: '+66', name: 'Thailand' },
  '60':  { code: '+60', name: 'Malaysia' },
  '63':  { code: '+63', name: 'Philippines' },
  '90':  { code: '+90', name: 'Turkey' },
  '48':  { code: '+48', name: 'Poland' },
  '46':  { code: '+46', name: 'Sweden' },
  '47':  { code: '+47', name: 'Norway' },
  '45':  { code: '+45', name: 'Denmark' },
  '41':  { code: '+41', name: 'Switzerland' },
  '43':  { code: '+43', name: 'Austria' },
  '32':  { code: '+32', name: 'Belgium' },
  '31':  { code: '+31', name: 'Netherlands' },
  '351': { code: '+351', name: 'Portugal' },
  '353': { code: '+353', name: 'Ireland' },
  '972': { code: '+972', name: 'Israel' },
  '965': { code: '+965', name: 'Kuwait' },
  '974': { code: '+974', name: 'Qatar' },
  '968': { code: '+968', name: 'Oman' },
  '973': { code: '+973', name: 'Bahrain' },
  '962': { code: '+962', name: 'Jordan' },
  '961': { code: '+961', name: 'Lebanon' },
  '963': { code: '+963', name: 'Syria' },
  '964': { code: '+964', name: 'Iraq' },
  '98':  { code: '+98', name: 'Iran' },
  '93':  { code: '+93', name: 'Afghanistan' },
  '880': { code: '+880', name: 'Bangladesh' },
  '94':  { code: '+94', name: 'Sri Lanka' },
  '977': { code: '+977', name: 'Nepal' },
  '975': { code: '+975', name: 'Bhutan' },
  '856': { code: '+856', name: 'Laos' },
  '855': { code: '+855', name: 'Cambodia' },
  '95':  { code: '+95', name: 'Myanmar' },
  '670': { code: '+670', name: 'Timor-Leste' },
  '673': { code: '+673', name: 'Brunei' },
  '679': { code: '+679', name: 'Fiji' },
  '687': { code: '+687', name: 'New Caledonia' },
  '689': { code: '+689', name: 'French Polynesia' },
  '590': { code: '+590', name: 'Guadeloupe' },
  '596': { code: '+596', name: 'Martinique' },
  '262': { code: '+262', name: 'Réunion' },
  '508': { code: '+508', name: 'Saint Pierre and Miquelon' },
};

function getCountryInfo(phoneDigits) {
  for (let len = 4; len > 0; len--) {
    const prefix = phoneDigits.substring(0, len);
    if (COUNTRY_MAP[prefix]) {
      return COUNTRY_MAP[prefix];
    }
  }
  return null;
}

function cleanAndFormatNumber(rawPhone) {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;
  const info = getCountryInfo(digits);
  if (info) {
    let countryCode = info.code.replace('+', '');
    let rest = digits;
    if (digits.startsWith(countryCode)) {
      rest = digits.substring(countryCode.length);
    }
    if (rest.length < 7) return null;
    return info.code + rest;
  }
  return '+' + digits;
}

// ========== PANEL LOGIN & NUMBER FETCH ==========
async function loginAndFetchNumbers() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  // 1. Get login page (captcha)
  const loginPage = await client.get(`${BASE_URL}/login`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const captchaMatch = loginPage.data.match(/What is (\d+) \+ (\d+) = \?/);
  if (!captchaMatch) throw new Error('Captcha not found');
  const ans = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);

  // 2. Submit login
  await client.post(`${BASE_URL}/signin`, new URLSearchParams({
    username: ST_CREDENTIALS.username,
    password: ST_CREDENTIALS.password,
    capt: ans
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE_URL}/login` },
    maxRedirects: 0,
    validateStatus: () => true
  });

  // 3. Access the numbers endpoint (requires sesskey, but it's handled by cookies)
  const ts = Date.now();
  const numbersUrl = `${NUMBERS_ENDPOINT}?frange=&fagent=&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
  const numbersResp = await client.get(numbersUrl, {
    headers: { Referer: `${BASE_URL}/agent/MySMSNumbers2` }
  });
  if (numbersResp.status !== 200) throw new Error(`Numbers endpoint returned ${numbersResp.status}`);
  const data = numbersResp.data;
  const rows = data.aaData || [];
  const phoneSet = new Set();
  for (const row of rows) {
    const rawPhone = row[3]; // phone number column (index 3)
    if (rawPhone) phoneSet.add(rawPhone);
  }
  return Array.from(phoneSet);
}

// ========== SYNC LOGIC (full sync) ==========
async function fullSync() {
  console.log('[SYNC] Fetching numbers from ST panel...');
  try {
    const rawNumbers = await loginAndFetchNumbers();
    console.log(`[SYNC] Raw numbers fetched: ${rawNumbers.length}`);

    // Clean and format, group by country
    const cleanedMap = new Map(); // phone -> country
    for (const raw of rawNumbers) {
      const clean = cleanAndFormatNumber(raw);
      if (!clean) continue;
      // determine country from cleaned number
      const digits = clean.replace(/\D/g, '');
      const info = getCountryInfo(digits);
      const country = info ? info.name : 'Unknown';
      cleanedMap.set(clean, country);
    }

    // Get current phones from DB
    const dbPhones = await new Promise((resolve, reject) => {
      db.all("SELECT phone FROM numbers", (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.phone));
      });
    });

    const cleanPhones = Array.from(cleanedMap.keys());
    const toDelete = dbPhones.filter(p => !cleanPhones.includes(p));
    const toAdd = cleanPhones.filter(p => !dbPhones.includes(p));

    // Delete missing numbers
    for (const phone of toDelete) {
      await new Promise((resolve, reject) => {
        db.run("DELETE FROM numbers WHERE phone = ?", [phone], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    console.log(`[SYNC] Deleted ${toDelete.length} numbers no longer in panel.`);

    // Insert new numbers
    let added = 0;
    for (const phone of toAdd) {
      const country = cleanedMap.get(phone);
      await new Promise((resolve, reject) => {
        db.run("INSERT OR IGNORE INTO numbers (country, phone) VALUES (?, ?)", [country, phone], function(err) {
          if (!err && this.changes) added++;
          resolve();
        });
      });
    }
    console.log(`[SYNC] Inserted ${added} new numbers.`);
    console.log(`[SYNC] Total numbers in DB after sync: ${cleanPhones.length}`);
  } catch (err) {
    console.error('[SYNC] Error:', err.message);
  }
}

// ========== PUBLIC ENDPOINTS (unchanged) ==========
// Panel configuration for OTPs (same as before)
const PANELS = [
  { name: 'KONEK', url: 'http://51.77.216.195/crapi/konek/viewstats', token: 'RFRXSjRSQmNccJFIWpN1e16XVIdYjGtlSGlphVVRUHpClnlginKV' },
  { name: 'ST Panel', url: 'http://147.135.212.197/crapi/st/viewstats', token: 'RVVVQ0dBUzRaZIdif2p2ZltibIB5lYp5d2FxfVdwcmJhjWqBYomEUw==' }
];

function extractOtp(text) {
  if (!text) return null;
  const m = text.match(/(?<!\d)(\d{3,4})[\s\-]?(\d{3,4})(?!\d)/);
  if (m) return m[1] + m[2];
  const m2 = text.match(/(?<!\d)(\d{4,8})(?!\d)/);
  return m2 ? m2[1] : null;
}

app.get('/api/countries', (req, res) => {
  db.all("SELECT country, COUNT(*) as count FROM numbers GROUP BY country", (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, countries: rows.map(r => ({ code: r.country, count: r.count })) });
  });
});

app.get('/api/number', (req, res) => {
  const country = req.query.country ? req.query.country.toUpperCase() : null;
  const limit = Math.min(parseInt(req.query.limit) || 1, 10);
  let sql, params;
  if (country) {
    sql = "SELECT phone FROM numbers WHERE country = ? ORDER BY RANDOM() LIMIT ?";
    params = [country, limit];
  } else {
    sql = "SELECT phone FROM numbers ORDER BY RANDOM() LIMIT ?";
    params = [limit];
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const numbers = rows.map(r => r.phone);
    if (!numbers.length) {
      return res.status(404).json({ success: false, error: 'No numbers available' + (country ? ` for ${country}` : '') });
    }
    res.json({ success: true, count: numbers.length, numbers, country: country || 'random' });
  });
});

app.get('/api/otps', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  let allMessages = [];
  for (const panel of PANELS) {
    const url = `${panel.url}?token=${encodeURIComponent(panel.token)}&records=${limit}`;
    try {
      const resp = await axios.get(url, { timeout: 10000 });
      const data = resp.data;
      if (data && data.data && Array.isArray(data.data)) {
        for (const row of data.data) {
          allMessages.push({
            source: panel.name,
            time: row.dt || new Date().toISOString(),
            number: row.num || '',
            service: row.cli || '',
            message: row.message || '',
            otp: extractOtp(row.message)
          });
        }
      } else if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
        for (const row of data) {
          if (row.length >= 4) {
            allMessages.push({
              source: panel.name,
              time: row[3] || new Date().toISOString(),
              number: row[1] || '',
              service: row[0] || '',
              message: row[2] || '',
              otp: extractOtp(row[2])
            });
          }
        }
      }
    } catch (err) {
      console.error(`Panel ${panel.name} error:`, err.message);
    }
  }
  allMessages.sort((a, b) => new Date(b.time) - new Date(a.time));
  allMessages = allMessages.slice(0, limit);
  res.json({
    success: true,
    count: allMessages.length,
    messages: allMessages,
    branding: {
      channel: 'https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t',
      copyright: '© Dark Tech Zone — Advanced Security Division'
    }
  });
});

// ========== ADMIN ENDPOINTS ==========
function adminAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ success: false, error: 'Invalid API key' });
  next();
}

app.post('/api/admin/numbers', adminAuth, (req, res) => {
  const { country, numbers } = req.body;
  if (!country || !numbers || !Array.isArray(numbers) || !numbers.length) {
    return res.status(400).json({ success: false, error: 'Missing country or numbers array' });
  }
  const stmt = db.prepare("INSERT OR IGNORE INTO numbers (country, phone) VALUES (?, ?)");
  let added = 0;
  numbers.forEach(phone => {
    stmt.run([country, phone], function(err) { if (!err && this.changes > 0) added++; });
  });
  stmt.finalize(err => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, added, total: numbers.length });
  });
});

app.delete('/api/admin/country/:country', adminAuth, (req, res) => {
  const country = req.params.country.toUpperCase();
  db.run("DELETE FROM numbers WHERE country = ?", [country], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

app.delete('/api/admin/number', adminAuth, (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  db.run("DELETE FROM numbers WHERE phone = ?", [phone], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

app.get('/api/admin/sync', adminAuth, async (req, res) => {
  res.json({ success: true, message: 'Sync started' });
  fullSync().catch(console.error);
});

// ========== WEB UI ==========
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Add Virtual Numbers</title><style>body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:2rem;}</style></head>
    <body>
      <h2>➕ Add Virtual Numbers to API</h2>
      <p>API Base: <code>${req.protocol}://${req.get('host')}</code></p>
      <p>Numbers are also auto‑synced from ST panel every hour.</p>
      <input type="text" id="country" placeholder="Country code (e.g., US, PK, IN)" style="width:200px;"><br>
      <textarea id="numbers" rows="10" cols="50" placeholder="One phone number per line (with or without +)"></textarea><br>
      <button onclick="addNumbers()">Add Numbers</button>
      <pre id="result"></pre>
      <script>
        async function addNumbers() {
          const apiBase = window.location.origin;
          const country = document.getElementById('country').value;
          const numbersText = document.getElementById('numbers').value;
          const numbers = numbersText.split('\\n').map(l=>l.trim()).filter(l=>l);
          if (!country || numbers.length===0) return alert('Fill country and numbers');
          const res = await fetch(apiBase + '/api/admin/numbers', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'x-api-key':'DarkZone2025' },
            body: JSON.stringify({ country, numbers })
          });
          const data = await res.json();
          document.getElementById('result').innerText = JSON.stringify(data, null, 2);
        }
      </script>
      <hr>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" target="_blank" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dark Tech Zone API</title><style>body{background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;}</style></head>
    <body>
      <h1>🔐 Dark Tech Zone Virtual Numbers API</h1>
      <p>✅ Running at <code>${req.protocol}://${req.get('host')}</code></p>
      <p>⏰ Auto‑syncs with ST panel every hour (full sync: adds new, removes deleted).</p>
      <h2>📡 Public Endpoints</h2>
      <ul>
        <li><code>GET /api/countries</code></li>
        <li><code>GET /api/number?country=US&limit=1</code></li>
        <li><code>GET /api/otps?limit=50</code></li>
      </ul>
      <h2>🔑 Admin Endpoints (API key: DarkZone2025)</h2>
      <ul>
        <li><code>POST /api/admin/numbers</code> – add numbers</li>
        <li><code>DELETE /api/admin/country/:country</code></li>
        <li><code>DELETE /api/admin/number</code></li>
        <li><code>GET /api/admin/sync</code> – manual sync</li>
      </ul>
      <p><a href="/admin">📁 Open Admin Panel to add numbers</a></p>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" target="_blank" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

// ========== START SERVER WITH AUTO SYNC ==========
setTimeout(() => {
  fullSync().catch(console.error);
}, 5000);

setInterval(() => {
  console.log('[SYNC] Running scheduled full sync...');
  fullSync().catch(console.error);
}, 60 * 60 * 1000); // every hour

app.listen(PORT, () => {
  console.log(`🚀 Dark Tech Zone API running on port ${PORT}`);
});
