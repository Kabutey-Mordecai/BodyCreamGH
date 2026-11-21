import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ordersAPI, deliveriesAPI, reviewsAPI, paymentsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import StarRating from '../components/StarRating';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { isSafePaystackCheckoutUrl } from '../utils/safePaystackUrl';
import './OrderDetail.css';

const ORDER_STATUS_STEPS = [
  { key: 'pending',    label: 'Order Placed' },
  { key: 'confirmed',  label: 'Confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped',    label: 'Shipped' },
  { key: 'delivered',  label: 'Delivered' },
];
const NORMAL_STATUS_KEYS = ORDER_STATUS_STEPS.map(s => s.key);

function getLastNormalIdx(order, log) {
  if (NORMAL_STATUS_KEYS.includes(order.status)) {
    return NORMAL_STATUS_KEYS.indexOf(order.status);
  }
  let maxIdx = 0;
  for (const entry of log) {
    const idx = NORMAL_STATUS_KEYS.indexOf(entry.to_status);
    if (idx > maxIdx) maxIdx = idx;
  }
  return maxIdx;
}

const DELIVERY_STEPS = [
  { key: 'pending',          label: 'Order packed & ready' },
  { key: 'in_transit',       label: 'In transit' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered',        label: 'Delivered' },
];

const money = (value) => `GHS ${parseFloat(value || 0).toFixed(2)}`;

function isTerminalOrder(order) {
  return order?.status === 'cancelled' || order?.status === 'refunded' || order?.refund_status === 'success';
}

function getRefundMessage(order) {
  if (!order) return null;
  if (order.status === 'cancelled' && ['paid', 'payment_review'].includes(order.payment_status) && (order.refund_status || 'not_requested') === 'not_requested') {
    return 'This order was cancelled. A refund may be pending.';
  }
  if (order.refund_status === 'pending') return 'Refund pending';
  if (order.refund_status === 'needs_attention') return 'Refund needs additional details - please contact support';
  if (order.refund_status === 'failed') return 'Refund failed - contact support';
  if (order.status === 'refunded' || order.refund_status === 'success') return 'Refunded';
  return null;
}

export default function OrderDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [order, setOrder]         = useState(null);
  const [delivery, setDelivery]   = useState(null);
  const [statusLog, setStatusLog] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [retryingPay, setRetryingPay]     = useState(false);
  const [retryPayError, setRetryPayError] = useState('');
  const retryPayLock = useRef(false);

  // Cancel request form
  const [cancelFormOpen, setCancelFormOpen] = useState(false);
  const [cancelReason, setCancelReason]     = useState('');
  const [cancelSaving, setCancelSaving]     = useState(false);
  const [cancelError, setCancelError]       = useState('');

  // Return request form
  const [returnFormOpen, setReturnFormOpen] = useState(false);
  const [returnReason, setReturnReason]     = useState('');
  const [returnSaving, setReturnSaving]     = useState(false);
  const [returnError, setReturnError]       = useState('');

  // Review prompt state — only populated for delivered orders when auth'd
  const [reviewedIds, setReviewedIds]   = useState(new Set());
  const [reviewForms, setReviewForms]   = useState({}); // { productId: { rating, title, body } }
  const [reviewErrors, setReviewErrors] = useState({}); // { productId: errorMsg }
  const [reviewSaving, setReviewSaving] = useState({}); // { productId: bool }

  // Silent background poll — only active while a cancel/return is awaiting admin action.
  useEffect(() => {
    if (!order) return;
    const needsPoll =
      (order.cancel_requested && !order.cancel_request_rejected && order.status !== 'cancelled') ||
      (order.return_requested && !order.return_request_rejected && order.status !== 'refunded' && order.refund_status !== 'success');
    if (!needsPoll) return;

    const intervalId = setInterval(() => {
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
        })
        .catch(() => {});
    }, 30000);

    return () => clearInterval(intervalId);
  }, [id, order?.cancel_requested, order?.cancel_request_rejected, order?.status, order?.return_requested, order?.return_request_rejected, order?.refund_status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    setError('');
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
        if (user && orderData.status === 'delivered' && orderData.refund_status !== 'success') {
          ordersAPI.getReviewStatus(id)
            .then(({ data }) => setReviewedIds(new Set(data.reviewed)))
            .catch(() => {});
        }
      })
      .catch(() => setError('Could not load order details. Please try again.'))
      .finally(() => setLoading(false));
  }, [id, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to review prompt if arrived via review link (e.g. from post-delivery email)
  useEffect(() => {
    if (!loading && order?.status === 'delivered' && (searchParams.get('review') === '1' || window.location.hash === '#reviews')) {
      const timer = setTimeout(() => {
        const targetProd = searchParams.get('product');
        const targetEl = targetProd
          ? document.getElementById(`review-card-${targetProd}`) || document.querySelector('.od-review-section')
          : document.querySelector('.od-review-section');
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [loading, order, searchParams]);

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
      showToast('Review submitted — thank you!', 'success');
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

  const handleRequestCancel = async () => {
    if (!cancelReason.trim()) { setCancelError('Please provide a reason.'); return; }
    setCancelSaving(true);
    setCancelError('');
    try {
      await ordersAPI.requestCancel(id, cancelReason.trim());
      setOrder(prev => ({ ...prev, cancel_requested: true, cancel_request_rejected: false }));
      setCancelFormOpen(false);
      setCancelReason('');
      showToast('Cancellation request submitted', 'success');
    } catch (err) {
      setCancelError(err.response?.data?.error || 'Could not submit request. Please try again.');
    } finally {
      setCancelSaving(false);
    }
  };

  const handleRequestReturn = async () => {
    if (!returnReason.trim()) { setReturnError('Please provide a reason.'); return; }
    setReturnSaving(true);
    setReturnError('');
    try {
      await ordersAPI.requestReturn(id, returnReason.trim());
      setOrder(prev => ({ ...prev, return_requested: true, return_request_rejected: false }));
      setReturnFormOpen(false);
      setReturnReason('');
      showToast('Return request submitted', 'success');
    } catch (err) {
      setReturnError(err.response?.data?.error || 'Could not submit request. Please try again.');
    } finally {
      setReturnSaving(false);
    }
  };

  const handleRetryPayment = async () => {
    if (!order || retryPayLock.current) return;
    retryPayLock.current = true;
    let redirecting = false;
    setRetryPayError('');
    setRetryingPay(true);

    try {
      const { data } = await paymentsAPI.initialize(order.id);
      if (!isSafePaystackCheckoutUrl(data?.authorization_url)) {
        throw new Error('Invalid payment redirect URL received. Please try again.');
      }
      try {
        sessionStorage.removeItem('pending_guest_payment');
        sessionStorage.setItem(
          'pending_auth_payment',
          JSON.stringify({ orderId: order.id, orderNumber: order.order_number || '' })
        );
      } catch { /* ignore storage errors */ }
      redirecting = true;
      window.location.assign(data.authorization_url);
    } catch (err) {
      setRetryPayError(err.response?.data?.error || err.message || 'Could not start payment. Please try again.');
    } finally {
      if (!redirecting) {
        retryPayLock.current = false;
        setRetryingPay(false);
      }
    }
  };

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  if (error || !order) {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center', padding: '60px 0' }}>
          <p style={{ marginBottom: '20px', color: 'var(--color-muted)' }}>
            {error || 'Order not found.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {error && (
              <button
                className="btn btn-accent"
                onClick={() => setRetryCount(c => c + 1)}
              >
                Try Again
              </button>
            )}
            <Link to="/orders" className="btn btn-outline">
              Back to Orders
            </Link>
          </div>
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
  const terminalOrder = isTerminalOrder(order);
  const refundMessage = getRefundMessage(order);
  const showReviewPrompt = order.status === 'delivered' &&
    order.refund_status !== 'success' &&
    user &&
    (order.items || []).length > 0;

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '6px' }}>
              <h1 className="page-title" style={{ margin: 0 }}>
                Order #{orderNum}
              </h1>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={(e) => {
                  navigator.clipboard?.writeText(orderNum).catch(() => {});
                  const btn = e.currentTarget;
                  btn.textContent = '✓ Copied';
                  setTimeout(() => { btn.textContent = 'Copy #'; }, 2000);
                }}
              >
                Copy #
              </button>
            </div>
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

        {/* ── Payment pending banner (authenticated retry) ── */}
        {user && order.payment_method === 'paystack' && ['unpaid', 'pending'].includes(order.payment_status) && ['pending', 'confirmed'].includes(order.status) && (
          <section className="order-state-banner order-state-banner--info" role="status" aria-live="polite">
            <div>
              <h2>Payment Pending</h2>
              <p>Your order is reserved, but online payment has not been completed yet.</p>
              {retryPayError && (
                <p className="od-review-error" role="alert" style={{ marginTop: '8px' }}>{retryPayError}</p>
              )}
              <button
                type="button"
                className="btn btn-accent"
                style={{ marginTop: '12px' }}
                disabled={retryingPay}
                aria-busy={retryingPay}
                onClick={handleRetryPayment}
              >
                {retryingPay ? 'Redirecting to Paystack…' : `Pay ${money(order.total_amount)} Now`}
              </button>
            </div>
          </section>
        )}

        {order.status === 'cancelled' && (
          <section className="order-state-banner order-state-banner--cancelled">
            <div>
              <h2>Order cancelled</h2>
              {refundMessage && <p>{refundMessage}</p>}
              {order.cancellation_reason && <p>Reason: {order.cancellation_reason}</p>}
              {order.cancelled_at && (
                <p>Cancelled on {new Date(order.cancelled_at).toLocaleString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}</p>
              )}
            </div>
          </section>
        )}

        {(order.status === 'refunded' || order.refund_status === 'success') && (
          <section className="order-state-banner order-state-banner--refunded">
            <div>
              <h2>Order refunded</h2>
              <p>{order.refund_amount ? `${money(order.refund_amount)} refunded` : 'Your refund has been completed.'}</p>
              {order.refund_method && <p>Method: {order.refund_method}</p>}
              {order.refund_reference && <p>Reference: {order.refund_reference}</p>}
              {order.refunded_at && (
                <p>Refunded on {new Date(order.refunded_at).toLocaleString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}</p>
              )}
            </div>
          </section>
        )}

        {order.refund_status === 'failed' && order.status !== 'refunded' && (
          <section className="order-state-banner order-state-banner--cancelled">
            <div>
              <h2>Refund failed</h2>
              <p>Refund failed - contact support.</p>
              {order.refund_reference && <p>Reference: {order.refund_reference}</p>}
            </div>
          </section>
        )}

        {/* ── Cancel request banner/form ───────────────── */}
        {user && ['pending', 'confirmed'].includes(order.status) && (
          <section className="order-state-banner order-state-banner--info">
            {order.cancel_requested && !order.cancel_request_rejected ? (
              <div>
                <h2>Cancellation requested</h2>
                <p>Your request is pending admin review. We will notify you once processed.</p>
              </div>
            ) : order.cancel_request_rejected ? (
              <div>
                <h2>Cancellation request rejected</h2>
                <p>Your cancellation request was not approved. Contact support for assistance.</p>
                {!cancelFormOpen && (
                  <button
                    className="btn btn-outline"
                    style={{ marginTop: '12px' }}
                    onClick={() => { setCancelFormOpen(true); setCancelError(''); }}
                  >
                    Resubmit request
                  </button>
                )}
              </div>
            ) : (
              <div>
                <h2>Need to cancel?</h2>
                <p>You can request a cancellation while your order is pending or confirmed.</p>
                {!cancelFormOpen && (
                  <button
                    className="btn btn-outline"
                    style={{ marginTop: '12px' }}
                    onClick={() => { setCancelFormOpen(true); setCancelError(''); }}
                  >
                    Request cancellation
                  </button>
                )}
              </div>
            )}
            {cancelFormOpen && (
              <div className="od-request-form">
                <textarea
                  rows={3}
                  className="od-review-input od-review-textarea"
                  placeholder="Please explain why you want to cancel this order…"
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  maxLength={500}
                />
                {cancelError && <p className="od-review-error">{cancelError}</p>}
                <div className="od-request-actions">
                  <button
                    className="btn btn-accent"
                    disabled={cancelSaving}
                    onClick={handleRequestCancel}
                  >
                    {cancelSaving ? 'Submitting…' : 'Submit request'}
                  </button>
                  <button
                    className="btn btn-outline"
                    disabled={cancelSaving}
                    onClick={() => { setCancelFormOpen(false); setCancelError(''); setCancelReason(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Return request banner/form ────────────────── */}
        {user && order.status === 'delivered' &&
          order.payment_status === 'paid' &&
          (!order.refund_status || order.refund_status === 'not_requested') && (
          <section className="order-state-banner order-state-banner--info">
            {order.return_requested && !order.return_request_rejected ? (
              <div>
                <h2>Return requested</h2>
                <p>Your return request is pending admin review. We will notify you once processed.</p>
              </div>
            ) : order.return_request_rejected ? (
              <div>
                <h2>Return request rejected</h2>
                <p>Your return request was not approved. Contact support for assistance.</p>
                {!returnFormOpen && (
                  <button
                    className="btn btn-outline"
                    style={{ marginTop: '12px' }}
                    onClick={() => { setReturnFormOpen(true); setReturnError(''); }}
                  >
                    Resubmit request
                  </button>
                )}
              </div>
            ) : (
              <div>
                <h2>Need a return or refund?</h2>
                <p>Not satisfied with your order? Request a return and our team will review it.</p>
                {!returnFormOpen && (
                  <button
                    className="btn btn-outline"
                    style={{ marginTop: '12px' }}
                    onClick={() => { setReturnFormOpen(true); setReturnError(''); }}
                  >
                    Request return
                  </button>
                )}
              </div>
            )}
            {returnFormOpen && (
              <div className="od-request-form">
                <textarea
                  rows={3}
                  className="od-review-input od-review-textarea"
                  placeholder="Please describe the reason for your return…"
                  value={returnReason}
                  onChange={e => setReturnReason(e.target.value)}
                  maxLength={500}
                />
                {returnError && <p className="od-review-error">{returnError}</p>}
                <div className="od-request-actions">
                  <button
                    className="btn btn-accent"
                    disabled={returnSaving}
                    onClick={handleRequestReturn}
                  >
                    {returnSaving ? 'Submitting…' : 'Submit request'}
                  </button>
                  <button
                    className="btn btn-outline"
                    disabled={returnSaving}
                    onClick={() => { setReturnFormOpen(false); setReturnError(''); setReturnReason(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Order status timeline ──────────────────── */}
        {(() => {
          const osIdx      = getLastNormalIdx(order, statusLog);
          const isTerminal = order.status === 'cancelled' || order.status === 'refunded';
          return (
            <section className="order-section" style={{ marginBottom: '24px' }}>
              <div className="order-section-head"><h2>Order Progress</h2></div>
              <div className="gold-divider" style={{ margin: '0 0 24px' }} />
              <div className="od-os-timeline">
                {ORDER_STATUS_STEPS.map((step, i) => {
                  const done    = i <= osIdx;
                  const current = !isTerminal && i === osIdx;
                  return (
                    <div key={step.key} className={`od-os-step${done ? ' done' : ''}${current ? ' current' : ''}`}>
                      <div className="od-os-dot">{done ? '✓' : i + 1}</div>
                      <div className="od-os-label">{step.label}</div>
                    </div>
                  );
                })}
                {isTerminal && (
                  <div className={`od-os-step od-os-step--terminal ${order.status}`}>
                    <div className="od-os-dot od-os-dot--terminal">✗</div>
                    <div className="od-os-label">
                      {order.status === 'cancelled' ? 'Cancelled' : 'Refunded'}
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* ── Delivery progress timeline ──────────────── */}
        {delivery && !terminalOrder && (
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
            {delivery && !terminalOrder && (
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
        {showReviewPrompt && (
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
                  <div
                    key={pid || i}
                    id={`review-card-${pid}`}
                    className={`od-review-card ${done ? 'od-review-card--done' : ''}`}
                    style={searchParams.get('product') === String(pid) ? { border: '2px solid var(--color-accent)', boxShadow: '0 0 0 3px rgba(201,165,90,0.15)' } : {}}
                  >
                    <div className="od-review-product" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {item.image_url && (
                          <img src={resolveImageUrl(item.image_url)} alt={item.name} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--color-border)' }} />
                        )}
                        <div>
                          <span className="od-review-product-name">{item.name || item.product_name}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)', display: 'block' }}>GHS {parseFloat(item.price_at_purchase || item.price || 0).toFixed(2)}</span>
                        </div>
                      </div>
                      <span className="verified-badge-pill" style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-accent-dark)', background: 'var(--color-accent-light)', padding: '3px 8px', borderRadius: 999 }}>
                        ✓ Verified Purchase
                      </span>
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
        /* ── Order status timeline ──────────────────── */
        .od-os-timeline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          position: relative;
        }
        .od-os-timeline::before {
          content: '';
          position: absolute;
          top: 14px;
          left: 14px;
          right: 14px;
          height: 2px;
          background: var(--color-border);
        }
        .od-os-step {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          flex: 1;
        }
        .od-os-dot {
          width: 28px; height: 28px;
          border-radius: 50%;
          background: var(--color-bg);
          border: 2px solid var(--color-border);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.75rem; font-weight: 600;
          color: var(--color-muted);
        }
        .od-os-step.done .od-os-dot {
          background: var(--color-accent);
          border-color: var(--color-accent);
          color: #fff;
        }
        .od-os-step.current .od-os-dot {
          box-shadow: 0 0 0 4px rgba(201,165,90,0.2);
        }
        .od-os-label {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--color-muted);
          text-align: center;
        }
        .od-os-step.done .od-os-label    { color: var(--color-primary); }
        .od-os-step.current .od-os-label { color: var(--color-accent-dark); }
        .od-os-step--terminal { flex: 1; }
        .od-os-dot--terminal {
          background: #fff0f0;
          border-color: #f2c7c1;
          color: #c0392b;
        }
        .od-os-step--terminal.refunded .od-os-dot--terminal {
          background: #f7f8fa;
          border-color: #d9dde5;
          color: var(--color-muted);
        }
        .od-os-step--terminal .od-os-label { color: var(--color-muted); }
        @media (max-width: 640px) {
          .od-os-label { font-size: 0.6rem; letter-spacing: 0.03em; }
        }

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

        .order-state-banner {
          border-radius: var(--radius-lg);
          padding: 22px 26px;
          margin-bottom: 24px;
          border: 1px solid var(--color-border);
        }
        .order-state-banner h2 {
          font-family: var(--font-display);
          font-size: 1.35rem;
          font-weight: 500;
          margin-bottom: 8px;
        }
        .order-state-banner p {
          margin: 4px 0;
          color: var(--color-text);
          line-height: 1.5;
        }
        .order-state-banner--cancelled {
          background: #fff8f7;
          border-color: #f2c7c1;
        }
        .order-state-banner--refunded {
          background: #f7f8fa;
          border-color: #d9dde5;
        }
        .order-state-banner--info {
          background: #f7f9f2;
          border-color: #c9dba0;
        }

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

        /* ── Request forms ────────────────────────── */
        .od-request-form {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .od-request-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
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
