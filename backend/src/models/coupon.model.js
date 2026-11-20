const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');

const CouponModel = {
  getWelcomeCouponConfig: async (db = pool) => {
    try {
      const { rows } = await db.query(
        "SELECT key, value FROM site_settings WHERE key IN ('newsletter_discount_text', 'newsletter_coupon_code')"
      );
      const map = Object.fromEntries(
        rows.map(r => [
          r.key,
          typeof r.value === 'string' ? r.value.replace(/^"|"$/g, '').trim() : r.value,
        ])
      );
      const code = (map.newsletter_coupon_code || 'WELCOME10').toString().toUpperCase().trim();
      const discountText = (map.newsletter_discount_text || '10% off').toString().trim();
      const pctMatch = discountText.match(/(\d+(?:\.\d+)?)\s*%/);
      const percent = pctMatch ? Math.min(100, Math.max(1, parseFloat(pctMatch[1]))) : 10;
      return { code, discountText, percent };
    } catch {
      return { code: 'WELCOME10', discountText: '10% off', percent: 10 };
    }
  },

  ensureWelcomeCouponExists: async (db = pool) => {
    const cfg = await CouponModel.getWelcomeCouponConfig(db);
    const existing = await db.query(
      'SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)',
      [cfg.code]
    );
    if (existing.rows.length > 0) {
      return { coupon: existing.rows[0], config: cfg };
    }
    const { rows } = await db.query(
      `INSERT INTO coupons (id, code, type, value, min_order, max_uses, expires_at, active)
       VALUES ($1, UPPER($2), 'percentage', $3, 0, NULL, NULL, true)
       ON CONFLICT (code) DO UPDATE SET active = coupons.active
       RETURNING *`,
      [uuid(), cfg.code, cfg.percent]
    );
    return { coupon: rows[0], config: cfg };
  },

  hasCustomerPlacedOrder: async ({ customerId = null, email = null } = {}, db = pool) => {
    const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
    const cleanCustomerId = customerId ? String(customerId).trim() : null;
    if (!cleanCustomerId && !cleanEmail) return false;

    const { rows } = await db.query(
      `SELECT COUNT(*) AS cnt
         FROM orders o
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE o.status != 'cancelled'
          AND (
            ($1::uuid IS NOT NULL AND o.customer_id = $1::uuid)
            OR ($2::text IS NOT NULL AND (
              LOWER(o.guest_email) = $2
              OR LOWER(u.email) = $2
            ))
          )`,
      [cleanCustomerId || null, cleanEmail || null]
    );
    return parseInt(rows[0]?.cnt || '0', 10) > 0;
  },

  findAll: async () => {
    const { rows } = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
    return rows;
  },

  findByCode: async (code) => {
    const { rows } = await pool.query(
      'SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)',
      [code]
    );
    return rows[0] || null;
  },

  create: async ({ code, type, value, min_order, max_uses, expires_at }) => {
    const { rows } = await pool.query(
      `INSERT INTO coupons (id, code, type, value, min_order, max_uses, expires_at)
       VALUES ($1, UPPER($2), $3, $4, $5, $6, $7)
       RETURNING *`,
      [uuid(), code, type, value, min_order || 0, max_uses || null, expires_at || null]
    );
    return rows[0];
  },

  deactivate: async (id) => {
    await pool.query(
      'UPDATE coupons SET active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
  },

  remove: async (id) => {
    await pool.query('DELETE FROM coupons WHERE id = $1', [id]);
  },

  update: async (id, { code, type, value, min_order, max_uses, expires_at, active }) => {
    const { rows } = await pool.query(
      `UPDATE coupons
          SET code       = UPPER($1),
              type       = $2,
              value      = $3,
              min_order  = $4,
              max_uses   = $5,
              expires_at = $6,
              active     = $7,
              updated_at = NOW()
        WHERE id = $8
        RETURNING *`,
      [code, type, value, min_order ?? 0, max_uses ?? null, expires_at ?? null, active !== false, id]
    );
    return rows[0] || null;
  },

  incrementUses: async (id) => {
    await pool.query(
      'UPDATE coupons SET uses_count = uses_count + 1, updated_at = NOW() WHERE id = $1',
      [id]
    );
  },

  // Read-only validation — safe for pre-flight coupon checks (e.g., the /coupons/validate
  // endpoint called by the frontend before checkout). Does NOT lock the row or increment uses.
  validate: async (code, orderTotal, { customerId = null, email = null } = {}) => {
    const welcomeCfg = await CouponModel.getWelcomeCouponConfig(pool);
    const isWelcomeCode = String(code || '').trim().toUpperCase() === welcomeCfg.code;

    if (isWelcomeCode) {
      await CouponModel.ensureWelcomeCouponExists(pool);
      const hasPriorOrder = await CouponModel.hasCustomerPlacedOrder(
        { customerId, email },
        pool
      );
      if (hasPriorOrder) {
        return {
          valid: false,
          error: 'This welcome discount is valid on your first order only.',
        };
      }
    }

    const coupon = await CouponModel.findByCode(code);
    if (!coupon)         return { valid: false, error: 'Invalid coupon code.' };
    if (!coupon.active)  return { valid: false, error: 'This coupon is no longer active.' };

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { valid: false, error: 'This coupon has expired.' };
    }
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
      return { valid: false, error: 'This coupon has reached its usage limit.' };
    }
    if (parseFloat(orderTotal) < parseFloat(coupon.min_order)) {
      return {
        valid: false,
        error: `A minimum order of GHS ${parseFloat(coupon.min_order).toFixed(2)} is required for this coupon.`,
      };
    }

    let discountAmount;
    if (coupon.type === 'percentage') {
      discountAmount = parseFloat(orderTotal) * (parseFloat(coupon.value) / 100);
    } else {
      discountAmount = Math.min(parseFloat(coupon.value), parseFloat(orderTotal));
    }
    discountAmount = Math.round(discountAmount * 100) / 100;

    return { valid: true, coupon, discountAmount, isFirstOrderWelcome: isWelcomeCode };
  },

  // Transactional validation: locks the coupon row FOR UPDATE so concurrent checkouts
  // cannot both pass the max_uses check, then increments the counter inside the same
  // transaction. Must be called with an active pg client inside a BEGIN block.
  validateAndLock: async (code, orderTotal, client, { customerId = null, email = null } = {}) => {
    const welcomeCfg = await CouponModel.getWelcomeCouponConfig(client);
    const isWelcomeCode = String(code || '').trim().toUpperCase() === welcomeCfg.code;

    if (isWelcomeCode) {
      await CouponModel.ensureWelcomeCouponExists(client);
      const hasPriorOrder = await CouponModel.hasCustomerPlacedOrder(
        { customerId, email },
        client
      );
      if (hasPriorOrder) {
        return {
          valid: false,
          error: 'This welcome discount is valid on your first order only.',
        };
      }
    }

    const { rows } = await client.query(
      'SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) FOR UPDATE',
      [code]
    );
    const coupon = rows[0];
    if (!coupon)        return { valid: false, error: 'Invalid coupon code.' };
    if (!coupon.active) return { valid: false, error: 'This coupon is no longer active.' };

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { valid: false, error: 'This coupon has expired.' };
    }
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
      return { valid: false, error: 'This coupon has reached its usage limit.' };
    }
    if (parseFloat(orderTotal) < parseFloat(coupon.min_order)) {
      return {
        valid: false,
        error: `A minimum order of GHS ${parseFloat(coupon.min_order).toFixed(2)} is required for this coupon.`,
      };
    }

    let discountAmount;
    if (coupon.type === 'percentage') {
      discountAmount = parseFloat(orderTotal) * (parseFloat(coupon.value) / 100);
    } else {
      discountAmount = Math.min(parseFloat(coupon.value), parseFloat(orderTotal));
    }
    discountAmount = Math.round(discountAmount * 100) / 100;

    // Increment atomically inside the caller's transaction
    await client.query(
      'UPDATE coupons SET uses_count = uses_count + 1, updated_at = NOW() WHERE id = $1',
      [coupon.id]
    );

    return { valid: true, coupon, discountAmount, isFirstOrderWelcome: isWelcomeCode };
  },
};

module.exports = CouponModel;
