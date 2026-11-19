// Business data, kept as CSV tables (stock, movements, invoices, invoice_items, settings).
'use strict';

const CSV = {
  parse(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const [head, ...body] = rows;
    if (!head) return [];
    return body.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  },
  stringify(cols, rows) {
    const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
  },
};

const SCHEMA = {
  'stock.csv': ['sku', 'name', 'specification', 'uom', 'unit_cost', 'qty', 'reorder_level', 'updated_at', 'deleted'],
  'movements.csv': ['id', 'date', 'sku', 'type', 'qty', 'ref', 'user', 'note'],
  'invoices.csv': ['number', 'type', 'date', 'due_date', 'client_name', 'client_tel', 'client_company', 'description',
    'labor_pct', 'vat_pct', 'subtotal', 'labor', 'subtotal2', 'vat', 'grand_total', 'status', 'amount_paid',
    'stock_applied', 'converted_to', 'created_by', 'created_at', 'updated_at', 'deleted'],
  'invoice_items.csv': ['invoice_number', 'line', 'sku', 'item', 'specification', 'qty', 'uom', 'unit_cost', 'amount'],
  'settings.csv': ['key', 'value', 'updated_at'],
};

const DEFAULT_SETTINGS = {
  quotation_prefix: 'QN-', quotation_next: '74560',
  invoice_prefix: 'INV-', invoice_next: '172880',
  default_labor_pct: '30', default_vat_pct: '0', due_days: '14', labor_style: 'Red, struck through',
  pay_bank: 'STANBIC BANK - EL-SYS CONTROLS',
  pay_account: '9030025045040',
  pay_merchant: '*291* 3 Code |274227',
  pay_momo: '0701475685',
  pay_momo_name: 'Joseph Bwamiki',
  footer: 'Thank you for your business.',
};

