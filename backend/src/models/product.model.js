const pool = require('../config/database');
const { v4: uuid } = require('uuid');

module.exports = {
  findAll: async ({ category, search, sort } = {}) => {
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    if (sort === 'price_low')   query += ' ORDER BY price ASC';
    else if (sort === 'price_high')  query += ' ORDER BY price DESC';
    else if (sort === 'name_asc')    query += ' ORDER BY name ASC';
    else if (sort === 'name_desc')   query += ' ORDER BY name DESC';
    else                             query += ' ORDER BY created_at DESC';

    const { rows } = await pool.query(query, params);
    return rows;
  },

  findById: async (id) => {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    return rows[0] || null;
  },

  create: async ({ name, price, cost, category, brand, description, image_url, stock_quantity, sku, ingredients, usage_instructions }) => {
    const id = uuid();
    await pool.query(
      `INSERT INTO products (id, name, price, cost, category, brand, description, image_url, stock_quantity, sku, ingredients, usage_instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, name, price, cost, category, brand, description, image_url, stock_quantity || 0, sku, ingredients, usage_instructions]
    );
    return id;
  },

  update: async (id, { name, price, cost, category, brand, description, image_url, stock_quantity, ingredients, usage_instructions }) => {
    await pool.query(
      `UPDATE products SET name=$1, price=$2, cost=$3, category=$4, brand=$5, description=$6,
       image_url=$7, stock_quantity=$8, ingredients=$9, usage_instructions=$10, updated_at=NOW()
       WHERE id=$11`,
      [name, price, cost, category, brand, description, image_url, stock_quantity, ingredients, usage_instructions, id]
    );
  },

  delete: async (id) => {
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
  },
};
