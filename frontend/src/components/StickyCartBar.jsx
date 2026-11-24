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
];

export default function StickyCartBar() {
  const { cartCount, cartTotal } = useCart();
  const { pathname } = useLocation();

  if (cartCount <= 0) return null;
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
      </div>
    </div>
  );
}
