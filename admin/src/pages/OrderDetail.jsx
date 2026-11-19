import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ordersAPI, settingsAPI, deliveriesAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { printInvoice } from '../utils/printInvoice';

// Fulfilment flow is strictly forward-moving. Skipping to "delivered" is allowed
// if the merchant updates late (e.g. phone-confirmed pickups).
const STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing'];
const REFUNDABLE_STATUSES = ['cancelled', 'delivered'];
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

function refundLabel(order) {
  if (!order) return null;
  if (order.status === 'cancelled' && order.payment_status === 'paid' && (order.refund_status || 'not_requested') === 'not_requested') {
    return { status: 'refund_owed', cls: 'badge-warning', label: 'Refund owed' };
  }
  if (order.refund_status === 'pending') return { status: 'pending', cls: 'badge-warning', label: 'Refund pending' };
  if (order.refund_status === 'failed') return { status: 'failed', cls: 'badge-danger', label: 'Refund failed' };
  if (order.refund_status === 'success') return { status: 'success', cls: 'badge-success', label: 'Refunded' };
  return { status: order.refund_status || 'not_requested', cls: 'badge-neutral', label: 'No refund requested' };
}

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [order, setOrder]     = useState(null);
  const [store, setStore]     = useState({});
  const [delivery, setDelivery] = useState(null);
  const [statusLog, setStatusLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({ method: 'paystack', reference: '', notes: '' });
  const [refundError, setRefundError] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);

  const [requestActionSaving, setRequestActionSaving] = useState(false);
  const [markPaidSaving, setMarkPaidSaving] = useState(false);

  // Delivery form state
  const [deliveryForm, setDeliveryForm] = useState({
    delivery_partner: '', tracking_number: '', estimated_delivery: '', driver_phone: '',
  });
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [deliverySaving, setDeliverySaving] = useState(false);

  const loadDelivery = () => {
    deliveriesAPI.getByOrder(id)
      .then(({ data }) => {
        setDelivery(data);
        setDeliveryStatus(data.status || '');
      })
      .catch(() => setDelivery(null));
  };

  const load = () => {
    setLoading(true);
    ordersAPI.getById(id)
      .then(({ data }) => {
        setOrder(data?.order ? { ...data.order, items: data.items || [] } : data);
      })
      .catch(() => toast.error('Failed to load order'))
      .finally(() => setLoading(false));
    loadDelivery();
    ordersAPI.getStatusLog(id)
      .then(({ data }) => setStatusLog(Array.isArray(data) ? data : []))
      .catch(() => setStatusLog([]));
  };

  useEffect(load, [id]);

  useEffect(() => {
    settingsAPI.getAll().then(({ data }) => setStore(data)).catch(() => {});
  }, []);

  const changeStatus = async (next, note = '') => {
    setSaving(true);
    try {
      await ordersAPI.updateStatus(id, next, note || `Status changed to ${next} by admin`);
      toast.success(`Status updated to ${next}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDelivery = async (e) => {
    e.preventDefault();
    setDeliverySaving(true);
    try {
      await deliveriesAPI.create({ order_id: id, ...deliveryForm });
      toast.success('Delivery created — order marked as shipped');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create delivery');
    } finally {
      setDeliverySaving(false);
    }
  };

  const handleUpdateDelivery = async (e) => {
    e.preventDefault();
    if (!delivery) return;
    setDeliverySaving(true);
    try {
      await deliveriesAPI.update(delivery.id, {
        status: deliveryStatus,
        tracking_number: deliveryForm.tracking_number || undefined,
        estimated_delivery: deliveryForm.estimated_delivery || undefined,
        driver_phone: deliveryForm.driver_phone || undefined,
      });
      toast.success('Delivery updated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update delivery');
    } finally {
      setDeliverySaving(false);
    }
  };

  const handleAdvanceSimulation = async () => {
    if (!delivery?.tracking_number) return;
    setDeliverySaving(true);
    try {
      const { data } = await deliveriesAPI.simulateAdvance(delivery.tracking_number);
      if (data.alreadyDelivered) {
        toast.info('Shipment is already delivered');
      } else {
        toast.success(`Courier advanced: ${data.from} → ${data.to}`);
      }
      loadDelivery();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Simulation failed');
    } finally {
      setDeliverySaving(false);
    }
  };

  const handleCancelOrder = async () => {
    setCancelSaving(true);
    setCancelError('');
    try {
      await ordersAPI.cancelOrder(id, cancelReason);
      toast.success('Order cancelled');
      setCancelOpen(false);
      setCancelReason('');
      load();
    } catch (err) {
      setCancelError(err.response?.data?.error || 'Failed to cancel order');
    } finally {
      setCancelSaving(false);
    }
  };

  const handleRefundOrder = async () => {
    setRefundSaving(true);
    setRefundError('');
    try {
      await ordersAPI.refundOrder(id, {
        method: refundForm.method,
        reference: refundForm.reference || undefined,
        notes: refundForm.notes || undefined,
      });
      toast.success(refundForm.method === 'manual' ? 'Refund marked complete' : 'Paystack refund requested');
      setRefundOpen(false);
      setRefundForm({ method: 'paystack', reference: '', notes: '' });
      load();
    } catch (err) {
      setRefundError(err.response?.data?.error || 'Failed to refund order');
    } finally {
      setRefundSaving(false);
    }
  };

  const handleRequestAction = async (action, label) => {
    setRequestActionSaving(true);
    try {
      await ordersAPI[action](id);
      toast.success(label);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed: ${label}`);
    } finally {
      setRequestActionSaving(false);
    }
  };

  const handleMarkPaid = async () => {
    setMarkPaidSaving(true);
    try {
      await ordersAPI.markPaid(id);
      toast.success('Order marked as paid (Cash/MoMo collected)');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to mark order as paid');
    } finally {
      setMarkPaidSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;
  if (!order) {
    return (
      <div>
        <Link to="/orders" className="muted text-sm">← Back to orders</Link>
        <div className="alert alert-error" style={{ marginTop: 16 }}>Order not found.</div>
      </div>
    );
  }

  const currentIdx = STATUS_FLOW.indexOf(order.status);
  const canShowStatusFlow = currentIdx >= 0;
  const canCancel = CANCELLABLE_STATUSES.includes(order.status);
  const canRefund = order.payment_status === 'paid' &&
    REFUNDABLE_STATUSES.includes(order.status) &&
    !['pending', 'success'].includes(order.refund_status);
  const canMarkPaid = order.payment_method === 'pay_on_delivery' &&
    order.payment_status !== 'paid' &&
    !['cancelled', 'refunded'].includes(order.status);
  const refundInfo = refundLabel(order);
  const subtotal = (order.items || []).reduce((s, it) => s + Number(it.subtotal || (it.price_at_purchase * it.quantity) || 0), 0);

  // Phone from user profile or guest order fields; fallback to notes
  const phoneFromNotes = order.notes?.match(/(?:^|\n)Phone:\s*(.+?)(\n|$)/i)?.[1]?.trim();
  const displayPhone = order.customer_phone || order.guest_phone || phoneFromNotes;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/orders" className="muted text-sm" style={{ textDecoration: 'none' }}>← Back to orders</Link>
          <h1 style={{ marginTop: 6 }}>
            Order #{order.order_number || order.id?.slice(0, 8)}
          </h1>
          <p className="muted">
            Placed {new Date(order.created_at).toLocaleString('en-GH')}
          </p>
        </div>
        <div className="page-actions">
          <StatusBadge status={order.status} />
          <StatusBadge status={order.payment_status} />
          {refundInfo && <span className={`badge ${refundInfo.cls}`}>{refundInfo.label}</span>}
          <button
            className="btn btn-outline"
            onClick={() => printInvoice(order, store)}
            title="Print invoice / packing slip"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ marginRight: 6 }}>
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print invoice
          </button>
        </div>
      </div>

      {/* Status progression tracker */}
      {canShowStatusFlow && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="status-track">
              {STATUS_FLOW.map((s, i) => {
                const done = i <= currentIdx;
                const isCurrent = i === currentIdx;
                return (
                  <div key={s} className={`track-step ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                    <div className="track-dot">{done ? '✓' : i + 1}</div>
                    <div className="track-label">{s}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {STATUS_FLOW.map((s, i) => (
                <button
                  key={s}
                  className={`btn btn-sm ${i === currentIdx + 1 ? 'btn-accent' : 'btn-outline'}`}
                  disabled={saving || i !== currentIdx + 1}
                  onClick={() => setPendingStatus(s)}
                  style={{ textTransform: 'capitalize' }}
                >
                  Mark as {s}
                </button>
              ))}
              {canCancel && (
                <button
                  className="btn btn-sm btn-outline"
                  style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-danger-soft)' }}
                  disabled={saving}
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel order
                </button>
              )}
              {canMarkPaid && (
                <button
                  className="btn btn-sm btn-accent"
                  disabled={markPaidSaving}
                  onClick={handleMarkPaid}
                >
                  {markPaidSaving ? 'Updating…' : '✓ Mark Paid (Cash/MoMo)'}
                </button>
              )}
              {canRefund && (
                <button
                  className="btn btn-sm btn-accent"
                  disabled={refundSaving}
                  onClick={() => setRefundOpen(true)}
                >
                  Refund order
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!canShowStatusFlow && canRefund && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Refund available</div>
              <div className="muted text-sm">Full refund amount: {fmt(order.total_amount)}</div>
            </div>
            <button className="btn btn-accent btn-sm" onClick={() => setRefundOpen(true)} disabled={refundSaving}>
              Refund order
            </button>
          </div>
        </div>
      )}

      {/* ── Cancel request pending banner ──────────────────────── */}
      {order.cancel_requested && !order.cancel_request_rejected && order.status !== 'cancelled' && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--ac-warning, #e8b84b)' }}>
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  ⚠ Customer requested cancellation
                </div>
                {order.cancel_reason && (
                  <div className="muted text-sm" style={{ maxWidth: 480 }}>
                    Reason: {order.cancel_reason}
                  </div>
                )}
                {order.cancel_requested_at && (
                  <div className="muted text-sm">
                    Requested {new Date(order.cancel_requested_at).toLocaleString('en-GH')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={requestActionSaving}
                  onClick={() => handleRequestAction('approveCancelRequest', 'Cancellation approved')}
                >
                  Approve & cancel
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={requestActionSaving}
                  onClick={() => handleRequestAction('rejectCancelRequest', 'Cancellation request rejected')}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Return request pending banner ───────────────────────── */}
      {order.return_requested && !order.return_request_rejected && order.status === 'delivered' && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--ac-info, #5ba4cf)' }}>
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  ↩ Customer requested a return
                </div>
                {order.return_reason && (
                  <div className="muted text-sm" style={{ maxWidth: 480 }}>
                    Reason: {order.return_reason}
                  </div>
                )}
                {order.return_requested_at && (
                  <div className="muted text-sm">
                    Requested {new Date(order.return_requested_at).toLocaleString('en-GH')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn btn-sm btn-accent"
                  disabled={requestActionSaving}
                  onClick={() => handleRequestAction('approveReturnRequest', 'Return approved & refund initiated')}
                >
                  Approve & refund
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={requestActionSaving}
                  onClick={() => handleRequestAction('rejectReturnRequest', 'Return request rejected')}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }} className="od-grid">

        {/* Items */}
        <div className="card">
          <div className="card-header"><h2 className="card-title">Items</h2></div>
          <div style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="cell-right">Qty</th>
                  <th className="cell-right">Unit</th>
                  <th className="cell-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(order.items || []).map(it => (
                  <tr key={it.id}>
                    <td>
                      <Link to={`/products/${it.product_id}`} className="cell-primary">
                        {it.product_name || it.name}
                      </Link>
                    </td>
                    <td className="cell-right">{it.quantity}</td>
                    <td className="cell-right cell-muted">{fmt(it.price_at_purchase || it.price)}</td>
                    <td className="cell-right cell-primary">{fmt(it.subtotal || (it.price_at_purchase * it.quantity))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ padding: 16, borderTop: '1px solid var(--ac-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem' }}>
                <span className="muted">Subtotal</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem' }}>
                <span className="muted">Delivery</span>
                <span>{fmt(order.delivery_fee)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 2px', borderTop: '1px solid var(--ac-border)', marginTop: 6, fontWeight: 600 }}>
                <span>Total</span>
                <span>{fmt(order.total_amount)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Customer + shipping */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="card-title">Customer</h2>
              {order.is_guest && (
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', background: '#3b2d1d', color: '#e5c378', border: '1px solid rgba(201,165,90,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Guest Checkout
                </span>
              )}
            </div>
            <div className="card-body">
              <div style={{ fontSize: '0.96rem', fontWeight: 600, marginBottom: 4 }}>
                {order.first_name || order.customer_name || '—'} {order.last_name || ''}
              </div>
              {order.email && (
                <div className="text-sm muted" style={{ marginBottom: 4 }}>
                  <a href={`mailto:${order.email}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                    ✉️ {order.email}
                  </a>
                </div>
              )}
              {displayPhone && (
                <div className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span>📞 {displayPhone}</span>
                  <a
                    href={`https://wa.me/${displayPhone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="badge"
                    style={{ fontSize: '0.7rem', padding: '2px 7px', textDecoration: 'none', background: '#25D366', color: '#fff', fontWeight: 600, borderRadius: '4px' }}
                  >
                    WhatsApp
                  </a>
                  <a
                    href={`tel:${displayPhone}`}
                    className="badge badge-neutral"
                    style={{ fontSize: '0.7rem', padding: '2px 7px', textDecoration: 'none', borderRadius: '4px' }}
                  >
                    Call
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">{order.fulfillment_method === 'pickup' ? 'Pickup Station' : 'Shipping'}</h2>
              {order.fulfillment_method === 'pickup' && (
                <span className="badge badge-neutral">Pickup</span>
              )}
            </div>
            <div className="card-body">
              <div style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                {order.shipping_address && <div>{order.shipping_address}</div>}
                {(order.shipping_city || order.shipping_region) && (
                  <div>{order.shipping_city}{order.shipping_region ? `, ${order.shipping_region}` : ''}</div>
                )}
                {!order.shipping_address && !order.shipping_city && <div className="muted">Not provided</div>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Payment</h2></div>
            <div className="card-body">
              <div style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="muted">Method</span>
                <span>{order.payment_method === 'pay_on_delivery' ? 'Pay on Delivery' : 'Paystack'}</span>
              </div>
              <div style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="muted">Status</span><StatusBadge status={order.payment_status} />
              </div>
              {order.payment_reference && (
                <div style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  <div className="muted text-xs">Reference</div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>{order.payment_reference}</div>
                </div>
              )}
              {canMarkPaid && (
                <button
                  className="btn btn-accent btn-sm"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={handleMarkPaid}
                  disabled={markPaidSaving}
                >
                  {markPaidSaving ? 'Updating…' : 'Mark Paid (Cash/MoMo Collected)'}
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Refund</h2>
              <span className={`badge ${refundInfo.cls}`}>{refundInfo.label}</span>
            </div>
            <div className="card-body">
              <div className="od-refund-grid">
                <span className="muted">Status</span>
                <StatusBadge status={order.refund_status || 'not_requested'} />
                <span className="muted">Method</span>
                <span>{order.refund_method || '—'}</span>
                <span className="muted">Amount</span>
                <span>{order.refund_amount ? fmt(order.refund_amount) : '—'}</span>
                <span className="muted">Reference</span>
                <span className="mono" style={{ wordBreak: 'break-all' }}>{order.refund_reference || '—'}</span>
                <span className="muted">Requested</span>
                <span>{order.refund_requested_at ? new Date(order.refund_requested_at).toLocaleString('en-GH') : '—'}</span>
                <span className="muted">Refunded</span>
                <span>{order.refunded_at ? new Date(order.refunded_at).toLocaleString('en-GH') : '—'}</span>
              </div>
              {order.refund_notes && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted text-xs">Notes</div>
                  <div style={{ fontSize: '0.86rem', whiteSpace: 'pre-wrap', marginTop: 4 }}>{order.refund_notes}</div>
                </div>
              )}
              {canRefund && (
                <button
                  className="btn btn-accent btn-sm"
                  style={{ width: '100%', marginTop: 14 }}
                  onClick={() => setRefundOpen(true)}
                  disabled={refundSaving}
                >
                  Refund order
                </button>
              )}
            </div>
          </div>

          {order.notes && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Notes</h2></div>
              <div className="card-body">
                <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{order.notes}</div>
              </div>
            </div>
          )}

          {/* ── Delivery management ──────────────────── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Delivery</h2>
              {delivery && <StatusBadge status={delivery.status} />}
            </div>
            <div className="card-body">
              {delivery ? (
                /* Existing delivery — show info + allow status/detail update */
                <form onSubmit={handleUpdateDelivery}>
                  <div style={{ fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {delivery.delivery_partner && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="muted">Courier</span>
                        <span>{delivery.delivery_partner}</span>
                      </div>
                    )}
                    {delivery.tracking_number && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="muted">Tracking #</span>
                        <span className="mono">{delivery.tracking_number}</span>
                      </div>
                    )}
                    {delivery.estimated_delivery && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="muted">Est. delivery</span>
                        <span>{new Date(delivery.estimated_delivery).toLocaleDateString('en-GH')}</span>
                      </div>
                    )}
                    {delivery.driver_phone && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="muted">Driver phone</span>
                        <span>{delivery.driver_phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '0.8rem' }}>Update status</label>
                    <select
                      value={deliveryStatus}
                      onChange={e => setDeliveryStatus(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_transit">In transit</option>
                      <option value="out_for_delivery">Out for delivery</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '0.8rem' }}>Tracking # (update)</label>
                    <input
                      type="text"
                      placeholder={delivery.tracking_number || 'e.g. GH-12345'}
                      value={deliveryForm.tracking_number}
                      onChange={e => setDeliveryForm(f => ({ ...f, tracking_number: e.target.value }))}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-accent btn-sm"
                    style={{ width: '100%' }}
                    disabled={deliverySaving}
                  >
                    {deliverySaving ? 'Saving…' : 'Save changes'}
                  </button>

                  {delivery.tracking_number && delivery.status !== 'delivered' && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', marginTop: 8, fontSize: '0.8rem' }}
                      disabled={deliverySaving}
                      onClick={handleAdvanceSimulation}
                    >
                      ⚡ Advance Courier Stage (Simulation)
                    </button>
                  )}
                </form>
              ) : (
                /* No delivery yet — create one */
                <form onSubmit={handleCreateDelivery}>
                  <p className="muted text-sm" style={{ marginBottom: 12 }}>
                    No delivery record yet. Creating one will mark this order as <strong>shipped</strong> and notify the customer.
                  </p>

                  {[
                    { name: 'delivery_partner',   label: 'Courier / delivery company', placeholder: 'e.g. DHL, Fedex GH, SkyNet' },
                    { name: 'tracking_number',    label: 'Tracking number',            placeholder: 'e.g. GH-123456789' },
                    { name: 'driver_phone',       label: 'Driver phone (optional)',     placeholder: '+233 XX XXX XXXX' },
                  ].map(f => (
                    <div className="form-group" key={f.name} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: '0.8rem' }}>{f.label}</label>
                      <input
                        type="text"
                        placeholder={f.placeholder}
                        value={deliveryForm[f.name]}
                        onChange={e => setDeliveryForm(prev => ({ ...prev, [f.name]: e.target.value }))}
                      />
                    </div>
                  ))}

                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: '0.8rem' }}>Estimated delivery date (optional)</label>
                    <input
                      type="date"
                      value={deliveryForm.estimated_delivery}
                      onChange={e => setDeliveryForm(f => ({ ...f, estimated_delivery: e.target.value }))}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-accent btn-sm"
                    style={{ width: '100%' }}
                    disabled={deliverySaving}
                  >
                    {deliverySaving ? 'Creating…' : 'Create delivery & mark shipped'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status history — rendered below the 2-col grid so it spans full width
          without displacing the Customer column from the right-hand slot */}
      {statusLog.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><h2 className="card-title">Status History</h2></div>
          <div className="card-body">
            <div className="od-admin-log">
              {statusLog.map((entry, i) => (
                <div key={i} className="od-admin-log-entry">
                  <div className="od-admin-log-dot" />
                  <div className="od-admin-log-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {entry.from_status && (
                        <>
                          <StatusBadge status={entry.from_status} />
                          <span style={{ color: 'var(--ac-text-muted)', fontSize: '0.75rem' }}>→</span>
                        </>
                      )}
                      <StatusBadge status={entry.to_status} />
                    </div>
                    {entry.note && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--ac-text-muted)', margin: '4px 0 2px', lineHeight: 1.5 }}>
                        {entry.note}
                      </p>
                    )}
                    <p style={{ fontSize: '0.72rem', color: 'var(--ac-text-muted)', marginTop: 2 }}>
                      {new Date(entry.created_at).toLocaleString('en-GH', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingStatus}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => { const s = pendingStatus; setPendingStatus(null); changeStatus(s); }}
        title={`Mark as ${pendingStatus}?`}
        message={`This will update the order status and may trigger customer notifications.`}
        confirmLabel={`Mark ${pendingStatus}`}
      />

      <Modal
        open={cancelOpen}
        onClose={() => {
          if (!cancelSaving) {
            setCancelOpen(false);
            setCancelError('');
          }
        }}
        title="Cancel order"
        size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setCancelOpen(false)} disabled={cancelSaving}>
              Close
            </button>
            <button className="btn btn-danger" onClick={handleCancelOrder} disabled={cancelSaving}>
              {cancelSaving ? 'Cancelling...' : 'Cancel order'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Reason</label>
          <textarea
            rows={4}
            maxLength={500}
            placeholder="Optional cancellation reason"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
          />
        </div>
        {cancelError && <div className="alert alert-error" style={{ marginTop: 12 }}>{cancelError}</div>}
      </Modal>

      <Modal
        open={refundOpen}
        onClose={() => {
          if (!refundSaving) {
            setRefundOpen(false);
            setRefundError('');
          }
        }}
        title="Refund order"
        size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setRefundOpen(false)} disabled={refundSaving}>
              Close
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRefundOrder}
              disabled={refundSaving || (refundForm.method === 'manual' && !refundForm.reference.trim())}
            >
              {refundSaving ? 'Submitting...' : 'Confirm refund'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <span className="muted">Full refund amount</span>
          <strong>{fmt(order.total_amount)}</strong>
        </div>
        <div className="form-group">
          <label>Method</label>
          <select
            value={refundForm.method}
            onChange={e => setRefundForm(f => ({ ...f, method: e.target.value }))}
          >
            <option value="paystack">Paystack</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Reference{refundForm.method === 'manual' ? '' : ' (optional)'}</label>
          <input
            type="text"
            maxLength={255}
            placeholder={refundForm.method === 'manual' ? 'Required for manual refunds' : 'Optional provider/reference note'}
            value={refundForm.reference}
            onChange={e => setRefundForm(f => ({ ...f, reference: e.target.value }))}
          />
        </div>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Notes</label>
          <textarea
            rows={4}
            maxLength={1000}
            placeholder="Optional refund notes"
            value={refundForm.notes}
            onChange={e => setRefundForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
        {refundForm.method === 'paystack' && (
          <p className="muted text-sm" style={{ marginTop: 10 }}>
            Paystack refunds stay pending until Paystack confirms processing by webhook.
          </p>
        )}
        {refundError && <div className="alert alert-error" style={{ marginTop: 12 }}>{refundError}</div>}
      </Modal>

      <style>{`
        @media (max-width: 900px) {
          .od-grid { grid-template-columns: 1fr !important; }
        }
        .status-track {
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: relative;
        }
        .status-track::before {
          content: '';
          position: absolute;
          top: 14px;
          left: 14px;
          right: 14px;
          height: 2px;
          background: var(--ac-border);
          z-index: 0;
        }
        .track-step {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          flex: 1;
        }
        .track-dot {
          width: 28px; height: 28px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid var(--ac-border-strong);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--ac-text-muted);
        }
        .track-step.done .track-dot {
          background: var(--ac-accent);
          border-color: var(--ac-accent);
          color: #fff;
        }
        .track-step.current .track-dot {
          box-shadow: 0 0 0 4px rgba(201, 165, 90, 0.2);
        }
        .track-label {
          font-size: 0.72rem;
          font-weight: 500;
          letter-spacing: 0.04em;
          color: var(--ac-text-muted);
          text-transform: capitalize;
        }
        .track-step.done .track-label { color: var(--ac-text); }
        .od-admin-log {
          display: flex;
          flex-direction: column;
          border-left: 2px solid var(--ac-border);
          padding-left: 18px;
          margin-left: 8px;
          gap: 0;
        }
        .od-admin-log-entry {
          position: relative;
          padding-bottom: 16px;
        }
        .od-admin-log-entry:last-child { padding-bottom: 0; }
        .od-admin-log-dot {
          position: absolute;
          left: -24px;
          top: 5px;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: var(--ac-accent);
          border: 2px solid var(--ac-bg);
        }
        .od-admin-log-body { }
        .od-refund-grid {
          display: grid;
          grid-template-columns: minmax(92px, auto) 1fr;
          gap: 8px 12px;
          align-items: center;
          font-size: 0.86rem;
        }
      `}</style>
    </div>
  );
}
