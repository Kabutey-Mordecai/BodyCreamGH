/**
 * Jumia-style boxed dispatch waybill & thermal shipping label (A4 or 80mm thermal).
 * Dependency-free Code128-B SVG barcode with structured Ghana zone routing code (e.g. BC-ACC-308721487-6357).
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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

function resolveZone(region, city) {
  const hay = `${region || ''} ${city || ''}`.toLowerCase();
  if (hay.includes('accra') || hay.includes('tema') || hay.includes('legon')) return 'ACC';
  if (hay.includes('ashanti') || hay.includes('kumasi')) return 'KSI';
  if (hay.includes('western') || hay.includes('takoradi')) return 'TAK';
  if (hay.includes('central') || hay.includes('cape coast') || hay.includes('kasoa')) return 'CAP';
  if (hay.includes('northern') || hay.includes('tamale')) return 'TAM';
  if (hay.includes('eastern') || hay.includes('koforidua')) return 'KOF';
  if (hay.includes('volta') || hay.includes('ho')) return 'VOL';
  return 'GHA';
}

export function code128Svg(text, height = 56) {
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

export function buildWaybillSheetHtml(rawOrder, store = {}, delivery = null) {
  const order = rawOrder?.order ? { ...rawOrder.order, items: rawOrder.items } : rawOrder;
  const num = order.order_number || String(order.id || '').slice(0, 8);
  const trackingCode = delivery?.tracking_number || num;
  const zoneCode = delivery?.zone_code || resolveZone(order.shipping_region, order.shipping_city);
  const partner = delivery?.delivery_partner || (order.fulfillment_method === 'pickup' ? 'Store Pickup' : 'In-house Dispatch Bike');
  const phoneFromNotes = order.notes?.match(/(?:^|\n)Phone:\s*(.+?)(\n|$)/i)?.[1]?.trim();
  const phone = order.customer_phone || order.guest_phone || phoneFromNotes || '';
  const name = `${order.first_name || order.customer_name || ''} ${order.last_name || ''}`.trim() || '—';
  const addr = [order.shipping_address, order.shipping_city, order.shipping_region].filter(Boolean).join(', ');
  const paid = ['paid', 'partially_refunded', 'refunded'].includes(order.payment_status);
  const cod = order.payment_method === 'pay_on_delivery' && !paid;
  const collectAmount = cod ? Number(order.total_amount || 0) : 0;

  const items = order.items || [];
  const totalItemQty = items.reduce((s, it) => s + Number(it.quantity || 1), 0);
  const subtotal = items.reduce((s, it) => s + Number(it.subtotal || (it.price_at_purchase * it.quantity) || 0), 0);
  const rows = items.map((it) => `<tr>
    <td>${esc(it.product_name || it.name)}${it.variant_label ? `<div class="v">${esc(it.variant_label)}</div>` : ''}</td>
    <td class="r">${esc(it.quantity)}</td>
    <td class="r">${money(it.price_at_purchase || it.price)}</td>
    <td class="r">${money(it.subtotal || it.price_at_purchase * it.quantity)}</td></tr>`).join('');

  return `<div class="sheet">
    <div class="label-box">
      <div class="brand-bar">
        <h1>${esc(store.store_name || 'BODYCREAM GH')}</h1>
        <div class="tag">EXPRESS DISPATCH WAYBILL</div>
      </div>

      <div class="grid-row">
        <div class="cell">
          <div class="lbl">Ship To (Recipient)</div>
          <div class="recipient">${esc(name)}</div>
          <div><b>Phone:</b> ${esc(phone || '—')}</div>
          <div style="margin-top:4px"><b>Address:</b> ${esc(addr || '—')}</div>
          ${order.fulfillment_method === 'pickup' ? '<div style="margin-top:4px;color:#c9a55a;font-weight:700">★ STATION PICKUP</div>' : ''}
        </div>
        <div class="cell">
          <div><b>Order #:</b> ${esc(num)}</div>
          <div><b>Order Date:</b> ${esc(new Date(order.created_at).toLocaleDateString('en-GH'))}</div>
          <div><b># items:</b> ${totalItemQty}</div>
          <div class="collect-box ${cod ? 'cod' : ''}">
            <div style="font-size:11px;font-weight:700;line-height:1.25">
              ${cod ? 'AMOUNT TO COLLECT<br>(CASH / MOMO)' : 'PREPAID ONLINE<br>DO NOT COLLECT'}
            </div>
            <div class="collect-amt">${money(collectAmount)}</div>
          </div>
        </div>
      </div>

      <div class="grid-row">
        <div class="cell zone-cell">
          <div>
            <div class="lbl">Dispatch Hub / Rider</div>
            <div><b>${esc(partner)}</b></div>
            ${delivery?.driver_phone ? `<div class="muted">${esc(delivery.driver_phone)}</div>` : ''}
          </div>
          <div class="zone-big">${esc(zoneCode)}</div>
        </div>
        <div class="cell barcode-wrap">
          <div class="lbl">Parcel Tracking Barcode</div>
          ${code128Svg(trackingCode)}
          <div class="code-txt">${esc(trackingCode)}</div>
        </div>
      </div>
    </div>

    <div class="pod-note">
      PROOF OF DELIVERY REQUIRED: Rider must verify customer's 6-digit Delivery OTP &amp; snap parcel photo on handoff.
    </div>

    <table>
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
      ${Number(order.discount_amount) > 0 ? `<div><span>Discount</span><span>- ${money(order.discount_amount)}</span></div>` : ''}
      <div><span>Delivery</span><span>${Number(order.delivery_fee) ? money(order.delivery_fee) : 'Free'}</span></div>
      <div class="grand"><span>TOTAL</span><span>${money(order.total_amount)}</span></div>
    </div>
    <div class="sign">
      <div>Rider name &amp; signature</div>
      <div>Customer signature</div>
      <div>Date / time</div>
    </div>
  </div>`;
}

const BASE_STYLES = `
  :root{font-family:system-ui,Arial,sans-serif;color:#000}
  body{margin:0;padding:16px;background:#eee}
  .toolbar{display:flex;gap:8px;justify-content:center;margin-bottom:12px}
  .toolbar button{padding:6px 14px;font-size:14px;cursor:pointer}
  .sheet{background:#fff;margin:0 auto 20px auto;padding:14mm;box-sizing:border-box;width:210mm;font-size:13px;page-break-after:always;break-after:page}
  .sheet:last-child{page-break-after:avoid;break-after:avoid;margin-bottom:0}
  body.thermal .sheet{width:80mm;padding:3mm;font-size:11px}

  .label-box{border:2.5px solid #000}
  .brand-bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:2px solid #000;background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .brand-bar h1{margin:0;font-size:20px;letter-spacing:1px;text-transform:uppercase}
  .brand-bar .tag{font-size:12px;font-weight:700;letter-spacing:.5px}
  .grid-row{display:grid;grid-template-columns:1.15fr 1fr;border-bottom:2px solid #000}
  .grid-row:last-child{border-bottom:none}
  .cell{padding:10px 12px;box-sizing:border-box}
  .cell + .cell{border-left:2px solid #000}
  body.thermal .grid-row{grid-template-columns:1fr}
  body.thermal .cell + .cell{border-left:none;border-top:2px solid #000}

  .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#444;font-weight:700;margin-bottom:3px}
  .recipient{font-size:15px;font-weight:800;margin-bottom:2px}
  .collect-box{margin-top:8px;padding:8px;border:2px solid #000;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .collect-box.cod{background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .collect-amt{font-size:22px;font-weight:900;white-space:nowrap}
  body.thermal .collect-amt{font-size:16px}

  .zone-cell{display:flex;flex-direction:column;justify-content:space-between}
  .zone-big{font-size:42px;font-weight:900;letter-spacing:2px;line-height:1;margin-top:6px}
  body.thermal .zone-big{font-size:28px}
  .barcode-wrap{text-align:center}
  .barcode{display:block;width:100%;height:56px;margin:4px 0}
  .code-txt{font-family:monospace;font-size:13px;font-weight:800;letter-spacing:.5px}

  .muted{color:#444}
  .pod-note{margin-top:10px;padding:7px 10px;border:1.5px dashed #000;font-size:11.5px;text-align:center;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:4px 6px;border-bottom:1px solid #999;text-align:left;vertical-align:top}
  .r{text-align:right} .v{font-size:.9em;color:#444}
  .totals{margin-left:auto;width:55%;margin-top:6px} .totals div{display:flex;justify-content:space-between;padding:2px 0}
  .grand{font-weight:900;font-size:1.15em;border-top:2px solid #000;margin-top:2px;padding-top:4px}
  .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px;padding-top:12px;border-top:1px dashed #666;font-size:10px;color:#444;text-align:center}
  .sign div{border-top:1px solid #000;padding-top:3px}

  @media print{
    body{background:#fff;padding:0}
    .toolbar{display:none}
    .sheet{margin:0;padding:12mm;box-shadow:none;border:none}
  }
`;

export function printWaybill(order, store = {}, delivery = null) {
  const sheetHtml = buildWaybillSheetHtml(order, store, delivery);
  const num = order.order_number || String(order.id || '').slice(0, 8);
  const trackingCode = delivery?.tracking_number || num;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Waybill ${esc(trackingCode)}</title>
<style>${BASE_STYLES}</style></head><body>
<div class="toolbar">
  <button id="pr" style="font-weight:700">🖨️ Print Waybill</button>
  <button id="a4">Standard A4</button>
  <button id="th">Thermal 80mm</button>
</div>
${sheetHtml}
<script>
  const b=document.body, st=document.createElement('style'); document.head.appendChild(st);
  function mode(m){b.className=m; st.textContent='@page{size:'+(m==='thermal'?'80mm auto':'A4')+';margin:0}'}
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

export function printBulkWaybills(ordersWithDeliveries, store = {}) {
  if (!Array.isArray(ordersWithDeliveries) || !ordersWithDeliveries.length) return;
  const sheets = ordersWithDeliveries.map(item => {
    const ord = item.order || item;
    const del = item.delivery || null;
    return buildWaybillSheetHtml(ord, store, del);
  }).join('\n');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bulk Waybills (${ordersWithDeliveries.length} orders)</title>
<style>${BASE_STYLES}</style></head><body>
<div class="toolbar">
  <button id="pr" style="font-weight:700">🖨️ Print All Waybills (${ordersWithDeliveries.length})</button>
  <button id="a4">Standard A4</button>
  <button id="th">Thermal 80mm</button>
</div>
${sheets}
<script>
  const b=document.body, st=document.createElement('style'); document.head.appendChild(st);
  function mode(m){b.className=m; st.textContent='@page{size:'+(m==='thermal'?'80mm auto':'A4')+';margin:0}'}
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
