const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateProduct } = require('../middleware/validation');
const { getProducts, getProductById, createProduct, updateProduct, deleteProduct } = require('../controllers/product.controller');

const router = express.Router();

router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', verifyToken, requireAdmin, validateProduct, createProduct);
router.put('/:id', verifyToken, requireAdmin, validateProduct, updateProduct);
router.delete('/:id', verifyToken, requireAdmin, deleteProduct);

module.exports = router;
