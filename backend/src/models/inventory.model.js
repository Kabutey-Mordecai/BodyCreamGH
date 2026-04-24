const pool = require('../config/database');
const { v4: uuid } = require('uuid');

module.exports = {
  adjustStock: async (productId, change, reason, notes = null, client = pool) => {
    await client.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at=NOW() WHERE id=$2',
      [change, productId]
    );
    await client.query(
      'INSERT INTO inventory_history (id, product_id, quantity_change, reason, notes) VALUES ($1,$2,$3,$4,$5)',
      [uuid(), productId, change, reason, notes]
    );
  },

  getHistory: async (productId = null, limit = 50) => {
    const params = [];
    let query = `
      SELECT ih.*, p.name as product_name, p.sku
      FROM inventory_history ih
      JOIN products p ON ih.product_id = p.id
    `;
    if (productId) {
      params.push(productId);
      query += ` WHERE ih.product_id = $${params.length}`;
    }
    params.push(parseInt(limit));
    query += ` ORDER BY ih.created_at DESC LIMIT $${params.length}`;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  getLowStock: async (threshold = 10) => {
    const { rows } = await pool.query(
      'SELECT id, name, sku, stock_quantity, price FROM products WHERE stock_quantity <= $1 ORDER BY stock_quantity ASC',
      [threshold]
    );
    return rows;
  },

  getAll: async () => {
    const { rows } = await pool.query(`
      SELECT id, name, sku, category, stock_quantity, price,
             CASE WHEN stock_quantity <= 10 THEN true ELSE false END as low_stock
      FROM products ORDER BY stock_quantity ASC
    `);
    return rows;
  },
};
