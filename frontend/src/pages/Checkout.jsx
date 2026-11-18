import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { ordersAPI, paymentsAPI, couponsAPI, cartAPI } from '../services/api';
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
  const {
    delivery_fee_flat,
    delivery_fee_accra,
    free_delivery_over,
    pickup_enabled,
    pickup_location,
    pickup_hours,
    pay_on_delivery_enabled,
    pay_on_delivery_accra_only,
  } = useSettings();
  const navigate = useNavigate();

  const [fulfillmentMethod, setFulfillmentMethod] = useState('delivery');
  const [paymentMethod, setPaymentMethod]         = useState('paystack');
  const [podConfirmation, setPodConfirmation]     = useState(null);

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

  // Coupon state
  const [couponInput, setCouponInput]       = useState('');
  const [coupon, setCoupon]                 = useState(null); // { code, discountAmount }
  const [couponError, setCouponError]       = useState('');
  const [couponLoading, setCouponLoading]   = useState(false);

  // Guest cart validation state — unused for authenticated users
  const [validation, setValidation]               = useState(null);   // null | { valid, items }
  const [validating, setValidating]               = useState(false);
  const [validationFetchError, setValidationFetchError] = useState('');

  // Pre-flight: validate guest cart against backend on mount (bypasses stale localStorage prices)
  useEffect(() => {
    if (!isGuest || cart.length === 0) return;
    setValidating(true);
    setValidationFetchError('');
    cartAPI.validateGuest(
      cart.map(i => ({ product_id: i.product_id, quantity: i.quantity }))
    )
      .then(({ data }) => setValidation(data))
      .catch(() => setValidationFetchError('Could not check item availability. Please try again.'))
      .finally(() => setValidating(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickupEnabled = pickup_enabled !== false && pickup_enabled !== 'false';
  const podEnabled    = pay_on_delivery_enabled === true || pay_on_delivery_enabled === 'true';
  const podAccraOnly  = pay_on_delivery_accra_only !== false && pay_on_delivery_accra_only !== 'false';

  const isAccra   = form.region === 'Greater Accra';
  const podEligible = podEnabled && (!podAccraOnly || fulfillmentMethod === 'pickup' || isAccra);

  useEffect(() => {
    if (!pickupEnabled && fulfillmentMethod === 'pickup') {
      setFulfillmentMethod('delivery');
    }
  }, [pickupEnabled, fulfillmentMethod]);

  useEffect(() => {
    if (!podEligible && paymentMethod === 'pay_on_delivery') {
      setPaymentMethod('paystack');
    }
  }, [podEligible, paymentMethod]);

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (cart.length === 0) return setError('Your cart is empty.');

    // Guest-only submit guards — keep authenticated path untouched
    if (isGuest && !validation) {
      return setError('Cart validation is still in progress. Please wait a moment.');
    }
    if (isGuest && validation && !validation.valid) {
      return setError('Some items in your cart are unavailable. Please review your cart and remove unavailable items.');
    }

    setError('');
    setLoading(true);

    try {
      const isPickup = fulfillmentMethod === 'pickup';
      const shippingAddress = isPickup
        ? `Pickup: ${pickup_location || 'East Legon, Accra'}`
        : form.delivery_address;
      const shippingCity   = isPickup ? 'Accra' : form.city;
      const shippingRegion = isPickup ? 'Greater Accra' : form.region;

      if (isGuest) {
        // Guest checkout — send items array directly
        const { data: order } = await ordersAPI.createGuest({
          email:              form.email,
          first_name:         form.first_name,
          last_name:          form.last_name,
          phone:              form.phone,
          fulfillment_method: fulfillmentMethod,
          payment_method:     paymentMethod,
          shipping_address:   shippingAddress,
          shipping_city:      shippingCity,
          shipping_region:    shippingRegion,
          notes:              form.notes,
          delivery_fee:       deliveryFee,
          coupon_code:        coupon?.code || undefined,
          items: cart.map(i => ({
            product_id: i.product_id,
            quantity:   i.quantity,
            ...(i.variant_id ? { variant_id: i.variant_id, variant_label: i.variant_label } : {}),
          })),
        });

        if (paymentMethod === 'pay_on_delivery') {
          await clearLocalCart();
          setPodConfirmation({
            orderId:            order.orderId,
            orderNumber:        order.orderNumber,
            total:              order.total,
            fulfillment_method: fulfillmentMethod,
            email:              form.email,
          });
          return;
        }

        const { data: payment } = await paymentsAPI.initializeGuest(order.orderId, order.email);
        await clearLocalCart();
        window.location.href = payment.authorization_url;
      } else {
        // Authenticated checkout — cart is on the server
        const { data: order } = await ordersAPI.create({
          fulfillment_method: fulfillmentMethod,
          payment_method:     paymentMethod,
          shipping_address:   shippingAddress,
          shipping_city:      shippingCity,
          shipping_region:    shippingRegion,
          notes: form.phone
            ? `Phone: ${form.phone}${form.notes ? '\n' + form.notes : ''}`
            : form.notes,
          delivery_fee: deliveryFee,
          coupon_code:  coupon?.code || undefined,
        });

        if (paymentMethod === 'pay_on_delivery') {
          await clearLocalCart();
          navigate(`/orders/${order.orderId}`);
          return;
        }

        const { data: payment } = await paymentsAPI.initialize(order.orderId);
        await clearLocalCart();
        window.location.href = payment.authorization_url;
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const feeFlat   = Number(delivery_fee_flat)  || 15;
  const feeAccra  = Number(delivery_fee_accra) || 10;
  const freeOver  = Number(free_delivery_over) || 0;
  const deliveryFee = fulfillmentMethod === 'pickup'
    ? 0
    : (freeOver > 0 && cartTotal >= freeOver)
      ? 0
      : isAccra ? feeAccra : feeFlat;
  const subtotalPlusDelivery = cartTotal + deliveryFee;
  const discountAmount = coupon?.discountAmount || 0;
  const orderTotal = Math.max(0, subtotalPlusDelivery - discountAmount);

  // For guests with successful validation, use backend-verified prices for the displayed total.
  // Authenticated users keep the existing orderTotal derived from the server cart.
  const validatedSubtotal = (isGuest && validation?.valid)
    ? validation.items.reduce((sum, i) => sum + parseFloat(i.subtotal), 0)
    : cartTotal;
  const validatedOrderTotal = isGuest
    ? Math.max(0, validatedSubtotal + deliveryFee - discountAmount)
    : orderTotal;

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCouponError('');
    setCouponLoading(true);
    try {
      const { data } = await couponsAPI.validate(code, subtotalPlusDelivery);
      setCoupon({ code: data.code, discountAmount: data.discountAmount, type: data.type, value: data.value });
      setCouponInput('');
    } catch (err) {
      setCouponError(err.response?.data?.error || 'Invalid coupon code.');
      setCoupon(null);
    } finally {
      setCouponLoading(false);
    }
  };

  if (podConfirmation) {
    return (
      <div className="page-section">
        <div className="container" style={{ maxWidth: 560, textAlign: 'center', padding: '60px 16px' }}>
          <div className="checkout-section" style={{ alignItems: 'center', textAlign: 'center' }}>
            <span className="section-label">Order Confirmed</span>
            <h1 className="page-title" style={{ marginBottom: 4 }}>Thank you!</h1>
            <p style={{ color: 'var(--color-muted)', margin: 0 }}>
              Order <strong>{podConfirmation.orderNumber}</strong> has been confirmed.
            </p>
            <p style={{ fontSize: '0.92rem', margin: '8px 0 0' }}>
              Total due on {podConfirmation.fulfillment_method === 'pickup' ? 'pickup' : 'delivery'}:{' '}
              <strong>GHS {Number(podConfirmation.total || 0).toFixed(2)}</strong> (Cash or Mobile Money).
            </p>
            {podConfirmation.fulfillment_method === 'pickup' && (
              <div className="checkout-pickup-box" style={{ width: '100%', textAlign: 'left' }}>
                <strong>Pickup Station</strong>
                <p>{pickup_location || 'East Legon, Accra (Call upon arrival)'}</p>
                {pickup_hours && <p className="checkout-pickup-hours">Hours: {pickup_hours}</p>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
              <Link to="/track" className="btn btn-accent">Track Your Order</Link>
              <Link to="/shop" className="btn btn-outline">Continue Shopping</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              <Link to="/login" state={{ from: { pathname: '/checkout' } }}>Sign in</Link> or{' '}
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
              <h2>Delivery Method</h2>
              <div className="gold-divider" style={{ margin: '0 0 24px' }} />

              {error && <div className="alert alert-error">{error}</div>}

              {pickupEnabled && (
                <div className="checkout-method-grid" role="radiogroup" aria-label="Fulfillment method">
                  <label className={`checkout-method-card${fulfillmentMethod === 'delivery' ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="fulfillment_method"
                      value="delivery"
                      checked={fulfillmentMethod === 'delivery'}
                      onChange={() => setFulfillmentMethod('delivery')}
                    />
                    <div>
                      <strong>Doorstep Delivery</strong>
                      <span>
                        Accra: GHS {feeAccra.toFixed(2)} · Nationwide: GHS {feeFlat.toFixed(2)}
                        {freeOver > 0 ? ` (Free over GHS ${freeOver})` : ''}
                      </span>
                    </div>
                  </label>
                  <label className={`checkout-method-card${fulfillmentMethod === 'pickup' ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="fulfillment_method"
                      value="pickup"
                      checked={fulfillmentMethod === 'pickup'}
                      onChange={() => setFulfillmentMethod('pickup')}
                    />
                    <div>
                      <strong>Pickup Station — Free</strong>
                      <span>{pickup_location || 'East Legon, Accra (Call upon arrival)'}</span>
                    </div>
                  </label>
                </div>
              )}

              {fulfillmentMethod === 'pickup' ? (
                <div className="checkout-pickup-box">
                  <strong>Pickup Location</strong>
                  <p>{pickup_location || 'East Legon, Accra (Call upon arrival)'}</p>
                  {pickup_hours && (
                    <p className="checkout-pickup-hours">Pickup hours: {pickup_hours}</p>
                  )}
                </div>
              ) : (
                <>
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
                </>
              )}

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
                  placeholder={fulfillmentMethod === 'pickup' ? 'Preferred pickup time or notes?' : 'Any special instructions for delivery?'}
                />
              </div>
            </div>

            {/* ── Payment method ──────────────────────── */}
            <div className="checkout-section">
              <h2>Payment Method</h2>
              <div className="gold-divider" style={{ margin: '0 0 16px' }} />

              <div className="checkout-method-grid" role="radiogroup" aria-label="Payment method">
                <label className={`checkout-method-card${paymentMethod === 'paystack' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="payment_method"
                    value="paystack"
                    checked={paymentMethod === 'paystack'}
                    onChange={() => setPaymentMethod('paystack')}
                  />
                  <div>
                    <strong>Pay Online (Paystack)</strong>
                    <span>MTN MoMo, Telecel Cash, Cards &amp; Bank Transfer</span>
                  </div>
                </label>

                {podEnabled && (
                  <label className={`checkout-method-card${paymentMethod === 'pay_on_delivery' ? ' is-selected' : ''}${!podEligible ? ' is-disabled' : ''}`}>
                    <input
                      type="radio"
                      name="payment_method"
                      value="pay_on_delivery"
                      checked={paymentMethod === 'pay_on_delivery'}
                      disabled={!podEligible}
                      onChange={() => setPaymentMethod('pay_on_delivery')}
                    />
                    <div>
                      <strong>{fulfillmentMethod === 'pickup' ? 'Pay on Pickup' : 'Pay on Delivery'}</strong>
                      <span>
                        {podEligible
                          ? 'Pay with Cash or Mobile Money when your order arrives'
                          : 'Available for Greater Accra deliveries or Store Pickup only'}
                      </span>
                    </div>
                  </label>
                )}
              </div>
            </div>

            {/* ── Coupon code ─────────────────────────── */}
            <div className="checkout-section">
              <h2>Promo Code</h2>
              <div className="gold-divider" style={{ margin: '0 0 16px' }} />

              {coupon ? (
                <div className="coupon-applied">
                  <div>
                    <span className="coupon-tag">{coupon.code}</span>
                    <span className="coupon-desc">
                      {coupon.type === 'percentage'
                        ? `${coupon.value}% off`
                        : `GHS ${coupon.value} off`}
                      {' '}— saving GHS {coupon.discountAmount.toFixed(2)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="coupon-remove"
                    onClick={() => setCoupon(null)}
                    aria-label="Remove coupon"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="coupon-row">
                  <input
                    type="text"
                    placeholder="Enter promo code"
                    value={couponInput}
                    onChange={e => { setCouponInput(e.target.value); setCouponError(''); }}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), applyCoupon())}
                    className="coupon-input"
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={applyCoupon}
                    disabled={couponLoading || !couponInput.trim()}
                  >
                    {couponLoading ? '…' : 'Apply'}
                  </button>
                </div>
              )}
              {couponError && <p className="coupon-error">{couponError}</p>}
            </div>

            <button
              type="submit"
              className="btn btn-accent btn-full checkout-submit"
              disabled={
                loading ||
                cart.length === 0 ||
                validating ||
                (isGuest && validation !== null && !validation.valid)
              }
            >
              {validating
                ? 'Checking availability…'
                : loading
                ? 'Processing…'
                : paymentMethod === 'pay_on_delivery'
                ? `Place Order — GHS ${validatedOrderTotal.toFixed(2)} (${fulfillmentMethod === 'pickup' ? 'Pay on Pickup' : 'Pay on Delivery'})`
                : `Pay GHS ${validatedOrderTotal.toFixed(2)} with Paystack`}
            </button>

            <div className="checkout-note">
              <span className="checkout-lock">🔒</span>
              <span>
                {paymentMethod === 'pay_on_delivery'
                  ? 'Your order will be confirmed immediately. Pay in cash or Mobile Money upon receipt.'
                  : "You'll be redirected to Paystack's secure payment page. Cards, mobile money, and bank transfers are accepted."}
              </span>
            </div>
          </form>

          {/* ── Order summary ──────────────────────────── */}
          <aside className="checkout-summary">
            <h2>Your Order</h2>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            {/* Guest-only validation status messages */}
            {isGuest && validating && (
              <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginBottom: '10px' }}>
                Checking item availability…
              </p>
            )}
            {isGuest && validationFetchError && (
              <div className="alert alert-error" style={{ marginBottom: '12px' }}>
                {validationFetchError}
              </div>
            )}
            {isGuest && !validating && validation && !validation.valid && (
              <div className="alert alert-error" style={{ marginBottom: '12px' }}>
                Some items are unavailable. Remove them from your cart before proceeding.
              </div>
            )}

            <ul className="checkout-items">
              {cart.map(item => {
                const v = isGuest
                  ? validation?.items?.find(vi => vi.product_id === item.product_id)
                  : null;
                const isUnavailable = Boolean(v && !v.available);
                const displayPrice = parseFloat(v?.price ?? item.price);

                return (
                  <li
                    key={item.id}
                    className={`checkout-item${isUnavailable ? ' checkout-item--unavailable' : ''}`}
                  >
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
                        GHS {(displayPrice * item.quantity).toFixed(2)}
                      </span>
                      {isUnavailable && (
                        <span className="checkout-item-error">{v.error}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="checkout-totals">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>GHS {validatedSubtotal.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>{fulfillmentMethod === 'pickup' ? 'Pickup Station' : 'Delivery'}</span>
                <span>{fulfillmentMethod === 'pickup'
                  ? 'Free'
                  : form.region
                    ? (deliveryFee === 0 ? 'Free' : `GHS ${deliveryFee.toFixed(2)}`)
                    : 'Select region'}
                </span>
              </div>
              {coupon && (
                <div className="summary-row" style={{ color: 'var(--color-accent-dark)' }}>
                  <span>Discount ({coupon.code})</span>
                  <span>− GHS {coupon.discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="summary-row summary-total">
                <span>Total</span>
                <span>GHS {validatedOrderTotal.toFixed(2)}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
