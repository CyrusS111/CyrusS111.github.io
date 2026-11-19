// Builds the invoice / quotation PDF. Every coordinate below (in points, A4, from top-left, text at baseline)
// was measured from "Quotation Cameras Pearl Junior School Mukono.pdf" so the output lines up with it.
'use strict';

const InvoicePDF = (() => {
  const FONTS = [
    ['calibri.ttf', 'Calibri', 'normal'], ['calibrib.ttf', 'Calibri', 'bold'],
    ['bookos.ttf', 'Bookman', 'normal'], ['bookosb.ttf', 'Bookman', 'bold'],
    ['cour.ttf', 'CourierNew', 'normal'], ['courbd.ttf', 'CourierNew', 'bold'],
  ];
  let assets = null;

  const toBinary = buf => {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return s;
  };
  const toDataUrl = (buf, type) => 'data:' + type + ';base64,' + btoa(toBinary(buf));

  async function loadAssets() {
    if (assets) return assets;
    const get = p => fetch(p).then(r => { if (!r.ok) throw new Error('Missing ' + p); return r.arrayBuffer(); });
    // Fonts: saved on this device; else the laptop's local fonts folder; else the private GitHub repository.
    const stored = (await Vault.getFonts()) || {};
    const missing = FONTS.map(f => f[0]).filter(n => !stored[n]);
    if (missing.length) {
      for (const n of missing) {
        stored[n] = await get('fonts/' + n).catch(() => null) || await Vault.fontFromGitHub(n).catch(() => null);
        if (!stored[n]) { delete stored[n]; break; }
      }
      await Vault.setFonts(stored);
      if (!FONTS.every(f => stored[f[0]])) throw new Error('PDF fonts are not on this device yet. On the laptop, open Settings → "Upload fonts to cloud", then try again here (needs internet once).');
    }
    const fonts = FONTS.map(f => toBinary(stored[f[0]]));
    const [header, logo] = await Promise.all([get('assets/header.png'), get('assets/logo.png')]);
    assets = { fonts, header: toDataUrl(header, 'image/png'), logo: toDataUrl(logo, 'image/png') };
    return assets;
  }
  const FONT_FILES = FONTS.map(f => f[0]);

  // ---------- helpers ----------
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const qtyFmt = n => { n = Number(n) || 0; return Number.isInteger(n) ? String(n) : String(+n.toFixed(2)); };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return d + ' ' + MONTHS[m - 1] + ' ' + y;
  }
  function words(n) {
    n = Math.round(Number(n) || 0);
    if (n === 0) return 'Zero';
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
      'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const three = x => {
      const h = Math.floor(x / 100), r = x % 100, out = [];
      if (h) out.push(ones[h] + ' hundred');
      if (r) out.push(r < 20 ? ones[r] : tens[Math.floor(r / 10)] + (r % 10 ? '-' + ones[r % 10] : ''));
      return out.join(' ');
    };
    const scales = ['', ' thousand', ' million', ' billion', ' trillion'];
    const parts = [];
    for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
      const c = n % 1000;
      if (c) parts.unshift(three(c) + scales[i]);
    }
    const s = parts.join(' ');
    return s[0].toUpperCase() + s.slice(1);
  }

  // Table geometry (column edges, cell padding, row pitch)
  const COL = [71.7, 107.1, 227.6, 345.6, 375.4, 412.8, 482.4, 552.6];
  const PAD = 5.4, ROW_H = 12.473, FIRST_ROW = 329.3, ROWS_PER_PAGE = 18;

  // Wrap text in a Courier cell; returns array of lines
  function wrapCell(doc, text, width) {
    text = String(text || '');
    if (!text) return [''];
    return doc.splitTextToSize(text, width);
  }

  // Expand invoice lines into printable table rows (wrapping long cells, blanking repeated item names)
  function tableRows(doc, lines) {
    doc.setFont('CourierNew', 'normal'); doc.setFontSize(11);
    const rows = []; let sn = 0, prevItem = null;
    for (const l of lines) {
      const cont = prevItem !== null && l.item && l.item === prevItem;
      if (!cont) sn++;
      prevItem = l.item;
      const item = cont ? [''] : wrapCell(doc, l.item, COL[2] - COL[1] - 2 * PAD);
      const spec = wrapCell(doc, l.specification, COL[3] - COL[2] - 2 * PAD);
      const h = Math.max(item.length, spec.length);
      for (let i = 0; i < h; i++) {
        rows.push(i === 0
          ? { sn: cont ? '' : String(sn), item: item[0] || '', spec: spec[0] || '', qty: qtyFmt(l.qty), uom: l.uom || '',
              cost: money(l.unit_cost), amount: money(Number(l.qty) * Number(l.unit_cost)) }
          : { sn: '', item: item[i] || '', spec: spec[i] || '', qty: '', uom: '', cost: '', amount: '' });
      }
    }
    return rows;
  }

  function drawPage(doc, A, inv, rows, isLast, s) {
    const isQuote = inv.type !== 'Invoice';
    const black = () => doc.setTextColor(0, 0, 0);

    // Header (letterhead image + logo square, same size and place as the original)
    doc.addImage(A.header, 'PNG', 72, 72, 479.4, 111, 'hdr', 'FAST');
    doc.addImage(A.logo, 'PNG', 454.9, 72, 97.9, 97.9, 'logo', 'FAST');

    // Blue reference bar
    doc.setFillColor(0x18, 0x4F, 0x7B); doc.rect(72.65, 192.1, 479.5, 24.15, 'F');
    doc.setFont('Calibri', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
    doc.text('To:', 80.2, 206.4);
    const label = (isQuote ? 'Quotation' : 'Invoice') + ' Reference No: ';
    doc.text(label, 368.2, 206.4);
    doc.setTextColor(0xF2, 0xF2, 0xF2);
    doc.text(inv.number, 368.2 + doc.getTextWidth(label), 206.4);

    // Grey client box
    doc.setFillColor(0xF2, 0xF2, 0xF2); doc.rect(72, 216.5, 479.5, 50.2, 'F');
    black(); doc.setFontSize(11);
    const field = (lbl, val, x, y, valX) => {
      doc.setFont('Bookman', 'normal'); doc.text(lbl, x, y);
      if (!val) return;
      const vx = valX || x + doc.getTextWidth(lbl + ' ');
      doc.setFont('CourierNew', 'bold'); doc.text(String(val), vx, y);
    };
    field('Contact Name:', inv.client_name, 79.6, 230.8);
    field('Tel:', inv.client_tel, 79.6, 245.6, 162.7);
    field('Client Company:', inv.client_company, 79.6, 259.6);
    field('Invoice Date:', fmtDate(inv.date), 367.6, 230.8, 439.7);
    field('Due Date:', fmtDate(inv.due_date), 367.6, 245.6, 439.7);

    // Description of service
    doc.setFont('Calibri', 'bold'); doc.setFontSize(11);
    doc.text('Description of Service', 79.6, 292.5); doc.text(':', 179, 292.5);
    if (inv.description) { doc.setFont('CourierNew', 'bold'); doc.setFontSize(12); doc.text(inv.description, 194.3, 292.5); }

    // Items table header
    doc.setFont('Bookman', 'bold'); doc.setFontSize(10);
    const mid = i => (COL[i] + COL[i + 1]) / 2;
    doc.text('S.No', mid(0), 317.4, { align: 'center' });
    doc.text('Item', COL[1] + PAD, 317.4);
    doc.text('Specification', COL[2] + PAD, 317.4);
    doc.text('Qty', mid(3), 317.4, { align: 'center' });
    doc.text('UOM', mid(4), 317.4, { align: 'center' });
    doc.text('Unit Cost', mid(5), 317.4, { align: 'center' });
    doc.text('Amount', mid(6), 317.4, { align: 'center' });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5); doc.line(COL[0], 320, COL[7], 320);

    // Item rows
    doc.setFont('CourierNew', 'normal'); doc.setFontSize(11);
    rows.forEach((r, i) => {
      const y = FIRST_ROW + i * ROW_H;
      if (r.sn) doc.text(r.sn, COL[1] - PAD, y, { align: 'right' });
      doc.text(r.item, COL[1] + PAD, y);
      doc.text(r.spec, COL[2] + PAD, y);
      if (r.qty) doc.text(r.qty, COL[4] - PAD, y, { align: 'right' });
      doc.text(r.uom, COL[4] + PAD, y);
      if (r.cost) doc.text(r.cost, COL[6] - PAD, y, { align: 'right' });
      if (r.amount) doc.text(r.amount, COL[7] - PAD, y, { align: 'right' });
    });
    doc.setDrawColor(0xBF, 0xBF, 0xBF); doc.line(COL[0], 544.9, COL[7], 544.9);
    doc.setDrawColor(0, 0, 0); doc.line(COL[0], 546.3, COL[7], 546.3);

    if (!isLast) {
      doc.setFont('CourierNew', 'normal'); doc.setFontSize(10);
      doc.text('Continued on next page...', 78.3, 558.4);
      footer(doc, s);
      return;
    }

    // Amount in words (justified like the original text box)
    const L = 78.3, R = 393.9, LH = 11.7;
    // tokens: bold 11pt heading words, then 10pt amount words; each token's trailing space is in its own size
    const tok = (t, bold, size) => {
      doc.setFont('CourierNew', bold ? 'bold' : 'normal'); doc.setFontSize(size);
      return { t, bold, size, w: doc.getTextWidth(t), sp: doc.getTextWidth(' ') };
    };
    const tokens = ['TOTAL', 'AMOUNT', 'IN'].map(t => tok(t, true, 11));
    tokens.push({ ...tok('WORDS:', true, 11), sp: tok(' ', false, 10).w });
    (words(inv.grand_total) + ' Ugandan shillings.').split(' ').forEach(t => tokens.push(tok(t, false, 10)));
    const lines = []; let cur = [], curW = 0;
    for (const k of tokens) {
      const add = (cur.length ? cur[cur.length - 1].sp : 0) + k.w;
      if (cur.length && curW + add > R - L) { lines.push({ toks: cur, w: curW }); cur = []; curW = 0; }
      curW += (cur.length ? cur[cur.length - 1].sp : 0) + k.w; cur.push(k);
    }
    lines.push({ toks: cur, w: curW, last: true });
    let y = 558.4;
    for (const ln of lines) {
      const extra = !ln.last && ln.toks.length > 1 ? (R - L - ln.w) / (ln.toks.length - 1) : 0;
      let x = L;
      for (const k of ln.toks) {
        doc.setFont('CourierNew', k.bold ? 'bold' : 'normal'); doc.setFontSize(k.size);
        doc.text(k.t, x, y); x += k.w + k.sp + extra;
      }
      y += LH;
    }
    doc.setFont('CourierNew', 'normal'); doc.setFontSize(10);

    // Payment details
    y = y - LH + 15.8;
    const run = (parts, x, yy) => {
      for (const [t, bold] of parts) {
        doc.setFont('CourierNew', bold ? 'bold' : 'normal'); doc.text(t, x, yy); x += doc.getTextWidth(t);
      }
    };
    doc.setFontSize(10);
    run([['PAYABLE VIA:', 1], [' ' + s.pay_bank, 0]], L, y); y += 11.3;
    run([['Account Number:', 0]], 114.3, y); run([[s.pay_account, 1], [', Or', 0]], 222.3, y); y += 11.3;
    const [mPlain, mBold] = (s.pay_merchant || '').split('|');
    run([['Merchant Code:', 0]], 114.3, y); run([[mPlain || '', 0], [mBold || '', 1], ['. Or', 0]], 222.3, y); y += 11.3;
    run([['Momo pay ', 0], [s.pay_momo, 1], [' ' + s.pay_momo_name + ' or Cash', 0]], L, y);

    // Totals column
    const TL = 418.2, TR = 547.2;
    const label2 = (t, yy) => { doc.setFont('Calibri', 'normal'); doc.setFontSize(11); black(); doc.text(t, TL, yy); };
    const val = (v, yy, bold) => { doc.setFont('CourierNew', bold ? 'bold' : 'normal'); doc.setFontSize(11); black(); doc.text(v, TR, yy, { align: 'right' }); };
    label2('Sub Total', 556.5); val(money(inv.subtotal), 556.1);
    label2('Labor ', 569.9);
    const pctX = TL + doc.getTextWidth('Labor ');
    const pct = '(' + (Number(inv.labor_pct) || 0) + '%)';
    if (s.labor_style === 'Plain') doc.text(pct, pctX, 569.9);
    else {   // as in the original: red, struck through
      doc.setTextColor(0xFF, 0, 0); doc.text(pct, pctX, 569.9);
      doc.setDrawColor(0xFF, 0, 0); doc.setLineWidth(0.5); doc.line(pctX, 566.6, pctX + doc.getTextWidth(pct), 566.6);
    }
    val(money(inv.labor), 569.6);
    label2('Sub Total', 583.4); val(money(inv.subtotal2), 583.1, true);
    label2('Vat ' + (Number(inv.vat_pct) || 18) + '%', 596.7);
    if (Number(inv.vat_pct) > 0) val(money(inv.vat), 596.4);
    label2('Grand Total', 610.2); val(money(inv.grand_total), 609.9, true);

    // Blue rule under the totals
    const barY = Math.max(628.9, y + 9);
    doc.setFillColor(0x1F, 0x4E, 0x79); doc.setDrawColor(0x20, 0x38, 0x64); doc.setLineWidth(0.75);
    doc.rect(69.3, barY, 481.6, 5.7, 'FD');

    footer(doc, s);
  }

  function footer(doc, s) {
    doc.setFont('Calibri', 'normal'); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
    doc.text(s.footer || '', 293.8, 735.6, { align: 'center' });
  }

  async function build(inv, lines, settings) {
    const A = await loadAssets();
    const doc = new jspdf.jsPDF({ unit: 'pt', format: [595.32, 841.92], compress: true });
    FONTS.forEach((f, i) => { doc.addFileToVFS(f[0], A.fonts[i]); doc.addFont(f[0], f[1], f[2]); });
    doc.setProperties({ title: (inv.type === 'Invoice' ? 'Invoice ' : 'Quotation ') + inv.number, author: 'EL-SYS Controls & Engineering Ltd' });
    const rows = tableRows(doc, lines);
    const pages = [];
    for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));
    pages.forEach((p, i) => { if (i) doc.addPage(); drawPage(doc, A, inv, p, i === pages.length - 1, settings); });
    return doc;
  }

  function fileName(inv) {
    const who = (inv.client_company || inv.client_name || '').replace(/[\\/:*?"<>|]+/g, '').trim();
    return (inv.type === 'Invoice' ? 'Invoice ' : 'Quotation ') + inv.number + (who ? ' ' + who : '') + '.pdf';
  }

  return { build, fileName, words, fmtDate, money, loadAssets, FONT_FILES, reset: () => { assets = null; } };
})();
