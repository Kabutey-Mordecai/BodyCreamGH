const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { getCart, addItem, updateItem, removeItem, clearCart, validateGuestCart } = require('../controllers/cart.controller');

const router = express.Router();

// Public — no auth required; must be declared before /:cartItemId parametric routes
router.post('/validate-guest', validateGuestCart);

router.get('/', verifyToken, getCart);
router.post('/add', verifyToken, addItem);
router.patch('/:cartItemId', verifyToken, updateItem);
router.delete('/:cartItemId', verifyToken, removeItem);
router.delete('/', verifyToken, clearCart);

module.exports = router;
