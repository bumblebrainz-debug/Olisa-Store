const $ = id => document.getElementById(id);
const naira = n => '\u20A6' + Number(n).toLocaleString('en-NG');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// If the page was opened from Live Server (port 5500) or as a file, talk to the Node server on port 3000.
const API = (location.protocol === 'file:' || location.port === '5500') ? 'http://localhost:3000' : '';
let serverUp = true;
let products = [];
let brand = 'All';
let query = '';
let cart = loadCart();

function loadCart() {
  try { return JSON.parse(localStorage.getItem('ifeanyi-cart')) || []; } catch { return []; }
}
function saveCart() {
  try { localStorage.setItem('ifeanyi-cart', JSON.stringify(cart)); } catch {}
}

/* ---------- Products ---------- */
async function loadProducts() {
  try {
    const res = await fetch(API + '/api/products');
    if (!res.ok) throw new Error('bad response');
    products = await res.json();
    serverUp = true;
    $('banner').hidden = true;
  } catch {
    // Server is not running: still show the phones so the page is never empty.
    serverUp = false;
    products = window.FALLBACK_PRODUCTS || [];
    $('banner').hidden = false;
    $('banner').innerHTML = 'The store server is not running, so ordering is switched off. ' +
      'Open the VS Code terminal, run <code>node server.js</code>, then open <code>http://localhost:3000</code>.';
  }
  renderBrands();
  renderProducts();
  renderCart();
}

// Used when a product photo is missing: draws a phone in the product's colour.
function phoneSvg(color) {
  return `<svg viewBox="0 0 120 200" width="110" role="img" aria-label="Phone">
    <rect x="14" y="4" width="92" height="192" rx="16" fill="${esc(color)}"/>
    <rect x="20" y="10" width="80" height="180" rx="11" fill="#0d1419"/>
    <rect x="24" y="14" width="72" height="172" rx="9" fill="#1d2b35"/>
    <circle cx="60" cy="24" r="3.5" fill="#0d1419"/>
    <rect x="32" y="48" width="56" height="8" rx="4" fill="#2f4352"/>
    <rect x="32" y="64" width="40" height="6" rx="3" fill="#2f4352"/>
  </svg>`;
}

function renderBrands() {
  const brands = ['All', ...new Set(products.map(p => p.brand))];
  $('brands').innerHTML = brands.map(b =>
    `<button class="chip" data-brand="${esc(b)}" aria-pressed="${b === brand}">${esc(b)}</button>`).join('');
}

function renderProducts() {
  const list = products.filter(p =>
    (brand === 'All' || p.brand === brand) &&
    `${p.brand} ${p.name} ${p.sku}`.toLowerCase().includes(query));
  $('status').textContent = list.length ? `${list.length} phone${list.length > 1 ? 's' : ''}` : 'No phones match your search.';

  $('grid').innerHTML = list.map(p => {
    const out = p.stock < 1;
    const low = p.stock > 0 && p.stock <= 5;
    return `<article class="card">
      <div class="pic">
        <img src="${esc(p.image)}" alt="${esc(p.brand + ' ' + p.name)}" loading="lazy" data-color="${esc(p.color)}">
      </div>
      <div class="info">
        <span class="brand-tag">${esc(p.brand)}</span>
        <span class="sku">Product code: ${esc(p.sku)}</span>
        <h3 class="name">${esc(p.name)} <small>${esc(p.storage)}</small></h3>
        <ul class="specs">${p.specs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        <div class="row">
          <div>
            <div class="price">${naira(p.price)}</div>
            <div class="stock ${low || out ? 'low' : ''}">${out ? 'Out of stock' : low ? 'Only ' + p.stock + ' left' : 'In stock'}</div>
          </div>
          <button class="primary" data-add="${esc(p.id)}" ${out ? 'disabled' : ''}>Add to cart</button>
        </div>
      </div>
    </article>`;
  }).join('');

  // If a photo file is missing, swap in the drawn phone.
  document.querySelectorAll('.pic img').forEach(img => {
    img.addEventListener('error', () => { img.parentElement.innerHTML = phoneSvg(img.dataset.color); }, { once: true });
  });
}

/* ---------- Cart ---------- */
function addToCart(id) {
  const p = products.find(x => x.id === id);
  const line = cart.find(l => l.id === id);
  if (line) { if (line.qty < Math.min(p.stock, 10)) line.qty++; } else cart.push({ id, qty: 1 });
  saveCart(); renderCart(); openCart();
}

