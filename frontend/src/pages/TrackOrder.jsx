import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trackingAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];

const STATUS_LABELS = {
  pending:    'Pending',
  confirmed:  'Confirmed',
  processing: 'Processing',
  shipped:    'Shipped',
  delivered:  'Delivered',
  cancelled:  'Cancelled',
  refunded:   'Refunded',
};

const STATUS_COLORS = {
  pending:    { bg: '#fff8e6', color: '#b5700a' },
  confirmed:  { bg: '#e8f0fe', color: '#1a56db' },
  processing: { bg: '#ede9fe', color: '#6d28d9' },
  shipped:    { bg: '#e0f2fe', color: '#0369a1' },
  delivered:  { bg: '#e6f4ea', color: '#1a7a34' },
  cancelled:  { bg: '#fdecea', color: '#b71c1c' },
  refunded:   { bg: '#e0f2fe', color: '#0369a1' },
};

function StatusBadge({ status }) {
  const { bg, color } = STATUS_COLORS[status] || { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span style={{
      background: bg, color, borderRadius: 9999,
      padding: '4px 14px', fontSize: '0.85rem', fontWeight: 700,
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function StatusTracker({ status }) {
  const currentIdx = ORDER_STATUSES.indexOf(status);
  if (currentIdx === -1) return null; // cancelled — don't show tracker

  return (
    <div style={{ margin: '24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        {/* connecting line */}
        <div style={{
          position: 'absolute', top: 16, left: '5%', right: '5%',
          height: 2, background: 'var(--color-border)', zIndex: 0,
        }} />
        <div style={{
          position: 'absolute', top: 16, left: '5%',
          width: `${Math.max(0, (currentIdx / (ORDER_STATUSES.length - 1)) * 90)}%`,
          height: 2, background: 'var(--color-accent)', zIndex: 1, transition: 'width 0.4s',
        }} />

        {ORDER_STATUSES.map((s, i) => {
          const done    = i <= currentIdx;
          const current = i === currentIdx;
          return (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: done ? 'var(--color-accent)' : 'var(--color-surface)',
                border: `2px solid ${done ? 'var(--color-accent)' : 'var(--color-border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: current ? '0 0 0 4px rgba(201,165,90,0.2)' : 'none',
                transition: 'all 0.3s',
              }}>
                {done && <span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 700 }}>✓</span>}
              </div>
              <span style={{
                marginTop: 6, fontSize: '0.68rem', fontWeight: current ? 700 : 500,
                color: done ? 'var(--color-accent-dark)' : 'var(--color-muted)',
                textAlign: 'center', textTransform: 'capitalize',
              }}>
                {STATUS_LABELS[s]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TrackOrder() {
  const [form,    setForm]    = useState({ order_number: '', email: '' });
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const { data } = await trackingAPI.track(form.order_number.trim(), form.email.trim());
      setResult(data);
    } catch (err) {
      setError(
        err.response?.data?.error ||
        err.response?.data?.message ||
        'We couldn\'t find that order. Please check your order number and email address and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError('');
    setForm({ order_number: '', email: '' });
  };

  return (
    <div className="page-section" style={{ minHeight: '60vh' }}>
      <div className="container" style={{ maxWidth: 520, margin: '0 auto', padding: '48px 16px' }}>

        {!result ? (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 500, marginBottom: 8, textAlign: 'center' }}>
              Track your order
            </h1>
            <p style={{ color: 'var(--color-muted)', textAlign: 'center', marginBottom: 32, fontSize: '0.95rem' }}>
              Enter your order number and email address to check your order status.
            </p>

            <form
              onSubmit={handleSubmit}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: 32,
              }}
            >
              <div className="field" style={{ marginBottom: 20 }}>
                <label htmlFor="track_order_number" style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '0.88rem' }}>
                  Order number
                </label>
                <input
                  id="track_order_number"
                  name="order_number"
                  type="text"
                  value={form.order_number}
                  onChange={e => setForm(f => ({ ...f, order_number: e.target.value }))}
                  placeholder="e.g. ORD-20240429-XXXX"
                  required
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div className="field" style={{ marginBottom: 24 }}>
                <label htmlFor="track_email" style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '0.88rem' }}>
                  Email address
                </label>
                <input
                  id="track_email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="The email used when ordering"
                  required
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              {error && (
                <p style={{ color: 'var(--color-danger, #b71c1c)', fontSize: '0.88rem', marginBottom: 16 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-accent btn-full"
                disabled={loading}
              >
                {loading ? 'Tracking…' : 'Track Order'}
              </button>
            </form>
          </>
        ) : (
          <>
            {/* ── Result view ── */}
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 28 }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Order</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{result.order_number}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: 2 }}>
                    Placed {new Date(result.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                </div>
                <StatusBadge status={result.status} />
              </div>

              {/* Progress tracker */}
              <StatusTracker status={result.status} />

              {/* Delivery info */}
              {result.delivery && (
                <div style={{ background: 'var(--color-blush)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Delivery Info</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '0.85rem' }}>
                    {result.delivery.delivery_partner && (
                      <>
                        <span style={{ color: 'var(--color-muted)' }}>Courier</span>
                        <span style={{ fontWeight: 600 }}>{result.delivery.delivery_partner}</span>
                      </>
                    )}
                    {result.delivery.tracking_number && (
                      <>
                        <span style={{ color: 'var(--color-muted)' }}>Tracking #</span>
                        <span style={{ fontWeight: 600 }}>{result.delivery.tracking_number}</span>
                      </>
                    )}
                    {result.delivery.estimated_delivery && (
                      <>
                        <span style={{ color: 'var(--color-muted)' }}>Est. Delivery</span>
                        <span style={{ fontWeight: 600 }}>
                          {new Date(result.delivery.estimated_delivery).toLocaleDateString('en-GH', { day: 'numeric', month: 'long' })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Items */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, marginBottom: 10, fontSize: '0.9rem' }}>Items</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(result.items || []).map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {item.image_url && (
                        <img
                          src={resolveImageUrl(item.image_url)}
                          alt={item.name}
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                          onError={e => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.name}</div>
                        {item.variant_label && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>{item.variant_label}</div>
                        )}
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Qty: {item.quantity}</div>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', flexShrink: 0 }}>
                        GHS {parseFloat(item.price).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ship to */}
              {(result.shipping_address?.city || result.shipping_address?.region) && (
                <div style={{ fontSize: '0.85rem', color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 14, marginBottom: 8 }}>
                  Shipping to: <strong>{[result.shipping_address.city, result.shipping_address.region].filter(Boolean).join(', ')}</strong>
                </div>
              )}
            </div>

            {/* Track another */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button
                onClick={handleReset}
                style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem' }}
              >
                Track another order
              </button>
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          Have an account? <Link to="/orders" style={{ color: 'var(--color-accent)' }}>View all your orders →</Link>
        </div>
      </div>
    </div>
  );
}
