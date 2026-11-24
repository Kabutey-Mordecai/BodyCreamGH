import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { toFiniteNumber } from '../utils/number';
import './Cart.css';

export default function Cart() {
  const { cart, loading, cartTotal, updateItem, removeItem } = useCart();
  const settings = useSettings() || {};
  const navigate = useNavigate();
  const [actionError, setActionError] = useState('');

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  if (cart.length === 0) {
    return (
      <div className="page-section">
        <div className="container cart-empty">
          <span className="cart-empty-icon">✦</span>
          <h2>Your cart is empty</h2>
          <p>Add some products and they'll appear here.</p>
          <Link to="/shop" className="btn btn-accent" style={{ marginTop: '24px' }}>
            Browse Products
          </Link>
        </div>
      </div>
    );
  }

  const returnDays = toFiniteNumber(settings.return_window_days, 3);
  // Count the total number of items, used in the header
  const itemCount = cart.reduce((n, item) => n + item.quantity, 0);
  const freeThreshold = toFiniteNumber(settings.free_delivery_over ?? settings.free_delivery_threshold, 200);
  const remainingForFree = Math.max(0, freeThreshold - cartTotal);
  const freeProgress = freeThreshold > 0 ? Math.min(100, (cartTotal / freeThreshold) * 100) : 100;

  return (
    <div className="page-section">
      <div className="container">
        <div className="cart-header">
          <span className="section-label">Your Basket</span>
          <h1 className="page-title">Shopping Cart</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} ready for checkout
          </p>
        </div>

        {actionError && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '16px' }}>
            {actionError}
          </div>
        )}

        {freeThreshold > 0 && (
          <div className="cart-free-ship-banner" role="status" aria-live="polite">
            <p className="cart-free-ship-text">
              {remainingForFree > 0
                ? <>Add <strong>GHS {remainingForFree.toFixed(2)}</strong> more for <strong>FREE Delivery</strong></>
                : <>🎉 You unlocked <strong>FREE Delivery</strong>!</>}
            </p>
            <div className="cart-free-ship-track" aria-hidden="true">
              <div className="cart-free-ship-fill" style={{ width: `${freeProgress}%` }} />
            </div>
          </div>
        )}

        <div className="cart-layout">
          {/* ── Line items ─────────────────────────────── */}
          <div className="cart-items">
            {cart.map(item => (
              <CartItem
                key={item.id}
                item={item}
                onUpdate={updateItem}
                onRemove={removeItem}
                onError={setActionError}
              />
            ))}
          </div>

          {/* ── Order summary sidebar ──────────────────── */}
          <div className="cart-summary">
            <h2>Order Summary</h2>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            <div className="summary-row">
              <span>Subtotal ({itemCount})</span>
              <span>GHS {cartTotal.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Delivery</span>
              {/* Delivery fee is calculated at checkout after the user enters their address */}
              <span className="muted">Calculated at checkout</span>
            </div>
            <div className="summary-row summary-total">
              <span>Total</span>
              <span>GHS {cartTotal.toFixed(2)}+</span>
            </div>

            <button
              className="btn btn-accent btn-full cart-checkout-btn"
              onClick={() => navigate('/checkout')}
            >
              Proceed to Checkout
            </button>

            <Link to="/shop" className="cart-continue-link">
              ← Continue Shopping
            </Link>

            {/* Trust badges under the CTA */}
            <div className="cart-trust">
              <div className="cart-trust-item">
                <span>🔒</span>
                <span>Secure Paystack checkout</span>
              </div>
              <div className="cart-trust-item">
                <span>🚚</span>
                <span>Nationwide delivery</span>
              </div>
              <div className="cart-trust-item">
                <span>↩</span>
                <span>{returnDays}-day returns</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Split into its own component so the parent JSX stays readable
function CartItem({ item, onUpdate, onRemove, onError }) {
  const handleQtyChange = async (newQty) => {
    if (newQty < 1) return;
    try {
      onError('');
      await onUpdate(item.id, newQty);
    } catch (err) {
      onError(err?.response?.data?.error || 'Could not update item quantity. Please try again.');
    }
  };

  const handleRemove = async () => {
    try {
      onError('');
      await onRemove(item.id);
    } catch (err) {
      onError(err?.response?.data?.error || 'Could not remove item. Please try again.');
    }
  };

  // TO CUSTOMIZE: Placeholder image for cart items without an image_url
  const imgSrc = resolveImageUrl(item.image_url) || 'https://placehold.co/200x200?text=?';

  return (
    <div className="cart-item">
      <Link to={`/products/${item.product_id}`} className="cart-item-img-link">
        <img src={imgSrc} alt={item.name} className="cart-item-img" />
      </Link>

      <div className="cart-item-details">
        <Link to={`/products/${item.product_id}`} className="cart-item-name">
          {item.name}
        </Link>
        {item.variant_label && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '2px 0' }}>
            {item.variant_label}
          </p>
        )}
        <p className="cart-item-unit-price">
          GHS {parseFloat(item.price).toFixed(2)} each
        </p>

        <div className="cart-item-actions">
          <div className="cart-item-qty">
            <button
              onClick={() => handleQtyChange(item.quantity - 1)}
              disabled={item.quantity <= 1}
              aria-label="Decrease quantity"
            >−</button>
            <span>{item.quantity}</span>
            <button
              onClick={() => handleQtyChange(item.quantity + 1)}
              disabled={item.stock_quantity > 0 && item.quantity >= item.stock_quantity}
              aria-label="Increase quantity"
            >+</button>
          </div>

          <button
            className="cart-item-remove"
            onClick={handleRemove}
          >
            Remove
          </button>
        </div>
      </div>

      <p className="cart-item-subtotal">
        GHS {(parseFloat(item.price) * item.quantity).toFixed(2)}
      </p>
    </div>
  );
}
