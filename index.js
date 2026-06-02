const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== SECURITY ==========
const API_KEY = process.env.API_KEY || 'DarkZone2025';  // Set in Railway env!

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());

// API Key check for all /api/* routes (except admin endpoints if needed)
const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
};

// ========== SQLITE SETUP (Virtual Numbers) ==========
const db = new sqlite3.Database('./numbers.db');
db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// ========== PANEL CONFIGURATION (Direct fetch, no Cloudflare) ==========
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

// Cache for panel data (TTL 15 seconds)
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 15000; // 15 seconds

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

async function getAllMessages(limit = 100, source = null) {
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
    let messages = cache.data;
    if (source) {
      messages = messages.filter(m => m.source_id === source);
    }
    return messages.slice(0, limit);
  }

  let allMessages = [];
  for (const panel of PANELS) {
    const msgs = await fetchPanelMessages(panel, limit);
    allMessages.push(...msgs);
  }
  allMessages.sort((a, b) => new Date(b.time) - new Date(a.time));
  cache.data = allMessages;
  cache.timestamp = now;
  
  let result = allMessages;
  if (source) {
    result = result.filter(m => m.source_id === source);
  }
  return result.slice(0, limit);
}

// ========== PUBLIC ENDPOINTS (require API key) ==========
app.get('/api/otps', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const source = req.query.source === 'konek' ? 'konek' : (req.query.source === 'st' ? 'st' : null);
    const messages = await getAllMessages(limit, source);
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

// Countries with available virtual numbers
app.get('/api/countries', requireApiKey, (req, res) => {
  db.all("SELECT country, COUNT(*) as count FROM numbers GROUP BY country", (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, countries: rows.map(r => ({ code: r.country, count: r.count })) });
  });
});

// Get random virtual number(s)
app.get('/api/number', requireApiKey, (req, res) => {
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

// ========== ADMIN ENDPOINTS (require API key) ==========
// Add numbers (POST /api/admin/numbers)
app.post('/api/admin/numbers', requireApiKey, (req, res) => {
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
app.delete('/api/admin/country/:country', requireApiKey, (req, res) => {
  const country = req.params.country.toUpperCase();
  db.run("DELETE FROM numbers WHERE country = ?", [country], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// Delete a single number
app.delete('/api/admin/number', requireApiKey, (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  db.run("DELETE FROM numbers WHERE phone = ?", [phone], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// ========== WEB ADMIN PANEL ==========
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dark Tech Zone – Admin</title><style>body{background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;}</style></head>
    <body>
      <h1>🔐 Admin Panel</h1>
      <p>API Key: <code>${API_KEY}</code></p>
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
            headers: { 'Content-Type':'application/json', 'x-api-key':'${API_KEY}' },
            body: JSON.stringify({ country, numbers })
          });
          document.getElementById('result').innerText = await res.text();
        }
      </script>
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
      <h1>🚀 Dark Tech Zone Premium API</h1>
      <p>✅ Running</p>
      <p>Use <code>x-api-key: ${API_KEY}</code> header for all requests.</p>
      <h2>Endpoints</h2>
      <ul>
        <li><code>GET /api/otps?limit=20&source=konek</code></li>
        <li><code>GET /api/countries</code></li>
        <li><code>GET /api/number?country=US&limit=1</code></li>
        <li><code>POST /api/admin/numbers</code> (admin)</li>
        <li><code>DELETE /api/admin/country/:country</code></li>
        <li><code>DELETE /api/admin/number</code></li>
      </ul>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" target="_blank" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Secure API running on port ${PORT}`);
  console.log(`🔑 API Key: ${API_KEY}`);
});
