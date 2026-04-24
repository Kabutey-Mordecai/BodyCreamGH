const pool = require('../config/database');
const { v4: uuid } = require('uuid');

module.exports = {
  create: async ({ orderId, deliveryPartner, trackingNumber, estimatedDelivery, driverPhone }) => {
    const id = uuid();
    await pool.query(
      `INSERT INTO deliveries
         (id, order_id, status, delivery_partner, tracking_number, estimated_delivery, driver_phone)
       VALUES ($1,$2,'pending',$3,$4,$5,$6)`,
      [id, orderId, deliveryPartner, trackingNumber, estimatedDelivery, driverPhone]
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

  update: async (id, { status, trackingNumber, estimatedDelivery, actualDeliveryDate, driverPhone }) => {
    await pool.query(
      `UPDATE deliveries
       SET status=$1, tracking_number=COALESCE($2, tracking_number),
           estimated_delivery=COALESCE($3, estimated_delivery),
           actual_delivery_date=COALESCE($4, actual_delivery_date),
           driver_phone=COALESCE($5, driver_phone),
           updated_at=NOW()
       WHERE id=$6`,
      [status, trackingNumber, estimatedDelivery, actualDeliveryDate, driverPhone, id]
    );
  },
};
