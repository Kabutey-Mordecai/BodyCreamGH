import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import './Cart.css';

export default function Cart() {
  const { cart, loading, cartTotal, updateItem, removeItem } = useCart();
  const navigate = useNavigate();

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

  // Count the total number of items, used in the header
  const itemCount = cart.reduce((n, item) => n + item.quantity, 0);

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

        <div className="cart-layout">
          {/* ── Line items ─────────────────────────────── */}
          <div className="cart-items">
            {cart.map(item => (
              <CartItem
                key={item.id}
                item={item}
                onUpdate={updateItem}
                onRemove={removeItem}
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
                <span>7-day returns</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Split into its own component so the parent JSX stays readable
function CartItem({ item, onUpdate, onRemove }) {
  const handleQtyChange = async (newQty) => {
    if (newQty < 1) return;
    await onUpdate(item.id, newQty);
  };

  // TO CUSTOMIZE: Placeholder image for cart items without an image_url
  const imgSrc = item.image_url || 'https://placehold.co/200x200?text=?';

  return (
    <div className="cart-item">
      <Link to={`/products/${item.product_id}`} className="cart-item-img-link">
        <img src={imgSrc} alt={item.name} className="cart-item-img" />
      </Link>

      <div className="cart-item-details">
        <Link to={`/products/${item.product_id}`} className="cart-item-name">
          {item.name}
        </Link>
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
              aria-label="Increase quantity"
            >+</button>
          </div>

          <button
            className="cart-item-remove"
            onClick={() => onRemove(item.id)}
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
