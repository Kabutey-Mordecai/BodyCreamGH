'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', 'src');

// Ensure config/paystack.js doesn't fail on missing key before we mock it
process.env.PAYSTACK_SECRET_KEY = 'sk_test_mock_secret_key_for_unit_tests';

// ── In-memory stateful store & mocks ──────────────────────────────────────────
const dbState = {
  orders: new Map(),
  payments: new Map(), // key: paystack_reference
  statusLogs: [],
  processedEvents: new Set(),
  customers: new Map(), // key: user_id
  products: new Map(), // key: product_id
  coupons: new Map(), // key: id
  cartItems: [],
  orderItems: [],
};

const queuedJobs = [];
const paystackCalls = [];
const sentEmails = [];
let lastPendingRefundSql = null;
let lastExportQuery = null;
let txSnapshot = null;
let mockReuseColumns = true;
let onBeforeMockQuery = null;
const mockPaystackHandlers = {
  post: async () => { throw new Error('Unmocked paystack POST'); },
  get:  async () => { throw new Error('Unmocked paystack GET'); },
};

function cloneMap(m) {
  return new Map([...m.entries()].map(([k, v]) => [k, { ...v }]));
}

function resetAll() {
  dbState.orders.clear();
  dbState.payments.clear();
  dbState.statusLogs.length = 0;
  dbState.processedEvents.clear();
  dbState.customers.clear();
  dbState.products.clear();
  dbState.coupons.clear();
  dbState.cartItems.length = 0;
  dbState.orderItems.length = 0;
  queuedJobs.length = 0;
  paystackCalls.length = 0;
  sentEmails.length = 0;
  loggedEvents.length = 0;
  lastPendingRefundSql = null;
  lastExportQuery = null;
  txSnapshot = null;
  onBeforeMockQuery = null;
  mockReuseColumns = true;
  _resetReuseColumnCache();
}

function makeOrder(overrides = {}) {
  const id = overrides.id || crypto.randomUUID();
  const order = {
    id,
    order_number: overrides.order_number || `BC-${id.slice(0, 6).toUpperCase()}`,
    customer_id: overrides.customer_id !== undefined ? overrides.customer_id : null,
    guest_email: overrides.guest_email || null,
    guest_first_name: overrides.guest_first_name || null,
    guest_last_name: overrides.guest_last_name || null,
    guest_phone: overrides.guest_phone || null,
    first_name: null,
    last_name: null,
    customer_phone: null,
    email: overrides.email || overrides.guest_email || 'buyer@example.com',
    is_guest: (overrides.customer_id ?? null) === null,
    status: 'pending',
    payment_status: 'unpaid',
    payment_method: 'paystack',
    payment_reference: null,
    total_amount: '100.00',
    refund_status: 'not_requested',
    refund_method: null,
    refund_amount: null,
    refund_provider_id: null,
    refund_reference: null,
    refund_notes: null,
    refund_requested_at: null,
    refunded_at: null,
    ...overrides,
  };
  dbState.orders.set(id, order);
  return order;
}

