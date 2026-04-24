import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import './ProductCard.css';

const PLACEHOLDER_IMG = 'https://placehold.co/400x400?text=No+Image';

// Product is "New" if created within the last 30 days
const isNewProduct = (createdAt) => {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
};

export default function ProductCard({ product }) {
  const { addItem } = useCart();
  const { user }    = useAuth();
  const [adding, setAdding] = useState(false);
  const [added, setAdded]   = useState(false);

  const isOutOfStock = product.stock_quantity === 0;
  const isNew        = isNewProduct(product.created_at);

  const handleAddToCart = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || adding) return;

    try {
      setAdding(true);
      await addItem(product.id, 1);
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

        {/* Badges — top-left corner */}
        <div className="product-card-badges">
          {isNew         && <span className="badge-pill badge-new">New</span>}
          {isOutOfStock  && <span className="badge-pill badge-oos">Sold out</span>}
        </div>

        {/* Hover overlay — slides up from bottom */}
        <div className="product-card-overlay">
          {isOutOfStock ? (
            <span className="overlay-sold-out">Out of Stock</span>
          ) : user ? (
            <button
              className={`btn overlay-atc-btn ${added ? 'overlay-atc-btn--added' : ''}`}
              onClick={handleAddToCart}
              disabled={adding}
            >
              {adding ? 'Adding…' : added ? '✓ Added to Cart' : 'Add to Cart'}
            </button>
          ) : (
            <Link
              to="/login"
              className="btn overlay-atc-btn"
              onClick={e => e.stopPropagation()}
            >
              Login to Buy
            </Link>
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
        <p className="product-card-price">
          GHS {parseFloat(product.price).toFixed(2)}
        </p>
      </div>

    </Link>
  );
}
