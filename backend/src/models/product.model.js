const pool = require('../config/database');
const { randomUUID: uuid } = require('crypto');

// Scalar correlated subquery — returns the most generous currently-active
// promotion for each product row as a JSON object, or NULL when none applies.
// Injected into SELECT lists so both findAll and findById return the same shape.
// Requires migration 020_promotions.sql to have been applied.
// Scalar subqueries for variant price range — injected into every SELECT list.
const VARIANT_SUBQS = `
  EXISTS(
    SELECT 1 FROM product_variants pv2
    WHERE pv2.product_id = p.id AND pv2.is_active = TRUE
  ) AS has_variants,
  (SELECT MIN(pv2.price) FROM product_variants pv2
   WHERE pv2.product_id = p.id AND pv2.is_active = TRUE) AS min_price,
  (SELECT MAX(pv2.price) FROM product_variants pv2
   WHERE pv2.product_id = p.id AND pv2.is_active = TRUE) AS max_price`;

const PROMO_SUBQ = `(
  SELECT json_build_object(
    'name',             promo.name,
    'discount_type',    promo.discount_type,
    'discount_value',   promo.discount_value,
    'ends_at',          promo.ends_at,
    'discounted_price', CASE
      WHEN promo.discount_type = 'percentage'
        THEN GREATEST(0, ROUND((p.price * (1 - promo.discount_value / 100.0))::numeric, 2))
      ELSE GREATEST(0, ROUND((p.price - promo.discount_value)::numeric, 2))
    END
  )
  FROM promotions promo
  WHERE promo.is_active = TRUE
    AND promo.starts_at <= NOW()
    AND promo.ends_at   >= NOW()
    AND (
      promo.applies_to = 'all'
      OR (promo.applies_to = 'category' AND promo.category = p.category)
      OR (promo.applies_to = 'product'  AND promo.product_id = p.id)
    )
  ORDER BY promo.discount_value DESC
  LIMIT 1
) AS active_promotion`;

