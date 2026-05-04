const { v4: uuid, validate: isValidUuid } = require('uuid');
const pool         = require('../config/database');
const logger       = require('../utils/logger');

const MAX_VALIDATE_ITEMS = 50;

// Returns caller's current cart. Uses variant price/stock when variant_id is present.
async function fetchUserCart(userId) {
  const { rows } = await pool.query(
    `SELECT ci.id, ci.quantity, ci.variant_id, ci.variant_label,
            p.id AS product_id, p.name,
            COALESCE(pv.image_url, p.image_url) AS image_url,
            COALESCE(pv.price,          p.price)          AS price,
            COALESCE(pv.stock_quantity, p.stock_quantity)  AS stock_quantity
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.customer_id = $1
      ORDER BY ci.added_at`,
    [userId]
  );
  return rows;
}

const getCart = async (req, res) => {
  try {
    res.json(await fetchUserCart(req.user.id));
  } catch (error) {
    logger.error('Error fetching cart', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
};

const addItem = async (req, res) => {
  const client = await pool.connect();
  try {
    const { product_id, quantity = 1, variant_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id is required' });

    await client.query('BEGIN');

    // Lock the product row
    const { rows: productRows } = await client.query(
      'SELECT id, stock_quantity FROM products WHERE id = $1 FOR UPDATE',
      [product_id]
    );
    if (!productRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    let stockToCheck;
    let variantLabel = null;

    if (variant_id) {
      // Lock and validate the specific variant
      const { rows: vRows } = await client.query(
        'SELECT id, stock_quantity, is_active FROM product_variants WHERE id = $1 AND product_id = $2 FOR UPDATE',
        [variant_id, product_id]
      );
      if (!vRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Variant not found' });
      }
      if (!vRows[0].is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Variant is not available' });
      }
      stockToCheck = vRows[0].stock_quantity;

      // Build the label ("100ml / Lavender") for cart display
      const { rows: lRows } = await client.query(
        `SELECT string_agg(ov.value, ' / ' ORDER BY ot.position) AS label
           FROM product_variant_option_values pvov
           JOIN product_option_values ov ON pvov.option_value_id = ov.id
           JOIN product_option_types  ot ON ov.option_type_id = ot.id
          WHERE pvov.variant_id = $1`,
        [variant_id]
      );
      variantLabel = lRows[0]?.label || null;
    } else {
      // If the product has active variants, a variant_id is required
      const { rows: hvRows } = await client.query(
        'SELECT 1 FROM product_variants WHERE product_id = $1 AND is_active = TRUE LIMIT 1',
        [product_id]
      );
      if (hvRows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Please select a variant' });
      }
      stockToCheck = productRows[0].stock_quantity;
    }

    // Check existing cart quantity for this exact product + variant combination
    const { rows: existing } = await client.query(
      `SELECT id, quantity FROM cart_items
        WHERE customer_id = $1
          AND product_id  = $2
          AND (variant_id = $3 OR (variant_id IS NULL AND $3::uuid IS NULL))`,
      [req.user.id, product_id, variant_id || null]
    );

    const currentQty  = existing.length ? existing[0].quantity : 0;
    const newTotalQty = currentQty + quantity;

    if (newTotalQty > stockToCheck) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    if (existing.length) {
      await client.query(
        'UPDATE cart_items SET quantity = $1 WHERE id = $2',
        [newTotalQty, existing[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO cart_items (id, customer_id, product_id, quantity, variant_id, variant_label)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuid(), req.user.id, product_id, quantity, variant_id || null, variantLabel]
      );
    }

    await client.query('COMMIT');
    res.json({ cart: await fetchUserCart(req.user.id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error adding to cart', { err: error.message });
    res.status(500).json({ error: 'Failed to add to cart' });
  } finally {
    client.release();
  }
};

const updateItem = async (req, res) => {
  const client = await pool.connect();
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

    await client.query('BEGIN');

    // Use variant stock when present, fall back to product stock
    const { rows } = await client.query(
      `SELECT ci.id,
              COALESCE(pv.stock_quantity, p.stock_quantity) AS stock_quantity
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN product_variants pv ON ci.variant_id = pv.id
        WHERE ci.id = $1 AND ci.customer_id = $2
        FOR UPDATE OF ci`,
      [req.params.cartItemId, req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cart item not found' });
    }

    if (quantity > rows[0].stock_quantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    await client.query(
      'UPDATE cart_items SET quantity = $1 WHERE id = $2 AND customer_id = $3',
      [quantity, req.params.cartItemId, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ cart: await fetchUserCart(req.user.id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error updating cart item', { err: error.message });
    res.status(500).json({ error: 'Failed to update cart item' });
  } finally {
    client.release();
  }
};

const removeItem = async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM cart_items WHERE id=$1 AND customer_id=$2',
      [req.params.cartItemId, req.user.id]
    );
    res.json({ cart: await fetchUserCart(req.user.id) });
  } catch (error) {
    logger.error('Error removing cart item', { err: error.message });
    res.status(500).json({ error: 'Failed to remove item' });
  }
};

const clearCart = async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE customer_id=$1', [req.user.id]);
    res.json({ cart: [] });
  } catch (error) {
    logger.error('Error clearing cart', { err: error.message });
    res.status(500).json({ error: 'Failed to clear cart' });
  }
};

const validateGuestCart = async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    if (items.length > MAX_VALIDATE_ITEMS) {
      return res.status(400).json({ error: `Cart cannot exceed ${MAX_VALIDATE_ITEMS} items` });
    }

    for (const item of items) {
      if (!item.product_id || !isValidUuid(item.product_id)) {
        return res.status(400).json({ error: 'Each item must have a valid product_id (UUID)' });
      }
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ error: 'Each item quantity must be a positive integer' });
      }
    }

    // Normalise: merge duplicate product_id + variant_id combinations
    const merged = Object.values(
      items.reduce((acc, item) => {
        const key = `${item.product_id}:${item.variant_id || ''}`;
        if (acc[key]) {
          acc[key] = { ...acc[key], quantity: acc[key].quantity + Number(item.quantity) };
        } else {
          acc[key] = { product_id: item.product_id, variant_id: item.variant_id || null, quantity: Number(item.quantity) };
        }
        return acc;
      }, {})
    );

    const productIds = [...new Set(merged.map(i => i.product_id))];
    const { rows: products } = await pool.query(
      `SELECT id, name, price, stock_quantity FROM products WHERE id = ANY($1)`,
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // Fetch variant stock for items with variant_id
    const variantIds = merged.map(i => i.variant_id).filter(Boolean);
    let variantMap = {};
    if (variantIds.length > 0) {
      const { rows: variants } = await pool.query(
        `SELECT id, price, stock_quantity FROM product_variants WHERE id = ANY($1)`,
        [variantIds]
      );
      variantMap = Object.fromEntries(variants.map(v => [v.id, v]));
    }

    let valid = true;
    const result = merged.map(item => {
      const p = productMap[item.product_id];
      if (!p) {
        valid = false;
        return { product_id: item.product_id, quantity: item.quantity, available: false, error: 'Product no longer available' };
      }

      const effectiveStock = item.variant_id && variantMap[item.variant_id]
        ? variantMap[item.variant_id].stock_quantity
        : p.stock_quantity;
      const effectivePrice = item.variant_id && variantMap[item.variant_id]
        ? variantMap[item.variant_id].price
        : p.price;

      if (item.quantity > effectiveStock) {
        valid = false;
        return {
          product_id: item.product_id, variant_id: item.variant_id,
          name: p.name, quantity: item.quantity, quantity_available: effectiveStock,
          price: effectivePrice, available: false,
          error: effectiveStock === 0 ? 'Out of stock' : `Only ${effectiveStock} in stock`,
        };
      }

      return {
        product_id: item.product_id, variant_id: item.variant_id,
        name: p.name, quantity: item.quantity, price: effectivePrice,
        subtotal: (parseFloat(effectivePrice) * item.quantity).toFixed(2), available: true,
      };
    });

    res.json({ valid, items: result });
  } catch (error) {
    logger.error('validateGuestCart error', { err: error.message });
    res.status(500).json({ error: 'Failed to validate cart' });
  }
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart, validateGuestCart };
