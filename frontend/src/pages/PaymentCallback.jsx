import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { paymentsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';

export default function PaymentCallback() {
  const [status, setStatus]     = useState('verifying'); // verifying | success | failed
  const [orderId, setOrderId]   = useState(null);
  const [orderNum, setOrderNum] = useState('');
  const [message, setMessage]   = useState('');
  const { user } = useAuth();
  const { fetchCart, clearLocalCart } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    // Paystack sends either 'reference' or 'trxref' depending on the SDK version
    const reference = params.get('reference') || params.get('trxref');

    if (!reference) {
      setStatus('failed');
      setMessage('No payment reference found. If you completed a payment, please contact support.');
      return;
    }

    paymentsAPI.verify(reference)
      .then(async ({ data }) => {
        setOrderId(data.orderId);
        setOrderNum(data.orderNumber || '');
        setStatus('success');

        // Sync cart state — server cart was already cleared when the order was created,
        // but the React state may be stale if the user navigated back without a full remount.
        if (user) {
          await fetchCart();
        } else {
          await clearLocalCart();
        }

        // Auto-redirect authenticated users to their order after 3 s
        if (user && data.orderId) {
          setTimeout(() => navigate(`/orders/${data.orderId}`), 3000);
        }
      })
      .catch(err => {
        setStatus('failed');
        setMessage(err.response?.data?.error || 'Payment could not be verified. Please contact support.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Verifying ─────────────────────────────────────────────────────────────
  if (status === 'verifying') {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center', padding: '80px 0' }}>
          <div className="spinner" style={{ marginBottom: '24px' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: '8px' }}>
            Confirming your payment…
          </h2>
          <p style={{ color: 'var(--color-muted)' }}>Please wait while we verify your transaction.</p>
        </div>
      </div>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (status === 'failed') {
    return (
      <div className="page-section">
        <div className="container" style={{ maxWidth: '540px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '20px', color: '#c0392b' }}>✗</div>
          <span className="section-label">Payment Status</span>
          <h1 className="page-title">Payment Failed</h1>
          <p style={{ color: 'var(--color-muted)', marginBottom: '32px' }}>{message}</p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/checkout" className="btn btn-accent">Try Again</Link>
            <Link to="/"         className="btn btn-outline">Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  return (
    <div className="page-section">
      <div className="container" style={{ maxWidth: '540px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: 'var(--color-accent)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px', fontSize: '2rem', color: '#fff',
        }}>
          ✓
        </div>

        <span className="section-label">Order Confirmed</span>
        <h1 className="page-title">Payment Successful!</h1>

        {orderNum && (
          <p style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
            Order <strong>#{orderNum}</strong> has been placed.
          </p>
        )}

        <p style={{ color: 'var(--color-muted)', marginBottom: '32px' }}>
          {user
            ? "You'll receive a confirmation email shortly. Redirecting to your order…"
            : "You'll receive a confirmation email with your order details and tracking information."}
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {user && orderId ? (
            <Link to={`/orders/${orderId}`} className="btn btn-accent">View Order</Link>
          ) : (
            <Link to="/" className="btn btn-accent">Continue Shopping</Link>
          )}
          <Link to="/shop" className="btn btn-outline">Browse Products</Link>
        </div>
      </div>
    </div>
  );
}
