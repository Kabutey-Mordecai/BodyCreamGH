const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { getCart, addItem, updateItem, removeItem, clearCart } = require('../controllers/cart.controller');

const router = express.Router();

router.get('/', verifyToken, getCart);
router.post('/add', verifyToken, addItem);
router.patch('/:cartItemId', verifyToken, updateItem);
router.delete('/:cartItemId', verifyToken, removeItem);
router.delete('/', verifyToken, clearCart);

module.exports = router;
