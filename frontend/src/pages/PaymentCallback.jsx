import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { paymentsAPI } from '../services/api';
import { useCart } from '../context/CartContext';

// Seconds to wait on the success screen before auto-redirecting to /orders
const REDIRECT_DELAY = 4;

// This page is the URL Paystack redirects to after the user pays.
// Paystack appends ?reference=... to the URL, which we use to verify the payment.
export default function PaymentCallback() {
  const [searchParams]      = useSearchParams();
  const navigate            = useNavigate();
  const { clearLocalCart, fetchCart } = useCart();
  const reference           = searchParams.get('reference');

  const [status, setStatus]   = useState('verifying'); // 'verifying' | 'success' | 'failed'
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(REDIRECT_DELAY);

  // Keep a stable ref so the countdown interval can read the latest value
  const countdownRef = useRef(REDIRECT_DELAY);

  useEffect(() => {
    if (!reference) {
      setStatus('failed');
      setMessage('No payment reference found. Please contact support.');
      return;
    }

    paymentsAPI.verify(reference)
      .then(() => {
        // Clear the local cart state immediately — the server already deleted
        // the cart rows when the order was created, so a re-fetch returns []
        clearLocalCart();
        // Re-fetch from the server so the cart badge in the nav resets to 0
        fetchCart();
        setStatus('success');
      })
      .catch((err) => {
        setStatus('failed');
        setMessage(
          err.response?.data?.error ||
          'Payment verification failed. If you were charged, please contact support.'
        );
      });
  }, [reference]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start the countdown only after the status flips to 'success'
  useEffect(() => {
    if (status !== 'success') return;

    countdownRef.current = REDIRECT_DELAY;
    setCountdown(REDIRECT_DELAY);

    const interval = setInterval(() => {
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);

      if (countdownRef.current <= 0) {
        clearInterval(interval);
        navigate('/orders');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status, navigate]);

  /* ── Verifying ────────────────────────────── */
  if (status === 'verifying') {
    return (
      <div className="auth-page" style={{ flexDirection: 'column', gap: '16px' }}>
        <div className="spinner" />
        <p style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-body)' }}>
          Verifying your payment…
        </p>
      </div>
    );
  }

  /* ── Success ──────────────────────────────── */
  if (status === 'success') {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '20px' }}>✅</div>

          <span style={{
            display: 'block',
            fontFamily: 'var(--font-body)',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-accent-dark)',
            marginBottom: '10px',
          }}>
            Order Confirmed
          </span>

          <h1 style={{ marginBottom: '12px' }}>Payment Successful!</h1>

          <p style={{ color: 'var(--color-muted)', marginBottom: '8px' }}>
            Your order has been placed. You'll receive a confirmation email shortly.
          </p>

          <p style={{
            fontSize: '0.82rem',
            color: 'var(--color-muted)',
            marginBottom: '28px',
          }}>
            Redirecting to your orders in <strong
              style={{ color: 'var(--color-accent-dark)' }}
            >{countdown}</strong> second{countdown !== 1 ? 's' : ''}…
          </p>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              className="btn btn-accent"
              onClick={() => navigate('/orders')}
            >
              View My Orders
            </button>
            <Link to="/shop" className="btn btn-outline">
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ── Failed ───────────────────────────────── */
  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '20px' }}>❌</div>

        <span style={{
          display: 'block',
          fontFamily: 'var(--font-body)',
          fontSize: '0.72rem',
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--color-error)',
          marginBottom: '10px',
        }}>
          Payment Failed
        </span>

        <h1 style={{ marginBottom: '12px' }}>Something went wrong</h1>

        <p style={{ color: 'var(--color-muted)', marginBottom: '28px' }}>
          {message || 'Your payment could not be processed. No charge was made.'}
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <Link to="/checkout" className="btn btn-accent">
            Try Again
          </Link>
          <Link to="/cart" className="btn btn-outline">
            Back to Cart
          </Link>
        </div>
      </div>
    </div>
  );
}
