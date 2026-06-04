const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = 'DarkZone2025';

// Enable CORS
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

// ========== Panel Configuration (for OTPs and numbers) ==========
const ST_PANEL = {
  baseUrl: 'http://51.89.99.105/NumberPanel',
  username: 'Ak_78600',
  password: '112233'
};

// Also keep the OTP panels as before
const OTP_PANELS = [
  {
    name: 'KONEK',
    url: 'http://51.77.216.195/crapi/konek/viewstats',
    token: 'RFRXSjRSQmNccJFIWpN1e16XVIdYjGtlSGlphVVRUHpClnlginKV'
  },
  {
    name: 'ST Panel',
    url: 'http://147.135.212.197/crapi/st/viewstats',
    token: 'RVVVQ0dBUzRaZIdif2p2ZltibIB5lYp5d2FxfVdwcmJhjWqBYomEUw=='
  }
];

// ========== Country prefix mapping ==========
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

function cleanAndFormatNumber(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const info = getCountryInfo(digits);
  if (!info) return null;
  // If the digits already start with the country code, extract the rest
  let rest = digits;
  const countryCodeDigits = info.code.replace('+', '');
  if (digits.startsWith(countryCodeDigits)) {
    rest = digits.substring(countryCodeDigits.length);
  }
  if (rest.length < 7) return null;
  return info.code + rest;
}

// ========== Panel Login + Number Fetch ==========
// We need a cookie‑aware axios session
const axiosCookie = wrapper(axios.create({ jar: new CookieJar() }));

async function loginToPanel() {
  console.log('[LOGIN] Logging into ST panel...');
  try {
    // 1. Get login page to extract captcha
    const loginPage = await axiosCookie.get(`${ST_PANEL.baseUrl}/login`);
    const captchaMatch = loginPage.data.match(/What is (\d+) \+ (\d+) = \?/);
    if (!captchaMatch) throw new Error('Captcha not found');
    const ans = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
    console.log(`[LOGIN] Captcha answer: ${ans}`);

    // 2. Submit login
    const loginRes = await axiosCookie.post(`${ST_PANEL.baseUrl}/signin`, 
      new URLSearchParams({
        username: ST_PANEL.username,
        password: ST_PANEL.password,
        capt: ans
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 0,
        validateStatus: status => status < 500
      }
    );
    if (loginRes.status !== 302 && loginRes.status !== 200) {
      throw new Error(`Login failed with status ${loginRes.status}`);
    }
    console.log('[LOGIN] Login successful.');
    return true;
  } catch (err) {
    console.error('[LOGIN] Error:', err.message);
    return false;
  }
}

async function fetchNumbersFromPanel() {
  // Ensure logged in
  const loggedIn = await loginToPanel();
  if (!loggedIn) return [];

  try {
    // The numbers endpoint (same as in original Node.js)
    const ts = Date.now();
    const url = `${ST_PANEL.baseUrl}/agent/res/data_smsnumbers.php?frange=&fagent=&sEcho=2&iDisplayStart=0&iDisplayLength=-1&_=${ts}`;
    const response = await axiosCookie.get(url, {
      headers: { 'Referer': `${ST_PANEL.baseUrl}/agent/MySMSNumbers2` }
    });
    const data = response.data;
    if (!data.aaData) return [];
    // aaData is array of arrays: each row contains [?, ?, ?, phone, plan, ...]
    const numbers = [];
    for (const row of data.aaData) {
      const rawPhone = row[3]; // phone number at index 3
      if (!rawPhone) continue;
      const cleaned = cleanAndFormatNumber(rawPhone);
      if (cleaned) {
        numbers.push(cleaned);
      }
    }
    return numbers;
  } catch (err) {
    console.error('[PANEL FETCH] Error:', err.message);
    return [];
  }
}

async function syncNumbers() {
  console.log('[SYNC] Fetching current numbers from panel...');
  const panelNumbers = await fetchNumbersFromPanel();
  if (!panelNumbers.length) {
    console.log('[SYNC] No numbers retrieved.');
    return;
  }

  // Get current DB numbers
  const dbNumbers = await new Promise((resolve, reject) => {
    db.all("SELECT phone FROM numbers", (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.phone));
    });
  });

  const panelSet = new Set(panelNumbers);
  const dbSet = new Set(dbNumbers);

  // Numbers to add: in panel but not in DB
  const toAdd = panelNumbers.filter(phone => !dbSet.has(phone));
  // Numbers to delete: in DB but not in panel
  const toDelete = dbNumbers.filter(phone => !panelSet.has(phone));

  if (toAdd.length) {
    console.log(`[SYNC] Adding ${toAdd.length} new numbers...`);
    // Group by country for insertion
    const groups = {};
    for (const phone of toAdd) {
      const digits = phone.replace(/\D/g, '');
      const info = getCountryInfo(digits);
      const country = info ? info.name : 'Unknown';
      if (!groups[country]) groups[country] = [];
      groups[country].push(phone);
    }
    for (const [country, phones] of Object.entries(groups)) {
      const stmt = db.prepare("INSERT OR IGNORE INTO numbers (country, phone) VALUES (?, ?)");
      for (const phone of phones) {
        stmt.run([country, phone]);
      }
      stmt.finalize();
      console.log(`[SYNC] Added ${phones.length} numbers for ${country}`);
    }
  }

  if (toDelete.length) {
    console.log(`[SYNC] Deleting ${toDelete.length} numbers that are no longer in panel...`);
    const placeholders = toDelete.map(() => '?').join(',');
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM numbers WHERE phone IN (${placeholders})`, toDelete, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`[SYNC] Deleted ${toDelete.length} numbers.`);
  }

  if (toAdd.length === 0 && toDelete.length === 0) {
    console.log('[SYNC] No changes.');
  }
}

// ========== Public Endpoints ==========
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
  for (const panel of OTP_PANELS) {
    const url = `${panel.url}?token=${encodeURIComponent(panel.token)}&records=${limit}`;
    try {
      const response = await axios.get(url, { timeout: 10000 });
      const data = response.data;
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

function extractOtp(text) {
  if (!text) return null;
  const match = text.match(/(?<!\d)(\d{3,4})[\s\-]?(\d{3,4})(?!\d)/);
  if (match) return match[1] + match[2];
  const match2 = text.match(/(?<!\d)(\d{4,8})(?!\d)/);
  return match2 ? match2[1] : null;
}

// ========== Admin Endpoints ==========
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
    stmt.run([country.toUpperCase(), phone], function(err) { if (!err && this.changes > 0) added++; });
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
  res.json({ success: true, message: 'Manual sync started.' });
  syncNumbers().catch(console.error);
});

// ========== UI and root ==========
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Add Virtual Numbers</title><style>body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:2rem;}</style></head>
    <body>
      <h2>➕ Add Virtual Numbers to API</h2>
      <p>API Base: <code>${req.protocol}://${req.get('host')}</code></p>
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
      <p>⏰ This API automatically syncs numbers from the ST panel every 10 minutes.</p>
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
        <li><code>GET /api/admin/sync</code> – manually trigger sync</li>
      </ul>
      <p><a href="/admin">📁 Open Admin Panel to add numbers</a></p>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" target="_blank" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

// ========== Schedule periodic sync ==========
setTimeout(() => {
  syncNumbers().catch(console.error);
}, 5000); // initial sync after 5 seconds

setInterval(() => {
  console.log('[SYNC] Running scheduled sync...');
  syncNumbers().catch(console.error);
}, 10 * 60 * 1000); // every 10 minutes

app.listen(PORT, () => {
  console.log(`🚀 Dark Tech Zone API running on port ${PORT}`);
});
