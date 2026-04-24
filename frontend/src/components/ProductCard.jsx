import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import StarRating from './StarRating';
import './ProductCard.css';

const PLACEHOLDER_IMG = 'https://placehold.co/400x400?text=No+Image';

// Product is "New" if created within the last 30 days
const isNewProduct = (createdAt) => {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
};

export default function ProductCard({ product }) {
  const { addItem }       = useCart();
  const { user }          = useAuth();
  const { savedIds, toggle } = useWishlist();
  const navigate          = useNavigate();
  const [adding, setAdding] = useState(false);
  const [added, setAdded]   = useState(false);

  const isSaved = savedIds.has(product.id);

  const handleWishlist = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { navigate('/login'); return; }
    await toggle(product.id);
  };

  const isOutOfStock = product.stock_quantity === 0;
  const isNew        = isNewProduct(product.created_at);

  const handleAddToCart = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || adding) return;

    try {
      setAdding(true);
      await addItem(product.id, 1, product);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Link to={`/products/${product.id}`} className="product-card">

      {/* ── Image ───────────────────────────── */}
      <div className="product-card-img-wrap">
        <img
          src={product.image_url || PLACEHOLDER_IMG}
          alt={product.name}
          loading="lazy"
        />

        {/* Wishlist heart — top-right corner */}
        <button
          className={`product-card-wishlist ${isSaved ? 'product-card-wishlist--saved' : ''}`}
          onClick={handleWishlist}
          aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
        </button>

        {/* Badges — top-left corner */}
        <div className="product-card-badges">
          {isNew         && <span className="badge-pill badge-new">New</span>}
          {isOutOfStock  && <span className="badge-pill badge-oos">Sold out</span>}
        </div>

        {/* Hover overlay — slides up from bottom */}
        <div className="product-card-overlay">
          {isOutOfStock ? (
            <span className="overlay-sold-out">Out of Stock</span>
          ) : (
            <button
              className={`btn overlay-atc-btn ${added ? 'overlay-atc-btn--added' : ''}`}
              onClick={handleAddToCart}
              disabled={adding}
            >
              {adding ? 'Adding…' : added ? '✓ Added to Cart' : 'Add to Cart'}
            </button>
          )}
          <Link
            to={`/products/${product.id}`}
            className="overlay-view-link"
            onClick={e => e.stopPropagation()}
          >
            View details →
          </Link>
        </div>
      </div>

      {/* ── Info ────────────────────────────── */}
      <div className="product-card-body">
        {product.category && (
          <span className="product-card-category">{product.category}</span>
        )}
        <h3 className="product-card-name">{product.name}</h3>
        {product.review_count > 0 && (
          <div className="product-card-rating">
            <StarRating value={parseFloat(product.avg_rating)} size="sm" />
            <span className="product-card-rating-count">({product.review_count})</span>
          </div>
        )}
        <p className="product-card-price">
          GHS {parseFloat(product.price).toFixed(2)}
        </p>
      </div>

    </Link>
  );
}
