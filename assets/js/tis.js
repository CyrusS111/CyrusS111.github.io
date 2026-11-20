(function () {
var WA = 'https://wa.me/256701475685?text=';
document.getElementById('yr').textContent = new Date().getFullYear();

// Phone menu
var menuBtn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
menuBtn.addEventListener('click', function () {
  var open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open);
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});

// Highlight the TiS tab for the section on screen
var tabs = [].slice.call(document.querySelectorAll('.subnav nav a'));
var secs = tabs.map(function (a) { return document.querySelector(a.getAttribute('href')); });
function onScroll() {
  var y = window.scrollY + 200, cur = 0;
  secs.forEach(function (s, i) { if (s.offsetTop <= y) cur = i; });
  tabs.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
}
window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

// ---------------- Catalogue ----------------
// Indicative Kampala retail incl. VAT. img: file in assets/products/shop (blank = photo coming).
var S = { k: 'In stock · Kampala', l: 'Local supplier · 2–5 days', i: 'Import order · 2–4 weeks' };
var CATS = ['Fasteners & fixings', 'Mechanical & power transmission', 'Electrical & panel', 'Control & automation', 'Pneumatics', 'Electronics & prototyping', 'Tools & consumables'];
var P = [
  ['Fasteners & fixings', 'FX-HB-M10x50', 'Hex bolt M10 × 50, grade 8.8', 'ISO 4017, zinc plated, full thread', 'k', 'piece', 1000, 'Box of 100: UGX 85,000', 'fx-hb-m10x50-88'],
  ['Fasteners & fixings', 'FX-NUT-M10-A2', 'Hex nut M10, stainless A2-70', 'ISO 4032', 'k', 'piece', 700, 'Bag of 50: UGX 30,000', 'fx-nut-m10-a2'],
  ['Fasteners & fixings', 'FX-FAZ-M12', 'Fischer FAZ II 12/10 bolt anchor', 'M12 × 100, approved for concrete', 'l', 'piece', 12000, 'Box of 20: UGX 220,000', 'fx-faz-m12'],
  ['Mechanical & power transmission', 'MP-SKF-6204', 'SKF 6204-2RSH ball bearing', '20 × 47 × 14 mm, sealed both sides', 'k', 'piece', 28000, '10+: UGX 25,000 each', 'mp-brg-6204-2rs'],
  ['Mechanical & power transmission', 'MP-A42', 'Gates A42 classical V-belt', 'Section A, 1067 mm inside length', 'l', 'piece', 30000, '', 'mp-vb-a42'],
  ['Mechanical & power transmission', 'MP-L075', 'Lovejoy L075 jaw coupling set', '2 hubs + spider, bores to 22 mm', 'i', 'set', 150000, '', 'mp-cpl-l075'],
  ['Mechanical & power transmission', 'MP-TSLOT-4040', 'Aluminium T-slot profile 40 × 40', 'Cut to length, slot 8', 'l', 'metre', 85000, 'T-nuts and brackets available', 'mp-tslot-4040'],
  ['Electrical & panel', 'EL-A9F44116', 'Schneider Acti9 iC60N MCB, 1P C16', '16 A, C curve, 6 kA', 'k', 'piece', 38000, '12+: UGX 34,000 each', 'el-mcb-c16-1p'],
  ['Electrical & panel', 'EL-LC1D18P7', 'Schneider TeSys D contactor LC1D18P7', '18 A AC-3, 230 V AC coil, 1NO+1NC', 'k', 'piece', 180000, '', 'el-ct-18a-230'],
  ['Electrical & panel', 'EL-LC1D115P7', 'Schneider TeSys D contactor LC1D115P7', '115 A AC-3, 230 V AC coil', 'i', 'piece', 1650000, '', 'el-ct-100a'],
  ['Electrical & panel', 'EL-NSYS3D4320P', 'Schneider Spacial S3D enclosure', '400 × 300 × 200 mm, IP66, with plate', 'l', 'piece', 620000, '', 'el-enc-400x300'],
  ['Control & automation', 'CA-ATV12HU22M2', 'Schneider Altivar 12 drive, 2.2 kW', '1-phase 230 V in, 3-phase out', 'l', 'piece', 1600000, '', 'ca-vfd-2-2-1p'],
  ['Control & automation', 'CA-E2E-M18', 'Omron E2E inductive sensor M18', 'PNP NO, 8 mm, 10–30 V DC', 'l', 'piece', 260000, '', ''],
  ['Control & automation', 'CA-NDR-120-24', 'Mean Well NDR-120-24 power supply', '24 V DC, 5 A, DIN rail', 'k', 'piece', 140000, '', ''],
  ['Pneumatics', 'PN-DSBC-32x100', 'Festo DSBC ISO cylinder 32 × 100', 'ISO 15552, double acting, cushioned', 'l', 'piece', 650000, '', ''],
  ['Pneumatics', 'PN-ADN-25x25', 'Festo ADN compact cylinder 25 × 25', 'Double acting, magnetic piston', 'l', 'piece', 320000, '', ''],
  ['Pneumatics', 'PN-ROT-DA', 'Pneumatic rotary actuator, double acting', 'Quarter-turn, ISO 5211, for valves', 'i', 'piece', 600000, '', ''],
  ['Pneumatics', 'PN-SY5120', 'SMC 5/2 solenoid valve SY5120', '1/4", 24 V DC coil', 'k', 'piece', 350000, '', ''],
  ['Pneumatics', 'PN-AC20', 'SMC AC20 filter-regulator-lubricator', '1/4", with gauge', 'l', 'piece', 450000, '', ''],
  ['Pneumatics', 'PN-PUN-8', 'Festo PUN-8 polyurethane tubing', '8 mm OD, blue', 'k', 'metre', 6000, 'Roll of 50 m: UGX 250,000', ''],
  ['Pneumatics', 'PN-QS-1/4-8', 'Festo QS-1/4-8 push-in fitting', 'Straight, 1/4" × 8 mm tube', 'k', 'piece', 25000, 'Pack of 10: UGX 220,000', 'pn-qs-1-4-8'],
  ['Pneumatics', 'PN-GRLA', 'Festo GRLA flow control valve', '1/4" × 8 mm', 'l', 'piece', 45000, '', ''],
  ['Electronics & prototyping', 'EC-RLY-5V', 'Relay module 5 V, 1 channel', 'Opto-isolated, 10 A contact', 'k', 'piece', 8000, '10+: UGX 6,500 each', 'ec-rly-5v-1ch'],
  ['Electronics & prototyping', 'EC-RES-600', 'Resistor kit, 600 pcs', '30 values, 1/4 W, 1 % metal film', 'k', 'kit', 35000, '', 'ec-res-kit'],
  ['Electronics & prototyping', 'PR-ESP32', 'Espressif ESP32-DevKitC', 'Wi-Fi + Bluetooth', 'k', 'piece', 55000, '5+: UGX 50,000 each', 'pr-esp32-dev'],
  ['Electronics & prototyping', 'PR-A000066', 'Arduino Uno Rev3 (genuine)', 'A000066 · ATmega328P', 'k', 'piece', 150000, '', 'pr-ard-uno'],
  ['Tools & consumables', 'TC-BOSCH-115', 'Bosch PRO cutting disc 115 mm', '115 × 1 × 22.23 mm, stainless and metal', 'k', 'piece', 7500, 'Box of 25: UGX 170,000', 'tc-ctd-115']
].map(function (r) { return { cat: r[0], sku: r[1], name: r[2], spec: r[3], s: r[4], unit: r[5], price: r[6], bulk: r[7], img: r[8] }; });

var fmt = function (n) { return 'UGX ' + Math.round(n).toLocaleString('en-US'); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var state = { cat: 'All parts', q: '' };
var catsEl = document.getElementById('cats'), prodEl = document.getElementById('products'), qEl = document.getElementById('q');

function renderCats() {
  catsEl.innerHTML = ['All parts'].concat(CATS).map(function (c) {
    var n = c === 'All parts' ? P.length : P.filter(function (p) { return p.cat === c; }).length;
    return '<button type="button" class="cat" aria-pressed="' + (c === state.cat) + '" data-cat="' + esc(c) + '">' + esc(c) + ' <small>' + n + '</small></button>';
  }).join('');
}
function renderProducts() {
  var q = state.q.toLowerCase();
  var list = P.filter(function (p) {
    return (state.cat === 'All parts' || p.cat === state.cat) && (!q || (p.name + ' ' + p.spec + ' ' + p.sku + ' ' + p.cat).toLowerCase().indexOf(q) >= 0);
  });
  prodEl.innerHTML = list.length ? list.map(function (p) {
    var ph = p.img ? '<img src="assets/products/shop/' + p.img + '.jpg" alt="' + esc(p.name) + '" width="800" height="800" loading="lazy">' : '<span>Photo coming soon</span>';
    return '<article class="prod"><div class="ph">' + ph + '</div><div class="body">' +
      '<span class="mono" style="color: var(--muted)">' + esc(p.sku) + '</span>' +
      '<h3>' + esc(p.name) + '</h3><p class="spec">' + esc(p.spec) + '</p>' +
      '<span class="stock ' + p.s + '">' + S[p.s] + '</span>' +
      '<div class="price">' + fmt(p.price) + ' <small>/ ' + p.unit + '</small></div>' +
      (p.bulk ? '<p class="bulk">' + esc(p.bulk) + '</p>' : '') +
      '<div class="add"><label class="sr" for="qty-' + esc(p.sku) + '">Quantity</label><input id="qty-' + esc(p.sku) + '" type="number" min="1" value="1">' +
      '<button type="button" class="btn btn-blue btn-sm" data-add="' + esc(p.sku) + '">Add</button></div></div></article>';
  }).join('') : '<div class="empty">No parts match. Try another word, or send us a photo on WhatsApp.</div>';
}
catsEl.addEventListener('click', function (e) {
  var b = e.target.closest('[data-cat]'); if (!b) return;
  state.cat = b.getAttribute('data-cat'); renderCats(); renderProducts();
});
qEl.addEventListener('input', function () {
  state.q = qEl.value.trim();
  if (state.q && state.cat !== 'All parts') { state.cat = 'All parts'; renderCats(); }   // search the whole catalogue
  renderProducts();
});

// ---------------- Order list (kept on this device only) ----------------
var order = {};
try { order = JSON.parse(localStorage.getItem('tis-order') || '{}'); } catch (e) { order = {}; }
var save = function () { try { localStorage.setItem('tis-order', JSON.stringify(order)); } catch (e) {} };
var bySku = function (s) { return P.filter(function (p) { return p.sku === s; })[0]; };
function renderOrder() {
  var skus = Object.keys(order).filter(bySku), total = 0, count = 0;
  document.getElementById('order-lines').innerHTML = skus.length ? skus.map(function (s) {
    var p = bySku(s); total += p.price * order[s]; count += order[s];
    return '<div class="line"><div><b>' + esc(p.name) + '</b><div class="note">' + fmt(p.price) + ' / ' + p.unit + '</div></div>' +
      '<input type="number" min="1" value="' + order[s] + '" data-qty="' + esc(s) + '" aria-label="Quantity of ' + esc(p.name) + '">' +
      '<button class="x" type="button" data-del="' + esc(s) + '" aria-label="Remove ' + esc(p.name) + '">✕</button></div>';
  }).join('') : '<p class="empty">Your list is empty. Add parts from the shop.</p>';
  document.getElementById('order-total').textContent = fmt(total);
  document.getElementById('order-count').textContent = count;
}
prodEl.addEventListener('click', function (e) {
  var b = e.target.closest('[data-add]'); if (!b) return;
  var s = b.getAttribute('data-add'), qty = Math.max(1, parseInt(document.getElementById('qty-' + s).value, 10) || 1);
  order[s] = (order[s] || 0) + qty; save(); renderOrder();
  b.textContent = 'Added ✓'; setTimeout(function () { b.textContent = 'Add'; }, 1200);
});
var drawer = document.getElementById('drawer');
document.getElementById('open-order').addEventListener('click', function () { renderOrder(); drawer.classList.add('open'); document.querySelector('.drawer .x').focus(); });
drawer.addEventListener('click', function (e) {
  if (e.target.hasAttribute('data-close')) drawer.classList.remove('open');
  var d = e.target.closest('[data-del]'); if (d) { delete order[d.getAttribute('data-del')]; save(); renderOrder(); }
});
drawer.addEventListener('change', function (e) {
  var q = e.target.getAttribute('data-qty'); if (q) { order[q] = Math.max(1, parseInt(e.target.value, 10) || 1); save(); renderOrder(); }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') drawer.classList.remove('open'); });
document.getElementById('send-order').addEventListener('click', function () {
  var skus = Object.keys(order).filter(bySku); if (!skus.length) return;
  var lines = ['Hello TiS, please quote these parts:'].concat(skus.map(function (s) { var p = bySku(s); return '- ' + order[s] + ' × ' + p.name + ' (' + p.sku + ')'; }));
  var nm = document.getElementById('o-name').value.trim(); if (nm) lines.push('Name: ' + nm);
  window.open(WA + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
});

// ---------------- Forms → WhatsApp ----------------
var pills = document.getElementById('proc-pills');
// "Get a 3D printing quote" pre-selects 3D printing in the quote form
document.querySelectorAll('[data-proc]').forEach(function (a) {
  a.addEventListener('click', function () {
    var want = a.getAttribute('data-proc');
    [].forEach.call(pills.children, function (x) { x.setAttribute('aria-pressed', x.textContent === want); });
    document.getElementById('m-mat').value = '3D print (PLA / PETG)';
  });
});
pills.addEventListener('click', function (e) {
  var b = e.target.closest('.pill'); if (!b) return;
  [].forEach.call(pills.children, function (x) { x.setAttribute('aria-pressed', x === b); });
});
document.getElementById('make-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var f = e.target, note = document.getElementById('make-note');
  var part = f.part.value.trim(), name = f.name.value.trim();
  if (!part || !name) { note.textContent = 'Please describe the part and add your name.'; note.style.color = '#B42318'; return; }
  var proc = pills.querySelector('[aria-pressed="true"]').textContent;
  var lines = ['Hello TiS, I need a part made.', 'Part: ' + part, 'Process: ' + proc, 'Quantity: ' + f.qty.value, 'Material: ' + f.mat.value,
    f.date.value ? 'Needed by: ' + f.date.value : '', 'Files I have: ' + f.files.value, f.notes.value.trim() ? 'Notes: ' + f.notes.value.trim() : '',
    'Name: ' + name + (f.org.value.trim() ? ' (' + f.org.value.trim() + ')' : ''), '(I will attach my files in this chat.)'].filter(Boolean);
  window.open(WA + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
});
document.getElementById('design-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var what = document.getElementById('d-what').value.trim(), name = document.getElementById('d-name').value.trim(), note = document.getElementById('design-note');
  if (!what || !name) { note.textContent = 'Please describe the job and add your name.'; note.style.color = '#B42318'; return; }
  var org = document.getElementById('d-org').value.trim();
  var lines = ['Hello TiS, I need a part designed.', 'Type: ' + document.getElementById('d-type').value, 'Package: ' + document.getElementById('d-plan').value,
    'Job: ' + what, 'Name: ' + name + (org ? ' (' + org + ')' : ''), '(I will send photos or sketches in this chat.)'];
  window.open(WA + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
});

renderCats(); renderProducts(); renderOrder();
})();
