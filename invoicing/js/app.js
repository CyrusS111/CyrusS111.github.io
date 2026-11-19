'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => localIso(new Date());
const addDays = (iso, d) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + d); return localIso(x); };
const STATUSES = { Invoice: ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Cancelled'], Quotation: ['Draft', 'Sent', 'Accepted', 'Declined'] };
const AUTO_LOCK_MIN = 15;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}
async function persist() { await Vault.save(Store.dump()); }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function statusPill(s) {
  const cls = { Paid: 'ok', Accepted: 'ok', Issued: '', Sent: '', 'Partially Paid': 'warn', Draft: 'grey', Cancelled: 'bad', Declined: 'bad' }[s] ?? '';
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}

// Generic modal form. fields: [{name,label,type,value,required,options,step,min}]
function modal(title, fields, submitLabel = 'Save', extraHtml = '') {
  return new Promise(resolve => {
    const d = $('#dlg'), f = $('#dlg-form');
    f.innerHTML = `<h3>${esc(title)}</h3>${extraHtml}<div class="form-grid">${fields.map(x => {
      const req = x.required ? 'required' : '';
      if (x.type === 'select') return `<label class="f">${esc(x.label)}<select name="${x.name}" ${req}>${x.options.map(o =>
        `<option ${String(o) === String(x.value) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      return `<label class="f">${esc(x.label)}<input name="${x.name}" type="${x.type || 'text'}" value="${esc(x.value ?? '')}"
        ${x.step ? `step="${x.step}"` : ''} ${x.min != null ? `min="${x.min}"` : ''} ${x.readonly ? 'readonly' : ''} ${req}></label>`;
    }).join('')}</div>
    <div class="row-end"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(submitLabel)}</button></div>`;
    let done = false;
    const finish = v => { if (done) return; done = true; f.onsubmit = d.oncancel = null; if (d.open) d.close(); resolve(v); };
    f.onsubmit = e => {
      e.preventDefault();
      finish(e.submitter && e.submitter.value === 'ok' ? Object.fromEntries(new FormData(f).entries()) : null);
    };
    d.oncancel = () => finish(null);   // Escape key
    d.showModal();
    const first = f.querySelector('input:not([readonly]),select'); if (first) first.focus();
  });
}
async function confirmBox(msg, label = 'Delete') {
  const r = await modal(msg, [], label);
  return r !== null;
}

// ============ auth ============
// Screens: connect (GitHub details) → create (first user ever) or login.
function authScreen(which, sub) {
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
  ['connect', 'setup', 'login'].forEach(n => $('#' + n + '-form').classList.toggle('hidden', n !== which));
  $('#auth-sub').textContent = sub;
  const first = $('#' + which + '-form input:not([type=hidden])'); if (first) first.focus();
}
async function showAuth() {
  const d = await Vault.loadDevice();
  if (!d) return authScreen('connect', 'Connect this device to your secure cloud storage');
  $('#login-repo').textContent = d.owner + '/' + d.repo;
  $('#login-token-wrap').classList.add('hidden');
  authScreen('login', 'Sign in to continue');
}
async function enterApp(res) {
  Store.load(res.unsent || res.files);
  if (res.unsent) {   // changes made on this device while offline: combine with GitHub's version
    const st = Store.merge(res.files);
    await persist();
    if (st.renumbered.length) toast('Renumbered to avoid a clash: ' + st.renumbered.join(', '));
  }
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $$('#auth form').forEach(f => f.reset());
  $('#who').textContent = Vault.user.name;
  go(location.hash.slice(1) || 'dashboard');
  armAutoLock();
  if (!res.online) toast(`Working offline. Changes are kept on this device and uploaded when you reconnect.`);
}
$('#connect-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#connect-err'); err.textContent = 'Checking…';
  try {
    const { exists } = await Vault.connect(f.owner.value, f.repo.value, f.token.value);
    err.textContent = '';
    if (exists) { $('#login-repo').textContent = f.owner.value.trim() + '/' + f.repo.value.trim(); authScreen('login', 'Connected. Sign in with your app username and password'); }
    else authScreen('setup', 'Connected. The data store is empty: create the first account');
  } catch (x) { err.textContent = x.message; }
});
$('#setup-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#setup-err'); err.textContent = '';
  if (f.p.value !== f.p2.value) return (err.textContent = 'Passwords do not match');
  try {
    err.textContent = 'Creating…';
    Store.load(null);
    await Vault.create(f.u.value.trim(), f.p.value, Store.dump());
    err.textContent = '';
    enterApp({ files: Store.dump(), online: true });
    toast('Account created and saved to the cloud (encrypted).');
  } catch (x) { err.textContent = x.message; }
});
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#login-err'); err.textContent = 'Signing in…';
  try { const res = await Vault.login(f.u.value, f.p.value, f.token.value); err.textContent = ''; await enterApp(res); }
  catch (x) {
    err.textContent = x.message;
    if (x.needToken) { $('#login-token-wrap').classList.remove('hidden'); f.token.focus(); }
  }
});
$('#reconnect-link').onclick = e => { e.preventDefault(); authScreen('connect', 'Connect this device to your secure cloud storage'); };
async function lock() {
  // upload anything pending first (it is safe on this device either way)
  if (Vault.user) await Promise.race([Vault.flush().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
  Vault.logout(); Store.load(null); $('#main').innerHTML = ''; await showAuth();
}

// ---- sync with GitHub ----
Vault.onMerge((remoteFiles, mode) => {
  let st = null;
  if (mode === 'replace') { Store.load(remoteFiles); Store.recount(); } else st = Store.merge(remoteFiles);
  if (st && st.renumbered.length) toast('Renumbered to avoid a clash: ' + st.renumbered.join(', '));
  // refresh the screen, but never throw away an invoice being edited
  const view = location.hash.slice(1);
  if (Vault.user && !view.startsWith('editor') && !$('#dlg').open) go(view || 'dashboard');
  else if (Vault.user) toast('Updated with changes from another device');
  return Store.dump();
});
Vault.onKicked(msg => { lock(); toast(msg); });
Vault.onStatus(s => {
  const el = $('#sync'); if (!el) return;
  const txt = { synced: 'Saved to cloud', saving: 'Saving…', offline: s.pending ? 'Offline · changes waiting' : 'Offline', error: 'Sync problem' }[s.state];
  el.textContent = txt; el.dataset.state = s.state;
  el.title = s.state === 'error' ? s.message + ' (click to retry)' : s.lastSync ? 'Last synced ' + s.lastSync.toLocaleTimeString() : '';
});
$('#sync').onclick = () => Vault.syncNow();
setInterval(() => { if (Vault.user && document.visibilityState === 'visible') Vault.syncNow(); }, 60000);
document.addEventListener('visibilitychange', () => { if (Vault.user && document.visibilityState === 'visible') Vault.syncNow(); });
window.addEventListener('online', () => { if (Vault.user) Vault.syncNow(); });
$('#logout').onclick = lock;
function armAutoLock() {
  const reset = () => { clearTimeout(armAutoLock.t); armAutoLock.t = setTimeout(() => { if (Vault.user) { lock(); toast('Locked after inactivity'); } }, AUTO_LOCK_MIN * 60000); };
  if (!armAutoLock.bound) { ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, reset, { passive: true })); armAutoLock.bound = true; }
  reset();
}

