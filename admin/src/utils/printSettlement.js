/**
 * Prints a Courier COD Shift Cash Settlement Receipt Voucher.
 * Used at end-of-day when courier riders hand over physical cash
 * collected from Pay on Delivery orders to the store supervisor.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export function printCashSettlementReceipt(settlement, store = {}) {
  const storeName = store.store_name || 'BodyCream GH';
  const storePhone = store.store_phone || '';
  const storeEmail = store.store_email || '';

  const rider = settlement.rider || {};
  const deliveries = settlement.deliveries || settlement.deliveries_today || [];
  const expected = Number(settlement.expected_ghs || 0);
  const received = Number(settlement.received_ghs || 0);
  const variance = Number(settlement.variance_ghs || 0);
  const settlementId = settlement.settlement_id || `SETTLE-${Date.now().toString().slice(-6)}`;
  const settledAt = new Date(settlement.settled_at || Date.now()).toLocaleString('en-GH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const deliveryRows = deliveries.map((d, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>#${esc(d.order_number || String(d.order_id || '').slice(0, 8))}</strong></td>
      <td>${esc(d.customer_name || 'Customer')}</td>
      <td>${esc(d.shipping_city || d.shipping_region || 'Accra')}</td>
      <td><span class="badge ${d.payment_method === 'pay_on_delivery' ? 'cod' : 'prepaid'}">${esc(d.payment_method === 'pay_on_delivery' ? 'COD' : 'Prepaid')}</span></td>
      <td class="right"><strong>${fmt(d.total_amount)}</strong></td>
      <td class="right">${d.pod_verified_at ? new Date(d.pod_verified_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }) : 'Verified'}</td>
    </tr>
  `).join('');

  const varianceLabel = variance === 0
    ? '<span class="status-balanced">✓ BALANCED (GHS 0.00)</span>'
    : variance > 0
      ? `<span class="status-surplus">+${fmt(variance)} (SURPLUS)</span>`
      : `<span class="status-short">-${fmt(Math.abs(variance))} (SHORTAGE)</span>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cash Settlement - ${esc(settlementId)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      background: #f4efe9;
      padding: 30px 15px;
    }
    .voucher-card {
      background: #fff;
      max-width: 760px;
      margin: 0 auto;
      padding: 36px 40px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #1a1a1a;
    }
    .brand-subtitle {
      font-size: 13px;
      font-weight: 700;
      color: #c9a55a;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .doc-meta {
      text-align: right;
      font-size: 12px;
      color: #555;
      line-height: 1.6;
    }
    .doc-meta strong {
      color: #1a1a1a;
      font-size: 14px;
    }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      background: #faf8f5;
      border: 1px solid #ebd9c8;
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    .detail-item {
      font-size: 12.5px;
      line-height: 1.6;
    }
    .detail-label {
      font-size: 10.5px;
      font-weight: 700;
      color: #8c7662;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 2px;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
      margin-bottom: 28px;
    }
    .sum-card {
      border: 1px solid #ebd9c8;
      border-radius: 6px;
      padding: 14px;
      background: #fff;
    }
    .sum-card.highlight {
      background: #fdfaf4;
      border-color: #c9a55a;
    }
    .sum-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #777;
    }
    .sum-val {
      font-size: 20px;
      font-weight: 800;
      color: #1a1a1a;
      margin-top: 4px;
    }
    .status-balanced { color: #16a34a; font-weight: 700; }
    .status-surplus  { color: #2563eb; font-weight: 700; }
    .status-short    { color: #dc2626; font-weight: 700; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
    }
    th {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #777;
      background: #faf8f5;
      border-bottom: 2px solid #ebd9c8;
      padding: 8px 10px;
      text-align: left;
    }
    td {
      padding: 10px;
      border-bottom: 1px solid #ebd9c8;
      font-size: 12px;
    }
    .right { text-align: right; }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge.cod { background: #fef3c7; color: #92400e; }
    .badge.prepaid { background: #e0f2fe; color: #0369a1; }

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 50px;
      margin-top: 36px;
      padding-top: 24px;
      border-top: 1px dashed #c4b5a5;
    }
    .sig-box {
      font-size: 12px;
      color: #555;
    }
    .sig-line {
      border-bottom: 1px solid #1a1a1a;
      height: 48px;
      margin-bottom: 6px;
    }

    .print-controls {
      position: sticky;
      top: 12px;
      max-width: 760px;
      margin: 0 auto 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #1a1a1a;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
    }
    .btn-print {
      background: #c9a55a;
      color: #1a1a1a;
      font-weight: 700;
      border: none;
      padding: 8px 18px;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-print:hover { background: #dfba6d; }

    @media print {
      body { background: #fff; padding: 0; }
      .print-controls { display: none !important; }
      .voucher-card { box-shadow: none; padding: 20px; }
      @page { margin: 12mm; }
    }
  </style>
</head>
<body>
  <div class="print-controls">
    <span>Settlement Voucher: <strong>${esc(settlementId)}</strong></span>
    <button class="btn-print" onclick="window.print()">🖨️ Print Settlement Voucher</button>
  </div>

  <div class="voucher-card">
    <div class="header">
      <div>
        <div class="brand-title">${esc(storeName)}</div>
        <div class="brand-subtitle">Rider COD Cash Handover Voucher</div>
      </div>
      <div class="doc-meta">
        <div>Voucher Ref: <strong>${esc(settlementId)}</strong></div>
        <div>Date: ${esc(settledAt)}</div>
      </div>
    </div>

    <div class="details-grid">
      <div class="detail-item">
        <div class="detail-label">Courier Rider</div>
        <div><strong>${esc(rider.name || 'Courier')}</strong></div>
        <div>${esc(rider.phone || '')} · ${esc(rider.vehicle_type || 'Motorbike')} ${rider.vehicle_plate ? `(${esc(rider.vehicle_plate)})` : ''}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Dispatch Supervisor / Store</div>
        <div><strong>${esc(settlement.supervisor || 'Dispatch Supervisor')}</strong></div>
        <div>${esc(storeName)} · ${esc(storePhone || '')}</div>
      </div>
    </div>

    <div class="summary-cards">
      <div class="sum-card">
        <div class="sum-label">Expected COD Cash</div>
        <div class="sum-val">${fmt(expected)}</div>
      </div>
      <div class="sum-card highlight">
        <div class="sum-label">Actual Cash Handed Over</div>
        <div class="sum-val" style="color:#c9a55a;">${fmt(received)}</div>
      </div>
      <div class="sum-card">
        <div class="sum-label">Cash Variance</div>
        <div class="sum-val" style="font-size:15px; margin-top:8px;">${varianceLabel}</div>
      </div>
    </div>

    ${settlement.notes ? `
      <div style="background:#faf8f5; border-left: 3px solid #c9a55a; padding: 10px 14px; margin-bottom: 24px; font-size: 12px;">
        <strong>Supervisor Notes:</strong> ${esc(settlement.notes)}
      </div>
    ` : ''}

    <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:#8c7662; margin-bottom:8px;">
      Delivered Stops Settled (${deliveries.length})
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Order #</th>
          <th>Customer</th>
          <th>City / Area</th>
          <th>Method</th>
          <th class="right">Amount</th>
          <th class="right">Delivered</th>
        </tr>
      </thead>
      <tbody>
        ${deliveryRows.length ? deliveryRows : '<tr><td colspan="7" style="text-align:center; padding:16px;">No orders found for this shift.</td></tr>'}
      </tbody>
    </table>

    <div class="signatures">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div><strong>Courier Rider Signature</strong></div>
        <div>${esc(rider.name || 'Rider')} · Date: _________________</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div><strong>Dispatch Supervisor Signature</strong></div>
        <div>${esc(settlement.supervisor || 'Supervisor')} · Date: _________________</div>
      </div>
    </div>
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print vouchers.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
