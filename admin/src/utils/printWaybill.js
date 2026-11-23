/**
 * Dispatch waybill print view (A4 or 80mm thermal). Dependency-free Code128-B barcode.
 * Opens a popup window with @page / @media print styles and a size toggle.
 */
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

export function code128Svg(text, height = 48) {
  const codes = [104];
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0) - 32;
    codes.push(c >= 0 && c < 96 ? c : 0);
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  let x = 10;
  let rects = '';
  for (const code of codes) {
    const p = PATTERNS[code];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
      x += w;
    }
  }
  const total = x + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" class="barcode" role="img" aria-label="Barcode ${esc(text)}">${rects}</svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export function printWaybill(order, store = {}) {
  const num = order.order_number || String(order.id || '').slice(0, 8);
  const phoneFromNotes = order.notes?.match(/(?:^|\n)Phone:\s*(.+?)(\n|$)/i)?.[1]?.trim();
  const phone = order.customer_phone || order.guest_phone || phoneFromNotes || '';
  const name = `${order.first_name || order.customer_name || ''} ${order.last_name || ''}`.trim() || '—';
  const addr = [order.shipping_address, order.shipping_city, order.shipping_region].filter(Boolean).join(', ');
  const paid = ['paid', 'partially_refunded', 'refunded'].includes(order.payment_status) || order.payment_method !== 'pay_on_delivery' && order.payment_status === 'paid';
  const cod = order.payment_method === 'pay_on_delivery' && !paid;
  const banner = cod
    ? `<div class="banner cod">COLLECT ${money(order.total_amount)} CASH ON DELIVERY</div>`
    : paid
      ? `<div class="banner paid">PAID${order.payment_method === 'paystack' ? ' (PAYSTACK)' : ''} — DO NOT COLLECT</div>`
      : `<div class="banner cod">PAYMENT PENDING (${esc(order.payment_status || 'unpaid')})</div>`;

  const items = order.items || [];
  const subtotal = items.reduce((s, it) => s + Number(it.subtotal || (it.price_at_purchase * it.quantity) || 0), 0);
  const rows = items.map((it) => `<tr>
    <td>${esc(it.product_name || it.name)}${it.variant_label ? `<div class="v">${esc(it.variant_label)}</div>` : ''}</td>
    <td class="r">${esc(it.quantity)}</td>
    <td class="r">${money(it.price_at_purchase || it.price)}</td>
    <td class="r">${money(it.subtotal || it.price_at_purchase * it.quantity)}</td></tr>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Waybill ${esc(num)}</title>
<style>
  :root{font-family:system-ui,Arial,sans-serif;color:#000}
  body{margin:0;padding:16px;background:#eee}
  .toolbar{display:flex;gap:8px;justify-content:center;margin-bottom:12px}
  .toolbar button{padding:6px 14px;font-size:14px;cursor:pointer}
  .sheet{background:#fff;margin:0 auto;padding:16mm;box-sizing:border-box;width:210mm;font-size:13px}
  body.thermal .sheet{width:80mm;padding:3mm;font-size:11px}
  h1{margin:0;font-size:20px} .muted{color:#444}
  .head{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:8px}
  .barcode{display:block;width:100%;max-width:260px;height:48px;margin:8px 0 2px}
  .banner{font-weight:900;text-align:center;font-size:20px;padding:10px;margin:10px 0;border:3px solid #000}
  .banner.paid{background:#fff} .banner.cod{background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.thermal .banner{font-size:15px;padding:6px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{padding:4px;border-bottom:1px solid #999;text-align:left;vertical-align:top}
  .r{text-align:right} .v{font-size:.9em;color:#444}
  .totals{margin-left:auto;width:60%;margin-top:6px} .totals div{display:flex;justify-content:space-between;padding:2px 0}
  .grand{font-weight:900;font-size:1.2em;border-top:2px solid #000}
  .to{margin-top:8px;font-size:1.15em} .to b{font-size:1.2em}
  .sign{display:flex;gap:16px;margin-top:28px} .sign div{flex:1;border-top:1px solid #000;padding-top:4px;font-size:.85em}
  body.thermal .sign{flex-direction:column;gap:22px}
  body.thermal .head{flex-direction:column}
  @page{size:A4;margin:0}
  @media print{
    body{background:#fff;padding:0} .toolbar{display:none}
    .sheet{box-shadow:none;margin:0}
    body.a4 .sheet{width:auto}
    body.thermal .sheet{width:80mm}
  }
</style></head><body class="a4">
<div class="toolbar">
  <button id="a4">A4</button><button id="th">80mm thermal</button><button id="pr">Print</button>
</div>
<div class="sheet">
  <div class="head">
    <div><h1>${esc(store.store_name || 'Store')}</h1>
      ${store.store_phone ? `<div>${esc(store.store_phone)}</div>` : ''}
      ${store.store_email ? `<div>${esc(store.store_email)}</div>` : ''}
      ${store.store_address ? `<div class="muted">${esc(store.store_address)}</div>` : ''}</div>
    <div><b>DISPATCH WAYBILL</b><div>Order #${esc(num)}</div>
      <div class="muted">${esc(new Date(order.created_at).toLocaleDateString('en-GH'))}</div></div>
  </div>
  ${code128Svg(num)}<div class="muted" style="font-family:monospace">${esc(num)}</div>
  ${banner}
  <div class="to">DELIVER TO<br><b>${esc(name)}</b><br>Tel: <b>${esc(phone || '—')}</b><br>${esc(addr || 'Address not provided')}</div>
  <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
    ${Number(order.discount_amount) > 0 ? `<div><span>Discount</span><span>- ${money(order.discount_amount)}</span></div>` : ''}
    <div><span>Delivery</span><span>${Number(order.delivery_fee) ? money(order.delivery_fee) : 'Free'}</span></div>
    <div class="grand"><span>TOTAL</span><span>${money(order.total_amount)}</span></div>
  </div>
  <div class="sign"><div>Rider name &amp; signature</div><div>Customer signature</div><div>Date / time</div></div>
</div>
<script>
  const b=document.body, st=document.createElement('style'); document.head.appendChild(st);
  function mode(m){b.className=m; st.textContent='@page{size:'+(m==='thermal'?'80mm auto':'A4')+';margin:'+(m==='thermal'?'0':'0')+'}'}
  document.getElementById('a4').onclick=()=>mode('a4');
  document.getElementById('th').onclick=()=>mode('thermal');
  document.getElementById('pr').onclick=()=>window.print();
  mode('a4');
</script></body></html>`;

  const w = window.open('', '_blank', 'width=900,height=900');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
