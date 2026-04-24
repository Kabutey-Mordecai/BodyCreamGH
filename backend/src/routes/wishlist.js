const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth');
const wc = require('../controllers/wishlist.controller');

router.use(verifyToken);

router.get('/',              wc.getWishlist);
router.get('/ids',           wc.getWishlistIds);
router.get('/:productId',    wc.checkWishlist);
router.post('/:productId',   wc.addToWishlist);
router.delete('/:productId', wc.removeFromWishlist);

module.exports = router;
