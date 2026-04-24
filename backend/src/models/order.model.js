const pool = require('../config/database');

module.exports = {
  findByCustomer: async (customerId) => {
    const { rows } = await pool.query(
      'SELECT id, order_number, total_amount, status, payment_status, created_at FROM orders WHERE customer_id=$1 ORDER BY created_at DESC',
      [customerId]
    );
    return rows;
  },

  // Pass customerId to scope to the logged-in user; omit for admin access
  findById: async (id, customerId = null) => {
    const params = [id];
    let query = `SELECT o.*, u.email as customer_email
                 FROM orders o JOIN users u ON o.customer_id = u.id
                 WHERE o.id = $1`;
    if (customerId) {
      params.push(customerId);
      query += ' AND o.customer_id = $2';
    }
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  findAll: async () => {
    const { rows } = await pool.query(
      `SELECT o.*, u.email, u.first_name, u.last_name
       FROM orders o JOIN users u ON o.customer_id = u.id
       ORDER BY o.created_at DESC`
    );
    return rows;
  },

  getItems: async (orderId) => {
    const { rows } = await pool.query(
      'SELECT oi.*, p.name, p.image_url FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1',
      [orderId]
    );
    return rows;
  },

  updateStatus: async (id, status) => {
    await pool.query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2', [status, id]);
  },

  markPaid: async (id, reference) => {
    await pool.query(
      `UPDATE orders SET status='paid', payment_status='paid', payment_reference=$1, updated_at=NOW() WHERE id=$2`,
      [reference, id]
    );
  },
};
