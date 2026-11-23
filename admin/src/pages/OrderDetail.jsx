import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ordersAPI, settingsAPI, deliveriesAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { printInvoice } from '../utils/printInvoice';
import { printWaybill } from '../utils/printWaybill';
import { resolveImageUrl } from '../utils/resolveImageUrl';

// Fulfilment flow is strictly forward-moving. Skipping to "delivered" is allowed
// if the merchant updates late (e.g. phone-confirmed pickups).
const STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing'];
const REFUNDABLE_STATUSES = ['cancelled', 'delivered'];
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

function refundLabel(order) {
  if (!order) return null;
  if (order.status === 'cancelled' && ['paid', 'payment_review'].includes(order.payment_status) && (order.refund_status || 'not_requested') === 'not_requested') {
    return { status: 'refund_owed', cls: 'badge-warning', label: 'Refund owed' };
  }
  if (order.refund_status === 'pending') return { status: 'pending', cls: 'badge-warning', label: 'Refund pending' };
  if (order.refund_status === 'needs_attention') return { status: 'needs_attention', cls: 'badge-warning', label: 'Needs attention' };
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
  const [codModalOpen, setCodModalOpen]     = useState(false);
  const [codFromDeliver, setCodFromDeliver] = useState(false);
  const [codForm, setCodForm]               = useState({
    collection_method: 'cash',
    reference: '',
    collected_by: '',
    mark_delivered: false,
    note: '',
  });
  const [payments, setPayments] = useState([]);
  const [dupRefundingId, setDupRefundingId] = useState(null);
  const [partialReturns, setPartialReturns] = useState([]);
  const [returnableItems, setReturnableItems] = useState([]);
  const [retActionId, setRetActionId] = useState(null);
  const [retOptions, setRetOptions] = useState({});
  const [adminRetOpen, setAdminRetOpen] = useState(false);
  const [adminRetQty, setAdminRetQty] = useState({});
  const [adminRetReason, setAdminRetReason] = useState('');
  const [adminRetSaving, setAdminRetSaving] = useState(false);

  // Delivery form state
  const [deliveryForm, setDeliveryForm] = useState({
    delivery_partner: '', tracking_number: '', estimated_delivery: '', driver_phone: '',
  });
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [podSending, setPodSending]         = useState(false);
  const [podLinkInfo, setPodLinkInfo]       = useState(null);

  const [knownPartners, setKnownPartners]   = useState([]);
  const [manifestInfo, setManifestInfo]     = useState(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  const loadDelivery = () => {
    deliveriesAPI.getPartners()
      .then(({ data }) => setKnownPartners(Array.isArray(data?.partners) ? data.partners : []))
      .catch(() => {});
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
        setPayments(Array.isArray(data?.payments) ? data.payments : []);
      })
      .catch(() => toast.error('Failed to load order'))
      .finally(() => setLoading(false));
    loadDelivery();
    ordersAPI.getStatusLog(id)
      .then(({ data }) => setStatusLog(Array.isArray(data) ? data : []))
      .catch(() => setStatusLog([]));
    ordersAPI.getOrderReturns(id)
      .then(({ data }) => {
        setPartialReturns(Array.isArray(data?.returns) ? data.returns : []);
        setReturnableItems(Array.isArray(data?.returnable_items) ? data.returnable_items : []);
      })
      .catch(() => { setPartialReturns([]); setReturnableItems([]); });
  };

  useEffect(load, [id]);

  useEffect(() => {
    settingsAPI.getAll().then(({ data }) => setStore(data)).catch(() => {});
  }, []);

  const handleRefundDuplicate = async (payment) => {
    if (!window.confirm(`Refund duplicate Paystack payment ${payment.paystack_reference} (GHS ${Number(payment.amount || 0).toFixed(2)})?`)) {
      return;
    }
    setDupRefundingId(payment.id);
    try {
      await ordersAPI.refundDuplicatePayment(id, payment.id);
      toast.success(`Duplicate payment ${payment.paystack_reference} refunded`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to refund duplicate payment');
    } finally {
      setDupRefundingId(null);
    }
  };

  const handleAdminCreateReturn = async () => {
    const items = Object.entries(adminRetQty)
      .filter(([, q]) => Number(q) > 0)
      .map(([order_item_id, quantity]) => ({ order_item_id, quantity: Number(quantity) }));
    if (items.length === 0) return toast.error('Select at least one item');
    if (adminRetReason.trim().length < 3) return toast.error('Enter a return reason');
    setAdminRetSaving(true);
    try {
      await ordersAPI.adminCreatePartialReturn(id, { items, reason: adminRetReason.trim() });
      toast.success('Return request created on behalf of customer');
      setAdminRetOpen(false);
      setAdminRetQty({});
      setAdminRetReason('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create return request');
    } finally {
      setAdminRetSaving(false);
    }
  };

  const handleApprovePartialReturn = async (rr) => {
    const opts = retOptions[rr.id] || { restock_items: false, include_delivery_fee: false };
    const isRetry = rr.status === 'refund_failed';
    if (!window.confirm(`${isRetry ? 'Retry refund' : 'Approve & refund'} GHS ${Number(rr.refund_amount || 0).toFixed(2)} for this return request?`)) {
      return;
    }
    setRetActionId(rr.id);
    try {
      const { data } = await ordersAPI.approvePartialReturn(rr.id, isRetry ? {} : opts);
      toast.success(data?.message || 'Return refund submitted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to process return refund');
    } finally {
      setRetActionId(null);
    }
  };

  const handleRejectPartialReturn = async (rr) => {
    const reason = window.prompt('Reason for rejecting this return request (optional):') ?? '';
    setRetActionId(rr.id);
    try {
      await ordersAPI.rejectPartialReturn(rr.id, { reason });
      toast.success('Return request rejected');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reject return request');
    } finally {
      setRetActionId(null);
    }
  };

  const openCodModal = (fromDeliver = false) => {
    setCodFromDeliver(fromDeliver);
    setCodForm({
      collection_method: 'cash',
      reference: '',
      collected_by: delivery?.delivery_partner || '',
      mark_delivered: fromDeliver || order?.status === 'shipped',
      note: '',
    });
    setCodModalOpen(true);
  };

  const changeStatus = async (next, note = '', { bypassCodGuard = false } = {}) => {
    if (
      !bypassCodGuard &&
      next === 'delivered' &&
      order?.payment_method === 'pay_on_delivery' &&
      !['paid', 'partially_refunded', 'refunded'].includes(order?.payment_status)
    ) {
      openCodModal(true);
      return;
    }
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
        setDelivery(prev => (prev ? { ...prev, status: data.to } : prev));
        setDeliveryStatus(data.to);
        toast.success(`Courier stage updated: ${data.from.replace(/_/g, ' ')} → ${data.to.replace(/_/g, ' ')}`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to advance courier stage');
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
      const res = await ordersAPI.refundOrder(id, {
        method: refundForm.method,
        reference: refundForm.reference || undefined,
        notes: refundForm.notes || undefined,
      });
      const fallbackMsg = refundForm.method === 'manual' ? 'Refund marked complete' : 'Paystack refund requested';
      const msg = res.data?.message || fallbackMsg;
      if (res.status === 202 || res.data?.order?.refund_status === 'needs_attention') {
        toast.info(msg);
      } else {
        toast.success(msg);
      }
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

  const handleSendPodOtp = async () => {
    if (!delivery?.id) return;
    setPodSending(true);
    try {
      const { data } = await deliveriesAPI.sendPodOtp(delivery.id);
      setPodLinkInfo(data);
      toast.success('6-digit Delivery OTP sent to customer & Rider Link ready');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send delivery OTP');
    } finally {
      setPodSending(false);
    }
  };

  const handleGetRiderManifest = async () => {
    if (!delivery) return;
    setManifestLoading(true);
    try {
      const { data } = await deliveriesAPI.createManifestLink({
        delivery_partner: delivery.delivery_partner || undefined,
        driver_phone: delivery.driver_phone || undefined,
        expires_in: '7d',
      });
      setManifestInfo(data);
      toast.success(`Rider Manifest ready (${data.active_count} active stop${data.active_count === 1 ? '' : 's'})`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate Rider Manifest link');
    } finally {
      setManifestLoading(false);
    }
  };

  const handleMarkPaid = () => openCodModal(false);

  const handleConfirmCodPayment = async (e) => {
    e.preventDefault();
    if (codForm.collection_method === 'momo' && !codForm.reference.trim()) {
      toast.error('Please enter the MoMo Transaction ID / Reference');
      return;
    }
    setMarkPaidSaving(true);
    try {
      await ordersAPI.markPaid(id, {
        collection_method: codForm.collection_method,
        reference: codForm.reference.trim(),
        collected_by: codForm.collected_by.trim(),
        mark_delivered: codForm.mark_delivered,
        note: codForm.note.trim(),
      });
      toast.success(
        codForm.mark_delivered
          ? 'Payment recorded & order marked Delivered'
          : 'COD payment confirmed and receipt recorded'
      );
      setCodModalOpen(false);
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
  const canRefund = ['paid', 'payment_review'].includes(order.payment_status) &&
    REFUNDABLE_STATUSES.includes(order.status) &&
    !['pending', 'needs_attention', 'success'].includes(order.refund_status);
  const canMarkPaid = order.payment_method === 'pay_on_delivery' &&
    !['paid', 'partially_refunded', 'refunded'].includes(order.payment_status) &&
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
          <button className="btn btn-outline" onClick={() => printWaybill(order, store, delivery)} title="Print Jumia-style dispatch waybill (A4 / 80mm)">Print Waybill</button>
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
                const label = order.fulfillment_method === 'pickup'
                  ? (s === 'shipped' ? 'Ready for Pickup' : s === 'delivered' ? 'Picked Up' : s)
                  : s;
                return (
                  <div key={s} className={`track-step ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                    <div className="track-dot">{done ? '✓' : i + 1}</div>
                    <div className="track-label">{label}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {STATUS_FLOW.map((s, i) => {
                const isNext = i === currentIdx + 1;
                const canDirectDeliver = s === 'delivered' && currentIdx >= 1 && currentIdx < 4;
                const enabled = isNext || canDirectDeliver;

                const btnLabel = order.fulfillment_method === 'pickup'
                  ? (s === 'shipped' ? 'Mark Ready for Pickup' : s === 'delivered' ? 'Mark Picked Up' : `Mark as ${s}`)
                  : `Mark as ${s}`;

                return (
                  <button
                    key={s}
                    className={`btn btn-sm ${isNext || canDirectDeliver ? 'btn-accent' : 'btn-outline'}`}
                    disabled={saving || !enabled}
                    onClick={() => setPendingStatus(s)}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {btnLabel}
                  </button>
                );
              })}
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

      {/* ── Return request banner ───────────────────────── */}
      {order.return_requested && !order.return_request_rejected && order.status === 'delivered' && (() => {
        const returnDecided = order.refund_status === 'pending' || order.refund_status === 'success';
        return (
          <div
            className="card"
            style={{
              marginBottom: 16,
              borderLeft: returnDecided
                ? '3px solid var(--ac-success, #27ae60)'
                : '3px solid var(--ac-info, #5ba4cf)',
            }}
          >
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {returnDecided
                      ? (order.refund_status === 'success'
                          ? '✓ Return approved — refund completed'
                          : '✓ Return approved — refund pending with Paystack')
                      : '↩ Customer requested a return'}
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
                {returnDecided ? (
                  <span className="badge badge-info" style={{ alignSelf: 'center' }}>
                    {order.refund_status === 'success' ? 'Refunded' : 'Approved · Refund Pending'}
                  </span>
                ) : (
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
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 42, height: 42, borderRadius: 'var(--ac-radius, 6px)',
                          background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)',
                          overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {it.image_url ? (
                            <img
                              src={resolveImageUrl(it.image_url)}
                              alt={it.product_name || it.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <span style={{ fontSize: '0.65rem', color: 'var(--ac-text-muted)' }}>No img</span>
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/products/${it.product_id}`} className="cell-primary" style={{ display: 'block', lineHeight: 1.3 }}>
                            {it.product_name || it.name}
                          </Link>
                          {it.variant_label && (
                            <div style={{
                              display: 'inline-block',
                              fontSize: '0.72rem',
                              fontWeight: 500,
                              color: 'var(--ac-text-muted)',
                              background: 'var(--ac-surface-2)',
                              border: '1px solid var(--ac-border)',
                              borderRadius: '4px',
                              padding: '1px 6px',
                              marginTop: 4,
                            }}>
                              {it.variant_label}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="cell-right" style={{ verticalAlign: 'middle' }}>{it.quantity}</td>
                    <td className="cell-right cell-muted" style={{ verticalAlign: 'middle' }}>{fmt(it.price_at_purchase || it.price)}</td>
                    <td className="cell-right cell-primary" style={{ verticalAlign: 'middle' }}>{fmt(it.subtotal || (it.price_at_purchase * it.quantity))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ padding: 16, borderTop: '1px solid var(--ac-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem' }}>
                <span className="muted">Subtotal</span>
                <span>{fmt(subtotal)}</span>
              </div>
              {Number(order.discount_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem', color: 'var(--ac-success)' }}>
                  <span>Discount {order.coupon_code ? `(${order.coupon_code})` : ''}</span>
                  <span>- {fmt(order.discount_amount)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem' }}>
                <span className="muted">Delivery</span>
                <span>{Number(order.delivery_fee) === 0 ? 'Free' : fmt(order.delivery_fee)}</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {order.customer_id && (
                  <Link
                    to={`/customers/${order.customer_id}`}
                    style={{ fontSize: '0.78rem', color: 'var(--ac-primary)', textDecoration: 'none', fontWeight: 500 }}
                  >
                    View Profile &rarr;
                  </Link>
                )}
                {order.is_guest && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', background: '#3b2d1d', color: '#e5c378', border: '1px solid rgba(201,165,90,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Guest Checkout
                  </span>
                )}
              </div>
            </div>
            <div className="card-body">
              <div style={{ fontSize: '0.96rem', fontWeight: 600, marginBottom: 4 }}>
                {order.customer_id ? (
                  <Link to={`/customers/${order.customer_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {order.first_name || order.customer_name || '—'} {order.last_name || ''}
                  </Link>
                ) : (
                  <>{order.first_name || order.customer_name || '—'} {order.last_name || ''}</>
                )}
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
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="card-title">{order.fulfillment_method === 'pickup' ? 'Pickup Station' : 'Shipping'}</h2>
              {order.fulfillment_method === 'pickup' ? (
                <span className="badge badge-accent" style={{ fontSize: '0.72rem' }}>Pickup Station</span>
              ) : (
                <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>Door Delivery</span>
              )}
            </div>
            <div className="card-body">
              {order.fulfillment_method === 'pickup' ? (
                <div style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ac-text)' }}>
                    📍 East Legon Station (Accra)
                  </div>
                  <div className="muted" style={{ fontSize: '0.84rem', marginTop: 2 }}>
                    {order.shipping_address || 'Opposite A&C Mall, Boundary Road, East Legon'}
                  </div>
                  {(order.shipping_city || order.shipping_region) && (
                    <div className="muted" style={{ fontSize: '0.84rem' }}>
                      {order.shipping_city || 'Accra'}{order.shipping_region ? `, ${order.shipping_region}` : ''}
                    </div>
                  )}
                  <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--ac-surface-sunken)', borderRadius: 4, fontSize: '0.8rem', color: 'var(--ac-text-muted)' }}>
                    Customer will collect in person. Ensure ID matches customer name.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                  {order.shipping_address && <div>{order.shipping_address}</div>}
                  {(order.shipping_city || order.shipping_region) && (
                    <div>{order.shipping_city}{order.shipping_region ? `, ${order.shipping_region}` : ''}</div>
                  )}
                  {order.ghana_post_gps && (
                    <div><strong>GhanaPostGPS:</strong> {order.ghana_post_gps}</div>
                  )}
                  {order.delivery_landmark && (
                    <div><strong>Landmark:</strong> {order.delivery_landmark}</div>
                  )}
                  {!order.shipping_address && !order.shipping_city && <div className="muted">Not provided</div>}
                </div>
              )}
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

          {payments.some(p => p.status === 'duplicate') && (
            <div className="card" style={{ borderColor: 'var(--color-danger, #c0392b)' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="card-title">Duplicate Payments</h2>
                <span className="badge badge-danger">Action Required</span>
              </div>
              <div className="card-body">
                <p className="muted" style={{ fontSize: '0.84rem', marginTop: 0 }}>
                  These extra Paystack charges were flagged as duplicates on an already-paid order. Refunding them does not cancel the order.
                </p>
                {payments.filter(p => p.status === 'duplicate').map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border-color, #eee)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{p.paystack_reference}</div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {p.currency || 'GHS'} {Number(p.amount || 0).toFixed(2)} · {p.created_at ? new Date(p.created_at).toLocaleString('en-GH') : ''}
                      </div>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={dupRefundingId === p.id}
                      onClick={() => handleRefundDuplicate(p)}
                    >
                      {dupRefundingId === p.id ? 'Refunding…' : 'Refund duplicate'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(partialReturns.length > 0 || (order.status === 'delivered' && ['paid', 'partially_refunded'].includes(order.payment_status) && returnableItems.some(i => Number(i.remaining_quantity) > 0))) && (
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="card-title">Item Return Requests ({partialReturns.length})</h2>
                {order.status === 'delivered' && ['paid', 'partially_refunded'].includes(order.payment_status) && returnableItems.some(i => Number(i.remaining_quantity) > 0) && (
                  <button className="btn btn-outline btn-sm" onClick={() => setAdminRetOpen(o => !o)}>
                    {adminRetOpen ? 'Close' : 'Create Return (Admin)'}
                  </button>
                )}
              </div>
              <div className="card-body">
                {adminRetOpen && (
                  <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-color, #eee)' }}>
                    <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                      Creates a return on behalf of the customer (bypasses return window / missing delivered_at).
                    </div>
                    {returnableItems.filter(i => Number(i.remaining_quantity) > 0).map(it => {
                      const q = Number(adminRetQty[it.id] || 0);
                      return (
                        <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="checkbox" checked={q > 0} onChange={e => setAdminRetQty(p => ({ ...p, [it.id]: e.target.checked ? 1 : 0 }))} />
                            {it.product_name} (max {it.remaining_quantity})
                          </label>
                          {q > 0 && (
                            <input
                              type="number" min={1} max={it.remaining_quantity} value={q}
                              onChange={e => setAdminRetQty(p => ({ ...p, [it.id]: Math.max(1, Math.min(Number(it.remaining_quantity), parseInt(e.target.value, 10) || 1)) }))}
                              style={{ width: 56 }}
                            />
                          )}
                        </div>
                      );
                    })}
                    <input
                      type="text"
                      placeholder="Return reason (required)"
                      value={adminRetReason}
                      onChange={e => setAdminRetReason(e.target.value)}
                      style={{ width: '100%', marginTop: 6, marginBottom: 8 }}
                    />
                    <button className="btn btn-accent btn-sm" disabled={adminRetSaving} onClick={handleAdminCreateReturn}>
                      {adminRetSaving ? 'Creating…' : 'Create Return Request'}
                    </button>
                  </div>
                )}
                {partialReturns.map((rr) => {
                  const opts = retOptions[rr.id] || { restock_items: false, include_delivery_fee: false };
                  const busy = retActionId === rr.id;
                  return (
                    <div key={rr.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border-color, #eee)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <strong>GHS {Number(rr.refund_amount || 0).toFixed(2)}</strong>
                        <span className={`badge ${rr.status === 'refunded' ? 'badge-success' : rr.status === 'refund_failed' || rr.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                          {rr.status}
                        </span>
                      </div>
                      <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>{rr.reason}</div>
                      {Array.isArray(rr.items) && rr.items.length > 0 && (
                        <ul style={{ margin: '6px 0 8px 18px', fontSize: '0.82rem' }}>
                          {rr.items.map((it) => (
                            <li key={it.id}>
                              {it.product_name}{it.variant_label ? ` (${it.variant_label})` : ''} × {it.quantity} — GHS {Number(it.line_refund_amount || 0).toFixed(2)}
                            </li>
                          ))}
                        </ul>
                      )}
                      {rr.status === 'pending' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={opts.restock_items}
                              onChange={(e) => setRetOptions(prev => ({ ...prev, [rr.id]: { ...opts, restock_items: e.target.checked } }))}
                            />
                            Restock returned items (unopened / sealed only)
                          </label>
                          {Number(order.delivery_fee || 0) > 0 && (
                            <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={opts.include_delivery_fee}
                                onChange={(e) => setRetOptions(prev => ({ ...prev, [rr.id]: { ...opts, include_delivery_fee: e.target.checked } }))}
                              />
                              Include delivery fee (+GHS {Number(order.delivery_fee).toFixed(2)})
                            </label>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => handleApprovePartialReturn(rr)}>
                              {busy ? 'Processing…' : 'Approve & Refund'}
                            </button>
                            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleRejectPartialReturn(rr)}>
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                      {rr.status === 'refund_failed' && (
                        <button className="btn btn-danger btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => handleApprovePartialReturn(rr)}>
                          {busy ? 'Retrying…' : 'Retry Paystack Refund'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {order.notes && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Notes</h2></div>
              <div className="card-body">
                <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{order.notes}</div>
              </div>
            </div>
          )}

          {/* ── Delivery management / Pickup Station Fulfilment ──────────────────── */}
          {order.fulfillment_method === 'pickup' ? (
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="card-title">Pickup Station Fulfilment</h2>
                <StatusBadge status={order.status === 'shipped' ? 'ready_for_pickup' : order.status} />
              </div>
              <div className="card-body">
                <div style={{ fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Station</span>
                    <span style={{ fontWeight: 500 }}>{store.pickup_location || 'East Legon Station (Accra)'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Pickup Status</span>
                    <span style={{ fontWeight: 600 }}>
                      {order.status === 'delivered' ? 'Picked Up / Completed' :
                       order.status === 'shipped' ? 'Ready for Pickup' :
                       order.status === 'processing' ? 'Processing at Station' :
                       order.status === 'confirmed' ? 'Confirmed (Awaiting Packing)' :
                       order.status === 'cancelled' ? 'Cancelled' :
                       order.status === 'refunded' ? 'Refunded' : 'Pending Confirmation'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Fulfillment Type</span>
                    <span>Self-Pickup</span>
                  </div>
                </div>

                {order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'refunded' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {order.status === 'pending' ? (
                      <button
                        type="button"
                        className="btn btn-accent btn-sm"
                        style={{ width: '100%' }}
                        onClick={() => changeStatus('confirmed', 'Pickup order confirmed by admin')}
                        disabled={saving}
                      >
                        {saving ? 'Updating…' : '✓ Confirm Pickup Order'}
                      </button>
                    ) : (
                      <>
                        {order.status !== 'shipped' && (
                          <button
                            type="button"
                            className="btn btn-accent btn-sm"
                            style={{ width: '100%' }}
                            onClick={() => changeStatus('shipped', 'Order marked ready for pickup by admin')}
                            disabled={saving}
                          >
                            {saving ? 'Updating…' : '📦 Mark Ready for Pickup'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          style={{ width: '100%' }}
                          onClick={() => changeStatus('delivered', 'Order picked up by customer')}
                          disabled={saving}
                        >
                          {saving ? 'Updating…' : '✓ Confirm Customer Picked Up'}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {order.status === 'delivered' && (
                  <div style={{ padding: '8px 12px', background: 'var(--ac-surface-sunken)', borderRadius: 4, color: 'var(--ac-success)', fontSize: '0.85rem', textAlign: 'center', fontWeight: 500 }}>
                    ✓ Order has been collected by the customer.
                  </div>
                )}
              </div>
            </div>
          ) : (
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
                        {delivery.status === 'pending'
                          ? 'Advance to In Transit →'
                          : delivery.status === 'in_transit'
                            ? 'Advance to Out for Delivery →'
                            : 'Mark as Delivered ✓'}
                      </button>
                    )}

                    {/* ── Multi-Layer Proof of Delivery (OTP + Rider Handoff Link + Photo + GPS) ── */}
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ac-border)' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Proof of Delivery (POD)
                      </div>

                      {delivery.pod_verified_at ? (
                        <div style={{ background: '#ecfdf5', border: '1px solid #10b981', borderRadius: 6, padding: 10, fontSize: '0.82rem' }}>
                          <div style={{ fontWeight: 700, color: '#065f46', marginBottom: 4 }}>
                            ✓ Verified Delivered ({delivery.pod_verified_method === 'rider_otp_photo' ? '6-Digit OTP + Photo + GPS' : delivery.pod_verified_method === 'customer_confirmed' ? 'Confirmed by Customer' : 'Admin Verified'})
                          </div>
                          <div className="muted text-xs">
                            {new Date(delivery.pod_verified_at).toLocaleString('en-GH')}
                            {delivery.pod_recipient_name ? ` · Received by: ${delivery.pod_recipient_name}` : ''}
                          </div>
                          {delivery.pod_lat != null && delivery.pod_lng != null && (
                            <div style={{ marginTop: 6 }}>
                              <a
                                href={`https://www.google.com/maps?q=${delivery.pod_lat},${delivery.pod_lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#047857', fontWeight: 600, fontSize: '0.78rem' }}
                              >
                                📍 View GPS Drop-off Location ({Number(delivery.pod_lat).toFixed(4)}, {Number(delivery.pod_lng).toFixed(4)})
                              </a>
                            </div>
                          )}
                          {delivery.pod_photo_url && (
                            <a
                              href={resolveImageUrl(delivery.pod_photo_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'inline-block', marginTop: 8 }}
                            >
                              <img
                                src={resolveImageUrl(delivery.pod_photo_url)}
                                alt="Proof of delivery parcel"
                                style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid #a7f3d0' }}
                              />
                            </a>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ fontSize: '0.76rem', color: 'var(--ac-text-muted)', marginBottom: 2 }}>
                            Send the customer their 6-digit code &amp; share a link with the rider:
                          </div>

                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ width: '100%', fontSize: '0.8rem' }}
                            disabled={podSending}
                            onClick={handleSendPodOtp}
                          >
                            {podSending ? 'Sending 6-Digit Code…' : '🔐 Send 6-Digit Code & Get This Order’s Link'}
                          </button>

                          {podLinkInfo?.rider_url && (
                            <div style={{ padding: 10, background: 'var(--ac-surface-2, #181b20)', borderRadius: 8, border: '1px solid var(--ac-border)', fontSize: '0.76rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ fontWeight: 700 }}>This Order Handoff Link</span>
                                <span className="muted">Valid 14d</span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ fontSize: '0.74rem', justifyContent: 'center' }}
                                  onClick={() => {
                                    navigator.clipboard?.writeText(podLinkInfo.rider_url);
                                    toast.success('Handoff link copied');
                                  }}
                                >
                                  📋 Copy
                                </button>
                                <a
                                  href={podLinkInfo.rider_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-outline btn-sm"
                                  style={{ fontSize: '0.74rem', textDecoration: 'none', justifyContent: 'center' }}
                                >
                                  ↗ Open
                                </a>
                                {delivery.driver_phone ? (
                                  <a
                                    href={`https://wa.me/${String(delivery.driver_phone).replace(/\D/g, '').replace(/^0/, '233')}?text=${encodeURIComponent(`BodyCream GH Dispatch (${podLinkInfo.tracking_number} · Zone ${podLinkInfo.zone_code}): Verify the customer's 6-digit OTP & snap parcel photo here: ${podLinkInfo.rider_url}`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-outline btn-sm"
                                    style={{ fontSize: '0.74rem', color: '#22c55e', borderColor: 'rgba(34,197,94,0.4)', textDecoration: 'none', justifyContent: 'center' }}
                                  >
                                    💬 Rider
                                  </a>
                                ) : (
                                  <span />
                                )}
                              </div>
                              {podLinkInfo.demo_otp && (
                                <div style={{ marginTop: 8, color: '#92400e', background: '#fef3c7', padding: '4px 8px', borderRadius: 4 }}>
                                  Demo OTP (SMS unconfigured): <strong>{podLinkInfo.demo_otp}</strong>
                                </div>
                              )}
                            </div>
                          )}

                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            style={{ width: '100%', fontSize: '0.8rem' }}
                            disabled={manifestLoading}
                            onClick={handleGetRiderManifest}
                          >
                            {manifestLoading
                              ? 'Loading Rider Route…'
                              : `🏍️ All Stops for ${delivery.delivery_partner || 'Rider'} (Route Manifest)`}
                          </button>

                          {manifestInfo?.manifest_url && (
                            <div style={{ padding: 10, background: 'var(--ac-surface-2, #181b20)', borderRadius: 8, border: '1px solid var(--ac-border)', fontSize: '0.76rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ fontWeight: 700 }}>{manifestInfo.delivery_partner}</span>
                                <span style={{ color: '#22c55e', fontWeight: 700 }}>
                                  {manifestInfo.active_count} stop{manifestInfo.active_count === 1 ? '' : 's'} · {manifestInfo.expires_in}
                                </span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ fontSize: '0.74rem', justifyContent: 'center' }}
                                  onClick={() => {
                                    navigator.clipboard?.writeText(manifestInfo.manifest_url);
                                    toast.success('Route manifest link copied');
                                  }}
                                >
                                  📋 Copy
                                </button>
                                <a
                                  href={manifestInfo.manifest_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-outline btn-sm"
                                  style={{ fontSize: '0.74rem', textDecoration: 'none', justifyContent: 'center' }}
                                >
                                  ↗ Route
                                </a>
                                <a
                                  href={`https://wa.me/${String(delivery.driver_phone || '').replace(/\D/g, '').replace(/^0/, '233')}?text=${encodeURIComponent(`BodyCream GH Rider Route (${manifestInfo.active_count} stops · ${manifestInfo.delivery_partner}):\n${manifestInfo.manifest_url}`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-outline btn-sm"
                                  style={{ fontSize: '0.74rem', color: '#22c55e', borderColor: 'rgba(34,197,94,0.4)', textDecoration: 'none', justifyContent: 'center' }}
                                >
                                  💬 WhatsApp
                                </a>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </form>
                ) : (
                  /* No delivery yet — create one */
                  <form onSubmit={handleCreateDelivery}>
                    <p className="muted text-sm" style={{ marginBottom: 12 }}>
                      No delivery record yet. Creating one will mark this order as <strong>shipped</strong> and notify the customer.
                    </p>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                        onClick={() => setDeliveryForm(prev => ({
                          ...prev,
                          delivery_partner: 'In-house Dispatch Bike',
                        }))}
                      >
                        In-house Bike Rider
                      </button>
                      {knownPartners
                        .filter(p => p.delivery_partner.toLowerCase() !== 'in-house dispatch bike')
                        .map(p => (
                          <button
                            key={p.delivery_partner}
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                            onClick={() => setDeliveryForm(prev => ({
                              ...prev,
                              delivery_partner: p.delivery_partner,
                              driver_phone: p.driver_phone || prev.driver_phone,
                            }))}
                          >
                            {p.delivery_partner}
                          </button>
                        ))}
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                        onClick={() => setDeliveryForm(prev => ({
                          ...prev,
                          delivery_partner: 'DHL / External Courier',
                        }))}
                      >
                        External Courier
                      </button>
                    </div>

                    {[
                      { name: 'delivery_partner',   label: 'Rider / courier name',                 placeholder: 'e.g. In-house Dispatch Bike, Kwame, DHL' },
                      { name: 'tracking_number',    label: 'Tracking # (auto-generated if blank)', placeholder: 'Leave blank for own bike rider' },
                      { name: 'driver_phone',       label: 'Rider / driver phone (optional)',      placeholder: '+233 XX XXX XXXX' },
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
          )}
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
        open={codModalOpen}
        onClose={() => { if (!markPaidSaving) setCodModalOpen(false); }}
        title="Confirm Pay-on-Delivery Collection"
      >
        <form onSubmit={handleConfirmCodPayment}>
          {codFromDeliver && (
            <div
              style={{
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                color: '#92400e',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: '0.84rem',
                marginBottom: 14,
              }}
            >
              <strong>Unpaid COD Order ({fmt(order.total_amount)}):</strong> Confirm how the rider collected payment before marking this order delivered.
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Amount Collected</label>
            <input type="text" value={fmt(order.total_amount)} disabled />
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Payment Method Received</label>
            <select
              value={codForm.collection_method}
              onChange={e => setCodForm(f => ({ ...f, collection_method: e.target.value }))}
            >
              <option value="cash">Cash on Delivery</option>
              <option value="momo">Mobile Money (MTN / Telecel / AT)</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>
              {codForm.collection_method === 'momo'
                ? 'MoMo Transaction ID / Reference *'
                : 'Receipt / Reference # (optional)'}
            </label>
            <input
              type="text"
              required={codForm.collection_method === 'momo'}
              placeholder={codForm.collection_method === 'momo' ? 'e.g. 48291047219' : 'e.g. Cash slip #12'}
              value={codForm.reference}
              onChange={e => setCodForm(f => ({ ...f, reference: e.target.value }))}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Collected By (Rider / Staff Name)</label>
            <input
              type="text"
              placeholder="e.g. Kwame (In-house Bike)"
              value={codForm.collected_by}
              onChange={e => setCodForm(f => ({ ...f, collected_by: e.target.value }))}
            />
          </div>

          {order.status !== 'delivered' && (
            <div className="form-group" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id="cod-mark-delivered"
                type="checkbox"
                style={{ width: 'auto' }}
                checked={codForm.mark_delivered}
                onChange={e => setCodForm(f => ({ ...f, mark_delivered: e.target.checked }))}
              />
              <label htmlFor="cod-mark-delivered" style={{ margin: 0, cursor: 'pointer', fontSize: '0.86rem' }}>
                Also mark order &amp; delivery as <strong>Delivered</strong>
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {codFromDeliver && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={markPaidSaving || saving}
                onClick={async () => {
                  setCodModalOpen(false);
                  await changeStatus('delivered', 'Marked delivered before COD settlement', { bypassCodGuard: true });
                }}
              >
                Deliver Without Payment
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={markPaidSaving}
              onClick={() => setCodModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-accent btn-sm"
              disabled={markPaidSaving}
            >
              {markPaidSaving
                ? 'Saving…'
                : codForm.mark_delivered
                  ? 'Confirm Payment & Deliver'
                  : 'Confirm Payment Received'}
            </button>
          </div>
        </form>
      </Modal>

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
          background: var(--ac-surface);
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

