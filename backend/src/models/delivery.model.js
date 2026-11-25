const pool = require('../config/database');
const { randomUUID: uuid } = require('crypto');

module.exports = {
  create: async ({ orderId, deliveryPartner, trackingNumber, estimatedDelivery, driverPhone, zoneCode }) => {
    const id = uuid();
    await pool.query(
      `INSERT INTO deliveries
         (id, order_id, status, delivery_partner, tracking_number, estimated_delivery, driver_phone, zone_code)
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7)`,
      [id, orderId, deliveryPartner, trackingNumber, estimatedDelivery, driverPhone, zoneCode || 'GHA']
    );
    return id;
  },

  findByOrderId: async (orderId) => {
    const { rows } = await pool.query(
      'SELECT * FROM deliveries WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orderId]
    );
    return rows[0] || null;
  },

  update: async (id, { status, trackingNumber, estimatedDelivery, actualDeliveryDate, driverPhone, deliveryPartner }) => {
    const updatePhone = driverPhone !== undefined;
    await pool.query(
      `UPDATE deliveries
       SET status               = COALESCE($1, status),
           tracking_number      = COALESCE($2, tracking_number),
           estimated_delivery   = COALESCE($3, estimated_delivery),
           actual_delivery_date = COALESCE($4, actual_delivery_date),
           driver_phone         = CASE WHEN $8::boolean THEN $5 ELSE driver_phone END,
           delivery_partner     = COALESCE($6, delivery_partner),
           updated_at           = NOW()
       WHERE id = $7`,
      [
        status             ?? null,
        trackingNumber     ?? null,
        estimatedDelivery  ?? null,
        actualDeliveryDate ?? null,
        driverPhone        ?? null,
        deliveryPartner    ?? null,
        id,
        updatePhone,
      ]
    );
  },
};