const Store = (() => {
  let t = {};   // table name -> array of row objects
  const now = () => new Date().toISOString();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; };

  function load(files) {
    t = {};
    for (const name of Object.keys(SCHEMA)) t[name] = files && files[name] ? CSV.parse(files[name]) : [];
    const s = settings();
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (!(k in s)) t['settings.csv'].push({ key: k, value: v, updated_at: '' });
  }
  function dump() {
    const out = {};
    for (const [name, cols] of Object.entries(SCHEMA)) out[name] = CSV.stringify(cols, t[name]);
    return out;
  }
  function settings() { return Object.fromEntries(t['settings.csv'].map(r => [r.key, r.value])); }
  function setSetting(key, value) {
    const r = t['settings.csv'].find(x => x.key === key);
    if (r && r.value === value) return;
    if (r) Object.assign(r, { value, updated_at: now() }); else t['settings.csv'].push({ key, value, updated_at: now() });
  }

  // ---------- stock ----------
  const stock = () => t['stock.csv'].filter(s => s.deleted !== '1');
  const stockItem = sku => t['stock.csv'].find(s => s.sku === sku);
  function move(sku, type, qty, ref, note) {
    t['movements.csv'].push({ id: uid(), date: now(), sku, type, qty, ref: ref || '', user: Vault.user ? Vault.user.name : '', note: note || '' });
  }
  function saveStock(item, isNew) {
    if (isNew) {
      if (!item.sku) item.sku = 'SKU-' + uid().toUpperCase().slice(-6);
      const existing = stockItem(item.sku);
      if (existing && existing.deleted !== '1') throw new Error('An item with code ' + item.sku + ' already exists');
      const qty = num(item.qty);
      const row = { ...item, qty: String(qty), updated_at: now(), deleted: '' };
      if (existing) Object.assign(existing, row); else t['stock.csv'].push(row);
      move(item.sku, 'add', qty, '', 'New item');
    } else {
      const s = stockItem(item.sku);
      const diff = num(item.qty) - num(s.qty);
      Object.assign(s, item, { updated_at: now() });
      if (diff) move(item.sku, 'adjust', diff, '', 'Manual stock correction');
    }
  }
  function replenish(sku, qty, unitCost, note) {
    const s = stockItem(sku);
    s.qty = String(num(s.qty) + num(qty));
    if (unitCost !== '' && unitCost != null) s.unit_cost = String(num(unitCost));
    s.updated_at = now();
    move(sku, 'replenish', num(qty), '', note);
  }
  function deleteStock(sku) {
    const s = stockItem(sku);
    move(sku, 'delete', -num(s.qty), '', 'Item removed from inventory');
    s.qty = '0'; s.deleted = '1'; s.updated_at = now();
  }

  // ---------- invoices ----------
  const invoices = () => t['invoices.csv'].filter(i => i.deleted !== '1');
  const invoice = n => t['invoices.csv'].find(i => i.number === n);
  const items = n => t['invoice_items.csv'].filter(i => i.invoice_number === n).sort((a, b) => num(a.line) - num(b.line));

  function nextNumber(type) {
    const s = settings(), key = type === 'Invoice' ? 'invoice' : 'quotation';
    let n = parseInt(s[key + '_next'], 10) || 1;
    while (invoice(s[key + '_prefix'] + n)) n++;
    return s[key + '_prefix'] + n;
  }
  function totals(inv, lines) {
    const subtotal = lines.reduce((a, l) => a + num(l.qty) * num(l.unit_cost), 0);
    const labor = Math.round(subtotal * num(inv.labor_pct) / 100);
    const subtotal2 = subtotal + labor;
    const vat = Math.round(subtotal2 * num(inv.vat_pct) / 100);
    return { subtotal, labor, subtotal2, vat, grand_total: subtotal2 + vat };
  }
  // Stock is deducted when an Invoice is issued; Quotations never touch stock.
  function applyStock(inv, sign) {
    for (const l of items(inv.number)) {
      if (!l.sku) continue;
      const s = stockItem(l.sku);
      if (!s) continue;
      s.qty = String(num(s.qty) - sign * num(l.qty)); s.updated_at = now();
      move(l.sku, sign > 0 ? 'invoice' : 'invoice-reversal', -sign * num(l.qty), inv.number);
    }
    inv.stock_applied = sign > 0 ? '1' : '';
  }
  function saveInvoice(inv, lines) {
    const isNew = !inv.number || !invoice(inv.number);
    let row = isNew ? null : invoice(inv.number);
    if (row && row.stock_applied === '1') applyStock(row, -1);   // put stock back, re-deduct below
    if (isNew) {
      inv.number = inv.number || nextNumber(inv.type);
      row = { created_by: Vault.user.name, created_at: now(), status: 'Draft', amount_paid: '0' };
      t['invoices.csv'].push(row);
      const s = settings(), key = inv.type === 'Invoice' ? 'invoice' : 'quotation';
      const n = parseInt(inv.number.slice(s[key + '_prefix'].length), 10);
      if (n >= (parseInt(s[key + '_next'], 10) || 0)) setSetting(key + '_next', String(n + 1));
    }
    Object.assign(row, inv, totals(inv, lines), { updated_at: now() });
    t['invoice_items.csv'] = t['invoice_items.csv'].filter(i => i.invoice_number !== row.number);
    lines.forEach((l, i) => t['invoice_items.csv'].push({
      invoice_number: row.number, line: String(i + 1), sku: l.sku || '', item: l.item, specification: l.specification,
      qty: String(num(l.qty)), uom: l.uom, unit_cost: String(num(l.unit_cost)), amount: String(num(l.qty) * num(l.unit_cost)),
    }));
    if (row.type === 'Invoice' && ['Issued', 'Partially Paid', 'Paid'].includes(row.status)) applyStock(row, 1);
    return row;
  }
  function setStatus(number, status, amountPaid) {
    const inv = invoice(number);
    inv.status = status;
    if (amountPaid != null) inv.amount_paid = String(num(amountPaid));
    if (status === 'Paid') inv.amount_paid = inv.grand_total;
    const shouldApply = inv.type === 'Invoice' && ['Issued', 'Partially Paid', 'Paid'].includes(status);
    if (shouldApply && inv.stock_applied !== '1') applyStock(inv, 1);
    if (!shouldApply && inv.stock_applied === '1') applyStock(inv, -1);
    inv.updated_at = now();
  }
  function deleteInvoice(number) {
    const inv = invoice(number);
    if (inv.stock_applied === '1') applyStock(inv, -1);
    inv.deleted = '1'; inv.updated_at = now();
  }
  function convertToInvoice(number) {
    const q = invoice(number);
    const lines = items(number).map(l => ({ ...l }));
    const inv = saveInvoice({ ...q, number: '', type: 'Invoice', status: 'Draft', amount_paid: '0', stock_applied: '', converted_to: '',
      date: today(), due_date: '' }, lines);
    q.converted_to = inv.number; q.status = 'Accepted'; q.updated_at = now();
    return inv;
  }

  // ---------- merge another device's data ----------
  // Rules: stock movements are combined (never lost) and stock quantities are recounted from them;
  // for invoices, stock item details and settings, the most recent edit wins; invoice numbers that two
  // devices both used for different documents are resolved by renumbering this device's document.
  function merge(files) {
    const other = {};
    for (const name of Object.keys(SCHEMA)) other[name] = files[name] ? CSV.parse(files[name]) : [];
    const stats = { stock: 0, invoices: 0, movements: 0, renumbered: [] };

    // 1. Number clashes: same number, different document (created at a different moment)
    const taken = new Set([...t['invoices.csv'], ...other['invoices.csv']].map(i => i.number));
    const s0 = settings();
    for (const o of other['invoices.csv']) {
      const m = invoice(o.number);
      if (!m || m.created_at === o.created_at) continue;
      const key = m.type === 'Invoice' ? 'invoice' : 'quotation', prefix = s0[key + '_prefix'];
      let n = Math.max(parseInt(s0[key + '_next'], 10) || 1,
        ...[...taken].filter(x => x.startsWith(prefix)).map(x => (parseInt(x.slice(prefix.length), 10) || 0) + 1));
      while (taken.has(prefix + n)) n++;
      const oldNo = m.number, newNo = prefix + n;
      taken.add(newNo);
      m.number = newNo; m.updated_at = now();
      t['invoice_items.csv'].forEach(i => { if (i.invoice_number === oldNo) i.invoice_number = newNo; });
      t['movements.csv'].forEach(x => { if (x.ref === oldNo && !other['movements.csv'].some(y => y.id === x.id)) x.ref = newNo; });
      // a quotation converted on this device points at our document, unless the other side's copy already points at theirs
      t['invoices.csv'].forEach(x => {
        if (x === m || x.converted_to !== oldNo) return;
        const theirs = other['invoices.csv'].find(y => y.number === x.number);
        if (!theirs || theirs.converted_to !== oldNo) { x.converted_to = newNo; x.updated_at = now(); }
      });
      setSetting(key + '_next', String(n + 1));
      stats.renumbered.push(oldNo + ' → ' + newNo);
    }

    // 2. Stock item details: newest edit wins
    for (const o of other['stock.csv']) {
      const m = stockItem(o.sku);
      if (!m) { t['stock.csv'].push(o); stats.stock++; }
      else if (o.updated_at > m.updated_at) { Object.assign(m, o); stats.stock++; }
    }
    // 3. Invoices and their lines: newest edit wins
    for (const o of other['invoices.csv']) {
      const m = invoice(o.number);
      if (!m || o.updated_at > m.updated_at) {
        if (m) Object.assign(m, o); else t['invoices.csv'].push(o);
        t['invoice_items.csv'] = t['invoice_items.csv'].filter(i => i.invoice_number !== o.number)
          .concat(other['invoice_items.csv'].filter(i => i.invoice_number === o.number));
        stats.invoices++;
      }
    }
    // 4. Stock movements: keep every one from both sides
    const ids = new Set(t['movements.csv'].map(m => m.id));
    for (const o of other['movements.csv']) if (!ids.has(o.id)) { t['movements.csv'].push(o); stats.movements++; }
    // 5. Settings: numbering only ever moves forward; other settings newest edit wins
    for (const o of other['settings.csv']) {
      const m = t['settings.csv'].find(x => x.key === o.key);
      if (/_next$/.test(o.key)) { if (!m || (parseInt(o.value, 10) || 0) > (parseInt(m.value, 10) || 0)) setSetting(o.key, o.value); }
      else if (!m) t['settings.csv'].push(o);
      else if ((o.updated_at || '') > (m.updated_at || '')) Object.assign(m, o);
    }
    recount();
    return stats;
  }
  // Stock on hand and "stock taken out" flags always follow the movement history.
  function recount() {
    const qty = {}, byRef = {};
    for (const m of t['movements.csv']) {
      qty[m.sku] = (qty[m.sku] || 0) + num(m.qty);
      if (m.ref && /^invoice/.test(m.type)) byRef[m.ref] = (byRef[m.ref] || 0) + num(m.qty);
    }
    for (const s of t['stock.csv']) {
      const q = String(+(qty[s.sku] || 0).toFixed(4));
      if (s.qty !== q) s.qty = q;
    }
    for (const i of t['invoices.csv']) i.stock_applied = (byRef[i.number] || 0) < 0 ? '1' : '';
  }

  return {
    load, dump, settings, setSetting, num,
    stock, stockItem, saveStock, replenish, deleteStock,
    movements: () => t['movements.csv'],
    invoices, invoice, items, nextNumber, totals, saveInvoice, setStatus, deleteInvoice, convertToInvoice,
    merge, recount,
  };
})();
