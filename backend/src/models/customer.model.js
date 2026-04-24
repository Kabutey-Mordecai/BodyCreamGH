const pool = require('../config/database');
const { v4: uuid } = require('uuid');

module.exports = {
  create: async (userId, phone) => {
    await pool.query(
      'INSERT INTO customers (id, user_id, phone) VALUES ($1, $2, $3)',
      [uuid(), userId, phone]
    );
  },

  findByUserId: async (userId) => {
    const { rows } = await pool.query('SELECT * FROM customers WHERE user_id=$1', [userId]);
    return rows[0] || null;
  },

  updateProfile: async (userId, { phone, address, city, region, postal_code }) => {
    await pool.query(
      `UPDATE customers SET phone=$1, address=$2, city=$3, region=$4, postal_code=$5, updated_at=NOW() WHERE user_id=$6`,
      [phone, address, city, region, postal_code, userId]
    );
  },

  // Call after payment succeeds to keep customer stats accurate
  updateTotals: async (userId, amount, client = pool) => {
    await client.query(
      'UPDATE customers SET total_spent = total_spent + $1, total_orders = total_orders + 1, updated_at=NOW() WHERE user_id=$2',
      [parseFloat(amount), userId]
    );
  },
};