module.exports = {
  findAll: async ({
    category, search, sort, limit, offset, includeInactive,
    min_price, max_price, in_stock,
  } = {}) => {
    const filterParams   = [];
    const filterClauses  = [];

    if (!includeInactive) {
      filterClauses.push('p.is_active = TRUE');
    }
    if (category) {
      filterParams.push(category);
      filterClauses.push(`p.category = $${filterParams.length}`);
    }
    if (search) {
      filterParams.push(`%${search}%`);
      filterClauses.push(`(p.name ILIKE $${filterParams.length} OR p.description ILIKE $${filterParams.length})`);
    }
    if (min_price !== undefined && min_price !== '') {
      filterParams.push(Number(min_price));
      filterClauses.push(`p.price >= $${filterParams.length}`);
    }
    if (max_price !== undefined && max_price !== '') {
      filterParams.push(Number(max_price));
      filterClauses.push(`p.price <= $${filterParams.length}`);
    }
    if (in_stock === 'true' || in_stock === true) {
      filterClauses.push('p.stock_quantity > 0');
    }

    const where = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';

    let orderBy = 'ORDER BY p.created_at DESC';
    if (sort === 'price_low')       orderBy = 'ORDER BY p.price ASC';
    else if (sort === 'price_high') orderBy = 'ORDER BY p.price DESC';
    else if (sort === 'name_asc')   orderBy = 'ORDER BY p.name ASC';
    else if (sort === 'name_desc')  orderBy = 'ORDER BY p.name DESC';
    else if (sort === 'top_rated')  orderBy = 'ORDER BY COALESCE(ROUND(AVG(r.rating)::numeric, 1), p.avg_rating, 0) DESC, p.id DESC';

    const selectSql = `
      SELECT p.*,
             ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
             COUNT(r.id)::int                 AS review_count,
             COALESCE(pi_primary.url, p.image_url) AS image_url,
             ${VARIANT_SUBQS},
             ${PROMO_SUBQ}
      FROM products p
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN LATERAL (
        SELECT url FROM product_images
        WHERE product_id = p.id AND is_primary = true
        LIMIT 1
      ) pi_primary ON true
      ${where}
      GROUP BY p.id, pi_primary.url
      ${orderBy}`;

    if (limit) {
      const lim = parseInt(limit)  || 20;
      const off = parseInt(offset) || 0;
      const paginatedSql = `${selectSql} LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`;
      const countSql     = `SELECT COUNT(*) FROM products p ${where}`;

      const [dataResult, countResult] = await Promise.all([
        pool.query(paginatedSql, [...filterParams, lim, off]),
        pool.query(countSql, filterParams),
      ]);
      return { products: dataResult.rows, total: parseInt(countResult.rows[0].count) };
    }

    const { rows } = await pool.query(selectSql, filterParams);
    return rows;
  },

  findById: async (id) => {
    const { rows } = await pool.query(
      `SELECT p.*,
              ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
              COUNT(r.id)::int                 AS review_count,
              COALESCE(pi_primary.url, p.image_url) AS image_url,
              ${VARIANT_SUBQS},
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
              ) AS images,
              ${PROMO_SUBQ}
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

  findRelated: async (productId) => {
    const { rows } = await pool.query(
      `SELECT p.*,
              ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
              COUNT(r.id)::int                 AS review_count,
              COALESCE(pi_primary.url, p.image_url) AS image_url,
              ${VARIANT_SUBQS},
              ${PROMO_SUBQ}
         FROM products p
         LEFT JOIN product_reviews r ON r.product_id = p.id
         LEFT JOIN LATERAL (
           SELECT url FROM product_images
           WHERE product_id = p.id AND is_primary = true
           LIMIT 1
         ) pi_primary ON true
        WHERE p.category = (SELECT category FROM products WHERE id = $1)
          AND p.id != $1
        GROUP BY p.id, pi_primary.url
        ORDER BY p.created_at DESC
        LIMIT 4`,
      [productId]
    );
    return rows;
  },

  create: async ({
    name, price, compare_at_price, cost, category, brand,
    description, image_url, stock_quantity, sku,
    ingredients, usage_instructions, is_active,
  }) => {
    const id = uuid();
    await pool.query(
      `INSERT INTO products
         (id, name, price, compare_at_price, cost, category, brand,
          description, image_url, stock_quantity, sku,
          ingredients, usage_instructions, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, name, price,
        compare_at_price != null && compare_at_price !== '' ? Number(compare_at_price) : null,
        cost, category, brand, description, image_url,
        stock_quantity || 0,
        (sku !== undefined && sku !== null && String(sku).trim() !== '') ? String(sku).trim() : null,
        ingredients, usage_instructions,
        is_active !== false,
      ]
    );
    return id;
  },

  update: async (id, {
    name, price, compare_at_price, cost, category, brand,
    description, image_url, stock_quantity, sku,
    ingredients, usage_instructions, is_active,
  }) => {
    const updateSku = sku !== undefined;
    const sanitizedSku = (sku !== undefined && sku !== null && String(sku).trim() !== '') ? String(sku).trim() : null;
    await pool.query(
      `UPDATE products
       SET name=$1, price=$2, compare_at_price=$3, cost=$4,
           category=$5, brand=$6, description=$7, image_url=$8,
           stock_quantity=$9, ingredients=$10, usage_instructions=$11,
           is_active=$12,
           sku = CASE WHEN $15::boolean THEN $13 ELSE sku END,
           updated_at=NOW()
       WHERE id=$14`,
      [
        name, price,
        compare_at_price != null && compare_at_price !== '' ? Number(compare_at_price) : null,
        cost, category, brand, description, image_url,
        stock_quantity, ingredients, usage_instructions,
        is_active !== false,
        sanitizedSku,
        id,
        updateSku,
      ]
    );
  },

  delete: async (id) => {
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
  },
};
