import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ordersAPI, deliveriesAPI, reviewsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import StarRating from '../components/StarRating';
import './OrderDetail.css';

const DELIVERY_STEPS = [
  { key: 'pending',          label: 'Order packed & ready' },
  { key: 'in_transit',       label: 'In transit' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered',        label: 'Delivered' },
];

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [order, setOrder]         = useState(null);
  const [delivery, setDelivery]   = useState(null);
  const [statusLog, setStatusLog] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  // Review prompt state — only populated for delivered orders when auth'd
  const [reviewedIds, setReviewedIds]   = useState(new Set());
  const [reviewForms, setReviewForms]   = useState({}); // { productId: { rating, title, body } }
  const [reviewErrors, setReviewErrors] = useState({}); // { productId: errorMsg }
  const [reviewSaving, setReviewSaving] = useState({}); // { productId: bool }

  useEffect(() => {
    Promise.all([
      ordersAPI.getById(id),
      deliveriesAPI.getByOrder(id).catch(() => null),
      ordersAPI.getStatusLog(id).catch(() => null),
    ])
      .then(([orderRes, deliveryRes, logRes]) => {
        const { order: orderData, items } = orderRes.data;
        setOrder({ ...orderData, items });
        setDelivery(deliveryRes?.data || null);
        setStatusLog(Array.isArray(logRes?.data) ? logRes.data : []);

        // Pre-populate which items were already reviewed (only for logged-in users)
        if (user && orderData.status === 'delivered') {
          ordersAPI.getReviewStatus(id)
            .then(({ data }) => setReviewedIds(new Set(data.reviewed)))
            .catch(() => {});
        }
      })
      .catch(() => setError('Order not found.'))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateReviewForm = (productId, field, value) =>
    setReviewForms(prev => ({
      ...prev,
      [productId]: { rating: 0, title: '', body: '', ...prev[productId], [field]: value },
    }));

  const submitReview = async (productId) => {
    const form = reviewForms[productId] || {};
    if (!form.rating) {
      setReviewErrors(prev => ({ ...prev, [productId]: 'Please select a star rating.' }));
      return;
    }
    setReviewSaving(prev => ({ ...prev, [productId]: true }));
    setReviewErrors(prev => ({ ...prev, [productId]: '' }));
    try {
      await reviewsAPI.create(productId, { rating: form.rating, title: form.title, body: form.body });
      setReviewedIds(prev => new Set([...prev, productId]));
    } catch (err) {
      const msg = err.response?.status === 409
        ? 'You already reviewed this product.'
        : err.response?.data?.error || 'Could not submit review. Please try again.';
      if (err.response?.status === 409) {
        setReviewedIds(prev => new Set([...prev, productId]));
      } else {
        setReviewErrors(prev => ({ ...prev, [productId]: msg }));
      }
    } finally {
      setReviewSaving(prev => ({ ...prev, [productId]: false }));
    }
  };

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  if (error || !order) {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center' }}>
          <p>{error || 'Order not found.'}</p>
          <Link to="/orders" className="btn btn-outline" style={{ marginTop: '16px' }}>
            Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const orderNum = order.order_number || order.id.slice(0, 8).toUpperCase();

  const phoneMatch = order.notes?.match(/^Phone:\s*(.+?)(\n|$)/i);
  const phone = order.customer_phone || (phoneMatch ? phoneMatch[1].trim() : null);

  // Compute subtotal from items; fall back to total_amount - delivery_fee
  const itemsSubtotal = (order.items || []).reduce(
    (s, item) => s + parseFloat(item.price_at_purchase || item.price) * item.quantity, 0
  );
  const subtotal = itemsSubtotal > 0
    ? itemsSubtotal
    : parseFloat(order.total_amount) - parseFloat(order.delivery_fee || 0);

  const deliveryStepIdx = DELIVERY_STEPS.findIndex(s => s.key === delivery?.status);

  return (
    <div className="page-section">
      <div className="container">
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <Link to="/orders">My Orders</Link>
          <span>/</span>
          <span>#{orderNum}</span>
        </nav>

        {/* Header */}
        <div className="order-detail-header">
          <div>
            <span className="section-label">Order Receipt</span>
            <h1 className="page-title" style={{ marginBottom: '6px' }}>
              Order #{orderNum}
            </h1>
            <p className="order-detail-date">
              Placed on{' '}
              {new Date(order.created_at).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
          </div>
          <span className={`badge badge-${order.status} order-detail-badge`}>
            {order.status}
          </span>
        </div>

        {/* ── Delivery progress timeline ──────────────── */}
        {delivery && (
          <section className="order-section" style={{ marginBottom: '24px' }}>
            <div className="order-section-head"><h2>Shipment Progress</h2></div>
            <div className="gold-divider" style={{ margin: '0 0 24px' }} />

            <div className="od-timeline">
              {DELIVERY_STEPS.map((step, i) => {
                const done    = i <= deliveryStepIdx;
                const current = i === deliveryStepIdx;
                return (
                  <div key={step.key} className={`od-tl-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                    <div className="od-tl-dot">{done ? '✓' : i + 1}</div>
                    <div className="od-tl-label">{step.label}</div>
                  </div>
                );
              })}
            </div>

            {delivery.tracking_number && (
              <p style={{ marginTop: '20px', fontSize: '0.85rem', color: 'var(--color-muted)', textAlign: 'center' }}>
                Tracking number: <strong style={{ color: 'var(--color-primary)', letterSpacing: '0.05em' }}>{delivery.tracking_number}</strong>
                {delivery.delivery_partner && ` · ${delivery.delivery_partner}`}
              </p>
            )}
            {delivery.estimated_delivery && order.status !== 'delivered' && (
              <p style={{ fontSize: '0.83rem', color: 'var(--color-muted)', textAlign: 'center', marginTop: '4px' }}>
                Estimated delivery:{' '}
                <strong>{new Date(delivery.estimated_delivery).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
              </p>
            )}
          </section>
        )}

        <div className="order-detail-grid">
          {/* ── Items ordered ──────────────────────────── */}
          <section className="order-section">
            <div className="order-section-head"><h2>Items</h2></div>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            <ul className="order-items-list">
              {(order.items || []).map((item, i) => (
                <li key={i} className="order-item">
                  <div className="order-item-meta">
                    <span className="order-item-name">{item.name || item.product_name}</span>
                    <span className="order-item-qty">Qty × {item.quantity}</span>
                  </div>
                  <span className="order-item-amt">
                    GHS {(parseFloat(item.price_at_purchase || item.price) * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="order-totals">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>GHS {subtotal.toFixed(2)}</span>
              </div>
              {order.delivery_fee != null && (
                <div className="summary-row">
                  <span>Delivery</span>
                  <span>{parseFloat(order.delivery_fee) === 0 ? 'Free' : `GHS ${parseFloat(order.delivery_fee).toFixed(2)}`}</span>
                </div>
              )}
              <div className="summary-row summary-total">
                <span>Total paid</span>
                <span>GHS {parseFloat(order.total_amount).toFixed(2)}</span>
              </div>
            </div>

            {/* ── Order status history ──────────────── */}
            {statusLog.length > 0 && (
              <div style={{ marginTop: '28px' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 500, marginBottom: '12px' }}>
                  Status History
                </h3>
                <div className="od-status-log">
                  {statusLog.map((entry, i) => (
                    <div key={i} className="od-log-entry">
                      <div className="od-log-dot" />
                      <div className="od-log-body">
                        <div className="od-log-status">
                          {entry.from_status && (
                            <><span className={`badge badge-${entry.from_status}`}>{entry.from_status}</span>
                            <span style={{ margin: '0 6px', color: 'var(--color-muted)', fontSize: '0.75rem' }}>→</span></>
                          )}
                          <span className={`badge badge-${entry.to_status}`}>{entry.to_status}</span>
                        </div>
                        {entry.note && (
                          <p className="od-log-note">{entry.note}</p>
                        )}
                        <p className="od-log-time">
                          {new Date(entry.created_at).toLocaleString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <div className="order-detail-side">
            {/* ── Delivery address ──────────────────────── */}
            <section className="order-section">
              <div className="order-section-head"><h2>Delivery Address</h2></div>
              <div className="gold-divider" style={{ margin: '0 0 16px' }} />
              <p className="order-address">
                {order.shipping_address || '—'}
                {order.shipping_city ? `, ${order.shipping_city}` : ''}
                {order.shipping_region ? `, ${order.shipping_region}` : ''}
              </p>
              {phone && <p className="order-phone">{phone}</p>}
            </section>

            {/* ── Tracking details ─────────────────────── */}
            {delivery && (
              <section className="order-section">
                <div className="order-section-head"><h2>Tracking</h2></div>
                <div className="gold-divider" style={{ margin: '0 0 16px' }} />

                <div className="tracking-row">
                  <span className="tracking-label">Status</span>
                  <span className={`badge badge-${delivery.status}`}>
                    {delivery.status?.replace(/_/g, ' ')}
                  </span>
                </div>

                {delivery.delivery_partner && (
                  <div className="tracking-row">
                    <span className="tracking-label">Courier</span>
                    <span>{delivery.delivery_partner}</span>
                  </div>
                )}

                {delivery.tracking_number && (
                  <div className="tracking-row">
                    <span className="tracking-label">Tracking #</span>
                    <span className="tracking-value">{delivery.tracking_number}</span>
                  </div>
                )}

                {delivery.estimated_delivery && (
                  <div className="tracking-row">
                    <span className="tracking-label">Est. Delivery</span>
                    <span>
                      {new Date(delivery.estimated_delivery).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                  </div>
                )}

                {delivery.actual_delivery_date && (
                  <div className="tracking-row">
                    <span className="tracking-label">Delivered on</span>
                    <span>
                      {new Date(delivery.actual_delivery_date).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* ── Review prompt — shown only on delivered orders for logged-in users ── */}
        {order.status === 'delivered' && user && (order.items || []).length > 0 && (
          <section className="order-section od-review-section">
            <div className="order-section-head">
              <h2>How did we do?</h2>
            </div>
            <div className="gold-divider" style={{ margin: '0 0 24px' }} />
            <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '24px' }}>
              Your feedback helps other shoppers and keeps our quality high. Thank you!
            </p>

            <div className="od-review-list">
              {(order.items || []).map((item, i) => {
                const pid  = item.product_id;
                const done = reviewedIds.has(pid);
                const form = reviewForms[pid] || { rating: 0, title: '', body: '' };

                return (
                  <div key={pid || i} className={`od-review-card ${done ? 'od-review-card--done' : ''}`}>
                    <div className="od-review-product">
                      <span className="od-review-product-name">{item.name || item.product_name}</span>
                    </div>

                    {done ? (
                      <div className="od-review-thankyou">
                        <span className="od-review-check">✓</span> Thank you for your review!
                      </div>
                    ) : (
                      <div className="od-review-form">
                        <StarRating
                          value={form.rating}
                          interactive
                          size="lg"
                          onChange={v => updateReviewForm(pid, 'rating', v)}
                        />
                        <input
                          type="text"
                          placeholder="Review title (optional)"
                          value={form.title}
                          onChange={e => updateReviewForm(pid, 'title', e.target.value)}
                          className="od-review-input"
                        />
                        <textarea
                          rows={3}
                          placeholder="Tell us what you think…"
                          value={form.body}
                          onChange={e => updateReviewForm(pid, 'body', e.target.value)}
                          className="od-review-input od-review-textarea"
                        />
                        {reviewErrors[pid] && (
                          <p className="od-review-error">{reviewErrors[pid]}</p>
                        )}
                        <button
                          className="btn btn-accent"
                          style={{ marginTop: '8px' }}
                          disabled={reviewSaving[pid]}
                          onClick={() => submitReview(pid)}
                        >
                          {reviewSaving[pid] ? 'Submitting…' : 'Submit Review'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <Link to="/orders" className="btn btn-outline" style={{ marginTop: '32px' }}>
          ← Back to Orders
        </Link>
      </div>

      <style>{`
        /* ── Delivery timeline ─────────────────────── */
        .od-timeline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          position: relative;
        }
        .od-timeline::before {
          content: '';
          position: absolute;
          top: 14px;
          left: 14px;
          right: 14px;
          height: 2px;
          background: var(--color-border);
        }
        .od-tl-step {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          flex: 1;
        }
        .od-tl-dot {
          width: 28px; height: 28px;
          border-radius: 50%;
          background: var(--color-bg);
          border: 2px solid var(--color-border);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.75rem; font-weight: 600;
          color: var(--color-muted);
        }
        .od-tl-step.done .od-tl-dot {
          background: var(--color-accent);
          border-color: var(--color-accent);
          color: #fff;
        }
        .od-tl-step.current .od-tl-dot {
          box-shadow: 0 0 0 4px rgba(201,165,90,0.2);
        }
        .od-tl-label {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--color-muted);
          text-align: center;
        }
        .od-tl-step.done .od-tl-label { color: var(--color-primary); }

        /* ── Status log ────────────────────────────── */
        .od-status-log {
          display: flex;
          flex-direction: column;
          gap: 0;
          border-left: 2px solid var(--color-border);
          padding-left: 18px;
          margin-left: 8px;
        }
        .od-log-entry {
          position: relative;
          padding-bottom: 18px;
        }
        .od-log-entry:last-child { padding-bottom: 0; }
        .od-log-dot {
          position: absolute;
          left: -24px;
          top: 5px;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: var(--color-accent);
          border: 2px solid var(--color-bg);
        }
        .od-log-body { }
        .od-log-status {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }
        .od-log-note {
          font-size: 0.82rem;
          color: var(--color-muted);
          margin: 2px 0 4px;
          line-height: 1.5;
        }
        .od-log-time {
          font-size: 0.72rem;
          color: var(--color-muted);
          letter-spacing: 0.03em;
        }

        @media (max-width: 640px) {
          .od-tl-label { font-size: 0.62rem; }
        }

        /* ── Review section ───────────────────────── */
        .od-review-section { margin-top: 32px; }
        .od-review-list {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .od-review-card {
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          padding: 20px 24px;
          background: var(--color-surface);
        }
        .od-review-card--done {
          background: var(--color-bg);
          border-color: var(--color-accent);
          opacity: 0.85;
        }
        .od-review-product { margin-bottom: 14px; }
        .od-review-product-name {
          font-family: var(--font-display);
          font-size: 1rem;
          font-weight: 500;
          color: var(--color-primary);
        }
        .od-review-form { display: flex; flex-direction: column; gap: 10px; }
        .od-review-input {
          width: 100%;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          font-size: 0.9rem;
          font-family: inherit;
          background: var(--color-bg);
          color: var(--color-primary);
          box-sizing: border-box;
        }
        .od-review-input:focus { outline: none; border-color: var(--color-accent); }
        .od-review-textarea { resize: vertical; }
        .od-review-error {
          font-size: 0.82rem;
          color: #c0392b;
          margin: 0;
        }
        .od-review-thankyou {
          font-size: 0.9rem;
          color: var(--color-accent-dark);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .od-review-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px; height: 22px;
          border-radius: 50%;
          background: var(--color-accent);
          color: #fff;
          font-size: 0.75rem;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