function renderCart() {
  // drop items that no longer exist
  cart = cart.filter(l => products.some(p => p.id === l.id));
  const count = cart.reduce((n, l) => n + l.qty, 0);
  $('cartCount').textContent = count;

  if (!cart.length) {
    $('cartItems').innerHTML = '<p class="empty">Your cart is empty.</p>';
  } else {
    $('cartItems').innerHTML = cart.map(l => {
      const p = products.find(x => x.id === l.id);
      return `<div class="line">
        <div><div class="t">${esc(p.name)}</div><div class="s">${esc(p.sku)} &middot; ${esc(p.storage)} &middot; ${naira(p.price)}</div></div>
        <div class="t">${naira(p.price * l.qty)}</div>
        <div class="qty"><button data-dec="${esc(l.id)}" aria-label="Decrease">&minus;</button><span>${l.qty}</span><button data-inc="${esc(l.id)}" aria-label="Increase">+</button></div>
        <button class="remove" data-rem="${esc(l.id)}">Remove</button>
      </div>`;
    }).join('');
  }
  const total = cart.reduce((s, l) => s + products.find(p => p.id === l.id).price * l.qty, 0);
  $('cartTotal').textContent = naira(total);
  $('checkoutBtn').disabled = !cart.length;
}

function changeQty(id, delta) {
  const line = cart.find(l => l.id === id);
  const p = products.find(x => x.id === id);
  line.qty = Math.max(0, Math.min(line.qty + delta, Math.min(p.stock, 10)));
  if (line.qty === 0) cart = cart.filter(l => l.id !== id);
  saveCart(); renderCart();
}

function openCart() { $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('overlay').hidden = false; }
function closeCart() { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('overlay').hidden = true; }

/* ---------- Checkout ---------- */
async function placeOrder(e) {
  e.preventDefault();
  $('formErr').textContent = '';
  const form = e.target;
  const body = {
    name: form.name.value, phone: form.phone.value, address: form.address.value, note: form.note.value,
    items: cart.map(l => ({ id: l.id, qty: l.qty }))
  };
  $('placeBtn').disabled = true;
  try {
    const res = await fetch(API + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { $('formErr').textContent = (data.errors || [data.error]).join(' '); return; }
    $('orderId').textContent = data.id;
    $('pkgId').textContent = data.packageCode;
    $('orderTotal').textContent = naira(data.total);
    $('orderForm').hidden = true; $('done').hidden = false;
    cart = []; saveCart(); form.reset();
    await loadProducts(); // refresh stock levels
  } catch {
    $('formErr').textContent = 'Could not send your order. Please check your connection and try again.';
  } finally {
    $('placeBtn').disabled = false;
  }
}

/* ---------- Order tracking ---------- */
const STEPS = ['new', 'confirmed', 'packed', 'shipped', 'delivered'];
const STEP_LABEL = { new: 'Order received', confirmed: 'Confirmed', packed: 'Packed', shipped: 'On the way', delivered: 'Delivered' };

async function trackOrder(e) {
  e.preventDefault();
  const f = e.target;
  $('trackErr').textContent = ''; $('trackResult').hidden = true;
  const code = f.code.value.trim().toUpperCase();
  try {
    const res = await fetch(API + `/api/track/${encodeURIComponent(code)}?phone=${encodeURIComponent(f.phone.value)}`);
    const o = await res.json();
    if (!res.ok) { $('trackErr').textContent = o.error; return; }
    const at = STEPS.indexOf(o.status);
    const cancelled = o.status === 'cancelled';
    $('trackResult').innerHTML = `
      <div class="codes"><div><span>Order code</span><strong>${esc(o.id)}</strong></div>
      <div><span>Package code</span><strong>${esc(o.packageCode)}</strong></div></div>
      ${cancelled ? '<p class="cancelled-note">This order was cancelled.</p>' :
        `<ol class="steps">${STEPS.map((s, i) => `<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${STEP_LABEL[s]}</li>`).join('')}</ol>`}
      <ul>${o.items.map(i => `<li>${i.qty} &times; ${esc(i.name)} ${esc(i.storage)} <span class="sku">(${esc(i.sku)})</span></li>`).join('')}</ul>
      <p>Total: <strong>${naira(o.total)}</strong></p>`;
    $('trackResult').className = 'result'; $('trackResult').hidden = false;
  } catch { $('trackErr').textContent = 'Could not check your order. Please try again.'; }
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.add) addToCart(t.dataset.add);
  if (t.dataset.inc) changeQty(t.dataset.inc, 1);
  if (t.dataset.dec) changeQty(t.dataset.dec, -1);
  if (t.dataset.rem) changeQty(t.dataset.rem, -99);
  if (t.dataset.brand) { brand = t.dataset.brand; renderBrands(); renderProducts(); }
});
$('search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderProducts(); });
$('openCart').addEventListener('click', openCart);
$('closeCart').addEventListener('click', closeCart);
$('overlay').addEventListener('click', closeCart);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCart(); });
$('checkoutBtn').addEventListener('click', () => {
  if (!serverUp) { closeCart(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  closeCart(); $('orderForm').hidden = false; $('done').hidden = true; $('formErr').textContent = ''; $('checkout').showModal(); });
$('cancelCheckout').addEventListener('click', () => $('checkout').close());
$('closeDone').addEventListener('click', () => $('checkout').close());
$('orderForm').addEventListener('submit', placeOrder);
$('trackForm').addEventListener('submit', trackOrder);
$('year').textContent = new Date().getFullYear();

loadProducts();
