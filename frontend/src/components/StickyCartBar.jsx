import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const HIDDEN_PREFIXES = [
  '/cart',
  '/checkout',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/payment',
  '/rider-manifest',
  '/rider-handoff',
  '/products',
  '/product',
];

export default function StickyCartBar() {
  const { cartCount, cartTotal } = useCart();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);

  if (cartCount <= 0 || dismissed) return null;
  if (HIDDEN_PREFIXES.some(p => pathname.startsWith(p))) return null;

  return (
    <div className="sticky-cart-bar" role="region" aria-label="Cart quick checkout">
      <div className="sticky-cart-summary">
        <strong>{cartCount} {cartCount === 1 ? 'item' : 'items'} in bag</strong>
        <span>Subtotal: GHS {cartTotal.toFixed(2)}</span>
      </div>
      <div className="sticky-cart-actions">
        <Link to="/cart" className="btn btn-outline btn-sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }}>
          View Bag
        </Link>
        <Link to="/checkout" className="btn btn-accent btn-sm">
          Checkout →
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: '1rem',
            lineHeight: 1,
            transition: 'color 0.15s',
          }}
          title="Dismiss"
          aria-label="Dismiss quick bag bar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
