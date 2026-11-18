'use strict';

const pool = require('../config/database');
const { randomUUID: uuid } = require('crypto');

module.exports = {
  // Full variant structure for a product — used by admin editor and customer PDP.
  // activeOnly=true filters to is_active=TRUE variants (customer view).
  findByProduct: async (productId, { activeOnly = false } = {}) => {
    const { rows: typeRows } = await pool.query(
      `SELECT t.id, t.name, t.position,
              COALESCE(
                json_agg(
                  json_build_object('id', v.id, 'value', v.value, 'position', v.position)
                  ORDER BY v.position
                ) FILTER (WHERE v.id IS NOT NULL),
                '[]'::json
              ) AS values
         FROM product_option_types t
         LEFT JOIN product_option_values v ON v.option_type_id = t.id
        WHERE t.product_id = $1
        GROUP BY t.id, t.name, t.position
        ORDER BY t.position, t.created_at`,
      [productId]
    );

    const activeClause = activeOnly ? 'AND pv.is_active = TRUE' : '';
    const { rows: variantRows } = await pool.query(
      `SELECT pv.id, pv.sku, pv.price, pv.compare_at_price,
              pv.stock_quantity, pv.image_url, pv.is_active, pv.position,
              COALESCE(
                json_agg(
                  json_build_object(
                    'option_type_id',   ot.id,
                    'option_value_id',  ov.id,
                    'type_name',        ot.name,
                    'value',            ov.value
                  ) ORDER BY ot.position
                ) FILTER (WHERE ov.id IS NOT NULL),
                '[]'::json
              ) AS option_values
         FROM product_variants pv
         LEFT JOIN product_variant_option_values pvov ON pvov.variant_id = pv.id
         LEFT JOIN product_option_values ov ON pvov.option_value_id = ov.id
         LEFT JOIN product_option_types  ot ON ov.option_type_id = ot.id
        WHERE pv.product_id = $1 ${activeClause}
        GROUP BY pv.id
        ORDER BY pv.position, pv.created_at`,
      [productId]
    );

    return { option_types: typeRows, variants: variantRows };
  },

  // Single variant with label built from its option values ("100ml / Lavender").
  findById: async (variantId, client) => {
    const db = client || pool;
    const { rows } = await db.query(
      `SELECT pv.*,
              string_agg(ov.value, ' / ' ORDER BY ot.position) AS variant_label
         FROM product_variants pv
         LEFT JOIN product_variant_option_values pvov ON pvov.variant_id = pv.id
         LEFT JOIN product_option_values ov ON pvov.option_value_id = ov.id
         LEFT JOIN product_option_types  ot ON ov.option_type_id = ot.id
        WHERE pv.id = $1
        GROUP BY pv.id`,
      [variantId]
    );
    return rows[0] || null;
  },

  create: async (productId, { sku, price, compare_at_price, stock_quantity, image_url, option_value_ids = [], position = 0 }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const variantId = uuid();
      await client.query(
        `INSERT INTO product_variants
           (id, product_id, sku, price, compare_at_price, stock_quantity, image_url, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          variantId, productId,
          sku || null,
          Number(price),
          compare_at_price != null && compare_at_price !== '' ? Number(compare_at_price) : null,
          Number(stock_quantity) || 0,
          image_url || null,
          position,
        ]
      );
      for (const valueId of option_value_ids) {
        await client.query(
          'INSERT INTO product_variant_option_values (variant_id, option_value_id) VALUES ($1,$2)',
          [variantId, valueId]
        );
      }
      await client.query('COMMIT');
      return variantId;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  update: async (variantId, { sku, price, compare_at_price, stock_quantity, image_url, is_active, position, option_value_ids }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE product_variants
            SET sku=$1, price=$2, compare_at_price=$3, stock_quantity=$4,
                image_url=$5, is_active=$6, position=$7, updated_at=NOW()
          WHERE id=$8`,
        [
          sku || null,
          Number(price),
          compare_at_price != null && compare_at_price !== '' ? Number(compare_at_price) : null,
          Number(stock_quantity) || 0,
          image_url || null,
          is_active !== false,
          position ?? 0,
          variantId,
        ]
      );
      if (Array.isArray(option_value_ids)) {
        await client.query('DELETE FROM product_variant_option_values WHERE variant_id = $1', [variantId]);
        for (const valueId of option_value_ids) {
          await client.query(
            'INSERT INTO product_variant_option_values (variant_id, option_value_id) VALUES ($1,$2)',
            [variantId, valueId]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  // Soft delete — out-of-stock variants are shown but disabled, never hidden.
  delete: async (variantId) => {
    await pool.query(
      'UPDATE product_variants SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [variantId]
    );
  },

  // Increment or decrement variant stock. Throws if result would go below zero.
  // Accepts an optional pg client for use inside an existing transaction.
  adjustStock: async (variantId, delta, client) => {
    const db = client || pool;
    const { rows } = await db.query(
      `UPDATE product_variants
          SET stock_quantity = stock_quantity + $1,
              updated_at = NOW()
        WHERE id = $2
          AND stock_quantity + $1 >= 0
        RETURNING stock_quantity`,
      [delta, variantId]
    );
    if (!rows.length) throw new Error(`Insufficient variant stock for variant ${variantId}`);
    return rows[0].stock_quantity;
  },

  createOptionType: async (productId, name, position = 0) => {
    const id = uuid();
    await pool.query(
      'INSERT INTO product_option_types (id, product_id, name, position) VALUES ($1,$2,$3,$4)',
      [id, productId, name, position]
    );
    return id;
  },

  createOptionValue: async (optionTypeId, productId, value, position = 0) => {
    const id = uuid();
    await pool.query(
      'INSERT INTO product_option_values (id, option_type_id, product_id, value, position) VALUES ($1,$2,$3,$4,$5)',
      [id, optionTypeId, productId, value, position]
    );
    return id;
  },

  deleteOptionType: async (optionTypeId) => {
    await pool.query('DELETE FROM product_option_types WHERE id = $1', [optionTypeId]);
  },

  deleteOptionValue: async (optionValueId) => {
    await pool.query('DELETE FROM product_option_values WHERE id = $1', [optionValueId]);
  },
};
