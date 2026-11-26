import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { paymentsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { isSafePaystackCheckoutUrl } from '../utils/safePaystackUrl';

const MAX_ATTEMPTS = 5;
const POLL_DELAYS_MS = [1500, 2500, 3500, 4500];
const PENDING_GUEST_KEY = 'pending_guest_payment';
const PENDING_AUTH_KEY  = 'pending_auth_payment';

const PAGE_TITLES = {
  verifying: 'Confirming Payment',
  pending:   'Payment Pending',
  success:   'Payment Successful',
  failed:    'Payment Failed',
  attention: 'Order Needs Attention',
};

function hasCancelledRefundState(data) {
  return data?.order_status === 'cancelled' ||
    data?.order_status === 'refunded' ||
    data?.refund_status === 'pending' ||
    data?.refund_status === 'needs_attention' ||
    data?.refund_status === 'failed' ||
    data?.refund_status === 'success';
}

function readPendingPayment(key, validate) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingPayment(key) {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

export default function PaymentCallback() {
  const [status, setStatus]         = useState('verifying'); // verifying | pending | success | failed | attention
  const [orderId, setOrderId]       = useState(null);
  const [orderNum, setOrderNum]     = useState('');
  const [message, setMessage]       = useState('');
  const [attempt, setAttempt]       = useState(1);
  const [checkSeq, setCheckSeq]     = useState(0);
  const [retryingPay, setRetryingPay] = useState(false);
  const [retryError, setRetryError]   = useState('');
  const [pendingGuest, setPendingGuest] = useState(() =>
    readPendingPayment(PENDING_GUEST_KEY, p => Boolean(p.orderId && p.email))
  );
  const [pendingAuth, setPendingAuth] = useState(() =>
    readPendingPayment(PENDING_AUTH_KEY, p => Boolean(p.orderId))
  );

  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const isAuthed = Boolean(user || token);
  const { fetchCart, clearLocalCart } = useCart();

  const headingRef = useRef(null);
  const retryLock = useRef(false);

  // Sync document title across SPA state transitions (WCAG / accessibility best practice)
  useEffect(() => {
    document.title = PAGE_TITLES[status] || PAGE_TITLES.verifying;
  }, [status]);

  // Move keyboard/screen-reader focus to the state heading when verification completes
  useEffect(() => {
    if (status !== 'verifying' && headingRef.current) {
      headingRef.current.focus();
    }
  }, [status]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');

    if (!reference) {
      setStatus('failed');
      setMessage('No payment reference found. If you completed a payment, please contact support.');
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    let timeoutId = null;

    setStatus('verifying');
    setAttempt(1);
    setRetryError('');

    const syncCartAfterPayment = async () => {
      if (isAuthed) {
        await fetchCart();
      } else {
        await clearLocalCart();
      }
      clearPendingPayment(PENDING_GUEST_KEY);
      clearPendingPayment(PENDING_AUTH_KEY);
      setPendingGuest(null);
      setPendingAuth(null);
    };

    const runAttempt = async (attemptNum) => {
      if (cancelled) return;
      setAttempt(attemptNum);

      try {
        const res = await paymentsAPI.verify(reference, { signal: controller.signal });
        if (cancelled) return;
        const data = res?.data || {};

        if (res.status === 202 || data.status === 'pending') {
          if (attemptNum < MAX_ATTEMPTS) {
            const delay = POLL_DELAYS_MS[attemptNum - 1] ?? 3000;
            timeoutId = setTimeout(() => runAttempt(attemptNum + 1), delay);
            return;
          }
          setStatus('pending');
          setMessage('Your payment is still being confirmed by Paystack (this can take a moment for Mobile Money). You can check again or retry payment.');
          return;
        }

        const resolvedOrderId = data.orderId || pendingAuth?.orderId || pendingGuest?.orderId || null;
        const resolvedOrderNum = data.orderNumber || pendingAuth?.orderNumber || pendingGuest?.orderNumber || '';
        setOrderId(resolvedOrderId);
        setOrderNum(resolvedOrderNum);

        if (data.status === 'attention' || hasCancelledRefundState(data)) {
          setStatus('attention');
          setMessage(
            data.message ||
            'Payment was received, but this order requires support review (for example due to cancellation, duplicate payment, or refund state). Please check your order or contact support.'
          );
          await syncCartAfterPayment();
          return;
        }

        setStatus('success');
        await syncCartAfterPayment();
      } catch (err) {
        if (cancelled || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          return;
        }
        setStatus('failed');
        setMessage(err.response?.data?.error || 'Payment could not be verified or was not completed. Please try again or contact support.');
      }
    };

    runAttempt(1);

    return () => {
      cancelled = true;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [checkSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryOrderId = orderId || pendingAuth?.orderId || null;

  const canRetryPayment = Boolean(
    (pendingGuest?.orderId && pendingGuest?.email) ||
    (isAuthed && retryOrderId)
  );

  const handleRetryPayment = async () => {
    if (retryLock.current) return;
    retryLock.current = true;
    let redirecting = false;
    setRetryError('');
    setRetryingPay(true);

    try {
      const { data } = isAuthed && retryOrderId
        ? await paymentsAPI.initialize(retryOrderId)
        : await paymentsAPI.initializeGuest(pendingGuest.orderId, pendingGuest.email);

      if (!isSafePaystackCheckoutUrl(data?.authorization_url)) {
        throw new Error('Invalid payment redirect URL received. Please try again.');
      }
      redirecting = true;
      window.location.assign(data.authorization_url);
    } catch (err) {
      setRetryError(err.response?.data?.error || err.message || 'Could not restart payment. Please try again.');
    } finally {
      if (!redirecting) {
        retryLock.current = false;
        setRetryingPay(false);
      }
    }
  };

  // ── Verifying ─────────────────────────────────────────────────────────────
  if (status === 'verifying') {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center', padding: '80px 0' }}>
          <div
            className="spinner"
            role="progressbar"
            aria-label="Confirming payment"
            style={{ marginBottom: '24px' }}
          />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: '8px' }}>
            Confirming your payment…
          </h1>
          <p style={{ color: 'var(--color-muted)' }}>
            {attempt > 1
              ? `Checking with Paystack (attempt ${attempt} of ${MAX_ATTEMPTS})…`
              : 'Please wait while we verify your transaction.'}
          </p>
        </div>
      </div>
    );
  }

  // ── Pending (Mobile Money / delayed confirmation) ─────────────────────────
  if (status === 'pending') {
    return (
      <div className="page-section">
        <div className="container" role="status" aria-live="polite" style={{ maxWidth: '540px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
          <div aria-hidden="true" style={{ fontSize: '3.2rem', marginBottom: '20px', color: '#92651e' }}>⏳</div>
          <span className="section-label">Payment Status</span>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">Confirmation Pending</h1>
          <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>{message}</p>
          {retryError && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: '20px' }}>{retryError}</div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => setCheckSeq(s => s + 1)}
            >
              Check Status Again
            </button>
            {canRetryPayment ? (
              <button
                type="button"
                className="btn btn-outline"
                disabled={retryingPay}
                aria-busy={retryingPay}
                onClick={handleRetryPayment}
              >
                {retryingPay ? 'Redirecting…' : 'Retry Payment'}
              </button>
            ) : (
              <Link to={isAuthed ? '/orders' : '/checkout'} className="btn btn-outline">
                {isAuthed ? 'View My Orders' : 'Back to Checkout'}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Failed / Abandoned ────────────────────────────────────────────────────
  if (status === 'failed') {
    return (
      <div className="page-section">
        <div className="container" role="alert" style={{ maxWidth: '540px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
          <div aria-hidden="true" style={{ fontSize: '3.5rem', marginBottom: '20px', color: 'var(--color-error, #8b2222)' }}>✗</div>
          <span className="section-label">Payment Status</span>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">Payment Not Completed</h1>
          <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>{message}</p>
          {retryError && (
            <div className="alert alert-error" style={{ marginBottom: '20px' }}>{retryError}</div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {canRetryPayment ? (
              <button
                type="button"
                className="btn btn-accent"
                disabled={retryingPay}
                aria-busy={retryingPay}
                onClick={handleRetryPayment}
              >
                {retryingPay ? 'Redirecting…' : 'Retry Payment'}
              </button>
            ) : (
              <Link to={isAuthed ? '/orders' : '/checkout'} className="btn btn-accent">
                {isAuthed ? 'View My Orders' : 'Try Again'}
              </Link>
            )}
            <Link to="/" className="btn btn-outline">Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Attention (cancelled/refunded/duplicate review) ───────────────────────
  if (status === 'attention') {
    return (
      <div className="page-section">
        <div className="container" role="status" aria-live="polite" style={{ maxWidth: '540px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
          <div aria-hidden="true" style={{ fontSize: '3.2rem', marginBottom: '20px', color: '#92651e' }}>!</div>
          <span className="section-label">Payment Status</span>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">Order Needs Attention</h1>
          {orderNum && (
            <p style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
              Order <strong>#{orderNum}</strong>
            </p>
          )}
          <p style={{ color: 'var(--color-muted)', marginBottom: '32px' }}>{message}</p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {isAuthed && orderId && <Link to={`/orders/${orderId}`} className="btn btn-accent">View Order</Link>}
            <Link to="/" className="btn btn-outline">Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  return (
    <div className="page-section">
      <div className="container" role="status" aria-live="polite" style={{ maxWidth: '540px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
        <div aria-hidden="true" style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: 'var(--color-accent)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px', fontSize: '2rem', color: '#fff',
        }}>
          ✓
        </div>

        <span className="section-label">Order Confirmed</span>
        <h1 ref={headingRef} tabIndex={-1} className="page-title">Payment Successful!</h1>

        {orderNum && (
          <p style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
            Order <strong>#{orderNum}</strong> has been placed.
          </p>
        )}

        <p style={{ color: 'var(--color-muted)', marginBottom: '32px' }}>
          You&apos;ll receive a confirmation email with your order details and tracking information.
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {isAuthed && orderId ? (
            <Link to={`/orders/${orderId}`} className="btn btn-accent">View Order</Link>
          ) : orderNum ? (
            <Link to={`/track?order_number=${encodeURIComponent(orderNum)}`} className="btn btn-accent">Track Order</Link>
          ) : isAuthed ? (
            <Link to="/orders" className="btn btn-accent">View Orders</Link>
          ) : (
            <Link to="/" className="btn btn-accent">Continue Shopping</Link>
          )}
          <Link to="/shop" className="btn btn-outline">Browse Products</Link>
        </div>
      </div>
    </div>
  );
}
