const { v4: uuid, validate: isValidUuid } = require('uuid');
const pool         = require('../config/database');
const logger       = require('../utils/logger');

const MAX_VALIDATE_ITEMS = 50;

// Returns caller's current cart — used by all mutating endpoints after commit
async function fetchUserCart(userId) {
  const { rows } = await pool.query(
    `SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price, p.image_url, p.stock_quantity
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
      WHERE ci.customer_id = $1
      ORDER BY ci.added_at`,
    [userId]
  );
  return rows;
}

const getCart = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price, p.image_url, p.stock_quantity
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
        WHERE ci.customer_id = $1
        ORDER BY ci.added_at`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching cart', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
};

const addItem = async (req, res) => {
  const client = await pool.connect();
  try {
    const { product_id, quantity = 1 } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id is required' });

    await client.query('BEGIN');

    // Lock the product row — serialises concurrent addItem calls for the same product
    const { rows: productRows } = await client.query(
      'SELECT id, stock_quantity FROM products WHERE id = $1 FOR UPDATE',
      [product_id]
    );
    if (!productRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    // Read existing cart quantity inside the same transaction
    const { rows: existing } = await client.query(
      'SELECT id, quantity FROM cart_items WHERE customer_id = $1 AND product_id = $2',
      [req.user.id, product_id]
    );

    const currentQty  = existing.length ? existing[0].quantity : 0;
    const newTotalQty = currentQty + quantity;

    if (newTotalQty > productRows[0].stock_quantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    if (existing.length) {
      await client.query(
        'UPDATE cart_items SET quantity = $1 WHERE customer_id = $2 AND product_id = $3',
        [newTotalQty, req.user.id, product_id]
      );
    } else {
      await client.query(
        'INSERT INTO cart_items (id, customer_id, product_id, quantity) VALUES ($1,$2,$3,$4)',
        [uuid(), req.user.id, product_id, quantity]
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

    // Single query: verify ownership, fetch live stock, lock both rows explicitly
    const { rows } = await client.query(
      `SELECT ci.id, p.stock_quantity
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
        WHERE ci.id = $1 AND ci.customer_id = $2
        FOR UPDATE OF ci, p`,
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

    // ── Shape validation ───────────────────────────────────────────────────
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

    // ── Normalise: merge duplicate product_ids by summing quantities ───────
    const merged = Object.values(
      items.reduce((acc, item) => {
        const id = item.product_id;
        if (acc[id]) {
          acc[id] = { product_id: id, quantity: acc[id].quantity + Number(item.quantity) };
        } else {
          acc[id] = { product_id: id, quantity: Number(item.quantity) };
        }
        return acc;
      }, {})
    );

    // ── Direct DB read — intentionally bypasses NodeCache ──────────────────
    const productIds = merged.map(i => i.product_id);
    const { rows: products } = await pool.query(
      `SELECT id, name, price, stock_quantity
         FROM products
        WHERE id = ANY($1)`,
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // ── Build per-item result ──────────────────────────────────────────────
    let valid = true;
    const result = merged.map(item => {
      const p = productMap[item.product_id];

      if (!p) {
        valid = false;
        return {
          product_id: item.product_id,
          name:       null,
          quantity:   item.quantity,
          available:  false,
          error:      'Product no longer available',
        };
      }

      if (item.quantity > p.stock_quantity) {
        valid = false;
        return {
          product_id:         item.product_id,
          name:               p.name,
          quantity:           item.quantity,
          quantity_available: p.stock_quantity,
          price:              p.price,
          available:          false,
          error: p.stock_quantity === 0
            ? 'Out of stock'
            : `Only ${p.stock_quantity} in stock`,
        };
      }

      return {
        product_id: item.product_id,
        name:       p.name,
        quantity:   item.quantity,
        price:      p.price,
        subtotal:   (parseFloat(p.price) * item.quantity).toFixed(2),
        available:  true,
      };
    });

    res.json({ valid, items: result });
  } catch (error) {
    logger.error('validateGuestCart error', { err: error.message });
    res.status(500).json({ error: 'Failed to validate cart' });
  }
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart, validateGuestCart };
