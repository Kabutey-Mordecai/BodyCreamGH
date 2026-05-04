import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { useSettings } from '../context/SettingsContext';
import StarRating from './StarRating';
import './ProductCard.css';

const PLACEHOLDER_IMG = 'https://placehold.co/400x400?text=No+Image';

const _apiUrl = import.meta.env.VITE_API_URL || '';
function resolveImageUrl(url) {
  if (!url || url.startsWith('http') || url.startsWith('data:')) return url;
  if (_apiUrl.startsWith('http')) {
    try { return `${new URL(_apiUrl).origin}${url}`; } catch { /* fall through */ }
  }
  return url;
}

const isNewProduct = (createdAt) => {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
};

function formatCountdown(endsAt) {
  const ms = new Date(endsAt) - Date.now();
  if (ms <= 0 || ms >= 24 * 60 * 60 * 1000) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `Ends in ${h}h ${m}m`;
}

export default function ProductCard({ product }) {
  const { addItem, cart, updateItem, removeItem } = useCart();
  const { user }             = useAuth();
  const { savedIds, toggle } = useWishlist();
  const settings             = useSettings();
  const navigate             = useNavigate();
  const [adding,   setAdding]   = useState(false);
  const [added,    setAdded]    = useState(false);
  const [addError, setAddError] = useState(false);

  const cartItem = cart.find(i => i.product_id === product.id);
  const cartQty  = cartItem?.quantity ?? 0;
  const isSaved  = savedIds.has(product.id);

  const threshold   = Number(settings.low_stock_threshold) || 5;
  const isOutOfStock = product.stock_quantity === 0;
  const isLowStock   = !isOutOfStock && product.stock_quantity > 0 && product.stock_quantity < threshold;
  const isNew        = isNewProduct(product.created_at);

  // ── Sale / promotion resolution ─────────────────────────────────────────────
  const promo         = product.active_promotion;
  const isSaleByPromo = promo && parseFloat(promo.discounted_price) < parseFloat(product.price);
  const isSaleByCompare = !isSaleByPromo
    && product.compare_at_price
    && parseFloat(product.compare_at_price) > parseFloat(product.price);
  const isOnSale = isSaleByPromo || isSaleByCompare;

  let effectivePrice, originalPrice, discountPct, saleBadgeText, countdownText;
  if (isSaleByPromo) {
    effectivePrice  = parseFloat(promo.discounted_price);
    originalPrice   = parseFloat(product.price);
    discountPct     = Math.round((1 - effectivePrice / originalPrice) * 100);
    saleBadgeText   = promo.name;
    countdownText   = formatCountdown(promo.ends_at);
  } else if (isSaleByCompare) {
    effectivePrice  = parseFloat(product.price);
    originalPrice   = parseFloat(product.compare_at_price);
    discountPct     = Math.round((1 - effectivePrice / originalPrice) * 100);
    saleBadgeText   = 'SALE';
  }

  const handleWishlist = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { navigate('/login'); return; }
    await toggle(product.id);
  };

  const withCartUpdate = async (fn) => {
    if (adding) return;
    setAddError(false);
    setAdding(true);
    try { await fn(); } catch {
      setAddError(true);
      setTimeout(() => setAddError(false), 2500);
    } finally { setAdding(false); }
  };

  const handleAddToCart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    withCartUpdate(async () => {
      if (cartItem) {
        if (cartQty < product.stock_quantity) await updateItem(cartItem.id, cartQty + 1);
      } else {
        await addItem(product.id, 1, product);
        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
      }
    });
  };

  const handleDecrease = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!cartItem) return;
    withCartUpdate(async () => {
      if (cartQty <= 1) await removeItem(cartItem.id);
      else              await updateItem(cartItem.id, cartQty - 1);
    });
  };

  return (
    <Link to={`/products/${product.id}`} className="product-card">

      {/* ── Image ───────────────────────────── */}
      <div className="product-card-img-wrap">
        <img
          src={resolveImageUrl(product.image_url) || PLACEHOLDER_IMG}
          alt={product.name}
          loading="lazy"
        />

        {/* Wishlist heart */}
        <button
          className={`product-card-wishlist ${isSaved ? 'product-card-wishlist--saved' : ''}`}
          onClick={handleWishlist}
          aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
        </button>

        {/* Badges */}
        <div className="product-card-badges">
          {isOnSale && (
            <span className={`badge-pill ${isSaleByPromo ? 'badge-promo' : 'badge-sale'}`}>
              {saleBadgeText}
            </span>
          )}
          {isNew && !isOnSale && <span className="badge-pill badge-new">New</span>}
          {isLowStock   && <span className="badge-pill badge-low-stock">Only {product.stock_quantity} left</span>}
          {isOutOfStock && <span className="badge-pill badge-oos">Sold out</span>}
        </div>

        {/* Hover overlay */}
        <div className="product-card-overlay">
          {isOutOfStock ? (
            <span className="overlay-sold-out">Out of Stock</span>
          ) : product.has_variants ? (
            <Link
              to={`/products/${product.id}`}
              className="btn overlay-atc-btn"
              onClick={e => e.stopPropagation()}
            >
              Select options →
            </Link>
          ) : cartItem ? (
            <div className="overlay-qty-stepper">
              <button
                className="overlay-qty-btn"
                onClick={handleDecrease}
                disabled={adding}
                aria-label="Decrease quantity"
              >−</button>
              <span className="overlay-qty-count">{cartQty}</span>
              <button
                className="overlay-qty-btn"
                onClick={handleAddToCart}
                disabled={adding || cartQty >= product.stock_quantity}
                aria-label="Increase quantity"
              >+</button>
            </div>
          ) : (
            <button
              className={`btn overlay-atc-btn ${added ? 'overlay-atc-btn--added' : addError ? 'overlay-atc-btn--error' : ''}`}
              onClick={handleAddToCart}
              disabled={adding}
            >
              {adding ? 'Adding…' : added ? '✓ Added to Cart' : addError ? '✗ Failed — try again' : 'Add to Cart'}
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

        {product.has_variants && product.min_price ? (
          <p className="product-card-price">
            From GHS {parseFloat(product.min_price).toFixed(2)}
          </p>
        ) : isOnSale ? (
          <div className="product-card-price-sale">
            <span className="product-card-price-current">
              GHS {effectivePrice.toFixed(2)}
            </span>
            <span className="product-card-price-was">
              GHS {originalPrice.toFixed(2)}
            </span>
            <span className="product-card-price-off">{discountPct}% off</span>
            {countdownText && (
              <span className="product-card-countdown">{countdownText}</span>
            )}
          </div>
        ) : (
          <p className="product-card-price">
            GHS {parseFloat(product.price).toFixed(2)}
          </p>
        )}
      </div>

    </Link>
  );
}
