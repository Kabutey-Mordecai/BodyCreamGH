/**
 * Opens a new window containing a formatted invoice and triggers the browser
 * print dialog. The window is fully self-contained so it can be printed
 * or saved as a PDF to slip into the package.
 */

const BASE_INVOICE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #1c1410;
    background: #f3efe9;
    padding: 30px 10px;
  }

  .invoice-sheet {
    background: #fff;
    padding: 40px;
    max-width: 720px;
    margin: 0 auto 30px;
    box-shadow: 0 4px 18px rgba(0,0,0,0.06);
    border-radius: 6px;
    page-break-after: always;
    break-after: page;
  }
  .invoice-sheet:last-child {
    margin-bottom: 0;
    page-break-after: auto;
    break-after: auto;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 24px;
    border-bottom: 3px solid #c9a55a;
    margin-bottom: 28px;
  }
  .brand-name {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #1c1410;
  }
  .brand-meta {
    font-size: 11.5px;
    color: #7a6e68;
    line-height: 1.7;
    margin-top: 4px;
  }
  .invoice-meta {
    text-align: right;
  }
  .invoice-label {
    font-size: 22px;
    font-weight: 700;
    color: #c9a55a;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .invoice-meta table {
    margin-top: 6px;
    font-size: 11.5px;
    color: #7a6e68;
    margin-left: auto;
  }
  .invoice-meta td:first-child {
    padding-right: 14px;
    color: #1c1410;
    font-weight: 600;
  }
  .invoice-meta td:last-child {
    text-align: right;
  }

  /* ── Bill-to / Ship-to ── */
  .parties {
    display: flex;
    gap: 40px;
    margin-bottom: 28px;
  }
  .party {
    flex: 1;
  }
  .party-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #c9a55a;
    margin-bottom: 6px;
  }
  .party p {
    font-size: 12.5px;
    line-height: 1.7;
    color: #1c1410;
  }
  .party .muted { color: #7a6e68; font-size: 11.5px; }

  /* ── Items table ── */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
  }
  table.items th {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #7a6e68;
    background: #faf7f4;
    padding: 9px 12px;
    border-bottom: 1px solid #ede5db;
  }
  table.items td {
    padding: 10px 12px;
    border-bottom: 1px solid #ede5db;
    font-size: 12.5px;
    vertical-align: top;
  }
  table.items tr:last-child td { border-bottom: none; }
  table.items .center { text-align: center; }
  table.items .right  { text-align: right; }

  /* ── Totals ── */
  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 0;
    border-top: 1px solid #ede5db;
  }
  .totals {
    width: 280px;
    padding: 14px 12px 0;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 12.5px;
    color: #7a6e68;
  }
  .totals-row.total {
    font-size: 14px;
    font-weight: 700;
    color: #1c1410;
    border-top: 2px solid #1c1410;
    padding-top: 10px;
    margin-top: 6px;
  }
  .totals-row .label { color: #1c1410; font-weight: 500; }

  /* ── Payment badge ── */
  .payment-status {
    display: inline-block;
    margin-top: 14px;
    padding: 5px 14px;
    border-radius: 40px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .paid   { background: #e6f9ec; color: #1a7a3e; }
  .unpaid { background: #fff3cd; color: #856404; }

  /* ── Notes ── */
  .notes-section {
    margin-top: 24px;
    padding: 14px 16px;
    background: #faf7f4;
    border-radius: 6px;
    font-size: 12px;
    color: #7a6e68;
    line-height: 1.6;
  }
  .notes-label { font-weight: 700; color: #1c1410; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }

  /* ── Footer ── */
  .footer {
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid #ede5db;
    text-align: center;
    font-size: 11px;
    color: #7a6e68;
    line-height: 1.8;
  }

  .print-bar {
    position: sticky;
    top: 10px;
    z-index: 999;
    background: #1c1410;
    color: #fff;
    padding: 10px 16px;
    border-radius: 8px;
    max-width: 720px;
    margin: 0 auto 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  }
  .print-btn {
    background: #c9a55a;
    color: #1c1410;
    border: none;
    font-weight: 700;
    padding: 8px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  .print-btn:hover { background: #dfba6d; }

  /* ── Print tweaks ── */
  @media print {
    body { background: #fff; padding: 0; }
    .print-bar { display: none !important; }
    .invoice-sheet {
      box-shadow: none;
      border-radius: 0;
      padding: 24px 20px;
      margin: 0;
      max-width: 100%;
    }
    @page { margin: 12mm; }
  }
`;

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export function buildInvoiceSheetHtml(rawOrder, store = {}) {
  const order = rawOrder?.order ? { ...rawOrder.order, items: rawOrder.items } : rawOrder;

  const storeName    = store.store_name    || 'BodyCream GH';
  const storeEmail   = store.store_email   || '';
  const storePhone   = store.store_phone   || '';
  const storeAddress = store.store_address || '';
  const whatsapp     = store.whatsapp_number || '';

  const orderNum  = order.order_number || (order.id || '').slice(0, 8).toUpperCase();
  const orderDate = new Date(order.created_at).toLocaleDateString('en-GH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const email = order.email || '';
  const customerName = [order.first_name, order.last_name].filter(Boolean).join(' ')
    || order.customer_name
    || (email ? email.split('@')[0] : 'Customer');

  const items = order.items || [];
  const subtotal = items.reduce(
    (s, it) => s + Number(it.subtotal || (it.price_at_purchase * it.quantity) || 0), 0
  );
  const deliveryFee  = Number(order.delivery_fee  || 0);
  const discountAmount = Number(order.discount_amount || 0);
  const total        = Number(order.total_amount || (subtotal - discountAmount + deliveryFee));
  const isPaid       = ['paid', 'completed'].includes(order.payment_status);

  const itemRows = items.map(it => `
    <tr>
      <td>
        <div style="font-weight: 600;">${it.product_name || it.name || '—'}</div>
        ${it.variant_label ? `<div style="font-size: 11px; color: #7a6e68; margin-top: 2px;">${it.variant_label}</div>` : ''}
      </td>
      <td class="center">${it.quantity}</td>
      <td class="right">${fmt(it.price_at_purchase || it.price)}</td>
      <td class="right">${fmt(it.subtotal || (it.price_at_purchase * it.quantity))}</td>
    </tr>
  `).join('');

  return `
  <div class="invoice-sheet">
    <!-- Header: store brand + invoice meta -->
    <div class="header">
      <div>
        <div class="brand-name">${storeName}</div>
        <div class="brand-meta">
          ${storeAddress ? storeAddress + '<br/>' : ''}
          ${storeEmail   ? storeEmail   + '<br/>' : ''}
          ${storePhone   ? storePhone   + '<br/>' : ''}
          ${whatsapp     ? 'WhatsApp: ' + whatsapp : ''}
        </div>
      </div>
      <div class="invoice-meta">
        <div class="invoice-label">Invoice</div>
        <table>
          <tr><td>Invoice No.</td><td><strong>${orderNum}</strong></td></tr>
          <tr><td>Date</td><td>${orderDate}</td></tr>
          <tr><td>Payment</td><td>${order.payment_status || 'unpaid'}</td></tr>
        </table>
      </div>
    </div>

    <!-- Bill-to + Ship-to -->
    <div class="parties">
      <div class="party">
        <div class="party-label">Bill To</div>
        <p>
          <strong>${customerName}</strong><br/>
          ${email ? `<span class="muted">${email}</span><br/>` : ''}
          ${(order.customer_phone || order.phone) ? `<span class="muted">${order.customer_phone || order.phone}</span>` : ''}
        </p>
      </div>
      <div class="party">
        <div class="party-label">${order.fulfillment_method === 'pickup' ? 'Pickup Station' : 'Deliver To'}</div>
        <p>
          ${order.fulfillment_method === 'pickup'
            ? `<strong>East Legon Station</strong><br/>Accra, Ghana<br/><span class="muted">Call upon arrival · Station Pickup</span>`
            : `
              ${order.shipping_address || ''}
              ${(order.shipping_city || order.shipping_region)
                ? `<br/>${[order.shipping_city, order.shipping_region].filter(Boolean).join(', ')}`
                : ''}
              ${!order.shipping_address && !order.shipping_city ? '—' : ''}
            `
          }
        </p>
      </div>
    </div>

    <!-- Items table -->
    <table class="items">
      <thead>
        <tr>
          <th style="text-align:left">Item</th>
          <th class="center">Qty</th>
          <th class="right">Unit price</th>
          <th class="right">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <!-- Totals -->
    <div class="totals-wrap">
      <div class="totals">
        <div class="totals-row">
          <span class="label">Subtotal</span>
          <span>${fmt(subtotal)}</span>
        </div>
        ${discountAmount > 0 ? `
        <div class="totals-row" style="color: #10b981;">
          <span class="label" style="color: #10b981;">Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}</span>
          <span>-${fmt(discountAmount)}</span>
        </div>` : ''}
        <div class="totals-row">
          <span class="label">Delivery fee</span>
          <span>${deliveryFee === 0 ? 'Free' : fmt(deliveryFee)}</span>
        </div>
        <div class="totals-row total">
          <span>Total</span>
          <span>${fmt(total)}</span>
        </div>
        <div>
          <span class="payment-status ${isPaid ? 'paid' : 'unpaid'}">
            ${isPaid ? 'Paid' : 'Payment Pending'}
          </span>
        </div>
      </div>
    </div>

    ${order.notes ? `
    <div class="notes-section">
      <div class="notes-label">Notes</div>
      ${order.notes}
    </div>` : ''}

    <!-- Footer -->
    <div class="footer">
      Thank you for your order!<br/>
      ${storeName} · ${storeEmail || ''}${storeEmail && storePhone ? ' · ' : ''}${storePhone || ''}
    </div>
  </div>`;
}

export function printInvoice(rawOrder, store = {}) {
  const order = rawOrder?.order ? { ...rawOrder.order, items: rawOrder.items } : rawOrder;
  const orderNum = order.order_number || (order.id || '').slice(0, 8).toUpperCase();
  const sheetHtml = buildInvoiceSheetHtml(order, store);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${orderNum}</title>
  <style>${BASE_INVOICE_CSS}</style>
</head>
<body>
  <div class="print-bar">
    <span>Invoice #${orderNum}</span>
    <button class="print-btn" onclick="window.print()">🖨️ Print Invoice</button>
  </div>
  ${sheetHtml}
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=780,height=900');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print invoices.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

export function printBulkInvoices(ordersList, store = {}) {
  if (!Array.isArray(ordersList) || !ordersList.length) return;
  const sheets = ordersList.map(ord => buildInvoiceSheetHtml(ord, store)).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoices (${ordersList.length} orders)</title>
  <style>${BASE_INVOICE_CSS}</style>
</head>
<body>
  <div class="print-bar">
    <span>${ordersList.length} Invoices Ready</span>
    <button class="print-btn" onclick="window.print()">🖨️ Print All Invoices (${ordersList.length})</button>
  </div>
  ${sheets}
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print invoices.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
