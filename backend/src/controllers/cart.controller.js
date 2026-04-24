const { v4: uuid } = require('uuid');
const pool = require('../config/database');

const getCart = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ci.id, ci.quantity, p.id as product_id, p.name, p.price, p.image_url, p.stock_quantity
       FROM cart_items ci JOIN products p ON ci.product_id = p.id
       WHERE ci.customer_id = $1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
};

const addItem = async (req, res) => {
  try {
    const { product_id, quantity = 1 } = req.body;

    if (!product_id) return res.status(400).json({ error: 'product_id is required' });

    const { rows } = await pool.query('SELECT id, stock_quantity FROM products WHERE id = $1', [product_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    if (rows[0].stock_quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });

    const existing = await pool.query(
      'SELECT id FROM cart_items WHERE customer_id = $1 AND product_id = $2',
      [req.user.id, product_id]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE cart_items SET quantity = quantity + $1 WHERE customer_id = $2 AND product_id = $3',
        [quantity, req.user.id, product_id]
      );
    } else {
      await pool.query(
        'INSERT INTO cart_items (id, customer_id, product_id, quantity) VALUES ($1,$2,$3,$4)',
        [uuid(), req.user.id, product_id, quantity]
      );
    }

    res.json({ message: 'Item added to cart' });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ error: 'Failed to add to cart' });
  }
};

const updateItem = async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

    await pool.query(
      'UPDATE cart_items SET quantity=$1 WHERE id=$2 AND customer_id=$3',
      [quantity, req.params.cartItemId, req.user.id]
    );
    res.json({ message: 'Cart item updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update cart item' });
  }
};

const removeItem = async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM cart_items WHERE id=$1 AND customer_id=$2',
      [req.params.cartItemId, req.user.id]
    );
    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove item' });
  }
};

const clearCart = async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE customer_id=$1', [req.user.id]);
    res.json({ message: 'Cart cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cart' });
  }
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
