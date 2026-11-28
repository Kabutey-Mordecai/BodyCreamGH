import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { ordersAPI, paymentsAPI, couponsAPI, cartAPI, newsletterAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { isSafePaystackCheckoutUrl } from '../utils/safePaystackUrl';
import { toFiniteNumber } from '../utils/number';
import { GHANA_REGIONS, getAreasForRegion, getTownsForArea } from '../data/ghanaLocations';
import TurnstileWidget from '../components/TurnstileWidget';
import './Checkout.css';

export default function Checkout() {
  const { cart, cartTotal, clearLocalCart, isGuest, loading: cartLoading } = useCart();
  const { user, loading: authLoading } = useAuth();
  const {
    delivery_fee_flat,
    delivery_fee_accra,
    free_delivery_over,
    pickup_enabled,
    pickup_location,
    pickup_hours,
    pay_on_delivery_enabled,
    pay_on_delivery_accra_only,
    guest_checkout_enabled,
  } = useSettings();
  const navigate = useNavigate();

  const allowGuestCheckout = guest_checkout_enabled === true || guest_checkout_enabled === 'true';

  const [fulfillmentMethod, setFulfillmentMethod] = useState('delivery');
  const [paymentMethod, setPaymentMethod]         = useState('paystack');
  const [podConfirmation, setPodConfirmation]     = useState(null);

  const [form, setForm] = useState(() => {
    const defaultRegion = 'Greater Accra';
    const areas = getAreasForRegion(defaultRegion);
    const defaultArea = areas[0] || 'Accra Central';
    const towns = getTownsForArea(defaultRegion, defaultArea);
    const defaultTown = towns[0] || '';
    return {
      // Guest-only fields
      first_name: '',
      last_name:  '',
      email:      '',
      // Delivery fields — shown for everyone
      delivery_address:  '',
      region:            defaultRegion,
      area:              defaultArea,
      town:              defaultTown,
      custom_town:       '',
      city:              defaultTown ? `${defaultTown}, ${defaultArea}` : defaultArea,
      ghana_post_gps:    '',
      delivery_landmark: '',
      phone:             '',
      notes:             '',
    };
  });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [website, setWebsite] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [reminderConsent, setReminderConsent] = useState(false);
  const submittingRef         = useRef(false);
  const checkoutSessionTokenRef = useRef(
    `cs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  useEffect(() => {
    if (!reminderConsent) return;
    const email = (form.email || user?.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || cart.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      const step = form.delivery_address.trim() ? 'shipping' : 'contact';
      ordersAPI.saveCheckoutSession({
        session_token: checkoutSessionTokenRef.current,
        consent: true,
        email,
        first_name: form.first_name || user?.first_name || undefined,
        phone: form.phone || user?.phone || undefined,
        subtotal: cartTotal,
        step_reached: step,
        items: cart.map(i => ({
          product_id: i.product_id,
          name: i.name,
          quantity: i.quantity,
          price: i.price,
        })),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [reminderConsent, form.email, form.first_name, form.phone, form.delivery_address, user?.email, user?.first_name, user?.phone, cart, cartTotal]);

  // Coupon state
  const [couponInput, setCouponInput]       = useState('');
  const [coupon, setCoupon]                 = useState(null); // { code, discountAmount }
  const [couponError, setCouponError]       = useState('');
  const [couponLoading, setCouponLoading]   = useState(false);

  // Guest cart validation state — unused for authenticated users
  const [validation, setValidation]               = useState(null);   // null | { valid, items }
  const [validating, setValidating]               = useState(false);
  const [validationFetchError, setValidationFetchError] = useState('');

  // Pre-fill phone number from authenticated user's profile
  useEffect(() => {
    if (user?.phone && !form.phone) {
      setForm(prev => ({ ...prev, phone: prev.phone || user.phone }));
    }
  }, [user?.phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-apply / re-validate first-order newsletter welcome discount (handles guest email changes)
  const welcomeCheckSeq = useRef(0);
  const couponRef = useRef(coupon);
  useEffect(() => { couponRef.current = coupon; }, [coupon]);

  useEffect(() => {
    if (cart.length === 0) return;
    let savedEmail = '';
    try { savedEmail = localStorage.getItem('bc_newsletter_email') || ''; } catch {}
    const typedGuestEmail = isGuest ? form.email.trim() : '';
    const emailToCheck = isGuest ? (typedGuestEmail || savedEmail) : (user?.email || savedEmail);
    if (!emailToCheck || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToCheck)) return;

    const seq = ++welcomeCheckSeq.current;
    const delay = isGuest && typedGuestEmail ? 450 : 0;

    const timer = setTimeout(() => {
      const freeThreshold = toFiniteNumber(free_delivery_over, 0);
      const baseTotal = cartTotal + (
        fulfillmentMethod === 'pickup'
          ? 0
          : (freeThreshold > 0 && cartTotal >= freeThreshold)
            ? 0
            : (form.region === 'Greater Accra' ? toFiniteNumber(delivery_fee_accra, 10) : toFiniteNumber(delivery_fee_flat, 15))
      );

      newsletterAPI.status(emailToCheck)
        .then(async ({ data }) => {
          if (seq !== welcomeCheckSeq.current) return;
          const activeCoupon = couponRef.current;
          const welcomeCode = (data?.couponCode || '').toUpperCase();

          if (data?.hasPlacedOrder) {
            try {
              localStorage.setItem('bc_first_order_done', 'true');
              localStorage.removeItem('bc_welcome_coupon');
            } catch {}
            const isActiveWelcome = activeCoupon && (
              activeCoupon.autoWelcome ||
              (welcomeCode && (activeCoupon.code || '').toUpperCase() === welcomeCode)
            );
            if (isActiveWelcome) {
              setCoupon(null);
              setCouponError('Welcome discount is valid on your first order only.');
            }
          } else if (data?.eligibleForWelcomeDiscount && data?.couponCode && !activeCoupon) {
            const { data: cv } = await couponsAPI.validate(data.couponCode, baseTotal, emailToCheck);
            if (seq !== welcomeCheckSeq.current) return;
            if (cv?.valid) {
              setCoupon({ code: cv.code, discountAmount: cv.discountAmount, type: cv.type, value: cv.value, autoWelcome: true });
              setCouponError('');
            }
          }
        })
        .catch(() => {});
    }, delay);

    return () => clearTimeout(timer);
  }, [cart.length, isGuest, user?.email, form.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const runGuestValidation = useCallback(() => {
    if (!isGuest || !allowGuestCheckout || cart.length === 0) return;
    setValidating(true);
    setValidationFetchError('');
    cartAPI.validateGuest(
      cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, variant_id: i.variant_id || null }))
    )
      .then(({ data }) => setValidation(data))
      .catch(() => setValidationFetchError('Could not check item availability. Please try again.'))
      .finally(() => setValidating(false));
  }, [isGuest, allowGuestCheckout, cart]);

  // Pre-flight: validate guest cart against backend on mount (only when guest checkout is allowed)
  useEffect(() => {
    runGuestValidation();
  }, [allowGuestCheckout]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const availableAreas = useMemo(() => getAreasForRegion(form.region), [form.region]);
  const availableTowns = useMemo(() => getTownsForArea(form.region, form.area), [form.region, form.area]);

  const handleRegionChange = (e) => {
    const newRegion = e.target.value;
    const areas = getAreasForRegion(newRegion);
    const defaultArea = areas[0] || '';
    const towns = getTownsForArea(newRegion, defaultArea);
    const defaultTown = towns[0] || '';
    setForm(prev => ({
      ...prev,
      region: newRegion,
      area: defaultArea,
      town: defaultTown,
      custom_town: '',
      city: defaultTown ? `${defaultTown}, ${defaultArea}` : (defaultArea || newRegion),
    }));
  };

  const handleAreaChange = (e) => {
    const newArea = e.target.value;
    const towns = getTownsForArea(form.region, newArea);
    const defaultTown = towns[0] || '';
    setForm(prev => ({
      ...prev,
      area: newArea,
      town: defaultTown,
      custom_town: '',
      city: defaultTown ? `${defaultTown}, ${newArea}` : newArea,
    }));
  };

  const handleTownChange = (e) => {
    const newTown = e.target.value;
    setForm(prev => ({
      ...prev,
      town: newTown,
      city: newTown === 'other'
        ? (prev.custom_town ? `${prev.custom_town}, ${prev.area}` : prev.area)
        : `${newTown}, ${prev.area}`,
    }));
  };

  const handleCustomTownChange = (e) => {
    const val = e.target.value;
    setForm(prev => ({
      ...prev,
      custom_town: val,
      city: val ? `${val}, ${prev.area}` : prev.area,
    }));
  };

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (cart.length === 0) return setError('Your cart is empty.');

    // Guest-only submit guards — keep authenticated path untouched
    if (isGuest && validationFetchError) {
      return setError(validationFetchError);
    }
    if (isGuest && !validation) {
      return setError('Cart validation is still in progress. Please wait a moment.');
    }
    if (isGuest && validation && !validation.valid) {
      return setError('Some items in your cart are unavailable. Please review your cart and remove unavailable items.');
    }

    submittingRef.current = true;
    let redirecting = false;
    setError('');
    setLoading(true);

    try {
      const isPickup = fulfillmentMethod === 'pickup';
      const shippingAddress = isPickup
        ? `Pickup: ${pickup_location || 'Store Pickup Station'}`
        : form.delivery_address;
      const shippingCity   = isPickup ? 'Accra' : form.city;
      const shippingRegion = isPickup ? 'Greater Accra' : form.region;
      const backendPaymentMethod = paymentMethod === 'pay_on_delivery' ? 'pay_on_delivery' : 'paystack';

      let order;
      if (isGuest) {
        const res = await ordersAPI.createGuest({
          email:              form.email,
          first_name:         form.first_name,
          last_name:          form.last_name,
          phone:              form.phone,
          fulfillment_method: fulfillmentMethod,
          payment_method:     backendPaymentMethod,
          shipping_address:   shippingAddress,
          shipping_city:      shippingCity,
          shipping_region:    shippingRegion,
          ...(form.ghana_post_gps.trim() ? { ghana_post_gps: form.ghana_post_gps.trim().toUpperCase() } : {}),
          ...(form.delivery_landmark.trim() ? { delivery_landmark: form.delivery_landmark.trim() } : {}),
          notes:              form.notes,
          delivery_fee:       deliveryFee,
          coupon_code:        coupon?.code || undefined,
          ...(website ? { website } : {}),
          ...(turnstileToken ? { cf_turnstile_response: turnstileToken } : {}),
          items: cart.map(i => ({
            product_id: i.product_id,
            quantity:   i.quantity,
            ...(i.variant_id ? { variant_id: i.variant_id, variant_label: i.variant_label } : {}),
          })),
        });
        order = res.data;
      } else {
        const res = await ordersAPI.create({
          fulfillment_method: fulfillmentMethod,
          payment_method:     backendPaymentMethod,
          shipping_address:   shippingAddress,
          shipping_city:      shippingCity,
          shipping_region:    shippingRegion,
          ...(form.ghana_post_gps.trim() ? { ghana_post_gps: form.ghana_post_gps.trim().toUpperCase() } : {}),
          ...(form.delivery_landmark.trim() ? { delivery_landmark: form.delivery_landmark.trim() } : {}),
          notes: form.phone
            ? `Phone: ${form.phone}${form.notes ? '\n' + form.notes : ''}`
            : form.notes,
          delivery_fee: deliveryFee,
          coupon_code:  coupon?.code || undefined,
          ...(website ? { website } : {}),
          ...(turnstileToken ? { cf_turnstile_response: turnstileToken } : {}),
        });
        order = res.data;
      }

      try {
        localStorage.setItem('bc_first_order_done', 'true');
        localStorage.removeItem('bc_welcome_coupon');
      } catch {}

      if (paymentMethod === 'pay_on_delivery') {
        await clearLocalCart();
        if (isGuest) {
          setPodConfirmation({
            orderId:            order.orderId,
            orderNumber:        order.orderNumber,
            total:              order.total,
            fulfillment_method: fulfillmentMethod,
            email:              form.email,
          });
        } else {
          navigate(`/orders/${order.orderId}`);
        }
        return;
      }

      const { data: payment } = isGuest
        ? await paymentsAPI.initializeGuest(order.orderId, order.email)
        : await paymentsAPI.initialize(order.orderId);
      if (!isSafePaystackCheckoutUrl(payment?.authorization_url)) {
        throw new Error('Invalid payment redirect URL received. Please try again.');
      }
      try {
        if (isGuest) {
          sessionStorage.removeItem('pending_auth_payment');
          sessionStorage.setItem('pending_guest_payment', JSON.stringify({
            orderId: order.orderId,
            orderNumber: order.orderNumber || '',
            email: order.email || form.email,
          }));
        } else {
          sessionStorage.removeItem('pending_guest_payment');
          sessionStorage.setItem(
            'pending_auth_payment',
            JSON.stringify({ orderId: order.orderId, orderNumber: order.orderNumber || '' })
          );
        }
      } catch { /* ignore storage quota errors */ }
      redirecting = true;
      window.location.assign(payment.authorization_url);
    } catch (err) {
      setTurnstileToken('');
      setTurnstileReset(k => k + 1);
      setError(err.response?.data?.error || err.message || 'Checkout failed. Please try again.');
    } finally {
      if (!redirecting) {
        submittingRef.current = false;
        setLoading(false);
      }
    }
  };

  const feeFlat   = toFiniteNumber(delivery_fee_flat, 15);
  const feeAccra  = toFiniteNumber(delivery_fee_accra, 10);
  const freeOver  = toFiniteNumber(free_delivery_over, 0);
  const deliveryFee = fulfillmentMethod === 'pickup'
    ? 0
    : (freeOver > 0 && cartTotal >= freeOver)
      ? 0
      : isAccra ? feeAccra : feeFlat;
  const subtotalPlusDelivery = cartTotal + deliveryFee;
  const discountAmount = coupon
    ? (coupon.type === 'percentage' && Number(coupon.value) > 0
      ? Math.min(
          subtotalPlusDelivery,
          Math.round((subtotalPlusDelivery * Number(coupon.value) / 100) * 100) / 100
        )
      : toFiniteNumber(coupon.discountAmount, 0))
    : 0;
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
      const emailToCheck = isGuest ? form.email.trim() : user?.email;
      const { data } = await couponsAPI.validate(code, subtotalPlusDelivery, emailToCheck);
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
                <p>{pickup_location || 'Store Pickup Station (Call upon arrival)'}</p>
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

  // Require sign in / account creation at checkout (Jumia / Temu flow) unless guest checkout is explicitly enabled in Admin
  if (authLoading) {
    return <div className="spinner" style={{ marginTop: '80px' }} />;
  }

  if (!user && !allowGuestCheckout) {
    return (
      <Navigate
        to="/login"
        state={{ from: { pathname: '/checkout' }, checkoutRedirect: true }}
        replace
      />
    );
  }

  if (cartLoading || loading || submittingRef.current) {
    return <div className="spinner" style={{ marginTop: '80px' }} />;
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
                      autoComplete="given-name"
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
                      autoComplete="family-name"
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
                    autoComplete="email"
                    placeholder="ama@example.com"
                  />
                </div>
                <label htmlFor="checkout-reminder-consent" className="checkout-consent-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '0.85rem', color: 'var(--color-muted)', cursor: 'pointer' }}>
                  <input
                    id="checkout-reminder-consent"
                    name="reminder_consent"
                    type="checkbox"
                    checked={reminderConsent}
                    onChange={e => setReminderConsent(e.target.checked)}
                  />
                  <span>Send me a reminder if I don&apos;t complete my order</span>
                </label>
              </div>
            )}

            <div className="checkout-section">
              <h2>Delivery Method</h2>
              <div className="gold-divider" style={{ margin: '0 0 24px' }} />

              {error && <div className="alert alert-error" role="alert">{error}</div>}

              {pickupEnabled && (
                <div className="checkout-method-grid" role="radiogroup" aria-label="Fulfillment method">
                  <label htmlFor="checkout-method-delivery" className={`checkout-method-card${fulfillmentMethod === 'delivery' ? ' is-selected' : ''}`}>
                    <input
                      id="checkout-method-delivery"
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
                  <label htmlFor="checkout-method-pickup" className={`checkout-method-card${fulfillmentMethod === 'pickup' ? ' is-selected' : ''}`}>
                    <input
                      id="checkout-method-pickup"
                      type="radio"
                      name="fulfillment_method"
                      value="pickup"
                      checked={fulfillmentMethod === 'pickup'}
                      onChange={() => setFulfillmentMethod('pickup')}
                    />
                    <div>
                      <strong>Pickup Station — Free</strong>
                      <span>{pickup_location || 'Store Pickup Station (Call upon arrival)'}</span>
                    </div>
                  </label>
                </div>
              )}

              {fulfillmentMethod === 'pickup' ? (
                <div className="checkout-pickup-box">
                  <strong>Pickup Location</strong>
                  <p>{pickup_location || 'Store Pickup Station (Call upon arrival)'}</p>
                  {pickup_hours && (
                    <p className="checkout-pickup-hours">Pickup hours: {pickup_hours}</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Cascading Location Hierarchy (Region ➔ Area ➔ Town) */}
                  <div className="checkout-row">
                    <div className="form-group">
                      <label htmlFor="region">1. Region</label>
                      <select
                        id="region"
                        name="region"
                        value={form.region}
                        onChange={handleRegionChange}
                        required
                        autoComplete="address-level1"
                      >
                        <option value="" disabled>Select region</option>
                        {GHANA_REGIONS.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="area">2. Area / District</label>
                      <select
                        id="area"
                        name="area"
                        value={form.area}
                        onChange={handleAreaChange}
                        required
                      >
                        <option value="" disabled>Select area</option>
                        {availableAreas.map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="town">3. Town / Neighborhood</label>
                    <select
                      id="town"
                      name="town"
                      value={form.town}
                      onChange={handleTownChange}
                      required
                    >
                      <option value="" disabled>Select town</option>
                      {availableTowns.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                      <option value="other">Other / Not in list…</option>
                    </select>
                  </div>

                  {form.town === 'other' && (
                    <div className="form-group" style={{ marginTop: 8 }}>
                      <label htmlFor="custom_town">Enter Your Specific Town / Area</label>
                      <input
                        id="custom_town"
                        name="custom_town"
                        type="text"
                        value={form.custom_town}
                        onChange={handleCustomTownChange}
                        required
                        placeholder="e.g. Dawhenya, New Bortianor, Prampram"
                      />
                    </div>
                  )}

                  <div className="form-group">
                    <label htmlFor="delivery_address">4. Street Address / House / Landmark</label>
                    <input
                      id="delivery_address"
                      name="delivery_address"
                      type="text"
                      value={form.delivery_address}
                      onChange={handleChange}
                      required
                      autoComplete="street-address"
                      placeholder="e.g. House No. 24, Near Shell Petrol Station / Oxford Street"
                    />
                  </div>

                  <div className="checkout-row">
                    <div className="form-group">
                      <label htmlFor="ghana_post_gps">GhanaPostGPS Code (optional)</label>
                      <span id="gps-hint" className="checkout-field-hint">Format: GA-183-9024</span>
                      <input
                        id="ghana_post_gps"
                        name="ghana_post_gps"
                        type="text"
                        value={form.ghana_post_gps}
                        onChange={handleChange}
                        onBlur={e => setForm(prev => ({
                          ...prev,
                          ghana_post_gps: e.target.value.trim().toUpperCase(),
                        }))}
                        pattern="^\s*[A-Za-z]{2}-\d{3,4}-\d{4}\s*$"
                        autoComplete="postal-code"
                        aria-describedby="gps-hint"
                        placeholder="e.g. GA-183-9024"
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="delivery_landmark">Nearest Landmark (optional)</label>
                      <span id="landmark-hint" className="checkout-field-hint">Helps the rider find you faster</span>
                      <input
                        id="delivery_landmark"
                        name="delivery_landmark"
                        type="text"
                        maxLength={300}
                        value={form.delivery_landmark}
                        onChange={handleChange}
                        aria-describedby="landmark-hint"
                        placeholder="e.g. Opposite Shell station, green gate"
                      />
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
                  autoComplete="tel"
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
                <label htmlFor="checkout-payment-paystack" className={`checkout-method-card${paymentMethod === 'paystack' ? ' is-selected' : ''}`}>
                  <input
                    id="checkout-payment-paystack"
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
                  <label htmlFor="checkout-payment-pod" className={`checkout-method-card${paymentMethod === 'pay_on_delivery' ? ' is-selected' : ''}${!podEligible ? ' is-disabled' : ''}`}>
                    <input
                      id="checkout-payment-pod"
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
                <div className="coupon-applied" role="status">
                  <div>
                    <span className="coupon-tag">{coupon.code}</span>
                    <span className="coupon-desc">
                      {coupon.type === 'percentage'
                        ? `${coupon.value}% off`
                        : `GHS ${coupon.value} off`}
                      {' '}— saving GHS {discountAmount.toFixed(2)}
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
                    id="checkout-coupon-code"
                    name="coupon_code"
                    type="text"
                    placeholder="Enter promo code"
                    value={couponInput}
                    onChange={e => { setCouponInput(e.target.value); setCouponError(''); }}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), applyCoupon())}
                    className="coupon-input"
                    aria-label="Promo code"
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
              {couponError && <p className="coupon-error" role="alert">{couponError}</p>}
            </div>

            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
            />

            <TurnstileWidget
              resetKey={turnstileReset}
              onToken={setTurnstileToken}
              onExpire={() => { setTurnstileToken(''); setTurnstileReset(k => k + 1); }}
            />

            <button
              type="submit"
              className="btn btn-accent btn-full checkout-submit"
              aria-busy={loading}
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
              <span className="checkout-lock" aria-hidden="true">🔒</span>
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
                <p style={{ margin: '0 0 8px' }}>{validationFetchError}</p>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.82rem', padding: '6px 12px' }}
                  onClick={runGuestValidation}
                  disabled={validating}
                >
                  Retry availability check
                </button>
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
                  ? validation?.items?.find(vi => vi.product_id === item.product_id && (vi.variant_id || null) === (item.variant_id || null))
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
                        src={resolveImageUrl(item.image_url) || 'https://placehold.co/80x80?text=?'}
                        alt={item.name}
                      />
                      <span className="checkout-item-badge">{item.quantity}</span>
                    </div>
                    <div className="checkout-item-meta">
                      <span className="checkout-item-name">{item.name}</span>
                      {item.variant_label && (
                        <span style={{ fontSize: '0.76rem', color: 'var(--color-muted)', display: 'block' }}>
                          {item.variant_label}
                        </span>
                      )}
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
                  <span>− GHS {discountAmount.toFixed(2)}</span>
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
