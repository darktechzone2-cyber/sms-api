const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== ADMIN KEY (only for /api/admin/*) ==========
const ADMIN_KEY = process.env.ADMIN_KEY || 'DarkZone2025';

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());

const requireAdminKey = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid admin key' });
  }
  next();
};

// ========== SQLITE (Virtual Numbers) ==========
const db = new sqlite3.Database('./numbers.db');
db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// ========== PANELS (Fixed ST token) ==========
const PANELS = [
  {
    id: 'konek',
    name: 'KONEK',
    url: 'http://51.77.216.195/crapi/konek/viewstats',
    token: 'RFRXSjRSQmNccJFIWpN1e16XVIdYjGtlSGlphVVRUHpClnlginKV'
  },
  {
    id: 'st',
    name: 'Number Panel (ST)',
    url: 'http://147.135.212.197/crapi/st/viewstats',
    token: 'SFBXRkFBUzSIiZZ8Y2FwSlqMb3yGkWOAi2lXW1JojFZbaFddaZRPdQ=='
  }
];

// Cache for OTP messages (15 seconds)
let otpCache = { data: null, timestamp: 0 };
const CACHE_TTL = 15000;

function extractOtp(text) {
  if (!text) return null;
  const match = text.match(/(?<!\d)(\d{3,4})[\s\-]?(\d{3,4})(?!\d)/);
  if (match) return match[1] + match[2];
  const match2 = text.match(/(?<!\d)(\d{4,8})(?!\d)/);
  return match2 ? match2[1] : null;
}

async function fetchPanelMessages(panel, limit = 100) {
  try {
    const url = `${panel.url}?token=${encodeURIComponent(panel.token)}&records=${limit}`;
    const res = await axios.get(url, { timeout: 10000 });
    const data = res.data;
    const messages = [];

    if (data?.data && Array.isArray(data.data)) {
      for (const row of data.data) {
        messages.push({
          source: panel.name,
          source_id: panel.id,
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
          messages.push({
            source: panel.name,
            source_id: panel.id,
            time: row[3] || new Date().toISOString(),
            number: row[1] || '',
            service: row[0] || '',
            message: row[2] || '',
            otp: extractOtp(row[2])
          });
        }
      }
    }
    return messages;
  } catch (err) {
    console.error(`Panel ${panel.name} error:`, err.message);
    return [];
  }
}

async function getAllMessages(limit = 100) {
  const now = Date.now();
  if (otpCache.data && (now - otpCache.timestamp) < CACHE_TTL) {
    return otpCache.data.slice(0, limit);
  }

  let allMessages = [];
  for (const panel of PANELS) {
    const msgs = await fetchPanelMessages(panel, limit);
    allMessages.push(...msgs);
  }
  allMessages.sort((a, b) => new Date(b.time) - new Date(a.time));
  otpCache.data = allMessages;
  otpCache.timestamp = now;
  return allMessages.slice(0, limit);
}

// ========== PUBLIC ENDPOINTS (no API key) ==========

// Get OTP messages (last 20, up to 200)
app.get('/api/otps', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);
    const messages = await getAllMessages(limit);
    res.json({
      success: true,
      count: messages.length,
      messages,
      branding: {
        channel: 'https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t',
        copyright: '© Dark Tech Zone — Advanced Security Division'
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get countries with available virtual numbers
app.get('/api/countries', (req, res) => {
  db.all("SELECT country, COUNT(*) as count FROM numbers GROUP BY country", (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, countries: rows.map(r => ({ code: r.country, count: r.count })) });
  });
});

// Get random virtual number(s)
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

// ========== ADMIN ENDPOINTS (require admin key) ==========

// Add numbers
app.post('/api/admin/numbers', requireAdminKey, (req, res) => {
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

// Delete all numbers of a country
app.delete('/api/admin/country/:country', requireAdminKey, (req, res) => {
  const country = req.params.country.toUpperCase();
  db.run("DELETE FROM numbers WHERE country = ?", [country], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// Delete a single number by phone
app.delete('/api/admin/number', requireAdminKey, (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  db.run("DELETE FROM numbers WHERE phone = ?", [phone], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// ========== SIMPLE WEB ADMIN PANEL ==========
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dark Tech Zone – Admin</title><style>body{background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;}</style></head>
    <body>
      <h1>🔐 Admin Panel</h1>
      <p>Admin Key: <code>${ADMIN_KEY}</code></p>
      <h2>Add Numbers</h2>
      <input type="text" id="country" placeholder="Country code (e.g., US)"><br>
      <textarea id="numbers" rows="10" cols="50" placeholder="One number per line"></textarea><br>
      <button onclick="add()">Add Numbers</button>
      <pre id="result"></pre>
      <script>
        async function add() {
          const country = document.getElementById('country').value;
          const numbers = document.getElementById('numbers').value.split('\\n').filter(l=>l.trim());
          const res = await fetch('/api/admin/numbers', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'x-api-key':'${ADMIN_KEY}' },
            body: JSON.stringify({ country, numbers })
          });
          document.getElementById('result').innerText = await res.text();
        }
      </script>
      <hr>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" target="_blank" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

// Root info page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dark Tech Zone API</title><style>body{background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;}</style></head>
    <body>
      <h1>🚀 Dark Tech Zone Premium API</h1>
      <p>✅ Running</p>
      <h2>Public Endpoints (No API key needed)</h2>
      <ul>
        <li><code>GET /api/otps?limit=20</code> – latest OTPs from both panels</li>
        <li><code>GET /api/countries</code> – list countries with available virtual numbers</li>
        <li><code>GET /api/number?country=US&limit=1</code> – get random virtual number</li>
      </ul>
      <h2>Admin Endpoints (require admin key)</h2>
      <p>Use header <code>x-api-key: ${ADMIN_KEY}</code></p>
      <ul>
        <li><code>POST /api/admin/numbers</code> – add numbers</li>
        <li><code>DELETE /api/admin/country/:country</code></li>
        <li><code>DELETE /api/admin/number</code> – body { "phone": "+123" }</li>
      </ul>
      <p><a href="/admin">📁 Open Admin Panel</a></p>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" target="_blank" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log(`🔑 Admin key: ${ADMIN_KEY}`);
});
