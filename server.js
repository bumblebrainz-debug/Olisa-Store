/**
 * Olisa store - backend
 * Plain Node.js (no packages to install).
 *
 *   GET  /api/products        list products (?brand=Apple&q=pro)
 *   GET  /api/products/:id    one product
 *   POST /api/orders          place an order
 *   GET  /api/track/:code     track an order (order code or package code + ?phone=last4)
 *   GET  /api/orders          list orders (needs the x-admin-key header)
 *   PATCH /api/orders/:code   change order status (needs the x-admin-key header)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-this-key';
// Works with the tidy layout (public/ and data/ folders) AND with all files in one folder.
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const DATA_DIR = fs.existsSync(path.join(__dirname, 'data')) ? path.join(__dirname, 'data') : __dirname;
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
// Files that must never be sent to a browser (matters when everything is in one folder).
const PRIVATE_FILES = ['server.js', 'orders.json', 'package.json', 'package-lock.json', 'readme.md'];

if (!fs.existsSync(PRODUCTS_FILE)) { console.error('Cannot find products.json next to server.js (or in a data folder).'); process.exit(1); }
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// ---------- codes ----------
// Order statuses, in the order a package moves through them.
const STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

// Order code, e.g. ORD-2610-0007 (year, month, running number)
function makeOrderCode(orders) {
  const d = new Date();
  const ym = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
  return `ORD-${ym}-${String(orders.length + 1).padStart(4, '0')}`;
}
// Package code, e.g. PKG-7KQ3M9XD (random, easy to read: no 0/O/1/I)
function makePackageCode(existing) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = 'PKG-' + Array.from(crypto.randomBytes(8), b => chars[b % chars.length]).join('');
  } while (existing.some(o => o.packageCode === code));
  return code;
}

// ---------- helpers ----------
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100_000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ---------- order validation ----------
function validateOrder(body, products) {
  const errors = [];
  const customer = {
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim(),
    address: String(body.address || '').trim(),
    note: String(body.note || '').trim().slice(0, 300)
  };
  if (customer.name.length < 2) errors.push('Please enter your full name.');
  if (!/^[0-9+\s-]{7,16}$/.test(customer.phone)) errors.push('Please enter a valid phone number.');
  if (customer.address.length < 6) errors.push('Please enter your delivery address.');

  const items = [];
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push('Your cart is empty.');
  } else {
    for (const line of body.items) {
      const product = products.find(p => p.id === line.id);
      const qty = Number(line.qty);
      if (!product) { errors.push('One of the phones is no longer available.'); continue; }
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) { errors.push(`Invalid quantity for ${product.name}.`); continue; }
      if (qty > product.stock) { errors.push(`Only ${product.stock} left of ${product.name}.`); continue; }
      // Price always comes from the server, never from the browser.
      items.push({ id: product.id, sku: product.sku, name: product.name, storage: product.storage, qty, price: product.price });
    }
  }
  return { errors, customer, items };
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'products', ...]

  if (parts[1] === 'products' && req.method === 'GET') {
    const products = readJSON(PRODUCTS_FILE);
    if (parts[2]) {
      const one = products.find(p => p.id === parts[2]);
      return one ? sendJSON(res, 200, one) : sendJSON(res, 404, { error: 'Product not found' });
    }
    const brand = url.searchParams.get('brand');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = products.filter(p =>
      (!brand || p.brand.toLowerCase() === brand.toLowerCase()) &&
      (!q || `${p.brand} ${p.name}`.toLowerCase().includes(q)));
    return sendJSON(res, 200, list);
  }

  if (parts[1] === 'orders' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { errors: [e.message] }); }

    const products = readJSON(PRODUCTS_FILE);
    const { errors, customer, items } = validateOrder(body, products);
    if (errors.length) return sendJSON(res, 400, { errors });

    // reduce stock
    for (const line of items) products.find(p => p.id === line.id).stock -= line.qty;
    writeJSON(PRODUCTS_FILE, products);

    const orders = readJSON(ORDERS_FILE);
    const now = new Date().toISOString();
    const order = {
      id: makeOrderCode(orders),
      packageCode: makePackageCode(orders),
      createdAt: now,
      status: 'new',
      history: [{ status: 'new', at: now }],
      customer, items,
      total: items.reduce((sum, l) => sum + l.price * l.qty, 0)
    };
    orders.push(order);
    writeJSON(ORDERS_FILE, orders);
    console.log(`New order ${order.id} from ${customer.name} - total ${order.total}`);
    return sendJSON(res, 201, { id: order.id, packageCode: order.packageCode, total: order.total });
  }

  // Public tracking: needs the code AND the last 4 digits of the phone number
  if (parts[1] === 'track' && req.method === 'GET') {
    const code = String(parts[2] || '').toUpperCase();
    const last4 = String(url.searchParams.get('phone') || '').replace(/\D/g, '').slice(-4);
    const order = readJSON(ORDERS_FILE).find(o => o.id === code || o.packageCode === code);
    if (!order || last4.length < 4 || !order.customer.phone.replace(/\D/g, '').endsWith(last4)) {
      return sendJSON(res, 404, { error: 'We could not find an order with those details.' });
    }
    return sendJSON(res, 200, {
      id: order.id, packageCode: order.packageCode, status: order.status, history: order.history,
      createdAt: order.createdAt, total: order.total,
      items: order.items.map(i => ({ sku: i.sku, name: i.name, storage: i.storage, qty: i.qty }))
    });
  }

  // Admin: change an order's status
  if (parts[1] === 'orders' && parts[2] && req.method === 'PATCH') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return sendJSON(res, 401, { error: 'Unauthorized' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    if (!STATUSES.includes(body.status)) return sendJSON(res, 400, { error: 'Status must be one of: ' + STATUSES.join(', ') });

    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === parts[2].toUpperCase() || o.packageCode === parts[2].toUpperCase());
    if (!order) return sendJSON(res, 404, { error: 'Order not found' });

    // cancelling puts the phones back in stock
    if (body.status === 'cancelled' && order.status !== 'cancelled') {
      const products = readJSON(PRODUCTS_FILE);
      for (const line of order.items) { const p = products.find(x => x.id === line.id); if (p) p.stock += line.qty; }
      writeJSON(PRODUCTS_FILE, products);
    }
    order.status = body.status;
    order.history.push({ status: body.status, at: new Date().toISOString() });
    writeJSON(ORDERS_FILE, orders);
    return sendJSON(res, 200, order);
  }

  if (parts[1] === 'orders' && req.method === 'GET') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return sendJSON(res, 401, { error: 'Unauthorized' });
    return sendJSON(res, 200, readJSON(ORDERS_FILE));
  }

  sendJSON(res, 404, { error: 'Not found' });
}

// ---------- static files ----------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || PRIVATE_FILES.includes(path.basename(file).toLowerCase())) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// Keep the offline backup list in sync with products.json every time the server starts.
function syncFallback() {
  const header = '// Backup copy of data/products.json (auto-generated when the server starts).\n';
  fs.writeFileSync(path.join(PUBLIC_DIR, 'products-fallback.js'),
    header + 'window.FALLBACK_PRODUCTS = ' + JSON.stringify(readJSON(PRODUCTS_FILE), null, 2) + ';\n');
}

// ---------- server ----------
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Something went wrong on our side.' });
  }
}).listen(PORT, () => { syncFallback(); console.log(`Ifeanyi store running at http://localhost:${PORT}`); });
