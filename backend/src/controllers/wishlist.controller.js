const WishlistModel = require('../models/wishlist.model');

exports.getWishlist = async (req, res) => {
  try {
    const items = await WishlistModel.findByUser(req.user.id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load wishlist' });
  }
};

exports.addToWishlist = async (req, res) => {
  const { productId } = req.params;
  try {
    const item = await WishlistModel.add(req.user.id, productId);
    res.status(201).json({ product_id: productId, added: !!item });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add to wishlist' });
  }
};

exports.removeFromWishlist = async (req, res) => {
  const { productId } = req.params;
  try {
    await WishlistModel.remove(req.user.id, productId);
    res.json({ product_id: productId, removed: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from wishlist' });
  }
};

exports.checkWishlist = async (req, res) => {
  const { productId } = req.params;
  try {
    const saved = await WishlistModel.exists(req.user.id, productId);
    res.json({ saved });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check wishlist' });
  }
};

// Returns a flat array of product_ids the user has wishlisted — used by
// the storefront to highlight heart buttons without an extra call per product.
exports.getWishlistIds = async (req, res) => {
  try {
    const ids = await WishlistModel.getProductIds(req.user.id);
    res.json(ids);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load wishlist IDs' });
  }
};
