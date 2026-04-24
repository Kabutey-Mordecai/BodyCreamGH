import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { ordersAPI, paymentsAPI } from '../services/api';
import './Checkout.css';

// Ghana's 16 administrative regions — shown in a select rather than a free text input
const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Western', 'Western North',
  'Central', 'Eastern', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East',
  'Upper West', 'Bono', 'Bono East', 'Ahafo',
];

export default function Checkout() {
  const { cart, cartTotal, clearLocalCart, isGuest } = useCart();
  const { user } = useAuth();
  const { delivery_fee_flat, delivery_fee_accra, free_delivery_over } = useSettings();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    // Guest-only fields
    first_name: '',
    last_name:  '',
    email:      '',
    // Delivery fields — shown for everyone
    delivery_address: '',
    city:             '',
    region:           '',
    phone:            '',
    notes:            '',
  });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (cart.length === 0) return setError('Your cart is empty.');

    setError('');
    setLoading(true);

    try {
      let orderId, email;

      if (isGuest) {
        // Guest checkout — send items array directly
        const { data: order } = await ordersAPI.createGuest({
          email:            form.email,
          first_name:       form.first_name,
          last_name:        form.last_name,
          phone:            form.phone,
          shipping_address: form.delivery_address,
          shipping_city:    form.city,
          shipping_region:  form.region,
          notes:            form.notes,
          delivery_fee:     deliveryFee,
          items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
        });
        orderId = order.orderId;
        email   = order.email;

        const { data: payment } = await paymentsAPI.initializeGuest(orderId, email);
        clearLocalCart();
        window.location.href = payment.authorization_url;
      } else {
        // Authenticated checkout — cart is on the server
        const { data: order } = await ordersAPI.create({
          shipping_address: form.delivery_address,
          shipping_city:    form.city,
          shipping_region:  form.region,
          notes: form.phone
            ? `Phone: ${form.phone}${form.notes ? '\n' + form.notes : ''}`
            : form.notes,
          delivery_fee: deliveryFee,
        });
        orderId = order.orderId;

        const { data: payment } = await paymentsAPI.initialize(orderId);
        clearLocalCart();
        window.location.href = payment.authorization_url;
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isAccra   = form.region === 'Greater Accra';
  const feeFlat   = Number(delivery_fee_flat)  || 15;
  const feeAccra  = Number(delivery_fee_accra) || 10;
  const freeOver  = Number(free_delivery_over) || 0;
  const deliveryFee = (freeOver > 0 && cartTotal >= freeOver)
    ? 0
    : isAccra ? feeAccra : feeFlat;
  const orderTotal = cartTotal + deliveryFee;

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

        {/* Guest prompt — offer login/register as an alternative */}
        {isGuest && (
          <div className="guest-notice">
            <p>
              <strong>Checking out as guest.</strong>{' '}
              <Link to={`/login?next=/checkout`}>Sign in</Link> or{' '}
              <Link to="/register">create an account</Link> to track your orders.
            </p>
          </div>
        )}

        <div className="checkout-layout">
          {/* ── Delivery form ─────────────────────────── */}
          <form className="checkout-form" onSubmit={handleSubmit}>
            {/* Guest-only contact section */}
            {isGuest && (
              <div className="checkout-section">
                <h2>Your Details</h2>
                <div className="gold-divider" style={{ margin: '0 0 24px' }} />

                <div className="checkout-row">
                  <div className="form-group">
                    <label htmlFor="first_name">First name</label>
                    <input
                      id="first_name"
                      name="first_name"
                      type="text"
                      value={form.first_name}
                      onChange={handleChange}
                      required
                      placeholder="Ama"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="last_name">Last name <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input
                      id="last_name"
                      name="last_name"
                      type="text"
                      value={form.last_name}
                      onChange={handleChange}
                      placeholder="Mensah"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    placeholder="ama@example.com"
                  />
                </div>
              </div>
            )}

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
                <label htmlFor="notes">Order notes <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span></label>
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
                <span>{form.region
                  ? (deliveryFee === 0 ? 'Free' : `GHS ${deliveryFee.toFixed(2)}`)
                  : 'Select region'}
                </span>
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