function makePayment(orderId, reference, overrides = {}) {
  const row = {
    id: crypto.randomUUID(),
    order_id: orderId,
    amount: '100.00',
    status: 'pending',
    payment_method: 'paystack',
    paystack_reference: reference,
    customer_email: 'buyer@example.com',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  dbState.payments.set(reference, row);
  return row;
}

function runMockQuery(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  if (onBeforeMockQuery) onBeforeMockQuery(q, params);

  if (q === 'BEGIN') {
    txSnapshot = {
      products: cloneMap(dbState.products),
      coupons: cloneMap(dbState.coupons),
      cartItems: dbState.cartItems.map(i => ({ ...i })),
      orderItems: dbState.orderItems.map(i => ({ ...i })),
    };
    return { rows: [], rowCount: 0 };
  }
  if (q === 'COMMIT') {
    txSnapshot = null;
    return { rows: [], rowCount: 0 };
  }
  if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/i.test(q)) {
    return { rows: [], rowCount: 0 };
  }
  if (q === 'ROLLBACK') {
    if (txSnapshot) {
      dbState.products = txSnapshot.products;
      dbState.coupons = txSnapshot.coupons;
      dbState.cartItems = txSnapshot.cartItems;
      dbState.orderItems = txSnapshot.orderItems;
      txSnapshot = null;
    }
    return { rows: [], rowCount: 0 };
  }

  // coupon queries (CouponModel.validateAndLock)
  if (q.startsWith('SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)')) {
    const code = String(params[0] || '').toUpperCase();
    const match = [...dbState.coupons.values()].find(c => String(c.code).toUpperCase() === code);
    return match ? { rows: [{ ...match }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (q.startsWith('UPDATE coupons SET uses_count = uses_count + 1')) {
    const c = dbState.coupons.get(params[0]);
    if (!c) return { rows: [], rowCount: 0 };
    c.uses_count += 1;
    return { rows: [{ ...c }], rowCount: 1 };
  }

  // exportOrders query
  if (q.includes('SELECT o.order_number, o.total_amount, o.status, o.payment_status, o.fulfillment_method, o.created_at')) {
    lastExportQuery = { sql: q, params };
    let rows = [...dbState.orders.values()];
    const payMatch = q.match(/o\.payment_status = \$(\d+)/);
    if (payMatch) {
      const targetPayStatus = params[Number(payMatch[1]) - 1];
      rows = rows.filter(o => o.payment_status === targetPayStatus);
    }
    const stMatch = q.match(/o\.status = \$(\d+)/);
    if (stMatch) {
      const targetStatus = params[Number(stMatch[1]) - 1];
      rows = rows.filter(o => o.status === targetStatus);
    }
    return {
      rows: rows.map(o => ({
        order_number: o.order_number,
        total_amount: o.total_amount,
        status: o.status,
        payment_status: o.payment_status,
        fulfillment_method: o.fulfillment_method || 'delivery',
        created_at: o.created_at || new Date(),
        customer_name: o.guest_first_name || 'Guest',
        customer_email: o.guest_email || o.email || '',
        customer_phone: o.guest_phone || '',
        is_guest: o.customer_id == null,
      })),
      rowCount: rows.length,
    };
  }

  // site_settings lookups
  if (q.startsWith('SELECT key, value FROM site_settings WHERE key = ANY')) {
    const defaults = {
      delivery_fee_flat: '15',
      delivery_fee_accra: '10',
      free_delivery_over: '200',
      pickup_enabled: 'true',
      pickup_location: 'East Legon, Accra',
      pay_on_delivery_enabled: 'false',
      pay_on_delivery_accra_only: 'true',
      guest_checkout_enabled: 'true',
    };
    const keys = params[0] || [];
    const rows = keys.filter(k => defaults[k] !== undefined).map(k => ({ key: k, value: defaults[k] }));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith("SELECT value FROM site_settings WHERE key = 'order_notification_email'")) {
    return { rows: [{ value: 'admin@bodycreamgh.test' }], rowCount: 1 };
  }

  // cart & product queries for createOrder / createGuestOrder
  if (q.includes('FROM cart_items ci JOIN products p')) {
    const rows = dbState.cartItems
      .filter(ci => ci.customer_id === params[0])
      .map(ci => {
        const p = dbState.products.get(ci.product_id);
        if (!p) return null;
        return {
          quantity: ci.quantity,
          variant_id: ci.variant_id || null,
          variant_label: ci.variant_label || null,
          product_id: p.id,
          price: p.price,
          stock_quantity: p.stock_quantity,
        };
      })
      .filter(Boolean);
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith('SELECT id, price, stock_quantity FROM products WHERE id = ANY')) {
    const ids = new Set(params[0] || []);
    const rows = [...dbState.products.values()]
      .filter(p => ids.has(p.id))
      .map(p => ({ id: p.id, price: p.price, stock_quantity: p.stock_quantity }));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith('UPDATE products SET stock_quantity = stock_quantity + $1')) {
    const p = dbState.products.get(params[1]);
    const nextQty = p ? Number(p.stock_quantity) + Number(params[0]) : -1;
    if (!p || nextQty < 0) return { rows: [], rowCount: 0 };
    p.stock_quantity = nextQty;
    return { rows: [], rowCount: 1 };
  }
  if (q.startsWith('INSERT INTO inventory_history')) {
    return { rows: [], rowCount: 1 };
  }
  if (q.startsWith('DELETE FROM cart_items WHERE customer_id=$1')) {
    for (let i = dbState.cartItems.length - 1; i >= 0; i--) {
      if (dbState.cartItems[i].customer_id === params[0]) dbState.cartItems.splice(i, 1);
    }
    return { rows: [], rowCount: 1 };
  }
  if (q.startsWith('INSERT INTO order_items')) {
    dbState.orderItems.push({ id: params[0], order_id: params[1], product_id: params[2], quantity: params[3] });
    return { rows: [], rowCount: 1 };
  }
  if (q.startsWith('INSERT INTO orders')) {
    const isGuestInsert = q.includes('guest_email');
    const payStatusMatch = q.match(/'([a-z_]+)'\)$/);
    const insertedPaymentStatus = payStatusMatch ? payStatusMatch[1] : 'unpaid';
    if (isGuestInsert) {
      makeOrder({
        id: params[0],
        customer_id: null,
        order_number: params[1],
        total_amount: String(params[2]),
        guest_email: params[10],
        guest_first_name: params[11],
        guest_last_name: params[12],
        guest_phone: params[13],
        fulfillment_method: params[14],
        payment_method: params[15],
        status: params[16],
        payment_status: insertedPaymentStatus,
      });
    } else {
      makeOrder({
        id: params[0],
        customer_id: params[1],
        order_number: params[2],
        total_amount: String(params[3]),
        fulfillment_method: params[11],
        payment_method: params[12],
        status: params[13],
        payment_status: insertedPaymentStatus,
      });
    }
    return { rows: [], rowCount: 1 };
  }

  // notification.worker.js refund email lookup
  if (q.includes('COALESCE(o.refund_amount, o.total_amount) AS refund_total')) {
    const o = dbState.orders.get(params[0]);
    if (!o) return { rows: [], rowCount: 0 };
    return {
      rows: [{
        order_number: o.order_number,
        refund_total: o.refund_amount !== null && o.refund_amount !== undefined ? o.refund_amount : o.total_amount,
        email: o.guest_email || o.email || 'buyer@example.com',
        first_name: o.first_name || o.guest_first_name || 'Customer',
      }],
      rowCount: 1,
    };
  }

  // processed_events (idempotency & claimEvent)
  if (q.startsWith('SELECT 1 FROM processed_events')) {
    return dbState.processedEvents.has(params[0]) ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (q.startsWith('INSERT INTO processed_events')) {
    if (dbState.processedEvents.has(params[0])) return { rows: [], rowCount: 0 };
    dbState.processedEvents.add(params[0]);
    return { rows: [], rowCount: 1 };
  }

  // order_status_log
  if (q.startsWith('INSERT INTO order_status_log')) {
    dbState.statusLogs.push({
      id: params[0],
      order_id: params[1],
      from_status: params[2],
      to_status: q.includes('$3, $3') ? params[2] : params[3],
      note: params.length === 4 ? params[3] : params[4],
    });
    return { rows: [], rowCount: 1 };
  }

  // payments columns added by migration 033 (reuse of open transactions)
  if (q.includes('FROM information_schema.columns') && q.includes("table_name = 'payments'")) {
    const rows = mockReuseColumns
      ? (params[0] || []).map(column_name => ({ column_name }))
      : [];
    return { rows, rowCount: rows.length };
  }

  // newest recent pending payment with a stored authorization_url for an order
  if (q.includes('FROM payments WHERE order_id = $1') && q.includes('authorization_url IS NOT NULL')) {
    const cutoff = Date.now() - Number(params[1]) * 60 * 1000;
    const rows = [...dbState.payments.values()]
      .filter(p =>
        p.order_id === params[0] &&
        p.payment_method === 'paystack' &&
        p.status === 'pending' &&
        p.authorization_url &&
        new Date(p.created_at).getTime() > cutoff
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(p => ({
        paystack_reference: p.paystack_reference,
        authorization_url: p.authorization_url,
        access_code: p.access_code,
        amount: p.amount,
        currency: p.currency || 'GHS',
      }));
    return { rows, rowCount: rows.length };
  }

  // INSERT INTO payments (legacy: 5 params; with reuse columns: 7 params)
  if (q.startsWith('INSERT INTO payments')) {
    const ref = params[3];
    if (!dbState.payments.has(ref)) {
      const row = {
        id: params[0],
        order_id: params[1],
        amount: params[2],
        status: 'pending',
        paystack_reference: ref,
        customer_email: params[4],
        payment_method: 'paystack',
        created_at: new Date(),
        updated_at: new Date(),
      };
      if (params.length > 5) {
        row.authorization_url = params[5];
        row.access_code = params[6];
        row.currency = 'GHS';
      }
      dbState.payments.set(ref, row);
    }
    return { rows: [], rowCount: 1 };
  }

  // payments status lookup by paystack_reference
  if (q.startsWith('SELECT status FROM payments WHERE paystack_reference = $1')) {
    const p = dbState.payments.get(params[0]);
    return p ? { rows: [{ status: p.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // payments lookup by paystack_reference
  if (q.startsWith('SELECT order_id') && q.includes('FROM payments WHERE paystack_reference = $1')) {
    const p = dbState.payments.get(params[0]);
    return p ? { rows: [{ order_id: p.order_id, status: p.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // reconciliation.worker.js payments JOIN orders lookup
  if (q.includes('FROM payments p JOIN orders o ON p.order_id = o.id WHERE p.paystack_reference = $1')) {
    const p = dbState.payments.get(params[0]);
    if (!p) return { rows: [], rowCount: 0 };
    const o = dbState.orders.get(p.order_id);
    if (!o) return { rows: [], rowCount: 0 };
    return { rows: [{ ...o, payment_row_status: p.status }], rowCount: 1 };
  }

  // refund.reconciliation.worker.js correlated scalar subquery pending refunds
  if (q.includes('AS transaction_reference FROM orders o WHERE o.refund_status IN')) {
    lastPendingRefundSql = q;
    const rank = { success: 1, needs_review: 2 };
    const rows = [...dbState.orders.values()]
      .filter(o => ['pending', 'needs_attention'].includes(o.refund_status) && o.refund_method === 'paystack')
      .map(o => {
        const candidates = [...dbState.payments.values()].filter(
          p => p.order_id === o.id && p.payment_method === 'paystack' && ['success', 'needs_review'].includes(p.status)
        );
        candidates.sort((a, b) => {
          const r = (rank[a.status] || 3) - (rank[b.status] || 3);
          if (r !== 0) return r;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
        return {
          id: o.id,
          status: o.status,
          refund_status: o.refund_status,
          refund_provider_id: o.refund_provider_id,
          refund_notes: o.refund_notes,
          transaction_reference: candidates[0] ? candidates[0].paystack_reference : null,
        };
      });
    return { rows, rowCount: rows.length };
  }

  // winning payment lookup
  if (q.startsWith('SELECT paystack_reference FROM payments WHERE order_id = $1 AND status = \'success\'')) {
    const found = [...dbState.payments.values()].find(p => p.order_id === params[0] && p.status === 'success');
    return found ? { rows: [found], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // findPaystackTransaction in order.controller
  if (q.includes('SELECT p.paystack_reference AS reference, p.amount FROM payments p')) {
    const list = [...dbState.payments.values()].filter(
      p => p.order_id === params[0] && p.payment_method === 'paystack'
    );
    const rank = { success: 1, needs_review: 2 };
    list.sort((a, b) => (rank[a.status] || 3) - (rank[b.status] || 3));
    return list[0] ? { rows: [{ reference: list[0].paystack_reference, amount: list[0].amount }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // payments updates
  if (q.startsWith('UPDATE payments SET status = \'refunded\'') && q.includes('WHERE order_id = $1')) {
    let rc = 0;
    for (const p of dbState.payments.values()) {
      if (p.order_id === params[0] && ['success', 'needs_review'].includes(p.status)) {
        p.status = 'refunded';
        rc++;
      }
    }
    return { rows: [], rowCount: rc };
  }
  if (q.startsWith('UPDATE payments SET status')) {
    const ref = params[0];
    const p = dbState.payments.get(ref);
    if (!p) return { rows: [], rowCount: 0 };
    if (/AND status\s*=\s*'pending'/.test(q) && p.status !== 'pending') return { rows: [], rowCount: 0 };
    if (/AND status\s*!=\s*'duplicate'/.test(q) && p.status === 'duplicate') return { rows: [], rowCount: 0 };
    if (q.includes("status='failed'") || q.includes("status = 'failed'")) p.status = 'failed';
    else if (q.includes("status = 'needs_review'")) p.status = 'needs_review';
    else if (q.includes("status = 'duplicate'")) p.status = 'duplicate';
    else if (q.includes("status = 'success'")) p.status = 'success';
    if (params.length >= 2 && params[1] !== undefined) p.amount = String(params[1]);
    p.updated_at = new Date();
    return { rows: [p], rowCount: 1 };
  }

  // customers total_spent update (faithfully enforce SQL NULL semantics unless COALESCE is used)
  if (q.startsWith('UPDATE customers SET total_spent')) {
    const cust = dbState.customers.get(params[1]);
    if (cust) {
      if (q.includes('COALESCE(total_spent, 0)')) {
        cust.total_spent = (cust.total_spent == null ? 0 : Number(cust.total_spent)) + Number(params[0]);
      } else {
        cust.total_spent = cust.total_spent == null ? null : Number(cust.total_spent) + Number(params[0]);
      }
      if (q.includes('COALESCE(total_orders, 0)')) {
        cust.total_orders = (cust.total_orders == null ? 0 : Number(cust.total_orders)) + 1;
      } else {
        cust.total_orders = cust.total_orders == null ? null : Number(cust.total_orders) + 1;
      }
      return { rows: [cust], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // findRefundOrderForUpdate
  if (q.includes('o.refund_provider_id = $1') && q.includes('o.refund_reference = $2')) {
    const [provId, refundRef, txRef] = params;
    const all = [...dbState.orders.values()];
    const match = all.find(o => provId && String(o.refund_provider_id) === String(provId))
      || all.find(o => refundRef && o.refund_reference === refundRef)
      || all.find(o => txRef && (o.payment_reference === txRef || [...dbState.payments.values()].some(p => p.order_id === o.id && p.paystack_reference === txRef)));
    return match ? { rows: [{ ...match }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // dispute order lookup
  if (q.includes('WHERE o.payment_reference = $1 OR EXISTS')) {
    const txRef = params[0];
    const match = [...dbState.orders.values()].find(
      o => o.payment_reference === txRef || [...dbState.payments.values()].some(p => p.order_id === o.id && p.paystack_reference === txRef)
    );
    return match ? { rows: [{ ...match }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // Single order SELECT
  if (q.startsWith('SELECT') && q.includes('FROM orders') && q.includes('WHERE id = $1')) {
    const o = dbState.orders.get(params[0]);
    return o ? { rows: [{ ...o }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // Order UPDATEs
  if (q.startsWith('UPDATE orders SET')) {
    const whereIdMatch = q.match(/WHERE id = \$(\d+)/);
    const id = whereIdMatch ? params[Number(whereIdMatch[1]) - 1] : params[params.length - 1];
    const o = dbState.orders.get(id);
    if (!o) return { rows: [], rowCount: 0 };
    if (q.includes("AND refund_status = 'pending'") && o.refund_status !== 'pending') {
      return { rows: [], rowCount: 0 };
    }

    if (q.includes("payment_status = 'payment_review'") && !q.includes('CASE WHEN')) {
      o.payment_status = 'payment_review';
    }
    if (q.includes("CASE WHEN payment_status = 'refunded'")) {
      if (o.payment_status !== 'refunded') o.payment_status = 'payment_review';
    }
    if (q.includes("payment_status = 'paid'")) {
      o.payment_status = 'paid';
      if (!o.payment_reference && params[1]) o.payment_reference = params[1];
    }
    if (q.includes("status = 'confirmed'")) o.status = 'confirmed';
    if (q.includes("refund_status = 'needs_attention'")) {
      o.refund_status = 'needs_attention';
      if (q.includes("refund_method = 'paystack'")) {
        o.refund_method = 'paystack';
        o.refund_amount = params[0];
        o.refund_provider_id = params[1];
        o.refund_reference = params[2];
        o.refund_notes = params[3];
      } else {
        if (q.includes('refund_method = COALESCE')) {
          o.refund_method = o.refund_method || 'paystack';
        }
        o.refund_provider_id = o.refund_provider_id || params[0];
        o.refund_reference = o.refund_reference || params[1];
        o.refund_notes = params[2];
      }
    } else if (q.includes("refund_status = 'success'")) {
      o.refund_status = 'success';
      o.status = 'refunded';
      o.payment_status = 'refunded';
      if (q.includes("refund_method = 'manual'")) {
        o.refund_method = 'manual';
        o.refund_amount = params[0];
        o.refund_reference = params[1];
        o.refund_notes = params[2];
      } else if (q.includes("refund_method = 'paystack'")) {
        o.refund_method = 'paystack';
        o.refund_amount = params[0];
        o.refund_provider_id = params[1];
        o.refund_reference = params[2];
        o.refund_notes = params[3];
      } else {
        o.refund_provider_id = o.refund_provider_id || params[0];
        o.refund_reference = o.refund_reference || params[1];
      }
    } else if (q.includes("refund_status = 'failed'")) {
      o.refund_status = 'failed';
      if (q.includes("refund_method = 'paystack'")) {
        o.refund_method = 'paystack';
        o.refund_amount = params[0];
        o.refund_notes = params[1];
      } else {
        o.refund_provider_id = o.refund_provider_id || params[0];
        o.refund_reference = o.refund_reference || params[1];
        o.refund_notes = params[2];
      }
    } else if (q.includes("refund_status = 'pending'")) {
      o.refund_status = 'pending';
      o.refund_method = 'paystack';
      o.refund_amount = params[0];
      if (q.includes('refund_provider_id = $2')) {
        o.refund_provider_id = params[1];
        o.refund_reference = params[2];
        o.refund_notes = params[3];
      } else {
        o.refund_notes = params[1];
      }
    } else if (q.startsWith('UPDATE orders SET refund_requested_at = COALESCE') || q.startsWith('UPDATE orders SET refund_notes = $1')) {
      o.refund_requested_at = o.refund_requested_at || new Date();
      o.refund_notes = params[0];
    } else if (q.includes('refund_provider_id = COALESCE')) {
      o.refund_provider_id = o.refund_provider_id || params[0];
      o.refund_reference = o.refund_reference || params[1];
      o.refund_notes = params[2];
    }

    o.updated_at = new Date();
    return { rows: [{ ...o }], rowCount: 1 };
  }

  if (q.includes("FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status = 'refund_pending'")) {
    const rows = [...dbState.payments.values()]
      .filter(p => p.status === 'refund_pending' && p.payment_method === 'paystack' && p.paystack_reference)
      .map(p => ({ ...p, order_status: dbState.orders.get(p.order_id)?.status || 'confirmed' }));
    return { rows, rowCount: rows.length };
  }

  if (q.includes('FROM return_requests') || q.includes("WHERE p.paystack_reference = $1 AND p.status = 'refund_pending'")) {
    return { rows: [], rowCount: 0 };
  }

  throw new Error(`Unhandled mock SQL query: ${q}`);
}

// Per-key async mutex emulating pg_advisory_xact_lock: a client holds the lock
// until it COMMITs, ROLLBACKs or is released, and other clients wait their turn.
const advisoryLocks = new Map();
async function acquireAdvisoryLock(key) {
  const prev = advisoryLocks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise(resolve => { release = resolve; });
  advisoryLocks.set(key, prev.then(() => mine));
  await prev;
  return release;
}

let activePoolClients = 0;

const mockPool = {
  query: async (sql, params) => runMockQuery(sql, params),
  connect: async () => {
    activePoolClients += 1;
    let released = false;
    const heldReleases = [];
    const releaseAll = () => { while (heldReleases.length) heldReleases.pop()(); };
    return {
      query: async (sql, params) => {
        const q = String(sql).replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT pg_advisory_xact_lock')) {
          heldReleases.push(await acquireAdvisoryLock(String(params[0])));
          return { rows: [], rowCount: 1 };
        }
        const result = runMockQuery(sql, params);
        if (q === 'COMMIT' || q === 'ROLLBACK') releaseAll();
        return result;
      },
      release: () => {
        if (!released) {
          released = true;
          activePoolClients -= 1;
        }
        releaseAll();
      },
    };
  },
};

// Install mocks into require.cache BEFORE loading controllers/workers
require.cache[path.join(SRC, 'config', 'database.js')] = {
  id: path.join(SRC, 'config', 'database.js'),
  filename: path.join(SRC, 'config', 'database.js'),
  loaded: true,
  exports: mockPool,
};

require.cache[path.join(SRC, 'config', 'paystack.js')] = {
  id: path.join(SRC, 'config', 'paystack.js'),
  filename: path.join(SRC, 'config', 'paystack.js'),
  loaded: true,
  exports: {
    post: async (url, payload) => {
      paystackCalls.push({ method: 'POST', url, payload });
      return mockPaystackHandlers.post(url, payload);
    },
    get: async (url, cfg) => {
      paystackCalls.push({ method: 'GET', url, cfg });
      return mockPaystackHandlers.get(url, cfg);
    },
  },
};

const makeQueueProxy = (prefix) => ({
  add: async (name, data, opts) => {
    queuedJobs.push({ queue: `${prefix}/${name}`, data, opts });
  },
});

require.cache[path.join(SRC, 'queues', 'index.js')] = {
  id: path.join(SRC, 'queues', 'index.js'),
  filename: path.join(SRC, 'queues', 'index.js'),
  loaded: true,
  exports: {
    paymentQueue: makeQueueProxy('payment'),
    shipmentQueue: makeQueueProxy('shipment'),
    notificationQueue: makeQueueProxy('notification'),
    reconcileQueue: makeQueueProxy('reconcile'),
    newsletterQueue: makeQueueProxy('newsletter'),
  },
};

require.cache[path.join(SRC, 'models', 'order.model.js')] = {
  id: path.join(SRC, 'models', 'order.model.js'),
  filename: path.join(SRC, 'models', 'order.model.js'),
  loaded: true,
  exports: {
    findById: async (id, customerId = null) => {
      const o = dbState.orders.get(id);
      if (!o) return null;
      if (customerId && String(o.customer_id) !== String(customerId)) return null;
      return { ...o };
    },
  },
};

const loggedEvents = [];
const loggerPath = path.join(SRC, 'utils', 'logger.js');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    info:  (msg, meta) => loggedEvents.push({ level: 'info', msg, meta }),
    warn:  (msg, meta) => loggedEvents.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => loggedEvents.push({ level: 'error', msg, meta }),
    debug: (msg, meta) => loggedEvents.push({ level: 'debug', msg, meta }),
  },
};

const emailPath = path.join(SRC, 'services', 'email.service.js');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendOrderConfirmation: async (to, data) => sentEmails.push({ fn: 'sendOrderConfirmation', to, data }),
    sendAdminNewOrder: async (to, data) => sentEmails.push({ fn: 'sendAdminNewOrder', to, data }),
    sendShippingNotification: async (to, data) => sentEmails.push({ fn: 'sendShippingNotification', to, data }),
    sendAdminOrderShipped: async (to, data) => sentEmails.push({ fn: 'sendAdminOrderShipped', to, data }),
    sendReviewRequest: async (to, data) => sentEmails.push({ fn: 'sendReviewRequest', to, data }),
    sendAdminOrderDelivered: async (to, data) => sentEmails.push({ fn: 'sendAdminOrderDelivered', to, data }),
    sendOrderCancellation: async (to, data) => sentEmails.push({ fn: 'sendOrderCancellation', to, data }),
    sendAdminOrderCancelled: async (to, data) => sentEmails.push({ fn: 'sendAdminOrderCancelled', to, data }),
    sendRefundNotification: async (to, data) => sentEmails.push({ fn: 'sendRefundNotification', to, data }),
    sendAdminOrderRefunded: async (to, data) => sentEmails.push({ fn: 'sendAdminOrderRefunded', to, data }),
    sendAdminPaymentAlert: async (to, data) => sentEmails.push({ fn: 'sendAdminPaymentAlert', to, data }),
  },
};

const {
  initializePayment,
  initializeGuestPayment,
  verifyPayment,
  handleWebhook,
  _resetReuseColumnCache,
  _withOrderInitLock,
  _orderInitLockCount,
} = require(path.join(SRC, 'controllers', 'payment.controller.js'));
const { createOrder, createGuestOrder, refundOrder, markOrderPaid, exportOrders } = require(path.join(SRC, 'controllers', 'order.controller.js'));
const registerPaymentWorker = require(path.join(SRC, 'workers', 'payment.worker.js'));
const registerNotificationWorker = require(path.join(SRC, 'workers', 'notification.worker.js'));
const registerReconcileWorker = require(path.join(SRC, 'workers', 'reconciliation.worker.js'));
const registerRefundReconcileWorker = require(path.join(SRC, 'workers', 'refund.reconciliation.worker.js'));
const { makeRateLimiter, normalizeIp } = require(path.join(SRC, 'middleware', 'rateLimit.js'));

const workerHandlers = {};
let workerHandler = null;
const fakeBoss = {
  createQueue: async () => {},
  schedule: async () => {},
  work: async (queue, optsOrFn, maybeFn) => {
    const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
    workerHandlers[queue] = fn;
    if (queue === 'payment/payment.success') workerHandler = fn;
  },
  send: async (queue, data, opts) => { queuedJobs.push({ queue, data, opts }); },
};

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
  return res;
}

function signWebhook(bodyObj) {
  const rawBody = Buffer.from(JSON.stringify(bodyObj));
  const sig = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return { rawBody, sig };
}

async function runTests() {
  await registerPaymentWorker(fakeBoss);
  await registerNotificationWorker(fakeBoss);
  await registerReconcileWorker(fakeBoss);
  await registerRefundReconcileWorker(fakeBoss);
  const reconcileHandler = workerHandlers['reconcile'];
  const refundReconcileHandler = workerHandlers['reconcile/refunds'];
  const refundNotifyHandler = workerHandlers['notification/order-refunded'];
  assert(typeof workerHandler === 'function', 'payment worker must register');
  assert(typeof reconcileHandler === 'function', 'reconcile worker must register');
  assert(typeof refundReconcileHandler === 'function', 'refund reconcile worker must register');
  assert(typeof refundNotifyHandler === 'function', 'order-refunded notification worker must register');

  // ── 1. initialize & initializeGuestPayment guards ──────────────────────────
  {
    resetAll();
    const res1 = makeRes();
    await initializePayment({ body: { orderId: 'not-a-uuid' }, user: { id: 'u1', email: 'a@b.com' } }, res1);
    assert.equal(res1.statusCode, 400);

    const custId = crypto.randomUUID();
    const cancelled = makeOrder({ customer_id: custId, status: 'cancelled' });
    const res2 = makeRes();
    await initializePayment({ body: { orderId: cancelled.id }, user: { id: custId, email: 'a@b.com' } }, res2);
    assert.equal(res2.statusCode, 400);

    const refunded = makeOrder({ customer_id: custId, status: 'refunded' });
    const res3 = makeRes();
    await initializePayment({ body: { orderId: refunded.id }, user: { id: custId, email: 'a@b.com' } }, res3);
    assert.equal(res3.statusCode, 400);

    const review = makeOrder({ customer_id: custId, payment_status: 'payment_review' });
    const res4 = makeRes();
    await initializePayment({ body: { orderId: review.id }, user: { id: custId, email: 'a@b.com' } }, res4);
    assert.equal(res4.statusCode, 400);

    const pod = makeOrder({ customer_id: custId, payment_method: 'pay_on_delivery' });
    const res5 = makeRes();
    await initializePayment({ body: { orderId: pod.id }, user: { id: custId, email: 'a@b.com' } }, res5);
    assert.equal(res5.statusCode, 400);

    // Guest oracle prevention: missing order, owned order, wrong email -> identical generic 404
    const owned = makeOrder({ customer_id: custId });
    const guestOrder = makeOrder({ customer_id: null, guest_email: 'Guest@Example.com' });

    const g1 = makeRes();
    await initializeGuestPayment({ body: { orderId: crypto.randomUUID(), email: 'x@y.com' } }, g1);
    const g2 = makeRes();
    await initializeGuestPayment({ body: { orderId: owned.id, email: 'x@y.com' } }, g2);
    const g3 = makeRes();
    await initializeGuestPayment({ body: { orderId: guestOrder.id, email: 'wrong@example.com' } }, g3);

    assert.deepEqual(
      [g1.statusCode, g2.statusCode, g3.statusCode],
      [404, 404, 404],
      'All invalid guest lookups must return 404'
    );
    assert.equal(g1.body.error, g2.body.error);
    assert.equal(g2.body.error, g3.body.error);

    // Guest init passes stored guest_email, not raw caller casing
    mockPaystackHandlers.post = async () => ({
      data: { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'ac', reference: 'ref_guest_1' } },
    });
    const gOk = makeRes();
    await initializeGuestPayment({ body: { orderId: guestOrder.id, email: '  guest@example.com ' } }, gOk);
    assert.equal(gOk.statusCode, 200);
    assert.equal(paystackCalls[0].payload.email, 'Guest@Example.com');
  }

  // ── 2. verifyPayment validation, abandoned/ongoing/failed, auth scoping ───
  {
    resetAll();
    const order = makeOrder({ customer_id: 'user-owner', total_amount: '50.00' });
    makePayment(order.id, 'ref_valid_1', { amount: '50.00' });

    // Invalid ref format
    const rBad = makeRes();
    await verifyPayment({ body: { reference: 'bad' } }, rBad);
    assert.equal(rBad.statusCode, 400);

    // Metadata-only ref with NO payments row -> rejected 400 (Paystack never called)
    const rMetaOnly = makeRes();
    await verifyPayment({ body: { reference: 'ref_untracked_xyz' } }, rMetaOnly);
    assert.equal(rMetaOnly.statusCode, 400);
    assert.equal(paystackCalls.length, 0);

    // Paystack 404 -> mapped to 400 (not 500)
    mockPaystackHandlers.get = async () => {
      const err = new Error('Not found');
      err.response = { status: 404 };
      throw err;
    };
    const r404 = makeRes();
    await verifyPayment({ body: { reference: 'ref_valid_1' } }, r404);
    assert.equal(r404.statusCode, 400);

    // txData.reference mismatch -> 400
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_other', status: 'success', amount: 5000, currency: 'GHS' } },
    });
    const rRefMismatch = makeRes();
    await verifyPayment({ body: { reference: 'ref_valid_1' } }, rRefMismatch);
    assert.equal(rRefMismatch.statusCode, 400);

    // abandoned / ongoing / pending -> 202 {status:'pending'}, payments row stays pending
    for (const st of ['abandoned', 'ongoing', 'pending']) {
      mockPaystackHandlers.get = async () => ({
        data: { status: true, data: { reference: 'ref_valid_1', status: st, amount: 5000, currency: 'GHS' } },
      });
      const rPend = makeRes();
      await verifyPayment({ body: { reference: 'ref_valid_1' } }, rPend);
      assert.equal(rPend.statusCode, 202, `expected 202 for ${st}`);
      assert.deepEqual(rPend.body, { status: 'pending' });
      assert.equal(dbState.payments.get('ref_valid_1').status, 'pending');
    }

    // success while unauthenticated -> returns STRICTLY { status: 'success' }
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_valid_1', status: 'success', amount: 5000, currency: 'GHS', metadata: { orderId: order.id } } },
    });
    const rAnon = makeRes();
    await verifyPayment({ body: { reference: 'ref_valid_1' } }, rAnon);
    assert.equal(rAnon.statusCode, 200);
    assert.deepEqual(rAnon.body, { status: 'success' });

    // success while authenticated as owner -> includes order details
    const rOwner = makeRes();
    await verifyPayment({ body: { reference: 'ref_valid_1' }, user: { id: 'user-owner', role: 'customer' } }, rOwner);
    assert.equal(rOwner.statusCode, 200);
    assert.equal(rOwner.body.orderId, order.id);
    assert.equal(rOwner.body.order_status, 'confirmed');

    // failed only overwrites pending rows (WHERE status='pending'), not success rows
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_valid_1', status: 'failed', amount: 5000, currency: 'GHS' } },
    });
    const rFailOnSuccess = makeRes();
    await verifyPayment({ body: { reference: 'ref_valid_1' } }, rFailOnSuccess);
    assert.equal(rFailOnSuccess.statusCode, 400);
    assert.equal(dbState.payments.get('ref_valid_1').status, 'success', 'must not overwrite success row');

    makePayment(order.id, 'ref_fail_pending');
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_fail_pending', status: 'failed', amount: 5000, currency: 'GHS' } },
    });
    const rFailPending = makeRes();
    await verifyPayment({ body: { reference: 'ref_fail_pending' } }, rFailPending);
    assert.equal(rFailPending.statusCode, 400);
    assert.equal(dbState.payments.get('ref_fail_pending').status, 'failed');
  }

  // ── 3. Cancelled & refunded order payments (verify + worker) ───────────────
  {
    for (const termStatus of ['cancelled', 'refunded']) {
      // verifyPayment path
      resetAll();
      const order = makeOrder({ status: termStatus, total_amount: '80.00' });
      makePayment(order.id, `ref_${termStatus}_v`);
      mockPaystackHandlers.get = async () => ({
        data: { status: true, data: { reference: `ref_${termStatus}_v`, status: 'success', amount: 8000, currency: 'GHS', metadata: { orderId: order.id } } },
      });
      const rTerm = makeRes();
      await verifyPayment({ body: { reference: `ref_${termStatus}_v` } }, rTerm);
      assert.equal(rTerm.statusCode, 200);
      assert.deepEqual(rTerm.body, { status: 'attention' });
      assert.equal(dbState.orders.get(order.id).payment_status, 'payment_review');
      assert.equal(dbState.payments.get(`ref_${termStatus}_v`).status, 'needs_review');
      assert(dbState.statusLogs.some(l => l.order_id === order.id));
      assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));
      assert(!queuedJobs.some(j => j.queue === 'payment/payment.success'));

      // worker path
      resetAll();
      const orderW = makeOrder({ status: termStatus, total_amount: '80.00', customer_id: 'cust-1' });
      dbState.customers.set('cust-1', { total_spent: 0, total_orders: 0 });
      makePayment(orderW.id, `ref_${termStatus}_w`);
      await workerHandler({ data: { reference: `ref_${termStatus}_w`, orderId: orderW.id, amount: 80, amountPesewas: 8000, currency: 'GHS' } });
      assert.equal(dbState.orders.get(orderW.id).payment_status, 'payment_review');
      assert.equal(dbState.orders.get(orderW.id).status, termStatus, 'must not advance terminal order');
      assert.equal(dbState.payments.get(`ref_${termStatus}_w`).status, 'needs_review');
      assert.equal(dbState.customers.get('cust-1').total_orders, 0);
      assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));
      assert(!queuedJobs.some(j => j.queue === 'shipment/create-shipment'));
      assert(!queuedJobs.some(j => j.queue === 'notification/payment-success'));
    }
  }

  // ── 4. Duplicate payment (verify + worker) ─────────────────────────────────
  {
    resetAll();
    const order = makeOrder({ status: 'confirmed', payment_status: 'paid', payment_reference: 'ref_win_1', total_amount: '100.00' });
    makePayment(order.id, 'ref_win_1', { status: 'success', amount: '100.00' });
    makePayment(order.id, 'ref_dup_v', { status: 'pending', amount: '100.00' });

    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_dup_v', status: 'success', amount: 10000, currency: 'GHS', metadata: { orderId: order.id } } },
    });
    const rDup = makeRes();
    await verifyPayment({ body: { reference: 'ref_dup_v' } }, rDup);
    assert.equal(rDup.statusCode, 200);
    assert.deepEqual(rDup.body, { status: 'attention' });
    assert.equal(dbState.payments.get('ref_dup_v').status, 'duplicate');
    assert(dbState.statusLogs.some(l => l.note.includes('Duplicate')));
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));
    assert(!queuedJobs.some(j => j.queue === 'payment/payment.success'));

    // worker duplicate
    makePayment(order.id, 'ref_dup_w', { status: 'pending', amount: '100.00' });
    queuedJobs.length = 0;
    await workerHandler({ data: { reference: 'ref_dup_w', orderId: order.id, amount: 100, amountPesewas: 10000, currency: 'GHS' } });
    assert.equal(dbState.payments.get('ref_dup_w').status, 'duplicate');
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));
    assert(!queuedJobs.some(j => j.queue === 'notification/payment-success'));
  }

  // ── 5. Webhook: unknown charge.success -> 200; needs-attention; disputes; external refund ─
  {
    resetAll();
    const evUnknown = { event: 'charge.success', data: { reference: 'ref_other_app', amount: 5000, currency: 'GHS' } };
    const { rawBody: rb1, sig: s1 } = signWebhook(evUnknown);
    const w1 = makeRes();
    await handleWebhook({ rawBody: rb1, headers: { 'x-paystack-signature': s1 }, body: evUnknown }, w1);
    assert.equal(w1.statusCode, 200);

    // refund.needs-attention (even when refund_method started null, e.g. external refund)
    const oNeed = makeOrder({ status: 'cancelled', payment_status: 'paid', refund_status: 'pending', refund_method: null, refund_provider_id: '9001', payment_reference: 'ref_need' });
    const evNeed = { event: 'refund.needs-attention', data: { id: 9001, transaction_reference: 'ref_need', status: 'needs-attention' } };
    const { rawBody: rb2, sig: s2 } = signWebhook(evNeed);
    const w2 = makeRes();
    await handleWebhook({ rawBody: rb2, headers: { 'x-paystack-signature': s2 }, body: evNeed }, w2);
    assert.equal(w2.statusCode, 200);
    assert.equal(dbState.orders.get(oNeed.id).refund_status, 'needs_attention');
    assert.equal(dbState.orders.get(oNeed.id).refund_method, 'paystack');
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));

    // charge.dispute.create & resolve
    const oDisp = makeOrder({ status: 'delivered', payment_status: 'paid', payment_reference: 'ref_disp' });
    const evDisp = { event: 'charge.dispute.create', data: { id: 77, status: 'awaiting-merchant-feedback', category: 'fraud', transaction: { reference: 'ref_disp' } } };
    const { rawBody: rb3, sig: s3 } = signWebhook(evDisp);
    const w3 = makeRes();
    await handleWebhook({ rawBody: rb3, headers: { 'x-paystack-signature': s3 }, body: evDisp }, w3);
    assert.equal(w3.statusCode, 200);
    assert.equal(dbState.orders.get(oDisp.id).payment_status, 'payment_review');

    const evDispResolve = { event: 'charge.dispute.resolve', data: { id: 77, status: 'resolved', category: 'merchant-won', transaction: { reference: 'ref_disp' } } };
    const { rawBody: rb3b, sig: s3b } = signWebhook(evDispResolve);
    const w3b = makeRes();
    await handleWebhook({ rawBody: rb3b, headers: { 'x-paystack-signature': s3b }, body: evDispResolve }, w3b);
    assert.equal(w3b.statusCode, 200);
    assert.equal(dbState.orders.get(oDisp.id).payment_status, 'payment_review');
    assert(dbState.statusLogs.some(l => l.order_id === oDisp.id && l.note.includes('charge.dispute.resolve')));

    // external refund.processed (refund_status was 'not_requested')
    const oExt = makeOrder({ status: 'delivered', payment_status: 'paid', refund_status: 'not_requested', payment_reference: 'ref_ext' });
    const evExt = { event: 'refund.processed', data: { id: 888, reference: 'rf_ext', transaction_reference: 'ref_ext', status: 'processed' } };
    const { rawBody: rb4, sig: s4 } = signWebhook(evExt);
    const w4 = makeRes();
    await handleWebhook({ rawBody: rb4, headers: { 'x-paystack-signature': s4 }, body: evExt }, w4);
    assert.equal(w4.statusCode, 200);
    assert.equal(dbState.orders.get(oExt.id).payment_status, 'payment_review');
    assert.equal(dbState.orders.get(oExt.id).refund_status, 'not_requested');
    assert(queuedJobs.some(j => j.data.title === 'External Paystack refund processed'));
  }

  // ── 6. refundOrder timeout recovery + min(paid, total) + currency GHS ──────
  {
    resetAll();
    const order = makeOrder({ status: 'cancelled', payment_status: 'paid', total_amount: '100.00', payment_reference: 'ref_rf_1' });
    // Simulate a payments row where paid was 90.00 (less than 100.00 total) or exact 100.00
    makePayment(order.id, 'ref_rf_1', { status: 'success', amount: '90.00' });

    mockPaystackHandlers.post = async () => {
      const err = new Error('timeout of 10000ms exceeded');
      err.code = 'ECONNABORTED';
      throw err;
    };
    mockPaystackHandlers.get = async (url) => {
      assert(url.startsWith('/refund'));
      return { data: { status: true, data: [{ id: 5544, reference: 'rf_ps_5544', status: 'pending' }] } };
    };

    const rRefund = makeRes();
    await refundOrder({ params: { orderId: order.id }, body: { method: 'paystack', notes: 'Customer cancel' }, user: { id: 'admin-1' } }, rRefund);
    assert.equal(rRefund.statusCode, 200);
    assert.equal(dbState.orders.get(order.id).refund_status, 'pending');
    assert.equal(dbState.orders.get(order.id).refund_provider_id, '5544');
    assert.equal(dbState.orders.get(order.id).refund_amount, 90);
    const postCall = paystackCalls.find(c => c.method === 'POST' && c.url === '/refund');
    assert.equal(postCall.payload.amount, 9000);
    assert.equal(postCall.payload.currency, 'GHS');
  }

  // ── 7. Rate limiter: IPv6 /64 prefix & LRU eviction (no global fail-closed) ─
  {
    assert.equal(normalizeIp('2001:db8:abcd:0001::1'), '2001:0db8:abcd:0001::/64');
    assert.equal(normalizeIp('2001:db8:abcd:1:9999::2'), '2001:0db8:abcd:0001::/64');
    assert.equal(normalizeIp('::ffff:192.0.2.10'), '192.0.2.10');

    const limiter = makeRateLimiter(60_000, 2, 'Limited', { maxKeys: 2 });
    const hit = async (ip) => {
      let passed = false;
      const res = makeRes();
      limiter({ ip }, res, () => { passed = true; });
      return { passed, status: res.statusCode };
    };

    // Same /64 rotates IID — hits same bucket -> 3rd blocked
    assert.equal((await hit('2001:db8:abcd:1::1')).passed, true);
    assert.equal((await hit('2001:db8:abcd:1::2')).passed, true);
    assert.equal((await hit('2001:db8:abcd:1::3')).status, 429);

    // Fill maxKeys (2) and ensure a brand new IP is NOT blocked (LRU evicts oldest)
    assert.equal((await hit('10.0.0.1')).passed, true);
    assert.equal((await hit('10.0.0.2')).passed, true); // evicts 2001:db8:abcd:0001::/64
    assert.equal((await hit('10.0.0.3')).passed, true); // evicts 10.0.0.1 — must NOT fail closed
  }

  // ── 8. Finding 1: reconciliation skips refunded / needs_review / duplicate ─
  {
    resetAll();
    const oRefunded = makeOrder({
      status: 'refunded',
      payment_status: 'refunded',
      payment_reference: 'ref_rec_refunded',
      refund_status: 'success',
    });
    makePayment(oRefunded.id, 'ref_rec_refunded', { status: 'refunded', amount: '100.00' });

    const oNeedsRev = makeOrder({
      status: 'cancelled',
      payment_status: 'pending',
      payment_reference: 'ref_rec_needs_rev',
    });
    makePayment(oNeedsRev.id, 'ref_rec_needs_rev', { status: 'needs_review', amount: '100.00' });

    const oDup = makeOrder({
      status: 'pending',
      payment_status: 'pending',
    });
    makePayment(oDup.id, 'ref_rec_dup', { status: 'duplicate', amount: '100.00' });

    const nowIso = new Date().toISOString();
    mockPaystackHandlers.get = async (url) => {
      assert.equal(url, '/transaction');
      return {
        data: {
          status: true,
          data: [
            { reference: 'ref_rec_refunded', status: 'success', amount: 10000, currency: 'GHS', paid_at: nowIso },
            { reference: 'ref_rec_needs_rev', status: 'success', amount: 10000, currency: 'GHS', paid_at: nowIso },
            { reference: 'ref_rec_dup', status: 'success', amount: 10000, currency: 'GHS', paid_at: nowIso },
          ],
          meta: { pageCount: 1 },
        },
      };
    };

    await reconcileHandler({});
    assert.equal(dbState.orders.get(oRefunded.id).payment_status, 'refunded', 'refunded order must stay refunded');
    assert.equal(dbState.orders.get(oNeedsRev.id).payment_status, 'pending', 'already-needs_review row must be skipped');
    assert.equal(dbState.orders.get(oDup.id).payment_status, 'pending', 'duplicate row must be skipped');
    assert.equal(dbState.statusLogs.length, 0);
    assert.equal(queuedJobs.length, 0);
  }

  // ── 9. Finding 2 & URL normalization & customer stats in verifyPayment ─────
  {
    // 9a: FRONTEND_URL trailing slash normalization in initialize & initializeGuestPayment
    resetAll();
    const prevFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://bodycreamgh.com///';
    try {
      const custId = 'cust-url-1';
      const oAuth = makeOrder({ customer_id: custId, total_amount: '50.00' });
      const oGuest = makeOrder({ customer_id: null, guest_email: 'guest@url.test', total_amount: '50.00' });
      mockPaystackHandlers.post = async () => ({
        data: { status: true, data: { authorization_url: 'https://checkout.paystack.com/u1', access_code: 'ac', reference: 'ref_url_1' } },
      });
      const rInit = makeRes();
      await initializePayment({ body: { orderId: oAuth.id }, user: { id: custId, email: 'cust@url.test' } }, rInit);
      assert.equal(rInit.statusCode, 200);
      assert.equal(paystackCalls[0].payload.callback_url, 'https://bodycreamgh.com/payment/callback');

      const rGuestInit = makeRes();
      await initializeGuestPayment({ body: { orderId: oGuest.id, email: 'guest@url.test' } }, rGuestInit);
      assert.equal(rGuestInit.statusCode, 200);
      assert.equal(paystackCalls[1].payload.callback_url, 'https://bodycreamgh.com/payment/callback');
    } finally {
      if (prevFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prevFrontendUrl;
    }

    // 9b: verifyPayment and payment.worker do NOT mutate/log/alert on terminal/handled payment row replay
    for (const rowStatus of ['refunded', 'needs_review', 'duplicate']) {
      resetAll();
      const order = makeOrder({
        status: 'refunded',
        payment_status: rowStatus === 'refunded' ? 'refunded' : 'cancelled_initial',
        payment_reference: `ref_replay_${rowStatus}`,
        refund_status: rowStatus === 'refunded' ? 'success' : 'not_requested',
        customer_id: 'cust-replay-1',
        total_amount: '100.00',
      });
      const initialPaymentStatus = order.payment_status;
      makePayment(order.id, `ref_replay_${rowStatus}`, { status: rowStatus, amount: '100.00' });

      mockPaystackHandlers.get = async () => ({
        data: {
          status: true,
          data: { reference: `ref_replay_${rowStatus}`, status: 'success', amount: 10000, currency: 'GHS', metadata: { orderId: order.id } },
        },
      });
      const rAnon = makeRes();
      await verifyPayment({ body: { reference: `ref_replay_${rowStatus}` } }, rAnon);
      assert.equal(rAnon.statusCode, 200);
      assert.deepEqual(rAnon.body, { status: 'attention' });

      const rOwner = makeRes();
      await verifyPayment({ body: { reference: `ref_replay_${rowStatus}` }, user: { id: 'cust-replay-1', role: 'customer' } }, rOwner);
      assert.equal(rOwner.statusCode, 200);
      assert.equal(rOwner.body.status, 'attention');
      assert.equal(rOwner.body.orderId, order.id);

      assert.equal(dbState.orders.get(order.id).payment_status, initialPaymentStatus);
      assert.equal(dbState.payments.get(`ref_replay_${rowStatus}`).status, rowStatus);
      assert.equal(dbState.statusLogs.length, 0);
      assert.equal(queuedJobs.length, 0);

      // Same check for payment.worker replay
      await workerHandler({
        data: { reference: `ref_replay_${rowStatus}`, orderId: order.id, amount: 100, amountPesewas: 10000, currency: 'GHS' },
      });
      assert.equal(dbState.orders.get(order.id).payment_status, initialPaymentStatus);
      assert.equal(dbState.statusLogs.length, 0);
      assert.equal(queuedJobs.length, 0);
    }

    // 9c: verifyPayment increments customers.total_spent & total_orders without double-counting when worker runs
    resetAll();
    dbState.customers.set('cust-stats-1', { total_spent: 10, total_orders: 1 });
    const oStats = makeOrder({ customer_id: 'cust-stats-1', total_amount: '75.00', status: 'pending', payment_status: 'pending' });
    makePayment(oStats.id, 'ref_cust_stats', { status: 'pending', amount: '75.00' });
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_cust_stats', status: 'success', amount: 7500, currency: 'GHS', metadata: { orderId: oStats.id } } },
    });
    const rStats = makeRes();
    await verifyPayment({ body: { reference: 'ref_cust_stats' }, user: { id: 'cust-stats-1', role: 'customer' } }, rStats);
    assert.equal(rStats.statusCode, 200);
    assert.equal(dbState.customers.get('cust-stats-1').total_spent, 85);
    assert.equal(dbState.customers.get('cust-stats-1').total_orders, 2);

    const queuedSuccess = queuedJobs.find(j => j.queue === 'payment/payment.success');
    assert(queuedSuccess, 'payment.success job must be enqueued');
    await workerHandler({ data: queuedSuccess.data });
    assert.equal(dbState.customers.get('cust-stats-1').total_spent, 85, 'worker replay must not double-count total_spent');
    assert.equal(dbState.customers.get('cust-stats-1').total_orders, 2, 'worker replay must not double-count total_orders');
  }

  // ── 10. Finding 4: refundOrder refunds full paidAmount on overpayment ─────
  {
    resetAll();
    const oOver = makeOrder({ status: 'cancelled', payment_status: 'paid', total_amount: '100.00', payment_reference: 'ref_over_1' });
    makePayment(oOver.id, 'ref_over_1', { status: 'success', amount: '125.00' });

    mockPaystackHandlers.post = async () => ({
      data: { status: true, data: { id: 7701, reference: 'rf_over_7701', status: 'pending' } },
    });
    const rOver = makeRes();
    await refundOrder({ params: { orderId: oOver.id }, body: { method: 'paystack', notes: 'Overpayment refund' }, user: { id: 'admin-1' } }, rOver);
    assert.equal(rOver.statusCode, 200);
    assert.equal(dbState.orders.get(oOver.id).refund_amount, 125);
    const postCall = paystackCalls.find(c => c.method === 'POST' && c.url === '/refund');
    assert.equal(postCall.payload.amount, 12500);
    assert.equal(postCall.payload.currency, 'GHS');
  }

  // ── 11. Finding 5: refund reconciliation picks one reference per order ─────
  {
    resetAll();
    const oMulti = makeOrder({
      status: 'cancelled',
      payment_status: 'paid',
      payment_reference: 'ref_multi_win',
      refund_status: 'pending',
      refund_method: 'paystack',
      refund_provider_id: null,
    });
    makePayment(oMulti.id, 'ref_multi_nr', { status: 'needs_review', amount: '100.00', updated_at: new Date(Date.now() - 1000) });
    makePayment(oMulti.id, 'ref_multi_win', { status: 'success', amount: '100.00', updated_at: new Date() });

    mockPaystackHandlers.get = async (url, cfg) => {
      assert.equal(url, '/refund');
      assert.equal(cfg?.params?.reference, 'ref_multi_win', 'must prioritize success payment row over needs_review');
      return { data: { status: true, data: [{ id: 8801, reference: 'rf_multi_8801', status: 'processed' }] } };
    };

    await refundReconcileHandler({});
    const refundCalls = paystackCalls.filter(c => c.method === 'GET' && c.url === '/refund');
    assert.equal(refundCalls.length, 1, 'order with multiple payments must only be reconciled once');
    assert(lastPendingRefundSql && !lastPendingRefundSql.includes('LEFT JOIN'), 'pending refund SQL must not LEFT JOIN payments');
    assert(lastPendingRefundSql.includes('AS transaction_reference'));
    assert.equal(dbState.orders.get(oMulti.id).refund_status, 'success');
    assert.equal(dbState.orders.get(oMulti.id).status, 'refunded');
    assert(queuedJobs.some(j => j.queue === 'notification/order-refunded' && j.data.orderId === oMulti.id), 'reconciliation must enqueue order-refunded email');
  }

  // ── 12. Review fixes: success replay on payment_review/cancelled, ambiguous refund, atomic reconcile ─
  {
    // 12a: payments.status='success' replay on disputed (payment_review) & cancelled orders
    for (const scenario of [
      { status: 'delivered', payment_status: 'payment_review', name: 'disputed order' },
      { status: 'cancelled', payment_status: 'paid', name: 'cancelled paid order' },
    ]) {
      resetAll();
      dbState.customers.set('cust-rev-1', { total_spent: 100, total_orders: 1 });
      const o = makeOrder({
        status: scenario.status,
        payment_status: scenario.payment_status,
        payment_reference: 'ref_succ_replay',
        customer_id: 'cust-rev-1',
        total_amount: '100.00',
      });
      makePayment(o.id, 'ref_succ_replay', { status: 'success', amount: '100.00' });

      mockPaystackHandlers.get = async () => ({
        data: { status: true, data: { reference: 'ref_succ_replay', status: 'success', amount: 10000, currency: 'GHS', metadata: { orderId: o.id } } },
      });

      const rVer = makeRes();
      await verifyPayment({ body: { reference: 'ref_succ_replay' }, user: { id: 'cust-rev-1', role: 'customer' } }, rVer);
      assert.equal(rVer.statusCode, 200);
      assert.equal(rVer.body.status, 'attention', `verifyPayment must return attention for ${scenario.name}`);
      assert.equal(dbState.orders.get(o.id).payment_status, scenario.payment_status);
      assert.equal(dbState.customers.get('cust-rev-1').total_spent, 100, 'must not double-count total_spent');
      assert.equal(dbState.customers.get('cust-rev-1').total_orders, 1, 'must not double-count total_orders');
      assert.equal(dbState.statusLogs.length, 0);
      assert.equal(queuedJobs.length, 0);

      await workerHandler({
        data: { reference: 'ref_succ_replay', orderId: o.id, amount: 100, amountPesewas: 10000, currency: 'GHS' },
      });
      assert.equal(dbState.orders.get(o.id).payment_status, scenario.payment_status);
      assert.equal(dbState.customers.get('cust-rev-1').total_spent, 100);
      assert.equal(dbState.customers.get('cust-rev-1').total_orders, 1);
      assert.equal(dbState.statusLogs.length, 0);
      assert.equal(queuedJobs.length, 0);
    }

    // 12b: new pending payment on order already in payment_review flags payment, never resets to paid or increments customers
    resetAll();
    dbState.customers.set('cust-rev-2', { total_spent: 100, total_orders: 1 });
    const oDisputed = makeOrder({
      status: 'delivered',
      payment_status: 'payment_review',
      payment_reference: 'ref_orig',
      customer_id: 'cust-rev-2',
      total_amount: '100.00',
    });
    makePayment(oDisputed.id, 'ref_new_pend_v', { status: 'pending', amount: '100.00' });
    makePayment(oDisputed.id, 'ref_new_pend_w', { status: 'pending', amount: '100.00' });

    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_new_pend_v', status: 'success', amount: 10000, currency: 'GHS', metadata: { orderId: oDisputed.id } } },
    });
    const rDispNew = makeRes();
    await verifyPayment({ body: { reference: 'ref_new_pend_v' } }, rDispNew);
    assert.equal(rDispNew.statusCode, 200);
    assert.deepEqual(rDispNew.body, { status: 'attention' });
    assert.equal(dbState.orders.get(oDisputed.id).payment_status, 'payment_review');
    assert.equal(dbState.payments.get('ref_new_pend_v').status, 'needs_review');
    assert.equal(dbState.customers.get('cust-rev-2').total_spent, 100);
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));

    queuedJobs.length = 0;
    await workerHandler({
      data: { reference: 'ref_new_pend_w', orderId: oDisputed.id, amount: 100, amountPesewas: 10000, currency: 'GHS' },
    });
    assert.equal(dbState.orders.get(oDisputed.id).payment_status, 'payment_review');
    assert.equal(dbState.payments.get('ref_new_pend_w').status, 'needs_review');
    assert.equal(dbState.customers.get('cust-rev-2').total_spent, 100);
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));

    // 12c: ambiguous POST /refund timeout where follow-up GET /refund throws -> 202 and stays pending (not failed)
    resetAll();
    const oAmb = makeOrder({ status: 'cancelled', payment_status: 'paid', total_amount: '100.00', payment_reference: 'ref_rf_amb' });
    makePayment(oAmb.id, 'ref_rf_amb', { status: 'success', amount: '100.00' });

    mockPaystackHandlers.post = async () => {
      const err = new Error('timeout of 10000ms exceeded');
      err.code = 'ECONNABORTED';
      throw err;
    };
    mockPaystackHandlers.get = async () => {
      throw new Error('upstream 503 during refund lookup');
    };
    const rAmb = makeRes();
    await refundOrder({ params: { orderId: oAmb.id }, body: { method: 'paystack', notes: 'Timeout lookup fail' }, user: { id: 'admin-1' } }, rAmb);
    assert.equal(rAmb.statusCode, 202, 'ambiguous timeout + failed lookup must return 202 pending');
    assert.equal(dbState.orders.get(oAmb.id).refund_status, 'pending', 'must stay pending for reconciliation');

    // Timeout recovery finding status:'processed' finalizes immediately & notifies customer
    resetAll();
    const oProc = makeOrder({ status: 'cancelled', payment_status: 'paid', total_amount: '100.00', payment_reference: 'ref_rf_proc' });
    makePayment(oProc.id, 'ref_rf_proc', { status: 'success', amount: '100.00' });
    mockPaystackHandlers.post = async () => {
      const err = new Error('timeout');
      err.code = 'ECONNABORTED';
      throw err;
    };
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: [{ id: 6602, reference: 'rf_proc_6602', status: 'processed' }] },
    });
    const rProc = makeRes();
    await refundOrder({ params: { orderId: oProc.id }, body: { method: 'paystack', notes: 'Instant proc recovery' }, user: { id: 'admin-1' } }, rProc);
    assert.equal(rProc.statusCode, 200);
    assert.equal(dbState.orders.get(oProc.id).refund_status, 'success');
    assert.equal(dbState.orders.get(oProc.id).status, 'refunded');
    assert.equal(dbState.payments.get('ref_rf_proc').status, 'refunded');
    assert(queuedJobs.some(j => j.queue === 'notification/order-refunded' && j.data.orderId === oProc.id));

    // 12d: reconciliation.worker.js race safety under FOR UPDATE / rowCount=0
    resetAll();
    const oRaceMismatch = makeOrder({ status: 'pending', payment_status: 'pending', total_amount: '100.00' });
    makePayment(oRaceMismatch.id, 'ref_race_mismatch', { status: 'pending', amount: '50.00' });

    const oRaceDup = makeOrder({ status: 'confirmed', payment_status: 'paid', payment_reference: 'ref_orig_win', total_amount: '100.00' });
    makePayment(oRaceDup.id, 'ref_orig_win', { status: 'success', amount: '100.00' });
    makePayment(oRaceDup.id, 'ref_race_dup', { status: 'pending', amount: '100.00' });

    const nowIso = new Date().toISOString();
    mockPaystackHandlers.get = async () => ({
      data: {
        status: true,
        data: [
          { reference: 'ref_race_mismatch', status: 'success', amount: 5000, currency: 'GHS', paid_at: nowIso },
          { reference: 'ref_race_dup', status: 'success', amount: 10000, currency: 'GHS', paid_at: nowIso },
        ],
        meta: { pageCount: 1 },
      },
    });
    // Simulate concurrent worker committing paid / updating payment status right before FOR UPDATE / conditional UPDATE
    onBeforeMockQuery = (q, params) => {
      if (q.startsWith('SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE') && params[0] === oRaceMismatch.id) {
        dbState.orders.get(oRaceMismatch.id).payment_status = 'paid';
      }
      if (q.startsWith("UPDATE payments SET status = 'duplicate'") && params[0] === 'ref_race_dup') {
        dbState.payments.get('ref_race_dup').status = 'needs_review';
      }
    };
    await reconcileHandler({});
    assert.equal(dbState.orders.get(oRaceMismatch.id).payment_status, 'paid', 'reconciliation mismatch must not clobber concurrent paid order');
    assert.equal(dbState.payments.get('ref_race_mismatch').status, 'pending');
    assert.equal(dbState.statusLogs.length, 0, 'rowCount=0 or skipped order must emit 0 status logs');
    assert.equal(queuedJobs.length, 0, 'rowCount=0 must emit 0 admin alerts');

    // 12e: refundOrder blocks needs_attention (prevents double refund)
    resetAll();
    const oAttn = makeOrder({ status: 'cancelled', payment_status: 'paid', refund_status: 'needs_attention', refund_method: 'paystack', payment_reference: 'ref_attn_blk' });
    makePayment(oAttn.id, 'ref_attn_blk', { status: 'success', amount: '100.00' });
    const rAttnPs = makeRes();
    await refundOrder({ params: { orderId: oAttn.id }, body: { method: 'paystack' }, user: { id: 'admin-1' } }, rAttnPs);
    assert.equal(rAttnPs.statusCode, 409);
    const rAttnMan = makeRes();
    await refundOrder({ params: { orderId: oAttn.id }, body: { method: 'manual', reference: 'MAN-1' }, user: { id: 'admin-1' } }, rAttnMan);
    assert.equal(rAttnMan.statusCode, 409);

    // 12f: reconciliation.worker.js flags newly settled pending payment on a payment_review order
    resetAll();
    const oReviewRec = makeOrder({ status: 'delivered', payment_status: 'payment_review', payment_reference: 'ref_rev_orig', total_amount: '100.00' });
    makePayment(oReviewRec.id, 'ref_rev_second', { status: 'pending', amount: '100.00' });
    mockPaystackHandlers.get = async () => ({
      data: {
        status: true,
        data: [{ reference: 'ref_rev_second', status: 'success', amount: 10000, currency: 'GHS', paid_at: new Date().toISOString() }],
        meta: { pageCount: 1 },
      },
    });
    await reconcileHandler({});
    assert.equal(dbState.payments.get('ref_rev_second').status, 'needs_review');
    assert.equal(dbState.orders.get(oReviewRec.id).payment_status, 'payment_review');
    assert(dbState.statusLogs.some(l => l.order_id === oReviewRec.id && l.note.includes('ref_rev_second')));
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert' && j.data.alertKey === 'review_order_payment_ref_rev_second'));
  }

  // ── 13. Audit Findings 1, 2, 3, 5 regression tests ─────────────────────────
  {
    // 13a (Finding 1): Real createOrder & createGuestOrder insert 'unpaid', then initialize succeeds; also test 'pending' & retry after failure
    resetAll();
    const prodId = crypto.randomUUID();
    const custId = 'cust-real-1';
    dbState.products.set(prodId, { id: prodId, price: '120.00', stock_quantity: 5 });
    dbState.cartItems.push({ customer_id: custId, product_id: prodId, quantity: 2 });

    const rCreateAuth = makeRes();
    await createOrder({
      user: { id: custId, email: 'realuser@example.com' },
      body: {
        fulfillment_method: 'delivery',
        payment_method: 'paystack',
        shipping_address: '14 Oxford St',
        shipping_city: 'Accra',
        shipping_region: 'Greater Accra',
        notes: 'Ring bell',
      },
    }, rCreateAuth);
    assert.equal(rCreateAuth.statusCode, 201);
    const createdAuthOrder = dbState.orders.get(rCreateAuth.body.orderId);
    assert.equal(createdAuthOrder.payment_status, 'unpaid', 'createOrder must persist payment_status=unpaid');

    let payInitCount = 0;
    mockPaystackHandlers.post = async () => {
      payInitCount += 1;
      return {
        data: {
          status: true,
          data: {
            authorization_url: `https://checkout.paystack.com/real_${payInitCount}`,
            access_code: `ac_${payInitCount}`,
            reference: `ref_real_${payInitCount}`,
          },
        },
      };
    };

    const rInitReal = makeRes();
    await initializePayment({ body: { orderId: createdAuthOrder.id }, user: { id: custId, email: 'realuser@example.com' } }, rInitReal);
    assert.equal(rInitReal.statusCode, 200, 'initializePayment must accept unpaid order from createOrder');
    assert.equal(rInitReal.body.reference, 'ref_real_1');

    // Simulate failed first attempt (payment row becomes failed, order remains unpaid), then retry succeeds
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_real_1', status: 'failed', amount: 24000, currency: 'GHS' } },
    });
    const rFail1 = makeRes();
    await verifyPayment({ body: { reference: 'ref_real_1' }, user: { id: custId, role: 'customer' } }, rFail1);
    assert.equal(rFail1.statusCode, 400);
    assert.equal(dbState.payments.get('ref_real_1').status, 'failed');
    assert.equal(dbState.orders.get(createdAuthOrder.id).payment_status, 'unpaid');

    const rRetryAuth = makeRes();
    await initializePayment({ body: { orderId: createdAuthOrder.id }, user: { id: custId, email: 'realuser@example.com' } }, rRetryAuth);
    assert.equal(rRetryAuth.statusCode, 200, 'retry initializePayment after failed attempt must succeed');
    assert.equal(rRetryAuth.body.reference, 'ref_real_2');

    // Guest checkout real createGuestOrder -> 'unpaid' -> initializeGuestPayment
    const rCreateGuest = makeRes();
    await createGuestOrder({
      body: {
        email: 'guestreal@example.com',
        first_name: 'Ama',
        last_name: 'Mensah',
        phone: '0240000000',
        fulfillment_method: 'pickup',
        payment_method: 'paystack',
        items: [{ product_id: prodId, quantity: 1 }],
      },
    }, rCreateGuest);
    assert.equal(rCreateGuest.statusCode, 201);
    const createdGuestOrder = dbState.orders.get(rCreateGuest.body.orderId);
    assert.equal(createdGuestOrder.payment_status, 'unpaid', 'createGuestOrder must persist payment_status=unpaid');

    const rInitGuestReal = makeRes();
    await initializeGuestPayment({ body: { orderId: createdGuestOrder.id, email: 'guestreal@example.com' } }, rInitGuestReal);
    assert.equal(rInitGuestReal.statusCode, 200, 'initializeGuestPayment must accept unpaid order from createGuestOrder');

    // Explicit test for both 'unpaid' and legacy 'pending' payment_status
    for (const st of ['unpaid', 'pending']) {
      const oAuthSt = makeOrder({ customer_id: 'cust-st', payment_status: st, total_amount: '55.00' });
      const oGuestSt = makeOrder({ customer_id: null, guest_email: 'st@test.com', payment_status: st, total_amount: '55.00' });
      const rA = makeRes();
      await initializePayment({ body: { orderId: oAuthSt.id }, user: { id: 'cust-st', email: 'st@test.com' } }, rA);
      assert.equal(rA.statusCode, 200, `initializePayment must accept ${st}`);
      const rG = makeRes();
      await initializeGuestPayment({ body: { orderId: oGuestSt.id, email: 'st@test.com' } }, rG);
      assert.equal(rG.statusCode, 200, `initializeGuestPayment must accept ${st}`);
    }

    // 13b (Finding 2): zero / negative / NaN totals rejected cleanly with 400 before calling Paystack
    resetAll();
    for (const badTotal of ['0.00', '0', '-5.00', 'not-a-number']) {
      const oZeroAuth = makeOrder({ customer_id: 'cust-z', payment_status: 'unpaid', total_amount: badTotal });
      const rZAuth = makeRes();
      await initializePayment({ body: { orderId: oZeroAuth.id }, user: { id: 'cust-z', email: 'z@test.com' } }, rZAuth);
      assert.equal(rZAuth.statusCode, 400, `auth init must reject total_amount=${badTotal}`);

      const oZeroGuest = makeOrder({ customer_id: null, guest_email: 'z@test.com', payment_status: 'unpaid', total_amount: badTotal });
      const rZGuest = makeRes();
      await initializeGuestPayment({ body: { orderId: oZeroGuest.id, email: 'z@test.com' } }, rZGuest);
      assert.equal(rZGuest.statusCode, 400, `guest init must reject total_amount=${badTotal}`);
    }
    assert.equal(paystackCalls.length, 0, 'Paystack must not be called for non-positive totals');

    // 13c (Finding 3): notification/order-refunded sends refund_amount (falling back to total_amount)
    resetAll();
    const oRefCustom = makeOrder({ order_number: 'ORD-REF-125', total_amount: '100.00', refund_amount: '125.00', guest_email: 'refundee@test.com' });
    await refundNotifyHandler({ data: { orderId: oRefCustom.id } });
    const custMail = sentEmails.find(e => e.fn === 'sendRefundNotification');
    const admMail = sentEmails.find(e => e.fn === 'sendAdminOrderRefunded');
    assert.equal(custMail.data.total, '125.00', 'customer refund email must use refund_amount');
    assert.equal(admMail.data.total, '125.00', 'admin refund email must use refund_amount');

    sentEmails.length = 0;
    const oRefFallback = makeOrder({ order_number: 'ORD-REF-FB', total_amount: '80.00', refund_amount: null, guest_email: 'refundee2@test.com' });
    await refundNotifyHandler({ data: { orderId: oRefFallback.id } });
    assert.equal(sentEmails.find(e => e.fn === 'sendRefundNotification').data.total, '80.00');
    assert.equal(sentEmails.find(e => e.fn === 'sendAdminOrderRefunded').data.total, '80.00');

    // 13d (Finding 5): NULL customers.total_spent & total_orders safely coalesce to 0 in verifyPayment & payment.worker
    resetAll();
    dbState.customers.set('cust-null-v', { total_spent: null, total_orders: null });
    const oNullV = makeOrder({ customer_id: 'cust-null-v', payment_status: 'unpaid', total_amount: '60.00' });
    makePayment(oNullV.id, 'ref_null_v', { status: 'pending', amount: '60.00' });
    mockPaystackHandlers.get = async () => ({
      data: { status: true, data: { reference: 'ref_null_v', status: 'success', amount: 6000, currency: 'GHS', metadata: { orderId: oNullV.id } } },
    });
    const rNullV = makeRes();
    await verifyPayment({ body: { reference: 'ref_null_v' }, user: { id: 'cust-null-v', role: 'customer' } }, rNullV);
    assert.equal(rNullV.statusCode, 200);
    assert.equal(dbState.customers.get('cust-null-v').total_spent, 60);
    assert.equal(dbState.customers.get('cust-null-v').total_orders, 1);

    dbState.customers.set('cust-null-w', { total_spent: null, total_orders: null });
    const oNullW = makeOrder({ customer_id: 'cust-null-w', payment_status: 'unpaid', total_amount: '45.00' });
    makePayment(oNullW.id, 'ref_null_w', { status: 'pending', amount: '45.00' });
    await workerHandler({ data: { reference: 'ref_null_w', orderId: oNullW.id, amount: 45, amountPesewas: 4500, currency: 'GHS' } });
    assert.equal(dbState.customers.get('cust-null-w').total_spent, 45);
    assert.equal(dbState.customers.get('cust-null-w').total_orders, 1);
  }

  // ── 14. Decisions A & C: zero-total checkout rollback, markOrderPaid COALESCE, exportOrders filter ─
  {
    // 14a: authenticated createOrder rejects 100%-discount zero-total Paystack order and rolls back stock & coupon usage
    resetAll();
    const prodId = crypto.randomUUID();
    const custId = 'cust-zero-auth';
    const couponId = 'coupon-free-100';
    dbState.products.set(prodId, { id: prodId, price: '100.00', stock_quantity: 5 });
    dbState.cartItems.push({ customer_id: custId, product_id: prodId, quantity: 1 });
    dbState.coupons.set(couponId, {
      id: couponId,
      code: 'FREE100',
      type: 'percentage',
      value: '100',
      min_order: '0',
      max_uses: 1,
      uses_count: 0,
      expires_at: null,
      active: true,
    });

    const rZeroAuth = makeRes();
    await createOrder({
      user: { id: custId, email: 'zeroauth@test.com' },
      body: {
        fulfillment_method: 'pickup',
        payment_method: 'paystack',
        coupon_code: 'FREE100',
      },
    }, rZeroAuth);
    assert.equal(rZeroAuth.statusCode, 400, 'createOrder must reject zero-total Paystack order with 400');
    assert.equal(dbState.orders.size, 0, 'zero-total rejection must not create order');
    assert.equal(dbState.products.get(prodId).stock_quantity, 5, 'stock must remain unchanged');
    assert.equal(dbState.coupons.get(couponId).uses_count, 0, 'coupon uses_count must roll back to 0');
    assert.equal(dbState.cartItems.length, 1, 'cart item must remain untouched');

    // 14b: createGuestOrder rejects 100%-discount zero-total Paystack order and rolls back stock & coupon usage
    const rZeroGuest = makeRes();
    await createGuestOrder({
      body: {
        email: 'zeroguest@test.com',
        first_name: 'Kofi',
        phone: '0240000001',
        fulfillment_method: 'pickup',
        payment_method: 'paystack',
        coupon_code: 'FREE100',
        items: [{ product_id: prodId, quantity: 1 }],
      },
    }, rZeroGuest);
    assert.equal(rZeroGuest.statusCode, 400, 'createGuestOrder must reject zero-total Paystack order with 400');
    assert.equal(dbState.orders.size, 0, 'guest zero-total rejection must not create order');
    assert.equal(dbState.products.get(prodId).stock_quantity, 5, 'guest zero-total rejection must keep stock at 5');
    assert.equal(dbState.coupons.get(couponId).uses_count, 0, 'guest zero-total rejection must roll back coupon uses_count');

    // 14c (Decision C1): markOrderPaid safely coalesces NULL customers.total_spent / total_orders
    resetAll();
    dbState.customers.set('cust-pod-null', { total_spent: null, total_orders: null });
    const oPod = makeOrder({
      customer_id: 'cust-pod-null',
      payment_method: 'pay_on_delivery',
      payment_status: 'unpaid',
      status: 'confirmed',
      total_amount: '85.00',
    });
    const rPod = makeRes();
    await markOrderPaid({ params: { orderId: oPod.id }, body: {}, user: { id: 'admin-1' } }, rPod);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rPod.statusCode, 200);
    assert.equal(dbState.orders.get(oPod.id).payment_status, 'paid');
    assert.equal(dbState.customers.get('cust-pod-null').total_spent, 85);
    assert.equal(dbState.customers.get('cust-pod-null').total_orders, 1);

    // 14d (Decision C2): exportOrders accepts and applies payment_status filter
    resetAll();
    makeOrder({ order_number: 'ORD-EXP-PAID', payment_status: 'paid', total_amount: '50.00', guest_email: 'a@b.com' });
    makeOrder({ order_number: 'ORD-EXP-REV', payment_status: 'payment_review', total_amount: '75.00', guest_email: 'c@d.com' });
    const rExp = makeRes();
    await exportOrders({ query: { payment_status: 'payment_review' } }, rExp);
    assert.equal(rExp.statusCode, 200);
    assert(lastExportQuery.sql.includes('o.payment_status = $1'));
    assert.deepEqual(lastExportQuery.params, ['payment_review']);
    assert(rExp.body.includes('ORD-EXP-REV'));
    assert(!rExp.body.includes('ORD-EXP-PAID'));
  }

  // ── 15. Security audit finding 2: reuse open Paystack transaction, race-safe ─
  {
    const initCalls = () => paystackCalls.filter(c => c.method === 'POST' && c.url === '/transaction/initialize');
    const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);
    const installPaystackInit = (delayMs = 0) => {
      let n = 0;
      mockPaystackHandlers.post = async () => {
        const id = ++n;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        return {
          data: {
            status: true,
            data: {
              authorization_url: `https://checkout.paystack.com/tx_${id}`,
              access_code: `ac_${id}`,
              reference: `ref_reuse_${id}`,
            },
          },
        };
      };
    };

    // 15a: second authenticated init returns the SAME reference; old row untouched
    resetAll();
    installPaystackInit();
    const oReuse = makeOrder({ customer_id: 'cust-reuse', payment_status: 'unpaid', total_amount: '100.00' });
    const rI1 = makeRes();
    await initializePayment({ body: { orderId: oReuse.id }, user: { id: 'cust-reuse', email: 'reuse@test.com' } }, rI1);
    const rI2 = makeRes();
    await initializePayment({ body: { orderId: oReuse.id }, user: { id: 'cust-reuse', email: 'reuse@test.com' } }, rI2);
    assert.equal(rI1.statusCode, 200);
    assert.equal(rI2.statusCode, 200);
    assert.equal(rI2.body.reference, rI1.body.reference, 'second init must reuse the open reference');
    assert.equal(rI2.body.authorization_url, rI1.body.authorization_url);
    assert.equal(rI2.body.access_code, rI1.body.access_code);
    assert.equal(initCalls().length, 1, 'Paystack initialize must be called once');
    assert.equal(dbState.payments.size, 1);
    assert.equal(dbState.payments.get(rI1.body.reference).status, 'pending');

    // 15b: guest flow reuses too
    resetAll();
    installPaystackInit();
    const oReuseG = makeOrder({ customer_id: null, guest_email: 'reuseg@test.com', payment_status: 'unpaid', total_amount: '60.00' });
    const rG1 = makeRes();
    await initializeGuestPayment({ body: { orderId: oReuseG.id, email: 'reuseg@test.com' } }, rG1);
    const rG2 = makeRes();
    await initializeGuestPayment({ body: { orderId: oReuseG.id, email: 'REUSEG@test.com' } }, rG2);
    assert.equal(rG2.body.reference, rG1.body.reference);
    assert.equal(initCalls().length, 1);

    // 15c: stale (older than 30 min) open transaction is not reused and is left pending
    resetAll();
    installPaystackInit();
    const oStale = makeOrder({ customer_id: 'cust-stale', payment_status: 'unpaid', total_amount: '100.00' });
    makePayment(oStale.id, 'ref_stale_old', {
      amount: '100.00', authorization_url: 'https://checkout.paystack.com/old', access_code: 'old', currency: 'GHS',
      created_at: minutesAgo(31),
    });
    const rStale = makeRes();
    await initializePayment({ body: { orderId: oStale.id }, user: { id: 'cust-stale', email: 's@test.com' } }, rStale);
    assert.equal(rStale.statusCode, 200);
    assert.equal(rStale.body.reference, 'ref_reuse_1', 'stale transaction must not be reused');
    assert.equal(initCalls().length, 1);
    assert.equal(dbState.payments.get('ref_stale_old').status, 'pending', 'old reference must NOT be marked abandoned/failed');

    // 15d: a recent one just inside the window IS reused
    resetAll();
    installPaystackInit();
    const oFresh = makeOrder({ customer_id: 'cust-fresh', payment_status: 'unpaid', total_amount: '100.00' });
    makePayment(oFresh.id, 'ref_fresh_old', {
      amount: '100.00', authorization_url: 'https://checkout.paystack.com/fresh', access_code: 'fresh', currency: 'GHS',
      created_at: minutesAgo(29),
    });
    const rFresh = makeRes();
    await initializePayment({ body: { orderId: oFresh.id }, user: { id: 'cust-fresh', email: 'f@test.com' } }, rFresh);
    assert.equal(rFresh.body.reference, 'ref_fresh_old');
    assert.equal(initCalls().length, 0);

    // 15e: changed order amount -> new reference; old stays pending
    resetAll();
    installPaystackInit();
    const oAmt = makeOrder({ customer_id: 'cust-amt', payment_status: 'unpaid', total_amount: '120.00' });
    makePayment(oAmt.id, 'ref_amt_old', {
      amount: '100.00', authorization_url: 'https://checkout.paystack.com/amt', access_code: 'amt', currency: 'GHS',
      created_at: minutesAgo(2),
    });
    const rAmt = makeRes();
    await initializePayment({ body: { orderId: oAmt.id }, user: { id: 'cust-amt', email: 'a@test.com' } }, rAmt);
    assert.equal(rAmt.body.reference, 'ref_reuse_1', 'changed amount must create a new reference');
    assert.equal(initCalls().length, 1);
    assert.equal(initCalls()[0].payload.amount, 12000);
    assert.equal(dbState.payments.get('ref_amt_old').status, 'pending');

    // 15f: other currency, failed rows and rows without a stored URL are never reused
    resetAll();
    installPaystackInit();
    const oSkip = makeOrder({ customer_id: 'cust-skip', payment_status: 'unpaid', total_amount: '100.00' });
    makePayment(oSkip.id, 'ref_skip_usd', {
      amount: '100.00', authorization_url: 'https://checkout.paystack.com/usd', currency: 'USD', created_at: minutesAgo(1),
    });
    makePayment(oSkip.id, 'ref_skip_failed', {
      amount: '100.00', authorization_url: 'https://checkout.paystack.com/failed', currency: 'GHS', status: 'failed', created_at: minutesAgo(1),
    });
    makePayment(oSkip.id, 'ref_skip_legacy', { amount: '100.00', created_at: minutesAgo(1) });
    makePayment(oSkip.id, 'ref_skip_badhost', {
      amount: '100.00', authorization_url: 'https://evil.example.com/pay', currency: 'GHS', created_at: minutesAgo(1),
    });
    const rSkip = makeRes();
    await initializePayment({ body: { orderId: oSkip.id }, user: { id: 'cust-skip', email: 'k@test.com' } }, rSkip);
    assert.equal(rSkip.body.reference, 'ref_reuse_1');
    assert.equal(initCalls().length, 1);

    // 15g: two simultaneous init calls produce ONE reference (auth and guest)
    resetAll();
    installPaystackInit(30);
    const oRace = makeOrder({ customer_id: 'cust-race', payment_status: 'unpaid', total_amount: '100.00' });
    const [rr1, rr2] = [makeRes(), makeRes()];
    await Promise.all([
      initializePayment({ body: { orderId: oRace.id }, user: { id: 'cust-race', email: 'race@test.com' } }, rr1),
      initializePayment({ body: { orderId: oRace.id }, user: { id: 'cust-race', email: 'race@test.com' } }, rr2),
    ]);
    assert.equal(rr1.statusCode, 200);
    assert.equal(rr2.statusCode, 200);
    assert.equal(rr1.body.reference, rr2.body.reference, 'parallel inits must share one reference');
    assert.equal(initCalls().length, 1, 'parallel inits must create exactly one Paystack transaction');
    assert.equal(dbState.payments.size, 1);

    resetAll();
    installPaystackInit(30);
    const oRaceG = makeOrder({ customer_id: null, guest_email: 'raceg@test.com', payment_status: 'unpaid', total_amount: '100.00' });
    const [rg1, rg2, rg3] = [makeRes(), makeRes(), makeRes()];
    await Promise.all([
      initializeGuestPayment({ body: { orderId: oRaceG.id, email: 'raceg@test.com' } }, rg1),
      initializeGuestPayment({ body: { orderId: oRaceG.id, email: 'raceg@test.com' } }, rg2),
      initializeGuestPayment({ body: { orderId: oRaceG.id, email: 'raceg@test.com' } }, rg3),
    ]);
    assert.equal(new Set([rg1.body.reference, rg2.body.reference, rg3.body.reference]).size, 1);
    assert.equal(initCalls().length, 1);
    assert.equal(dbState.payments.size, 1);

    // different orders do not block or share references
    resetAll();
    installPaystackInit(10);
    const oX = makeOrder({ customer_id: 'cust-x', payment_status: 'unpaid', total_amount: '100.00' });
    const oY = makeOrder({ customer_id: 'cust-x', payment_status: 'unpaid', total_amount: '100.00' });
    const [rx, ry] = [makeRes(), makeRes()];
    await Promise.all([
      initializePayment({ body: { orderId: oX.id }, user: { id: 'cust-x', email: 'x@test.com' } }, rx),
      initializePayment({ body: { orderId: oY.id }, user: { id: 'cust-x', email: 'x@test.com' } }, ry),
    ]);
    assert.notEqual(rx.body.reference, ry.body.reference);
    assert.equal(initCalls().length, 2);

    // 15h: an old reference can still be paid; duplicate detection still works after reuse logic
    resetAll();
    installPaystackInit();
    const oDup = makeOrder({ customer_id: 'cust-dup', payment_status: 'unpaid', total_amount: '100.00' });
    makePayment(oDup.id, 'ref_dup_old', {
      amount: '100.00', authorization_url: 'https://checkout.paystack.com/dupold', currency: 'GHS',
      created_at: minutesAgo(45),
    });
    const rDupInit = makeRes();
    await initializePayment({ body: { orderId: oDup.id }, user: { id: 'cust-dup', email: 'd@test.com' } }, rDupInit);
    const newRef = rDupInit.body.reference;
    assert.equal(newRef, 'ref_reuse_1');
    assert.equal(dbState.payments.get('ref_dup_old').status, 'pending');

    const paystackSuccess = (reference) => async () => ({
      data: { status: true, data: { reference, status: 'success', amount: 10000, currency: 'GHS', metadata: { orderId: oDup.id } } },
    });
    mockPaystackHandlers.get = paystackSuccess('ref_dup_old');
    const rPayOld = makeRes();
    await verifyPayment({ body: { reference: 'ref_dup_old' }, user: { id: 'cust-dup', role: 'customer' } }, rPayOld);
    assert.equal(rPayOld.body.status, 'success');
    assert.equal(dbState.orders.get(oDup.id).payment_status, 'paid');
    assert.equal(dbState.payments.get('ref_dup_old').status, 'success');

    mockPaystackHandlers.get = paystackSuccess(newRef);
    const rPayNew = makeRes();
    await verifyPayment({ body: { reference: newRef }, user: { id: 'cust-dup', role: 'customer' } }, rPayNew);
    assert.equal(rPayNew.body.status, 'attention', 'second payment on the same order must be flagged as duplicate');
    assert.equal(dbState.payments.get(newRef).status, 'duplicate');
    assert(queuedJobs.some(j => j.queue === 'notification/admin-payment-alert'));

    // 15i: before migration 033 is applied, init falls back to the previous behaviour
    resetAll();
    mockReuseColumns = false;
    installPaystackInit();
    const oLegacy = makeOrder({ customer_id: 'cust-legacy', payment_status: 'unpaid', total_amount: '100.00' });
    const rL1 = makeRes();
    await initializePayment({ body: { orderId: oLegacy.id }, user: { id: 'cust-legacy', email: 'l@test.com' } }, rL1);
    const rL2 = makeRes();
    await initializePayment({ body: { orderId: oLegacy.id }, user: { id: 'cust-legacy', email: 'l@test.com' } }, rL2);
    assert.equal(rL1.statusCode, 200);
    assert.equal(rL2.statusCode, 200);
    assert.notEqual(rL1.body.reference, rL2.body.reference, 'without reuse columns each init creates a new reference');
    assert.equal(initCalls().length, 2);
    assert.equal(dbState.payments.get(rL1.body.reference).authorization_url, undefined);

    // 15j: an eligibility error inside the lock still releases it (next call is not stuck)
    resetAll();
    installPaystackInit();
    const oBad = makeOrder({ customer_id: 'cust-bad', payment_status: 'paid', total_amount: '100.00' });
    const rBad1 = makeRes();
    await initializePayment({ body: { orderId: oBad.id }, user: { id: 'cust-bad', email: 'b@test.com' } }, rBad1);
    assert.equal(rBad1.statusCode, 400);
    dbState.orders.get(oBad.id).payment_status = 'unpaid';
    const rBad2 = makeRes();
    await initializePayment({ body: { orderId: oBad.id }, user: { id: 'cust-bad', email: 'b@test.com' } }, rBad2);
    assert.equal(rBad2.statusCode, 200);

    // 15k: a Paystack failure inside the lock releases it and stores nothing
    resetAll();
    const oFail = makeOrder({ customer_id: 'cust-pf', payment_status: 'unpaid', total_amount: '100.00' });
    mockPaystackHandlers.post = async () => { throw new Error('Paystack down'); };
    const rPf1 = makeRes();
    await initializePayment({ body: { orderId: oFail.id }, user: { id: 'cust-pf', email: 'pf@test.com' } }, rPf1);
    assert.equal(rPf1.statusCode, 500);
    assert.equal(dbState.payments.size, 0);
    installPaystackInit();
    const rPf2 = makeRes();
    await initializePayment({ body: { orderId: oFail.id }, user: { id: 'cust-pf', email: 'pf@test.com' } }, rPf2);
    assert.equal(rPf2.statusCode, 200);

    // 15l: no DB pool connection is held while Paystack HTTP call is in flight
    resetAll();
    let clientsDuringHttp = -1;
    mockPaystackHandlers.post = async () => {
      clientsDuringHttp = activePoolClients;
      await new Promise(resolve => setTimeout(resolve, 15));
      return {
        data: {
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/tx_no_conn',
            access_code: 'ac_no_conn',
            reference: 'ref_no_conn',
          },
        },
      };
    };
    const oNoConn = makeOrder({ customer_id: 'cust-nc', payment_status: 'unpaid', total_amount: '100.00' });
    const [rNc1, rNc2] = [makeRes(), makeRes()];
    await Promise.all([
      initializePayment({ body: { orderId: oNoConn.id }, user: { id: 'cust-nc', email: 'nc@test.com' } }, rNc1),
      initializePayment({ body: { orderId: oNoConn.id }, user: { id: 'cust-nc', email: 'nc@test.com' } }, rNc2),
    ]);
    assert.equal(clientsDuringHttp, 0, 'no DB connection may be held during the Paystack HTTP call');
    assert.equal(activePoolClients, 0, 'all DB connections must be released after init');
    assert.equal(rNc1.body.reference, 'ref_no_conn');
    assert.equal(rNc2.body.reference, 'ref_no_conn');
    assert.equal(initCalls().length, 1);

    // 15m: cross-process race — another process inserts a reusable row while our
    // Paystack HTTP call is in flight -> return existing row, do NOT insert ours,
    // and log the discarded reference.
    resetAll();
    const oCross = makeOrder({ customer_id: 'cust-cross', payment_status: 'unpaid', total_amount: '100.00' });
    mockPaystackHandlers.post = async () => {
      // Simulate another server process committing a pending row during our HTTP call
      makePayment(oCross.id, 'ref_peer_proc', {
        amount: '100.00',
        authorization_url: 'https://checkout.paystack.com/peer_tx',
        access_code: 'ac_peer',
        currency: 'GHS',
        created_at: new Date(),
      });
      return {
        data: {
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/discarded_tx',
            access_code: 'ac_discarded',
            reference: 'ref_discarded_1',
          },
        },
      };
    };
    const rCross = makeRes();
    await initializePayment({ body: { orderId: oCross.id }, user: { id: 'cust-cross', email: 'c@test.com' } }, rCross);
    assert.equal(rCross.statusCode, 200);
    assert.equal(rCross.body.reference, 'ref_peer_proc', 'must return existing peer reference');
    assert.equal(rCross.body.authorization_url, 'https://checkout.paystack.com/peer_tx');
    assert.equal(rCross.body.access_code, 'ac_peer');
    assert.equal(dbState.payments.has('ref_discarded_1'), false, 'discarded reference must not be inserted');
    assert.equal(dbState.payments.size, 1);
    assert(
      loggedEvents.some(e =>
        e.level === 'warn' &&
        e.meta?.reference === 'ref_peer_proc' &&
        e.meta?.discardedReference === 'ref_discarded_1'
      ),
      'discarded reference must be logged'
    );

    // 15n: withOrderInitLock deletes its Map entry when the last waiter finishes,
    // including when callbacks throw (single waiter and multiple waiters).
    assert.equal(_orderInitLockCount(), 0);
    await _withOrderInitLock('lock-ok', async () => 'done');
    assert.equal(_orderInitLockCount(), 0, 'map entry deleted after single success');

    await assert.rejects(
      () => _withOrderInitLock('lock-throw', async () => { throw new Error('boom'); }),
      /boom/
    );
    assert.equal(_orderInitLockCount(), 0, 'map entry deleted after single throw');

    const lockResults = await Promise.allSettled([
      _withOrderInitLock('lock-multi', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('first-failed');
      }),
      _withOrderInitLock('lock-multi', async () => 'second-ok'),
      _withOrderInitLock('lock-multi', async () => {
        throw new Error('last-failed');
      }),
    ]);
    assert.equal(lockResults[0].status, 'rejected');
    assert.equal(lockResults[1].status, 'fulfilled');
    assert.equal(lockResults[1].value, 'second-ok');
    assert.equal(lockResults[2].status, 'rejected');
    assert.equal(_orderInitLockCount(), 0, 'map entry deleted after last waiter finishes even on throw');
  }

  // ── 16. Security audit finding 3: HTML escaping in email.service.js ─────────
  {
    const nodemailerPath = require.resolve('nodemailer');
    const emailServicePath = require.resolve('../src/services/email.service');
    const origNodemailer = require.cache[nodemailerPath];
    const origEmailService = require.cache[emailServicePath];
    const origSmtpUser = process.env.SMTP_USER;
    const origSmtpPass = process.env.SMTP_PASS;

    const sentMails = [];
    try {
      process.env.SMTP_USER = 'noreply@bodycreamgh.test';
      process.env.SMTP_PASS = 'real_test_app_password';
      require.cache[nodemailerPath] = {
        id: nodemailerPath,
        filename: nodemailerPath,
        loaded: true,
        exports: {
          createTransport: () => ({
            sendMail: async (mail) => {
              sentMails.push(mail);
              return { messageId: `mock-${sentMails.length}` };
            },
            verify: async () => true,
          }),
        },
      };
      delete require.cache[emailServicePath];
      const realEmail = require('../src/services/email.service');

      const xss = '<img src=x onerror=alert(1)>';
      const escapedXss = '&lt;img src=x onerror=alert(1)&gt;';

      const lastHtml = () => sentMails[sentMails.length - 1].html;
      const assertEscaped = (label) => {
        const html = lastHtml();
        assert(html.includes(escapedXss), `${label}: expected escaped XSS payload in HTML`);
        assert(!html.includes(xss), `${label}: raw unescaped XSS payload must not appear in HTML`);
      };

      await realEmail.sendWelcomeEmail('u@test.com', xss);
      assertEscaped('sendWelcomeEmail');

      await realEmail.sendOrderConfirmation('u@test.com', {
        orderNumber: xss,
        total: 120,
        items: [{ name: xss, quantity: 2, price_at_purchase: 60 }],
      });
      assertEscaped('sendOrderConfirmation');

      await realEmail.sendShippingNotification('u@test.com', {
        orderNumber: 'ORD-1',
        deliveryPartner: xss,
        trackingNumber: xss,
      });
      assertEscaped('sendShippingNotification');

      await realEmail.sendReviewRequest('u@test.com', {
        customerName: xss,
        orderNumber: 'ORD-2',
        orderId: 'order-123',
        items: [{ id: 'p-1', name: xss }],
        frontendUrl: 'https://store.example.com',
      });
      assertEscaped('sendReviewRequest');
      assert(
        lastHtml().includes('href="https://store.example.com/orders/order-123?review=1"'),
        'sendReviewRequest: self-built targetUrl must remain unescaped'
      );

      await realEmail.sendOrderCancellation('u@test.com', { customerName: xss, orderNumber: 'ORD-3' });
      assertEscaped('sendOrderCancellation');

      await realEmail.sendRefundNotification('u@test.com', { customerName: xss, orderNumber: 'ORD-4', total: 50 });
      assertEscaped('sendRefundNotification');

      await realEmail.sendCancelRequested('u@test.com', { customerName: xss, orderNumber: 'ORD-5' });
      assertEscaped('sendCancelRequested');

      await realEmail.sendCancelRejected('u@test.com', { customerName: xss, orderNumber: 'ORD-6' });
      assertEscaped('sendCancelRejected');

      await realEmail.sendReturnRequested('u@test.com', { customerName: xss, orderNumber: 'ORD-7' });
      assertEscaped('sendReturnRequested');

      await realEmail.sendReturnRejected('u@test.com', { customerName: xss, orderNumber: 'ORD-8' });
      assertEscaped('sendReturnRejected');

      await realEmail.sendAdminNewOrder('admin@test.com', { orderNumber: 'ORD-9', total: 80, customerName: xss });
      assertEscaped('sendAdminNewOrder');

      await realEmail.sendAdminCancelRequest('admin@test.com', { orderNumber: 'ORD-10', customerName: xss, reason: xss });
      assertEscaped('sendAdminCancelRequest');

      await realEmail.sendAdminReturnRequest('admin@test.com', { orderNumber: 'ORD-11', customerName: xss, reason: xss });
      assertEscaped('sendAdminReturnRequest');

      await realEmail.sendAdminOrderShipped('admin@test.com', { orderNumber: 'ORD-12', trackingNumber: xss });
      assertEscaped('sendAdminOrderShipped');

      await realEmail.sendNewsletterWelcome('u@test.com', {
        name: xss,
        couponCode: xss,
        discountText: '15% & more',
        unsubscribeUrl: 'https://store.example.com/unsub?t=abc&x=1',
      });
      assertEscaped('sendNewsletterWelcome');
      assert(lastHtml().includes('15% &amp; more'), 'sendNewsletterWelcome: discountText must be escaped');
      assert(
        lastHtml().includes('href="https://store.example.com/unsub?t=abc&x=1"'),
        'sendNewsletterWelcome: self-built unsubscribeUrl must remain unescaped'
      );

      await realEmail.sendNewsletterEmail('u@test.com', {
        subject: 'Campaign',
        bodyHtml: '<p><strong>Intentional HTML</strong></p>',
        unsubscribeUrl: 'https://store.example.com/unsub?t=xyz&a=2',
        storeName: xss,
      });
      assertEscaped('sendNewsletterEmail(storeName)');
      assert(
        lastHtml().includes('<p><strong>Intentional HTML</strong></p>'),
        'sendNewsletterEmail: intentional bodyHtml must not be escaped'
      );
      assert(
        lastHtml().includes('href="https://store.example.com/unsub?t=xyz&a=2"'),
        'sendNewsletterEmail: self-built unsubscribeUrl must remain unescaped'
      );

      await realEmail.sendOtpEmail('admin@test.com', { firstName: xss, otp: '123456' });
      assertEscaped('sendOtpEmail');

      await realEmail.sendPasswordResetEmail('u@test.com', 'https://store.example.com/reset?token=abc&foo=bar');
      assert(
        lastHtml().includes('href="https://store.example.com/reset?token=abc&foo=bar"'),
        'sendPasswordResetEmail: self-built resetUrl must remain unescaped'
      );

      // Verify "Ama & Kofi": escaped in HTML body, unescaped in subject and plain-text body
      await realEmail.sendOrderCancellation('u@test.com', {
        customerName: 'Ama & Kofi',
        orderNumber: 'ORD-A&K',
      });
      const cancelMail = sentMails[sentMails.length - 1];
      assert(cancelMail.html.includes('Hi Ama &amp; Kofi,'), 'HTML body must escape ampersands in customerName');
      assert(cancelMail.html.includes('ORD-A&amp;K'), 'HTML body must escape ampersands in orderNumber');
      assert.equal(
        cancelMail.subject,
        'Your order ORD-A&K has been cancelled',
        'email subject must not be HTML-escaped'
      );

      await realEmail.sendNewsletterEmail('u@test.com', {
        subject: 'Hello Ama & Kofi',
        bodyHtml: '<p>Welcome</p>',
        bodyText: 'Hi Ama & Kofi, thanks for subscribing!',
        unsubscribeUrl: 'https://store.example.com/unsub?t=1',
        storeName: 'Ama & Kofi Store',
      });
      const nlMail = sentMails[sentMails.length - 1];
      assert.equal(nlMail.subject, 'Hello Ama & Kofi', 'newsletter subject must not be HTML-escaped');
      assert(
        nlMail.text.includes('Hi Ama & Kofi, thanks for subscribing!'),
        'plain-text body must not be HTML-escaped'
      );
      assert(
        !nlMail.text.includes('&amp;'),
        'plain-text body must not contain HTML entities from escapeHtml'
      );
      assert(
        nlMail.html.includes('Ama &amp; Kofi Store'),
        'HTML footer must escape storeName'
      );
    } finally {
      if (origNodemailer) require.cache[nodemailerPath] = origNodemailer;
      else delete require.cache[nodemailerPath];
      if (origEmailService) require.cache[emailServicePath] = origEmailService;
      else delete require.cache[emailServicePath];
      if (origSmtpUser === undefined) delete process.env.SMTP_USER;
      else process.env.SMTP_USER = origSmtpUser;
      if (origSmtpPass === undefined) delete process.env.SMTP_PASS;
      else process.env.SMTP_PASS = origSmtpPass;
    }
  }

  console.log('ALL PAYSTACK PAYMENT FLOW TESTS PASSED');
}

runTests().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
