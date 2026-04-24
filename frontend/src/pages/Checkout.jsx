import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { ordersAPI, paymentsAPI } from '../services/api';
import './Checkout.css';

// TO CUSTOMIZE: Set your delivery fee or make it dynamic based on location
const DELIVERY_FEE = 15; // GHS

// Ghana's 16 administrative regions — shown in a select rather than a free text input
const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Western', 'Western North',
  'Central', 'Eastern', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East',
  'Upper West', 'Bono', 'Bono East', 'Ahafo',
];

export default function Checkout() {
  const { cart, cartTotal, clearLocalCart } = useCart();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    delivery_address: '',
    city: '',
    region: '',
    phone: '',
    notes: '',
  });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (cart.length === 0) {
      return setError('Your cart is empty.');
    }

    setError('');
    setLoading(true);

    try {
      // Step 1: Create the order on the backend.
      // The server validates stock levels and calculates the final total.
      const { data: order } = await ordersAPI.create({
        shipping_address: form.delivery_address,
        shipping_city:    form.city,
        shipping_region:  form.region,
        // Phone is stored in notes since the orders table has no phone column
        notes: form.phone
          ? `Phone: ${form.phone}${form.notes ? '\n' + form.notes : ''}`
          : form.notes,
        delivery_fee: DELIVERY_FEE,
      });

      // Step 2: Initialize a Paystack payment for the order.
      // Paystack returns an authorization_url — we redirect the user there.
      const { data: payment } = await paymentsAPI.initialize(order.orderId);

      // Clear the cart locally before redirect (server clears it on payment success,
      // but this prevents a stale cart being shown if the user navigates back)
      clearLocalCart();

      // Redirect to Paystack's hosted payment page
      window.location.href = payment.authorization_url;

    } catch (err) {
      setError(err.response?.data?.error || 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const orderTotal = cartTotal + DELIVERY_FEE;

  // If the cart is empty the checkout form is pointless — guide the user away
  if (cart.length === 0) {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center', padding: '60px 0' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', marginBottom: '12px' }}>
            Your cart is empty
          </h2>
          <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>
            Add a product before heading to checkout.
          </p>
          <Link to="/shop" className="btn btn-accent">Browse Products</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-section">
      <div className="container">
        <div className="checkout-header">
          <span className="section-label">Almost Yours</span>
          <h1 className="page-title">Checkout</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            Enter your delivery details and we'll take it from there.
          </p>
        </div>

        <div className="checkout-layout">
          {/* ── Delivery form ─────────────────────────── */}
          <form className="checkout-form" onSubmit={handleSubmit}>
            <div className="checkout-section">
              <h2>Delivery Details</h2>
              <div className="gold-divider" style={{ margin: '0 0 24px' }} />

              {error && <div className="alert alert-error">{error}</div>}

              <div className="form-group">
                <label htmlFor="delivery_address">Street address</label>
                <input
                  id="delivery_address"
                  name="delivery_address"
                  type="text"
                  value={form.delivery_address}
                  onChange={handleChange}
                  required
                  placeholder="e.g. 12 Oxford Street"
                />
              </div>

              <div className="checkout-row">
                <div className="form-group">
                  <label htmlFor="city">City</label>
                  <input
                    id="city"
                    name="city"
                    type="text"
                    value={form.city}
                    onChange={handleChange}
                    required
                    placeholder="e.g. Accra"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="region">Region</label>
                  <select
                    id="region"
                    name="region"
                    value={form.region}
                    onChange={handleChange}
                    required
                  >
                    <option value="" disabled>Select a region</option>
                    {GHANA_REGIONS.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone number</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  required
                  placeholder="+233 XX XXX XXXX"
                />
              </div>

              <div className="form-group">
                <label htmlFor="notes">Order notes (optional)</label>
                <textarea
                  id="notes"
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Any special instructions for delivery?"
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-accent btn-full checkout-submit"
              disabled={loading || cart.length === 0}
            >
              {loading ? 'Processing…' : `Pay GHS ${orderTotal.toFixed(2)} with Paystack`}
            </button>

            <div className="checkout-note">
              <span className="checkout-lock">🔒</span>
              <span>
                You'll be redirected to Paystack's secure payment page.
                Cards, mobile money, and bank transfers are accepted.
              </span>
            </div>
          </form>

          {/* ── Order summary ──────────────────────────── */}
          <aside className="checkout-summary">
            <h2>Your Order</h2>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            <ul className="checkout-items">
              {cart.map(item => (
                <li key={item.id} className="checkout-item">
                  <div className="checkout-item-thumb">
                    <img
                      src={item.image_url || 'https://placehold.co/80x80?text=?'}
                      alt={item.name}
                    />
                    <span className="checkout-item-badge">{item.quantity}</span>
                  </div>
                  <div className="checkout-item-meta">
                    <span className="checkout-item-name">{item.name}</span>
                    <span className="checkout-item-price">
                      GHS {(parseFloat(item.price) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="checkout-totals">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>GHS {cartTotal.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Delivery</span>
                <span>GHS {DELIVERY_FEE.toFixed(2)}</span>
              </div>
              <div className="summary-row summary-total">
                <span>Total</span>
                <span>GHS {orderTotal.toFixed(2)}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