// ============ routing ============
const VIEWS = {};
function go(view, arg) {
  if (!Vault.user) return;
  const [name, param] = view.split('/');
  if (!VIEWS[name]) return go('dashboard');
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  history.replaceState(null, '', '#' + view);
  VIEWS[name](param ?? arg);
  window.scrollTo(0, 0);
}
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); };

// ============ dashboard ============
VIEWS.dashboard = () => {
  const stock = Store.stock(), inv = Store.invoices();
  const low = stock.filter(s => Store.num(s.qty) <= Store.num(s.reorder_level));
  const invs = inv.filter(i => i.type === 'Invoice' && i.status !== 'Cancelled');
  const outstanding = invs.filter(i => ['Issued', 'Partially Paid'].includes(i.status));
  const owed = outstanding.reduce((a, i) => a + Store.num(i.grand_total) - Store.num(i.amount_paid), 0);
  const month = today().slice(0, 7);
  const billed = invs.filter(i => (i.date || '').startsWith(month) && i.status !== 'Draft').reduce((a, i) => a + Store.num(i.grand_total), 0);
  const stockValue = stock.reduce((a, s) => a + Store.num(s.qty) * Store.num(s.unit_cost), 0);
  const recent = [...inv].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  $('#main').innerHTML = `
    <div class="view-head"><h2>Dashboard</h2><span class="spacer"></span>
      <button class="btn primary" onclick="go('editor')">New invoice / quotation</button></div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Owed to you (${outstanding.length} unpaid)</div><div class="value">${money(owed)}</div></div>
      <div class="card kpi"><div class="label">Billed this month</div><div class="value">${money(billed)}</div></div>
      <div class="card kpi"><div class="label">Stock value (${stock.length} items)</div><div class="value">${money(stockValue)}</div></div>
      <div class="card kpi"><div class="label">Items to replenish</div><div class="value" style="color:${low.length ? 'var(--bad)' : 'inherit'}">${low.length}</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h3 style="margin-bottom:10px">Low stock</h3>${low.length ? `<table><tbody>${low.map(s => `
        <tr><td>${esc(s.name)} <span class="muted">${esc(s.specification)}</span></td>
        <td class="num">${esc(s.qty)} ${esc(s.uom)}</td>
        <td class="actions"><button class="btn small" onclick="replenishDlg('${esc(s.sku)}')">Replenish</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Everything is above its reorder level.</p>'}</div>
      <div class="card"><h3 style="margin-bottom:10px">Recent activity</h3>${recent.length ? `<table><tbody>${recent.map(i => `
        <tr style="cursor:pointer" onclick="go('editor/${esc(i.number)}')"><td>${esc(i.number)}<div class="muted" style="font-size:13px">${esc(i.client_company || i.client_name)}</div></td>
        <td class="num">${money(i.grand_total)}</td><td>${statusPill(i.status)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No invoices or quotations yet.</p>'}</div>
    </div>`;
};

// ============ stock ============
VIEWS.stock = () => {
  $('#main').innerHTML = `
    <div class="view-head"><h2>Stock</h2><span class="spacer"></span>
      <input class="search" id="stock-q" placeholder="Search stock…">
      <button class="btn" onclick="go('history')">Stock history</button>
      <button class="btn primary" onclick="stockDlg()">Add item</button></div>
    <div class="table-wrap"><table><thead><tr><th class="hide-sm">Code</th><th>Item</th><th>Specification</th><th class="num">In stock</th>
      <th>UOM</th><th class="num">Unit cost</th><th class="num hide-sm">Reorder at</th><th></th></tr></thead><tbody id="stock-body"></tbody></table></div>`;
  const render = () => {
    const q = $('#stock-q').value.toLowerCase();
    const rows = Store.stock().filter(s => !q || [s.sku, s.name, s.specification].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    $('#stock-body').innerHTML = rows.length ? rows.map(s => {
      const low = Store.num(s.qty) <= Store.num(s.reorder_level);
      return `<tr><td class="muted hide-sm">${esc(s.sku)}</td><td>${esc(s.name)}</td><td>${esc(s.specification)}</td>
        <td class="num">${low ? `<span class="pill bad">${esc(s.qty)}</span>` : esc(s.qty)}</td><td>${esc(s.uom)}</td>
        <td class="num">${money(s.unit_cost)}</td><td class="num hide-sm">${esc(s.reorder_level)}</td>
        <td class="actions"><button class="btn small primary" onclick="replenishDlg('${esc(s.sku)}')">Replenish</button><button class="btn small" onclick="stockDlg('${esc(s.sku)}')">Edit</button><button class="btn small danger" onclick="deleteStock('${esc(s.sku)}')">Delete</button></td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">${q ? 'Nothing matches your search.' : 'No stock yet. Add your first item.'}</td></tr>`;
  };
  $('#stock-q').oninput = render; render();
};
async function stockDlg(sku) {
  const s = sku ? Store.stockItem(sku) : { uom: 'PCs', qty: '0', reorder_level: '1' };
  const r = await modal(sku ? 'Edit item' : 'Add stock item', [
    { name: 'sku', label: 'Code (leave blank to auto-generate)', value: s.sku, readonly: !!sku },
    { name: 'name', label: 'Item', value: s.name, required: true },
    { name: 'specification', label: 'Specification', value: s.specification },
    { name: 'uom', label: 'Unit of measure', value: s.uom },
    { name: 'unit_cost', label: 'Unit cost (UGX)', type: 'number', min: 0, step: 'any', value: s.unit_cost, required: true },
    { name: 'qty', label: sku ? 'Quantity in stock (correction)' : 'Opening quantity', type: 'number', step: 'any', value: s.qty, required: true },
    { name: 'reorder_level', label: 'Warn when stock falls to', type: 'number', min: 0, step: 'any', value: s.reorder_level },
  ]);
  if (!r) return;
  try { r.sku = r.sku.trim(); Store.saveStock(r, !sku); await persist(); toast(sku ? 'Item updated' : 'Item added'); go('stock'); }
  catch (err) { toast(err.message); }
}
async function replenishDlg(sku) {
  const s = Store.stockItem(sku);
  const r = await modal(`Replenish: ${s.name} ${s.specification}`, [
    { name: 'qty', label: `Quantity received (now ${s.qty} ${s.uom})`, type: 'number', min: 0, step: 'any', required: true },
    { name: 'unit_cost', label: 'New unit cost (optional)', type: 'number', min: 0, step: 'any', value: '' },
    { name: 'note', label: 'Supplier / note', value: '' },
  ], 'Add to stock');
  if (!r || !(Store.num(r.qty) > 0)) return;
  Store.replenish(sku, r.qty, r.unit_cost, r.note); await persist();
  toast(`Added ${r.qty} ${s.uom}`); go(location.hash.slice(1) || 'stock');
}
async function deleteStock(sku) {
  const s = Store.stockItem(sku);
  if (!await confirmBox(`Delete "${s.name}" from stock? Past invoices keep their lines.`)) return;
  Store.deleteStock(sku); await persist(); toast('Item deleted'); go('stock');
}

VIEWS.history = () => {
  const names = Object.fromEntries(Store.stock().map(s => [s.sku, s.name + ' ' + s.specification]));
  const rows = [...Store.movements()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 500);
  $('#main').innerHTML = `<div class="view-head"><h2>Stock history</h2><span class="spacer"></span><button class="btn" onclick="go('stock')">Back to stock</button></div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Item</th><th>Change</th><th class="num">Qty</th><th>Ref</th><th class="hide-sm">By</th><th class="hide-sm">Note</th></tr></thead><tbody>
    ${rows.length ? rows.map(m => `<tr><td>${esc(m.date.slice(0, 16).replace('T', ' '))}</td><td>${esc(names[m.sku] || m.sku)}</td><td>${esc(m.type)}</td>
      <td class="num">${Store.num(m.qty) > 0 ? '+' : ''}${esc(m.qty)}</td><td>${m.ref ? `<a href="#editor/${esc(m.ref)}">${esc(m.ref)}</a>` : ''}</td>
      <td class="hide-sm">${esc(m.user)}</td><td class="hide-sm muted">${esc(m.note)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No stock movements yet.</td></tr>'}
    </tbody></table></div>`;
};

// ============ invoices list ============
VIEWS.invoices = () => {
  $('#main').innerHTML = `
    <div class="view-head"><h2>Invoices &amp; quotations</h2><span class="spacer"></span>
      <input class="search" id="inv-q" placeholder="Search number or client…">
      <select id="inv-type" style="width:auto"><option value="">All types</option><option>Invoice</option><option>Quotation</option></select>
      <select id="inv-status" style="width:auto"><option value="">Any status</option>${[...new Set([...STATUSES.Invoice, ...STATUSES.Quotation])].map(s => `<option>${s}</option>`).join('')}</select>
      <button class="btn primary" onclick="go('editor')">New</button></div>
    <div class="table-wrap"><table><thead><tr><th>Number</th><th>Date</th><th>Client</th><th class="num">Total</th><th class="num hide-sm">Balance</th><th>Status</th><th></th></tr></thead>
    <tbody id="inv-body"></tbody></table></div>`;
  const render = () => {
    const q = $('#inv-q').value.toLowerCase(), ty = $('#inv-type').value, st = $('#inv-status').value;
    const rows = Store.invoices().filter(i => (!ty || i.type === ty) && (!st || i.status === st) &&
      (!q || [i.number, i.client_name, i.client_company, i.description].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at));
    $('#inv-body').innerHTML = rows.length ? rows.map(i => {
      const bal = i.type === 'Invoice' && i.status !== 'Cancelled' ? Store.num(i.grand_total) - Store.num(i.amount_paid) : null;
      return `<tr><td style="white-space:nowrap"><a href="#editor/${esc(i.number)}">${esc(i.number)}</a><div class="muted" style="font-size:12px">${esc(i.type)}${i.converted_to ? ' → ' + esc(i.converted_to) : ''}</div></td>
      <td style="white-space:nowrap">${esc(InvoicePDF.fmtDate(i.date))}</td><td>${esc(i.client_company || i.client_name)}<div class="muted" style="font-size:12px">${esc(i.description)}</div></td>
      <td class="num">${money(i.grand_total)}</td><td class="num hide-sm">${bal == null ? '' : money(bal)}</td><td>${statusPill(i.status)}</td>
      <td class="actions"><button class="btn small" onclick="pdfFor('${esc(i.number)}')">PDF</button><button class="btn small" onclick="statusDlg('${esc(i.number)}')">Status</button></td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty">${q || ty || st ? 'Nothing matches.' : 'No invoices or quotations yet.'}</td></tr>`;
  };
  ['inv-q', 'inv-type', 'inv-status'].forEach(id => $('#' + id).oninput = render); render();
};
async function statusDlg(number) {
  const inv = Store.invoice(number);
  const fields = [{ name: 'status', label: 'Status', type: 'select', options: STATUSES[inv.type], value: inv.status }];
  if (inv.type === 'Invoice') fields.push({ name: 'amount_paid', label: `Amount paid so far (of ${money(inv.grand_total)})`, type: 'number', min: 0, step: 'any', value: inv.amount_paid });
  const note = inv.type === 'Invoice' ? '<p class="muted" style="margin:0;font-size:13px">Stock is deducted when an invoice is Issued, Partially Paid or Paid, and returned if it goes back to Draft or Cancelled.</p>' : '';
  const r = await modal(`${number} status`, fields, 'Update', note);
  if (!r) return;
  Store.setStatus(number, r.status, r.amount_paid); await persist(); toast('Status updated');
  go(location.hash.slice(1));
}
async function pdfFor(number) {
  const inv = Store.invoice(number);
  toast('Building PDF…');
  try {
    const doc = await InvoicePDF.build(inv, Store.items(number), Store.settings());
    download(doc.output('blob'), InvoicePDF.fileName(inv));
  } catch (err) { console.error(err); toast('PDF failed: ' + err.message); }
}

// ============ invoice editor ============
VIEWS.editor = number => {
  const s = Store.settings();
  const existing = number ? Store.invoice(number) : null;
  if (number && !existing) return go('invoices');
  const inv = existing ? { ...existing } : {
    type: 'Quotation', date: today(), due_date: '', client_name: '', client_tel: '', client_company: '', description: '',
    labor_pct: s.default_labor_pct, vat_pct: s.default_vat_pct, status: 'Draft',
  };
  let lines = existing ? Store.items(number).map(l => ({ ...l })) : [{ sku: '', item: '', specification: '', qty: 1, uom: 'PCs', unit_cost: '' }];
  const stock = Store.stock();
  $('#main').innerHTML = `
    <div class="view-head"><h2>${existing ? esc(inv.type) + ' ' + esc(inv.number) : 'New invoice / quotation'}</h2>
      ${existing ? statusPill(inv.status) : ''}<span class="spacer"></span>
      ${existing && inv.type === 'Quotation' && !inv.converted_to ? '<button class="btn" id="convert">Convert to invoice</button>' : ''}
      ${existing ? '<button class="btn danger" id="del">Delete</button>' : ''}
      <button class="btn" id="save">Save</button><button class="btn primary" id="save-pdf">Save &amp; download PDF</button></div>
    <div class="card" style="margin-bottom:16px"><div class="form-grid" id="head">
      <label class="f">Type<select name="type" ${existing ? 'disabled' : ''}><option ${inv.type === 'Quotation' ? 'selected' : ''}>Quotation</option><option ${inv.type === 'Invoice' ? 'selected' : ''}>Invoice</option></select></label>
      <label class="f">Number<input name="number" value="${esc(existing ? inv.number : Store.nextNumber(inv.type))}" ${existing ? 'readonly' : ''}></label>
      <label class="f">Invoice date<input name="date" type="date" value="${esc(inv.date)}" required></label>
      <label class="f">Due date<input name="due_date" type="date" value="${esc(inv.due_date)}"></label>
      <label class="f">Contact name<input name="client_name" value="${esc(inv.client_name)}" list="clients"></label>
      <label class="f">Tel<input name="client_tel" value="${esc(inv.client_tel)}" inputmode="tel"></label>
      <label class="f">Client company<input name="client_company" value="${esc(inv.client_company)}"></label>
      <label class="f">Description of service<input name="description" value="${esc(inv.description)}"></label>
      <label class="f">Labor %<input name="labor_pct" type="number" min="0" step="any" value="${esc(inv.labor_pct)}"></label>
      <label class="f">VAT %<input name="vat_pct" type="number" min="0" step="any" value="${esc(inv.vat_pct)}"></label>
    </div></div>
    <datalist id="clients">${[...new Set(Store.invoices().map(i => i.client_name).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="stock-list">${stock.map(x => `<option value="${esc(x.name + ' | ' + x.specification)}">${esc(x.qty + ' ' + x.uom + ' in stock · ' + money(x.unit_cost))}</option>`).join('')}</datalist>
    <div class="card"><h3 style="margin-bottom:6px">Items</h3>
      <p class="muted" style="margin:0 0 10px;font-size:13px">Pick from stock or type a new item. Repeat the same item name on the next line to group it (e.g. Indoors / Outdoors cameras).</p>
      <div class="table-wrap"><table class="lines"><thead><tr><th>#</th><th>Item</th><th>Specification</th><th>Qty</th><th>UOM</th><th>Unit cost</th><th class="num">Amount</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;align-items:flex-start">
        <button class="btn" id="add-line">+ Add line</button>
        <div class="totals" id="totals"></div>
      </div>
    </div>`;

  const head = () => Object.fromEntries($$('#head input, #head select').map(e => [e.name, e.value]));
  const findStock = v => stock.find(x => x.name + ' | ' + x.specification === v);
  function renderLines() {
    $('#lines').innerHTML = lines.map((l, i) => {
      const st = l.sku && Store.stockItem(l.sku);
      const warn = st && head().type === 'Invoice' && Store.num(l.qty) > Store.num(st.qty) + (existing && existing.stock_applied === '1' ? Store.num((Store.items(number).find(o => o.sku === l.sku) || {}).qty) : 0)
        ? `<div style="color:var(--bad);font-size:12px">Only ${esc(st.qty)} in stock</div>` : '';
      return `<tr data-i="${i}"><td class="muted">${i + 1}</td>
      <td><input data-k="item" value="${esc(l.item)}" list="stock-list" placeholder="Item">${st ? '<div class="tag">from stock · ' + esc(st.qty + ' ' + st.uom) + ' available</div>' : ''}</td>
      <td><input data-k="specification" value="${esc(l.specification)}"></td>
      <td><input class="w-qty" data-k="qty" type="number" min="0" step="any" value="${esc(l.qty)}">${warn}</td>
      <td><input class="w-uom" data-k="uom" value="${esc(l.uom)}"></td>
      <td><input class="w-cost" data-k="unit_cost" type="number" min="0" step="any" value="${esc(l.unit_cost)}"></td>
      <td class="num">${money(Store.num(l.qty) * Store.num(l.unit_cost))}</td>
      <td><button class="btn small danger" data-del="${i}" title="Remove line">✕</button></td></tr>`;
    }).join('');
    renderTotals();
  }
  function renderTotals() {
    const h = head(), t = Store.totals(h, lines);
    $('#totals').innerHTML = `<div><span>Sub total</span><span class="num">${money(t.subtotal)}</span></div>
      <div><span>Labor (${esc(h.labor_pct || 0)}%)</span><span class="num">${money(t.labor)}</span></div>
      <div><span>Sub total</span><span class="num">${money(t.subtotal2)}</span></div>
      <div><span>VAT (${esc(h.vat_pct || 0)}%)</span><span class="num">${money(t.vat)}</span></div>
      <div class="grand"><span>Grand total</span><span class="num">${money(t.grand_total)}</span></div>
      <div class="muted" style="font-size:12px;display:block">${esc(InvoicePDF.words(t.grand_total))} Ugandan shillings.</div>`;
  }
  $('#lines').addEventListener('input', e => {
    const tr = e.target.closest('tr'), k = e.target.dataset.k; if (!tr || !k) return;
    const l = lines[+tr.dataset.i];
    if (k === 'item') {
      const st = findStock(e.target.value);
      if (st) { Object.assign(l, { sku: st.sku, item: st.name, specification: st.specification, uom: st.uom, unit_cost: st.unit_cost }); renderLines(); return; }
      if (l.sku && (Store.stockItem(l.sku) || {}).name !== e.target.value) l.sku = '';
    }
    l[k] = e.target.value;
    tr.cells[6].textContent = money(Store.num(l.qty) * Store.num(l.unit_cost));
    renderTotals();
  });
  $('#lines').addEventListener('change', e => { if (e.target.dataset.k === 'qty') renderLines(); });
  $('#lines').addEventListener('click', e => { const d = e.target.dataset.del; if (d != null) { lines.splice(+d, 1); renderLines(); } });
  $('#add-line').onclick = () => { lines.push({ sku: '', item: '', specification: '', qty: 1, uom: 'PCs', unit_cost: '' }); renderLines(); $$('#lines tr:last-child input')[0].focus(); };
  $('#head').addEventListener('input', e => {
    if (e.target.name === 'type' && !existing) $('#head [name=number]').value = Store.nextNumber(e.target.value);
    renderTotals(); if (e.target.name === 'type') renderLines();
  });

  async function save(withPdf) {
    const h = head();
    if (!h.date) return toast('Please set the invoice date');
    const clean = lines.filter(l => (l.item || '').trim() || (l.specification || '').trim());
    if (!clean.length) return toast('Add at least one item');
    if (!existing && Store.invoice(h.number.trim())) return toast('That number is already used');
    const row = Store.saveInvoice({ ...(existing || {}), ...h, number: existing ? existing.number : h.number.trim(),
      type: existing ? existing.type : h.type, status: existing ? existing.status : 'Draft' }, clean);
    await persist();
    toast('Saved ' + row.number);
    if (withPdf) await pdfFor(row.number);
    go('editor/' + row.number);
  }
  $('#save').onclick = () => save(false);
  $('#save-pdf').onclick = () => save(true);
  if ($('#del')) $('#del').onclick = async () => {
    if (!await confirmBox(`Delete ${inv.number}? ${existing.stock_applied === '1' ? 'Its items will be returned to stock.' : ''}`)) return;
    Store.deleteInvoice(inv.number); await persist(); toast('Deleted'); go('invoices');
  };
  if ($('#convert')) $('#convert').onclick = async () => {
    const n = Store.convertToInvoice(inv.number); await persist(); toast('Created invoice ' + n.number); go('editor/' + n.number);
  };
  if (!existing) { const dd = Store.num(s.due_days); if (dd) $('#head [name=due_date]').value = addDays(inv.date, dd); }
  renderLines();
};

// ============ settings, users, backup ============
VIEWS.settings = () => {
  const s = Store.settings(), admin = Vault.user.admin;
  const field = (k, label, type = 'text') => `<label class="f">${esc(label)}<input data-set="${k}" type="${type}" value="${esc(s[k])}"></label>`;
  $('#main').innerHTML = `
    <div class="view-head"><h2>Settings</h2></div>
    <div class="grid" style="gap:16px">
      <div class="card"><h3 style="margin-bottom:6px">Cloud sync</h3>
        <p class="muted" style="margin:0 0 12px;font-size:14px">Data store: <b>${esc(Vault.device.repo)}</b> (private, encrypted). Changes are saved on this device straight away and uploaded,
          encrypted, within seconds when online. Other devices' changes are downloaded every minute. Offline sign-in works for ${Vault.OFFLINE_DAYS} days after the last online check.
          Every saved version is kept in the cloud history, so nothing is lost.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="sync-now">Sync now</button>
          <button class="btn" id="bk-dl">Download extra backup</button>
          <label class="btn" style="display:inline-flex;align-items:center">Import &amp; merge backup<input type="file" id="bk-in" accept=".elsys,application/octet-stream,application/json" hidden></label>
        </div>
      </div>

      <div class="card"><h3 style="margin-bottom:6px">PDF fonts</h3>
        <p class="muted" style="margin:0 0 12px;font-size:14px" id="font-status">Checking…</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="font-up">Upload fonts to cloud (once, from the laptop)</button>
          <label class="btn" style="display:inline-flex;align-items:center">Load font files (.ttf)<input type="file" id="font-in" accept=".ttf" multiple hidden></label>
        </div>
        <p class="muted" style="margin:10px 0 0;font-size:13px">Fonts are kept in your private cloud storage, never on the public app address. Needed files (from C:\\Windows\\Fonts): ${InvoicePDF.FONT_FILES.join(', ')}</p></div>

      <div class="card"><h3 style="margin-bottom:12px">Payment details printed on documents</h3><div class="form-grid">
        ${field('pay_bank', 'Bank line')}${field('pay_account', 'Account number')}
        ${field('pay_merchant', 'Merchant code (text after | is bold)')}${field('pay_momo', 'Mobile money number')}
        ${field('pay_momo_name', 'Mobile money name')}${field('footer', 'Footer text')}</div></div>

      <div class="card"><h3 style="margin-bottom:12px">Numbering &amp; defaults</h3><div class="form-grid">
        ${field('quotation_prefix', 'Quotation prefix')}${field('quotation_next', 'Next quotation number', 'number')}
        ${field('invoice_prefix', 'Invoice prefix')}${field('invoice_next', 'Next invoice number', 'number')}
        ${field('default_labor_pct', 'Default labor %', 'number')}${field('default_vat_pct', 'Default VAT %', 'number')}
        ${field('due_days', 'Due date (days after invoice date)', 'number')}
        <label class="f">Labor % on the PDF<select data-set="labor_style">${['Red, struck through', 'Plain'].map(o =>
          `<option ${s.labor_style === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label></div>
        <div style="margin-top:12px"><button class="btn primary" id="save-settings">Save settings</button></div></div>

      <div class="card"><h3 style="margin-bottom:12px">Users</h3>
        <div class="table-wrap" style="margin-bottom:12px"><table><tbody>${Vault.users.map(u => `<tr><td>${esc(u.name)}</td><td>${u.admin ? '<span class="pill">Admin</span>' : ''}</td>
          <td class="actions">${admin && u.name.toLowerCase() !== Vault.user.u ? `<button class="btn small danger" onclick="removeUser('${esc(u.name)}')">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${admin ? '<button class="btn" id="add-user">Add user</button>' : ''}<button class="btn" id="chg-pw">Change my password</button></div>
        <p class="muted" style="margin:10px 0 0;font-size:13px">User changes need an internet connection and apply on every device at its next sync. A new user signs in on a device with the access key the first time.</p></div>

      <div class="card"><h3 style="margin-bottom:6px">Export for Excel</h3>
        <p class="muted" style="margin:0 0 12px;font-size:14px">Plain, unencrypted CSV copies. Keep them somewhere private.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${Object.keys(SCHEMA).filter(n => n !== 'settings.csv').map(n => `<button class="btn" data-csv="${n}">${n}</button>`).join('')}</div></div>
    </div>`;

  $('#save-settings').onclick = async () => {
    $$('[data-set]').forEach(i => Store.setSetting(i.dataset.set, i.value));
    await persist(); toast('Settings saved');
  };
  $$('[data-csv]').forEach(b => b.onclick = () => download(new Blob([Store.dump()[b.dataset.csv]], { type: 'text/csv' }), b.dataset.csv));
  const backupName = () => `elsys-backup-${today()}.elsys`;
  const fontStatus = async () => {
    const f = (await Vault.getFonts()) || {};
    const missing = InvoicePDF.FONT_FILES.filter(n => !f[n]);
    if (missing.length) { try { await InvoicePDF.loadAssets(); return fontStatus(); } catch { /* not on this device */ } }
    const el = $('#font-status'); if (!el) return;
    el.innerHTML = missing.length ? `<span style="color:var(--bad)">Missing on this device: ${esc(missing.join(', '))}.</span> PDFs can't be made until they are added: upload them to the cloud from the laptop, or load the files here.`
      : '<span style="color:var(--ok)">All PDF fonts are saved on this device.</span>';
  };
  $('#sync-now').onclick = async () => { await Vault.syncNow(); toast(Vault.online ? 'Synced' : 'Offline: will sync when connected'); };
  $('#font-up').onclick = async () => {
    const f = (await Vault.getFonts()) || {};
    if (!InvoicePDF.FONT_FILES.every(n => f[n])) return toast('This device does not have all the fonts yet');
    try { toast('Uploading fonts…'); await Vault.uploadFonts(f); toast('Fonts are saved in your cloud storage'); }
    catch (err) { toast(err.message); }
  };
  fontStatus();
  $('#font-in').onchange = async e => {
    const f = (await Vault.getFonts()) || {};
    for (const file of e.target.files) {
      const n = file.name.toLowerCase();
      if (InvoicePDF.FONT_FILES.includes(n)) f[n] = await file.arrayBuffer();
    }
    await Vault.setFonts(f); InvoicePDF.reset(); e.target.value = ''; fontStatus(); toast('Fonts saved on this device');
  };
  $('#bk-dl').onclick = () => download(Vault.exportBlob(), backupName());
  $('#bk-in').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = await f.text();
      let files;
      try { files = await Vault.readBackup(text); }
      catch (err) {
        const pw = await modal('This backup was made with a different password', [{ name: 'p', label: 'Password used for that backup', type: 'password', required: true }], 'Open');
        if (!pw) return;
        files = await Vault.readBackup(text, pw.p);
      }
      const st = Store.merge(files); await persist();
      toast(`Merged: ${st.invoices} invoices, ${st.stock} stock items, ${st.movements} stock moves updated`);
      go('settings');
    } catch (err) { toast(err.message); }
    e.target.value = '';
  };
  if ($('#add-user')) $('#add-user').onclick = async () => {
    const r = await modal('Add user', [
      { name: 'u', label: 'Username', required: true },
      { name: 'p', label: 'Password (8+ characters)', type: 'password', required: true },
      { name: 'admin', label: 'Role', type: 'select', options: ['Staff', 'Admin'], value: 'Staff' },
    ], 'Add user');
    if (!r) return;
    if (r.p.length < 8) return toast('Password must be at least 8 characters');
    try { await Vault.addUser(r.u.trim(), r.p, r.admin === 'Admin'); toast('User added'); go('settings'); }
    catch (err) { toast(err.message); }
  };
  $('#chg-pw').onclick = async () => {
    const r = await modal('Change my password', [
      { name: 'p', label: 'New password (8+ characters)', type: 'password', required: true },
      { name: 'p2', label: 'Repeat new password', type: 'password', required: true },
    ], 'Change');
    if (!r) return;
    if (r.p.length < 8 || r.p !== r.p2) return toast('Passwords must match and be 8+ characters');
    try { await Vault.changePassword(r.p); toast('Password changed on all devices'); } catch (err) { toast(err.message); }
  };
};
async function removeUser(name) {
  if (!await confirmBox(`Remove user ${name}? They will be signed out on every device at its next sync.`, 'Remove')) return;
  try { await Vault.removeUser(name); toast('User removed'); go('settings'); } catch (err) { toast(err.message); }
}

// ============ boot ============
if (!window.isSecureContext || !crypto.subtle) {
  document.body.innerHTML = '<p style="padding:24px;font:16px system-ui">This app needs a secure connection. Open it via http://localhost on the laptop, or from an https:// address on your phone.</p>';
} else {
  showAuth();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
