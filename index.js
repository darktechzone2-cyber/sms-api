const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');

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

// ========== Panel configuration (direct) ==========
const PANELS = [
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

// ========== Source API for auto‑sync ==========
const SOURCE_API = 'https://sms-api-lilac.vercel.app/';

// ========== Country mapping: prefix -> { code: country_code, name: country_name } ==========
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
  '966': { code: '+966', name: 'Saudi Arabia' },
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
  // phoneDigits is the raw number (digits only, no '+')
  for (let len = 4; len > 0; len--) {
    const prefix = phoneDigits.substring(0, len);
    if (COUNTRY_MAP[prefix]) {
      return COUNTRY_MAP[prefix];
    }
  }
  return null;
}

function cleanAndFormatNumber(rawPhone) {
  // Remove all non‑digits
  let digits = (rawPhone || '').replace(/\D/g, '');
  if (!digits) return null;
  
  const countryInfo = getCountryInfo(digits);
  if (countryInfo) {
    // If the digits already start with the country code, use as is, else prepend
    // But we want to store international format with '+'
    let countryCode = countryInfo.code.replace('+', ''); // e.g., '58'
    let rest = digits;
    if (digits.startsWith(countryCode)) {
      rest = digits.substring(countryCode.length);
    }
    // Ensure the number is at least 7 digits after country code
    if (rest.length < 7) return null;
    return countryInfo.code + rest;
  }
  // Unknown – just add '+' and return as is
  return '+' + digits;
}

async function syncFromSTPanel() {
  console.log('[SYNC] Fetching numbers from ST panel API...');
  try {
    const response = await axios.get(SOURCE_API, { timeout: 15000 });
    const data = response.data;
    const items = data.numbers || [];
    if (!items.length) {
      console.log('[SYNC] No numbers found in source.');
      return;
    }

    const groups = {};
    for (const item of items) {
      let rawPhone = item.phone;
      if (!rawPhone) continue;
      
      // Clean and format the number
      const cleanPhone = cleanAndFormatNumber(rawPhone);
      if (!cleanPhone) {
        console.log(`[SYNC] Skipping invalid number: ${rawPhone}`);
        continue;
      }
      
      // Determine country name from the cleaned number's prefix
      const digits = cleanPhone.replace(/\D/g, '');
      const countryInfo = getCountryInfo(digits);
      const countryName = countryInfo ? countryInfo.name : 'Unknown';
      
      if (!groups[countryName]) groups[countryName] = [];
      groups[countryName].push(cleanPhone);
    }

    // Insert each group
    for (const [country, phones] of Object.entries(groups)) {
      const stmt = db.prepare("INSERT OR IGNORE INTO numbers (country, phone) VALUES (?, ?)");
      let added = 0;
      for (const phone of phones) {
        stmt.run([country, phone], function(err) {
          if (!err && this.changes > 0) added++;
        });
      }
      stmt.finalize((err) => {
        if (err) console.error(`[SYNC] Error inserting ${country}:`, err.message);
        else console.log(`[SYNC] Inserted ${added} new numbers for ${country} (total ${phones.length})`);
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('[SYNC] Sync completed.');
  } catch (err) {
    console.error('[SYNC] Error:', err.message);
  }
}

// ========== PUBLIC ENDPOINTS (unchanged) ==========
// ... (keep your existing app.get endpoints for /api/countries, /api/number, /api/otps, etc.)
// I will copy them from the original to save space – they remain identical.

// For brevity, I'll assume you have the same public endpoints.
// But to be complete, I'll include them (they are the same as in your original index.js).

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

// ========== ADMIN ENDPOINTS (keep as before) ==========
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
  res.json({ success: true, message: 'Sync started in background.' });
  syncFromSTPanel().catch(console.error);
});

// ========== Web UI and root (same as before) ==========
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

// ========== START SERVER WITH AUTO-SYNC ==========
setTimeout(() => {
  syncFromSTPanel().catch(console.error);
}, 5000);

setInterval(() => {
  console.log('[SYNC] Running scheduled sync...');
  syncFromSTPanel().catch(console.error);
}, 10 * 60 * 1000); // 10 minutes

app.listen(PORT, () => {
  console.log(`🚀 Dark Tech Zone API running on port ${PORT}`);
});
