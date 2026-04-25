const pool = require('../config/database');
const { v4: uuid } = require('uuid');

module.exports = {
  findAll: async ({ category, search, sort } = {}) => {
    let query = `
      SELECT p.*,
             ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
             COUNT(r.id)::int                 AS review_count,
             COALESCE(pi_primary.url, p.image_url) AS image_url
      FROM products p
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN LATERAL (
        SELECT url
        FROM product_images
        WHERE product_id = p.id AND is_primary = true
        LIMIT 1
      ) pi_primary ON true
      WHERE 1=1`;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND p.category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    query += ' GROUP BY p.id, pi_primary.url';

    if (sort === 'price_low')        query += ' ORDER BY p.price ASC';
    else if (sort === 'price_high')  query += ' ORDER BY p.price DESC';
    else if (sort === 'name_asc')    query += ' ORDER BY p.name ASC';
    else if (sort === 'name_desc')   query += ' ORDER BY p.name DESC';
    else if (sort === 'top_rated')   query += ' ORDER BY avg_rating DESC NULLS LAST';
    else                             query += ' ORDER BY p.created_at DESC';

    const { rows } = await pool.query(query, params);
    return rows;
  },

  findById: async (id) => {
    const { rows } = await pool.query(
      `SELECT p.*,
              ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
              COUNT(r.id)::int                 AS review_count,
              COALESCE(pi_primary.url, p.image_url) AS image_url,
              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object(
                      'id',            pi.id,
                      'url',           pi.url,
                      'filename',      pi.filename,
                      'original_name', pi.original_name,
                      'mime_type',     pi.mime_type,
                      'size_bytes',    pi.size_bytes,
                      'sort_order',    pi.sort_order,
                      'is_primary',    pi.is_primary
                    ) ORDER BY pi.sort_order
                  )
                  FROM product_images pi
                  WHERE pi.product_id = p.id
                ),
                '[]'::json
              ) AS images
       FROM products p
       LEFT JOIN product_reviews r ON r.product_id = p.id
       LEFT JOIN LATERAL (
         SELECT url
         FROM product_images
         WHERE product_id = p.id AND is_primary = true
         LIMIT 1
       ) pi_primary ON true
       WHERE p.id = $1
       GROUP BY p.id, pi_primary.url`,
      [id]
    );
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
