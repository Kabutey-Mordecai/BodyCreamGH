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
import { buildWhatsAppLink, WA_TEMPLATES } from '../utils/whatsappTemplates';
import './Orders.css';

// Fulfilment flow is strictly forward-moving. Skipping to "delivered" is allowed
// if the merchant updates late (e.g. phone-confirmed pickups).
const STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing'];
const REFUNDABLE_STATUSES = ['cancelled', 'delivered'];
const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
        setDeliveryForm({
          delivery_partner: data.delivery_partner || '',
          tracking_number: data.tracking_number || '',
          estimated_delivery: data.estimated_delivery ? String(data.estimated_delivery).slice(0, 10) : '',
          driver_phone: data.driver_phone || '',
        });
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

  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const reason = window.prompt('Reason for rejecting this return request (optional):');
    if (reason === null) return;
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
      await deliveriesAPI.create({
        order_id: id,
        delivery_partner: deliveryForm.delivery_partner.trim() || 'In-house Dispatch Bike',
        driver_phone: deliveryForm.driver_phone.trim() || undefined,
        tracking_number: deliveryForm.tracking_number.trim() || undefined,
        estimated_delivery: deliveryForm.estimated_delivery ? deliveryForm.estimated_delivery : undefined,
      });
      toast.success('Rider dispatched — order marked as shipped & customer notified');
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
        delivery_partner: deliveryForm.delivery_partner.trim() || undefined,
        tracking_number: deliveryForm.tracking_number.trim() || undefined,
        estimated_delivery: deliveryForm.estimated_delivery || undefined,
        driver_phone: deliveryForm.driver_phone.trim(),
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
      await deliveriesAPI.sendPodOtp(delivery.id);
      toast.success('6-digit Delivery Code sent privately to customer');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send delivery code');
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
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;
  const canSkipToDelivered = currentIdx >= 1 && currentIdx < 3; // confirmed or processing can jump directly to delivered if picked up/handed off
  const canCancel = CANCELLABLE_STATUSES.includes(order.status);
  const canRefund = ['paid', 'payment_review'].includes(order.payment_status) &&
    REFUNDABLE_STATUSES.includes(order.status) &&
    !['pending', 'needs_attention', 'success'].includes(order.refund_status);
  const canMarkPaid = order.payment_method === 'pay_on_delivery' &&
    !['paid', 'partially_refunded', 'refunded'].includes(order.payment_status) &&
    !['cancelled', 'refunded'].includes(order.status);

  const refundInfo = refundLabel(order);
  const hasRefundActivity = Boolean(
    canRefund ||
    (order.refund_status && order.refund_status !== 'not_requested') ||
    refundInfo?.status === 'refund_owed' ||
    order.refund_amount ||
    order.refund_notes
  );

  const subtotal = (order.items || []).reduce((s, it) => s + Number(it.subtotal || (it.price_at_purchase * it.quantity) || 0), 0);

  const phoneFromNotes = order.notes?.match(/(?:^|\n)Phone:\s*(.+?)(\n|$)/i)?.[1]?.trim();
  const displayPhone = order.customer_phone || order.guest_phone || phoneFromNotes;
  const cleanCustomerName = `${order.first_name || order.customer_name || 'Customer'} ${order.last_name || ''}`.trim();
  const initials = cleanCustomerName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('') || 'C';

  const fullAddressString = [
    order.shipping_address,
    order.shipping_city,
    order.shipping_region,
  ].filter(Boolean).join(', ');

  const statusBtnLabel = (s) => {
    if (order.fulfillment_method === 'pickup') {
      if (s === 'shipped') return 'Mark Ready for Pickup';
      if (s === 'delivered') return 'Mark Picked Up';
    }
    return `Mark as ${s.charAt(0).toUpperCase() + s.slice(1)}`;
  };

  return (
    <div>
      {/* ── Header Bar ──────────────────────────────────────────────── */}
      <div className="od-header-bar">
        <div>
          <Link to="/orders" className="pe-back-link" style={{ textDecoration: 'none', color: 'var(--ac-text-muted)', fontSize: '0.8rem', fontWeight: 500 }}>
            ← Back to Orders
          </Link>
          <div className="od-title-line">
            <h1>Order #{order.order_number || order.id?.slice(0, 8)}</h1>
            <StatusBadge status={order.fulfillment_method === 'pickup' && order.status === 'shipped' ? 'ready_for_pickup' : order.status} />
            <StatusBadge status={order.payment_status} />
            {hasRefundActivity && refundInfo && (
              <span className={`badge ${refundInfo.cls}`}>{refundInfo.label}</span>
            )}
          </div>
          <div className="od-meta-line">
            Placed {new Date(order.created_at).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' })}
            {' · '}
            {order.fulfillment_method === 'pickup' ? 'Pickup Station' : 'Door Delivery'}
            {' · '}
            {order.payment_method === 'pay_on_delivery' ? 'Pay on Delivery (COD)' : 'Paystack Online'}
          </div>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => printInvoice(order, store)}
            title="Print customer invoice / packing slip"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print Invoice
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => printWaybill(order, store, delivery)}
            title="Print A4 or 80mm thermal dispatch barcode waybill"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" />
            </svg>
            Print Waybill
          </button>
        </div>
      </div>

      {/* ── Fulfilment Progress Tracker & Focused Next-Action Strip ─── */}
      {canShowStatusFlow && (
        <div className="card od-tracker-card">
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

            {(nextStatus || canSkipToDelivered || canCancel || canRefund) && (
              <div className="od-tracker-footer">
                <div className="od-tracker-primary-actions">
                  {nextStatus && (
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      disabled={saving}
                      onClick={() => setPendingStatus(nextStatus)}
                    >
                      → {statusBtnLabel(nextStatus)}
                    </button>
                  )}
                  {canSkipToDelivered && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={saving}
                      onClick={() => setPendingStatus('delivered')}
                    >
                      ✓ {statusBtnLabel('delivered')}
                    </button>
                  )}
                </div>

                <div className="od-tracker-secondary-actions">
                  {canRefund && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={refundSaving}
                      onClick={() => setRefundOpen(true)}
                    >
                      Issue Refund
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ color: 'var(--ac-danger)', borderColor: 'rgba(220, 38, 38, 0.35)' }}
                      disabled={saving}
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel Order
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!canShowStatusFlow && canRefund && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Order cancelled — refund owed</div>
              <div className="muted text-sm">Full refundable amount: {fmt(order.total_amount)}</div>
            </div>
            <button className="btn btn-accent btn-sm" onClick={() => setRefundOpen(true)} disabled={refundSaving}>
              Issue Refund
            </button>
          </div>
        </div>
      )}

      {/* ── Customer Cancel / Return Request Alert Banners ──────────── */}
      {order.cancel_requested && !order.cancel_request_rejected && order.status !== 'cancelled' && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--ac-warning)' }}>
          <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Customer requested cancellation</div>
              {order.cancel_reason && <div className="muted text-sm">Reason: {order.cancel_reason}</div>}
              {order.cancel_requested_at && (
                <div className="muted text-xs">Requested {new Date(order.cancel_requested_at).toLocaleString('en-GH')}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-danger" disabled={requestActionSaving} onClick={() => handleRequestAction('approveCancelRequest', 'Cancellation approved')}>
                Approve &amp; Cancel
              </button>
              <button className="btn btn-sm btn-outline" disabled={requestActionSaving} onClick={() => handleRequestAction('rejectCancelRequest', 'Cancellation request rejected')}>
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {order.return_requested && !order.return_request_rejected && order.status === 'delivered' && (() => {
        const returnDecided = order.refund_status === 'pending' || order.refund_status === 'success';
        return (
          <div className="card" style={{ marginBottom: 16, borderLeft: returnDecided ? '3px solid var(--ac-success)' : '3px solid var(--ac-info)' }}>
            <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {returnDecided
                    ? (order.refund_status === 'success' ? '✓ Return approved — refund completed' : '✓ Return approved — refund pending with Paystack')
                    : '↩ Customer requested a return'}
                </div>
                {order.return_reason && <div className="muted text-sm">Reason: {order.return_reason}</div>}
              </div>
              {returnDecided ? (
                <span className="badge badge-info">{order.refund_status === 'success' ? 'Refunded' : 'Approved · Refund Pending'}</span>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-accent" disabled={requestActionSaving} onClick={() => handleRequestAction('approveReturnRequest', 'Return approved & refund initiated')}>
                    Approve &amp; Refund
                  </button>
                  <button className="btn btn-sm btn-outline" disabled={requestActionSaving} onClick={() => handleRequestAction('rejectReturnRequest', 'Return request rejected')}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Balanced 2-Column Workspace (Zero Empty Void!) ──────────── */}
      <div className="od-workspace">

        {/* ════════ LEFT OPERATIONAL COLUMN ════════ */}
        <div className="od-main-col">

          {/* 1. Order Items & Financial Breakdown */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                Order Items ({(order.items || []).reduce((n, i) => n + Number(i.quantity || 1), 0)})
              </h2>
              <span className="muted text-xs">{(order.items || []).length} SKU{(order.items || []).length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="cell-right" style={{ width: 64 }}>Qty</th>
                    <th className="cell-right" style={{ width: 120 }}>Unit Price</th>
                    <th className="cell-right" style={{ width: 130 }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items || []).map(it => (
                    <tr key={it.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 46, height: 46, borderRadius: 8,
                            background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)',
                            overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                              <span className="ap-sku-badge" style={{ marginTop: 4, display: 'inline-block', padding: '1px 7px', borderRadius: 5, background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)', fontSize: '0.72rem', color: 'var(--ac-text-muted)' }}>
                                {it.variant_label}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="cell-right" style={{ fontWeight: 600 }}>×{it.quantity}</td>
                      <td className="cell-right cell-muted" style={{ whiteSpace: 'nowrap' }}>{fmt(it.price_at_purchase || it.price)}</td>
                      <td className="cell-right cell-primary" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {fmt(it.subtotal || (it.price_at_purchase * it.quantity))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="od-totals-box">
              <div className="od-totals-inner">
                <div className="od-total-row">
                  <span className="muted">Items Subtotal</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {Number(order.discount_amount) > 0 && (
                  <div className="od-total-row" style={{ color: 'var(--ac-success)' }}>
                    <span>Discount {order.coupon_code ? `(${order.coupon_code})` : ''}</span>
                    <span>− {fmt(order.discount_amount)}</span>
                  </div>
                )}
                <div className="od-total-row">
                  <span className="muted">Delivery Fee</span>
                  <span>{Number(order.delivery_fee) === 0 ? 'Free' : fmt(order.delivery_fee)}</span>
                </div>
                <div className="od-total-row od-total-row--grand">
                  <span>Order Total</span>
                  <span>{fmt(order.total_amount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Dispatch & Rider Fulfilment Center (Promoted to Main Column!) */}
          {order.fulfillment_method === 'pickup' ? (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Pickup Station Fulfilment</h2>
                <StatusBadge status={order.status === 'shipped' ? 'ready_for_pickup' : order.status} />
              </div>
              <div className="card-body">
                <div className="od-delivery-summary-grid">
                  <div>
                    <div className="od-kv-label">Station</div>
                    <div className="od-kv-val">{store.pickup_location || 'Store Pickup Station'}</div>
                  </div>
                  <div>
                    <div className="od-kv-label">Stage</div>
                    <div className="od-kv-val">
                      {order.status === 'delivered' ? 'Picked Up' :
                       order.status === 'shipped' ? 'Ready for Pickup' :
                       order.status === 'processing' ? 'Packing at Station' : 'Awaiting Prep'}
                    </div>
                  </div>
                  <div>
                    <div className="od-kv-label">Verification</div>
                    <div className="od-kv-val">Customer ID / Order #</div>
                  </div>
                </div>

                {order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'refunded' ? (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {order.status === 'pending' && (
                      <button type="button" className="btn btn-accent btn-sm" onClick={() => changeStatus('confirmed', 'Pickup order confirmed by admin')} disabled={saving}>
                        ✓ Confirm Pickup Order
                      </button>
                    )}
                    {order.status !== 'pending' && order.status !== 'shipped' && (
                      <button type="button" className="btn btn-accent btn-sm" onClick={() => changeStatus('shipped', 'Order marked ready for pickup by admin')} disabled={saving}>
                        📦 Mark Ready for Pickup
                      </button>
                    )}
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => changeStatus('delivered', 'Order picked up by customer')} disabled={saving}>
                      ✓ Confirm Customer Picked Up
                    </button>
                  </div>
                ) : order.status === 'delivered' ? (
                  <div className="alert alert-info" style={{ marginBottom: 0 }}>
                    ✓ Customer has collected this order from the pickup station.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Dispatch &amp; Rider Proof-of-Delivery</h2>
                  <p className="muted text-xs" style={{ marginTop: 2 }}>
                    {delivery
                      ? 'Track courier stage, share live route manifest, or verify 6-digit OTP & photo handoff.'
                      : 'Assign an in-house rider or courier to mark this order Shipped and send the customer their 6-digit delivery code.'}
                  </p>
                </div>
                {delivery && <StatusBadge status={delivery.status} />}
              </div>

              <div className="card-body">
                {delivery ? (
                  <form onSubmit={handleUpdateDelivery}>
                    <div className="od-delivery-summary-grid">
                      <div>
                        <div className="od-kv-label">Assigned Rider / Courier</div>
                        <div className="od-kv-val">{delivery.delivery_partner || 'In-house Dispatch'}</div>
                      </div>
                      <div>
                        <div className="od-kv-label">Tracking Number</div>
                        <div className="od-kv-val mono" style={{ fontSize: '0.82rem' }}>{delivery.tracking_number || '—'}</div>
                      </div>
                      <div>
                        <div className="od-kv-label">Rider Phone</div>
                        <div className="od-kv-val">{delivery.driver_phone || 'Not set'}</div>
                      </div>
                      {delivery.estimated_delivery && (
                        <div>
                          <div className="od-kv-label">Est. Delivery</div>
                          <div className="od-kv-val">{new Date(delivery.estimated_delivery).toLocaleDateString('en-GH')}</div>
                        </div>
                      )}
                    </div>

                    {delivery.pod_verified_at ? (
                      <div style={{ background: 'var(--ac-success-soft)', border: '1px solid rgba(5, 150, 105, 0.35)', borderRadius: 10, padding: 14, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                        {delivery.pod_photo_url && (
                          <a href={resolveImageUrl(delivery.pod_photo_url)} target="_blank" rel="noopener noreferrer">
                            <img
                              src={resolveImageUrl(delivery.pod_photo_url)}
                              alt="Proof of delivery parcel"
                              style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(5,150,105,0.4)' }}
                            />
                          </a>
                        )}
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontWeight: 700, color: 'var(--ac-success)', fontSize: '0.9rem' }}>
                            ✓ Proof of Delivery Verified ({delivery.pod_verified_method === 'rider_otp_photo' ? '6-Digit OTP + Live Photo + GPS' : 'Verified'})
                          </div>
                          <div className="muted text-xs" style={{ marginTop: 3 }}>
                            {new Date(delivery.pod_verified_at).toLocaleString('en-GH')}
                            {delivery.pod_recipient_name ? ` · Received by ${delivery.pod_recipient_name}` : ''}
                          </div>
                          {delivery.pod_lat != null && delivery.pod_lng != null && (
                            <div style={{ marginTop: 6 }}>
                              <a
                                href={`https://www.google.com/maps?q=${delivery.pod_lat},${delivery.pod_lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--ac-success)', fontWeight: 600, fontSize: '0.8rem', textDecoration: 'underline' }}
                              >
                                📍 Open GPS Drop-off Pin ({Number(delivery.pod_lat).toFixed(4)}, {Number(delivery.pod_lng).toFixed(4)}) ↗
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* 1-Click Rider Assignment / Switch (visible whenever registered riders exist) */}
                        {knownPartners.length > 0 && delivery.status !== 'delivered' && (
                          <div style={{ padding: '10px 12px', borderRadius: 'var(--ac-radius)', background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span className="text-xs" style={{ fontWeight: 600, color: 'var(--ac-text-muted)' }}>
                                Assign or switch rider
                              </span>
                              <Link to="/riders" className="text-xs" style={{ fontWeight: 600, color: 'var(--ac-accent)' }}>
                                Manage riders →
                              </Link>
                            </div>
                            <div className="od-rider-chips" style={{ marginBottom: 0 }}>
                              {knownPartners.slice(0, 10).map(p => {
                                const isCurrent = String(delivery.delivery_partner || '').toLowerCase() === p.delivery_partner.toLowerCase();
                                return (
                                  <button
                                    key={p.delivery_partner}
                                    type="button"
                                    disabled={deliverySaving || isCurrent}
                                    className={`od-rider-chip${isCurrent ? ' is-selected' : ''}`}
                                    onClick={async () => {
                                      setDeliverySaving(true);
                                      try {
                                        await deliveriesAPI.update(delivery.id, {
                                          delivery_partner: p.delivery_partner,
                                          driver_phone: p.driver_phone || '',
                                        });
                                        setManifestInfo(null);
                                        toast.success(`Assigned to ${p.delivery_partner}`);
                                        load();
                                      } catch (err) {
                                        toast.error(err.response?.data?.error || 'Failed to reassign rider');
                                      } finally {
                                        setDeliverySaving(false);
                                      }
                                    }}
                                  >
                                    <span>{p.delivery_partner}</span>
                                    {isCurrent && <span style={{ fontSize: '0.68rem' }}>✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={manifestLoading}
                            onClick={handleGetRiderManifest}
                          >
                            {manifestLoading
                              ? 'Generating link…'
                              : `Route link (${delivery.delivery_partner || 'All stops'})`}
                          </button>

                          {delivery.tracking_number && delivery.status !== 'delivered' && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={deliverySaving}
                              onClick={handleAdvanceSimulation}
                            >
                              {delivery.status === 'pending'
                                ? 'Advance to In Transit'
                                : delivery.status === 'in_transit'
                                  ? 'Advance to Out for Delivery'
                                  : 'Mark Delivered'}
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={podSending}
                            onClick={handleSendPodOtp}
                          >
                            {podSending ? 'Sending…' : 'Resend customer OTP'}
                          </button>
                        </div>

                        {manifestInfo?.manifest_url && (
                          <div className="rm-share-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <strong style={{ fontSize: '0.84rem' }}>
                                {manifestInfo.delivery_partner} · {manifestInfo.active_count} active stop{manifestInfo.active_count === 1 ? '' : 's'}
                              </strong>
                              <span className="badge badge-success">Valid {manifestInfo.expires_in}</span>
                            </div>
                            <div className="rm-url-box">
                              <input type="text" readOnly value={manifestInfo.manifest_url} onFocus={e => e.target.select()} />
                            </div>
                            <div className="rm-action-grid">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => {
                                  navigator.clipboard?.writeText(manifestInfo.manifest_url);
                                  toast.success('Rider manifest link copied');
                                }}
                              >
                                Copy link
                              </button>
                              <a
                                href={manifestInfo.manifest_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-outline btn-sm"
                                style={{ textDecoration: 'none' }}
                              >
                                Open console ↗
                              </a>
                              <a
                                href={`https://wa.me/${String(manifestInfo.driver_phone || delivery.driver_phone || '').replace(/\D/g, '').replace(/^0/, '233')}?text=${encodeURIComponent(`BodyCream GH Dispatch Route (${manifestInfo.active_count} stops · ${manifestInfo.delivery_partner}):\n${manifestInfo.manifest_url}`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary btn-sm"
                                style={{ textDecoration: 'none' }}
                              >
                                Send WhatsApp
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <details style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--ac-border)' }}>
                      <summary className="muted text-xs" style={{ cursor: 'pointer', fontWeight: 600 }}>
                        Reassign rider, edit courier stage, phone, or tracking #
                      </summary>
                      {knownPartners.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span className="muted text-xs" style={{ fontWeight: 700 }}>Quick-Reassign Registered Rider</span>
                            <Link to="/riders" style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--ac-accent)', textDecoration: 'none' }}>
                              Manage Riders →
                            </Link>
                          </div>
                          <div className="od-rider-chips">
                            {knownPartners.slice(0, 8).map(p => (
                              <button
                                key={p.delivery_partner}
                                type="button"
                                className={`od-rider-chip${deliveryForm.delivery_partner.toLowerCase() === p.delivery_partner.toLowerCase() ? ' is-selected' : ''}`}
                                onClick={() => setDeliveryForm(f => ({
                                  ...f,
                                  delivery_partner: p.delivery_partner,
                                  driver_phone: p.driver_phone || '',
                                }))}
                              >
                                {p.delivery_partner}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="od-dispatch-grid" style={{ marginTop: 12 }}>
                        <div>
                          <label>Assigned Rider / Courier</label>
                          <input
                            type="text"
                            placeholder="e.g. Kwame Mensah"
                            value={deliveryForm.delivery_partner}
                            onChange={e => setDeliveryForm(f => ({ ...f, delivery_partner: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label>Rider WhatsApp Phone</label>
                          <input
                            type="text"
                            placeholder="e.g. 024 812 3456"
                            value={deliveryForm.driver_phone}
                            onChange={e => setDeliveryForm(f => ({ ...f, driver_phone: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label>Courier Stage</label>
                          <select value={deliveryStatus} onChange={e => setDeliveryStatus(e.target.value)}>
                            <option value="pending">Pending Pickup</option>
                            <option value="in_transit">In Transit</option>
                            <option value="out_for_delivery">Out for Delivery</option>
                            <option value="delivered">Delivered</option>
                          </select>
                        </div>
                        <div>
                          <label>Tracking #</label>
                          <input
                            type="text"
                            placeholder={delivery.tracking_number || 'e.g. BC-ACC-...'}
                            value={deliveryForm.tracking_number}
                            onChange={e => setDeliveryForm(f => ({ ...f, tracking_number: e.target.value }))}
                          />
                        </div>
                      </div>
                      <button type="submit" className="btn btn-outline btn-sm" disabled={deliverySaving}>
                        {deliverySaving ? 'Saving…' : 'Save Delivery & Rider Changes'}
                      </button>
                    </details>
                  </form>
                ) : (
                  <form onSubmit={handleCreateDelivery}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div className="rm-step-label" style={{ marginBottom: 0 }}>Assign Dispatch Rider</div>
                      <Link to="/riders" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ac-accent)', textDecoration: 'none' }}>
                        Manage riders →
                      </Link>
                    </div>
                    <div className="od-rider-chips">
                      <button
                        type="button"
                        className={`od-rider-chip${deliveryForm.delivery_partner === 'In-house Dispatch Bike' ? ' is-selected' : ''}`}
                        onClick={() => setDeliveryForm(prev => ({ ...prev, delivery_partner: 'In-house Dispatch Bike', driver_phone: '' }))}
                      >
                        In-house Bike
                      </button>
                      {knownPartners
                        .filter(p => p.delivery_partner.toLowerCase() !== 'in-house dispatch bike')
                        .slice(0, 10)
                        .map(p => {
                          const isSel = deliveryForm.delivery_partner.toLowerCase() === p.delivery_partner.toLowerCase();
                          return (
                            <button
                              key={p.delivery_partner}
                              type="button"
                              className={`od-rider-chip${isSel ? ' is-selected' : ''}`}
                              onClick={() => setDeliveryForm(prev => ({
                                ...prev,
                                delivery_partner: p.delivery_partner,
                                driver_phone: p.driver_phone || '',
                              }))}
                            >
                              <span>{p.delivery_partner}</span>
                              {p.active_count > 0 && (
                                <span style={{ fontSize: '0.68rem', opacity: 0.75 }}>({p.active_count})</span>
                              )}
                            </button>
                          );
                        })}
                      <button
                        type="button"
                        className={`od-rider-chip${deliveryForm.delivery_partner === 'DHL / External Courier' ? ' is-selected' : ''}`}
                        onClick={() => setDeliveryForm(prev => ({ ...prev, delivery_partner: 'DHL / External Courier', driver_phone: '' }))}
                      >
                        External Courier
                      </button>
                    </div>

                    <div className="od-dispatch-grid">
                      <div>
                        <label htmlFor="od-dp">Rider / Courier Name *</label>
                        <input
                          id="od-dp"
                          type="text"
                          placeholder="Select above or type rider name"
                          value={deliveryForm.delivery_partner}
                          onChange={e => setDeliveryForm(prev => ({ ...prev, delivery_partner: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="od-ph">Rider WhatsApp Phone</label>
                        <input
                          id="od-ph"
                          type="text"
                          placeholder="Auto-filled for saved riders"
                          value={deliveryForm.driver_phone}
                          onChange={e => setDeliveryForm(prev => ({ ...prev, driver_phone: e.target.value }))}
                        />
                      </div>
                    </div>

                    <details style={{ marginBottom: 14 }}>
                      <summary className="muted text-xs" style={{ cursor: 'pointer', fontWeight: 500 }}>
                        Optional custom tracking # or estimated delivery date
                      </summary>
                      <div className="od-dispatch-grid" style={{ marginTop: 10, marginBottom: 0 }}>
                        <div>
                          <label htmlFor="od-trk">Tracking # (auto-generated if blank)</label>
                          <input
                            id="od-trk"
                            type="text"
                            placeholder="Auto-assigned e.g. BC-ACC-..."
                            value={deliveryForm.tracking_number}
                            onChange={e => setDeliveryForm(prev => ({ ...prev, tracking_number: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label htmlFor="od-eta">Estimated Delivery Date</label>
                          <input
                            id="od-eta"
                            type="date"
                            value={deliveryForm.estimated_delivery}
                            onChange={e => setDeliveryForm(prev => ({ ...prev, estimated_delivery: e.target.value }))}
                          />
                        </div>
                      </div>
                    </details>

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={deliverySaving || order.status === 'cancelled'}
                    >
                      {deliverySaving ? 'Dispatching…' : 'Dispatch order & send customer code'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* 3. Status & Audit Timeline */}
          {statusLog.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Order Activity Timeline</h2>
                <span className="muted text-xs">{statusLog.length} event{statusLog.length === 1 ? '' : 's'}</span>
              </div>
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
                          <span style={{ fontSize: '0.73rem', color: 'var(--ac-text-muted)', marginLeft: 'auto' }}>
                            {new Date(entry.created_at).toLocaleString('en-GH', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {entry.note && (
                          <p style={{ fontSize: '0.82rem', color: 'var(--ac-text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
                            {entry.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ════════ RIGHT CONTEXT SIDEBAR ════════ */}
        <div className="od-side-col">

          {/* 1. Customer Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Customer</h2>
              {order.customer_id ? (
                <Link to={`/customers/${order.customer_id}`} style={{ fontSize: '0.78rem', color: 'var(--ac-accent)', fontWeight: 600 }}>
                  View Profile →
                </Link>
              ) : order.is_guest ? (
                <span className="badge badge-accent">Guest</span>
              ) : null}
            </div>
            <div className="card-body">
              <div className="od-customer-top">
                <div className="od-avatar">{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.94rem' }}>{cleanCustomerName}</div>
                  {order.email && (
                    <a href={`mailto:${order.email}`} className="muted text-xs" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {order.email}
                    </a>
                  )}
                </div>
              </div>

              {displayPhone && (
                <div className="od-contact-list">
                  <div className="od-kv-row">
                    <span className="muted">Phone</span>
                    <span className="mono" style={{ fontSize: '0.82rem', fontWeight: 600 }}>{displayPhone}</span>
                  </div>
                  <div className="od-contact-actions">
                    <a
                      href={buildWhatsAppLink(displayPhone) || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-whatsapp btn-sm"
                      style={{ flex: 1, textDecoration: 'none' }}
                    >
                      💬 WhatsApp
                    </a>
                    <a
                      href={`tel:${displayPhone}`}
                      className="btn btn-outline btn-sm"
                      style={{ flex: 1, textDecoration: 'none' }}
                    >
                      📞 Call
                    </a>
                  </div>

                  {/* 1-Click WhatsApp Quick Message Templates */}
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="muted text-xs" style={{ fontWeight: 600 }}>Quick WhatsApp Messages:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <a
                        href={buildWhatsAppLink(displayPhone, WA_TEMPLATES.orderConfirmation(order)) || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm text-xs"
                        style={{ padding: '4px 8px', fontSize: '0.74rem', border: '1px solid var(--ac-border)', textDecoration: 'none' }}
                        title="Send Order Confirmation message"
                      >
                        ✨ Confirmed
                      </a>
                      {delivery && (
                        <a
                          href={buildWhatsAppLink(displayPhone, WA_TEMPLATES.deliveryHandoffWithOtp(order, delivery)) || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-sm text-xs"
                          style={{ padding: '4px 8px', fontSize: '0.74rem', border: '1px solid var(--ac-border)', textDecoration: 'none' }}
                          title="Send Dispatch & 6-digit Delivery Code message"
                        >
                          🛵 Dispatched
                        </a>
                      )}
                      {order.payment_method === 'pay_on_delivery' && order.payment_status !== 'paid' && (
                        <a
                          href={buildWhatsAppLink(displayPhone, WA_TEMPLATES.paymentReminderCod(order)) || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-sm text-xs"
                          style={{ padding: '4px 8px', fontSize: '0.74rem', border: '1px solid var(--ac-border)', textDecoration: 'none' }}
                          title="Send Cash on Delivery payment reminder"
                        >
                          💵 COD Reminder
                        </a>
                      )}
                      {order.fulfillment_method === 'pickup' && (
                        <a
                          href={buildWhatsAppLink(displayPhone, WA_TEMPLATES.readyForPickup(order, store)) || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-sm text-xs"
                          style={{ padding: '4px 8px', fontSize: '0.74rem', border: '1px solid var(--ac-border)', textDecoration: 'none' }}
                          title="Send Ready for Pickup station location notice"
                        >
                          📍 Pickup Ready
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 2. Destination / Pickup Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">{order.fulfillment_method === 'pickup' ? 'Pickup Station' : 'Delivery Address'}</h2>
              <span className={`badge ${order.fulfillment_method === 'pickup' ? 'badge-accent' : 'badge-neutral'}`}>
                {order.fulfillment_method === 'pickup' ? 'Pickup' : 'Door Delivery'}
              </span>
            </div>
            <div className="card-body">
              {order.fulfillment_method === 'pickup' ? (
                <div style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600 }}>{store.pickup_location || 'Store Pickup Station'}</div>
                  <div className="muted text-xs" style={{ marginTop: 4 }}>
                    Customer collects parcel in person — verify recipient ID or order number.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>
                  {fullAddressString ? (
                    <div style={{ fontWeight: 500 }}>{fullAddressString}</div>
                  ) : (
                    <div className="muted">Address not provided</div>
                  )}
                  {order.ghana_post_gps && (
                    <div style={{ marginTop: 6 }}>
                      <span className="muted text-xs">GhanaPostGPS: </span>
                      <strong className="mono" style={{ fontSize: '0.8rem' }}>{order.ghana_post_gps}</strong>
                    </div>
                  )}
                  {order.delivery_landmark && (
                    <div style={{ marginTop: 4 }}>
                      <span className="muted text-xs">Landmark: </span>
                      <span>{order.delivery_landmark}</span>
                    </div>
                  )}

                  {fullAddressString && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => {
                          navigator.clipboard?.writeText(fullAddressString);
                          toast.success('Delivery address copied');
                        }}
                      >
                        📋 Copy
                      </button>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.ghana_post_gps || fullAddressString)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline btn-sm"
                        style={{ flex: 1, textDecoration: 'none' }}
                      >
                        📍 Maps ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. Unified Payment & Refund Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Payment &amp; Settlement</h2>
              <StatusBadge status={order.payment_status} />
            </div>
            <div className="card-body">
              <div className="od-kv-row">
                <span className="muted">Method</span>
                <span style={{ fontWeight: 600 }}>
                  {order.payment_method === 'pay_on_delivery' ? 'Pay on Delivery (COD)' : 'Paystack Online'}
                </span>
              </div>
              <div className="od-kv-row">
                <span className="muted">Order Total</span>
                <strong style={{ fontSize: '0.92rem' }}>{fmt(order.total_amount)}</strong>
              </div>
              {order.payment_reference && (
                <div className="od-kv-row">
                  <span className="muted">Reference</span>
                  <span className="mono" style={{ fontSize: '0.76rem', wordBreak: 'break-all' }}>{order.payment_reference}</span>
                </div>
              )}
              <div className="od-kv-row">
                <span className="muted">Refund Status</span>
                <span className={`badge ${refundInfo.cls}`}>{refundInfo.label}</span>
              </div>

              {canMarkPaid && (
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={handleMarkPaid}
                  disabled={markPaidSaving}
                >
                  {markPaidSaving ? 'Updating…' : '✓ Record Cash / MoMo Collected'}
                </button>
              )}

              {hasRefundActivity && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ac-border)' }}>
                  <div className="od-refund-grid">
                    {order.refund_method && (
                      <>
                        <span className="muted">Method</span>
                        <span>{order.refund_method}</span>
                      </>
                    )}
                    {order.refund_amount && (
                      <>
                        <span className="muted">Refunded</span>
                        <strong>{fmt(order.refund_amount)}</strong>
                      </>
                    )}
                    {order.refund_reference && (
                      <>
                        <span className="muted">Ref</span>
                        <span className="mono" style={{ fontSize: '0.76rem', wordBreak: 'break-all' }}>{order.refund_reference}</span>
                      </>
                    )}
                  </div>
                  {order.refund_notes && (
                    <div className="muted text-xs" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{order.refund_notes}</div>
                  )}
                  {canRefund && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', marginTop: 10 }}
                      onClick={() => setRefundOpen(true)}
                      disabled={refundSaving}
                    >
                      Process Refund
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 4. Duplicate Payments Alert (only when present) */}
          {payments.some(p => p.status === 'duplicate') && (
            <div className="card" style={{ borderColor: 'var(--ac-danger)' }}>
              <div className="card-header">
                <h2 className="card-title">Duplicate Charges</h2>
                <span className="badge badge-danger">Action Required</span>
              </div>
              <div className="card-body">
                {payments.filter(p => p.status === 'duplicate').map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{p.paystack_reference}</div>
                      <div className="muted text-xs">{fmt(p.amount)}</div>
                    </div>
                    <button className="btn btn-danger btn-sm" disabled={dupRefundingId === p.id} onClick={() => handleRefundDuplicate(p)}>
                      {dupRefundingId === p.id ? 'Refunding…' : 'Refund'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. Order Notes (only when present) */}
          {order.notes && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Customer / Order Notes</h2></div>
              <div className="card-body">
                <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{order.notes}</div>
              </div>
            </div>
          )}

          {/* 6. Partial Item Returns (only when present or eligible) */}
          {(partialReturns.length > 0 || (order.status === 'delivered' && ['paid', 'partially_refunded'].includes(order.payment_status) && returnableItems.some(i => Number(i.remaining_quantity) > 0))) && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Item Returns ({partialReturns.length})</h2>
                {order.status === 'delivered' && ['paid', 'partially_refunded'].includes(order.payment_status) && returnableItems.some(i => Number(i.remaining_quantity) > 0) && (
                  <button className="btn btn-outline btn-sm" onClick={() => setAdminRetOpen(o => !o)}>
                    {adminRetOpen ? 'Close' : '+ New Return'}
                  </button>
                )}
              </div>
              <div className="card-body">
                {adminRetOpen && (
                  <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--ac-border)' }}>
                    {returnableItems.filter(i => Number(i.remaining_quantity) > 0).map(it => {
                      const q = Number(adminRetQty[it.id] || 0);
                      return (
                        <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="checkbox" style={{ width: 'auto' }} checked={q > 0} onChange={e => setAdminRetQty(p => ({ ...p, [it.id]: e.target.checked ? 1 : 0 }))} />
                            {it.product_name} (max {it.remaining_quantity})
                          </label>
                          {q > 0 && (
                            <input
                              type="number"
                              min={1}
                              max={it.remaining_quantity}
                              value={q}
                              onChange={e => setAdminRetQty(p => ({ ...p, [it.id]: Math.max(1, Math.min(Number(it.remaining_quantity), parseInt(e.target.value, 10) || 1)) }))}
                              style={{ width: 58 }}
                            />
                          )}
                        </div>
                      );
                    })}
                    <input
                      type="text"
                      placeholder="Return reason *"
                      value={adminRetReason}
                      onChange={e => setAdminRetReason(e.target.value)}
                      style={{ marginTop: 6, marginBottom: 8 }}
                    />
                    <button className="btn btn-accent btn-sm" disabled={adminRetSaving} onClick={handleAdminCreateReturn}>
                      {adminRetSaving ? 'Creating…' : 'Create Return'}
                    </button>
                  </div>
                )}

                {partialReturns.map(rr => {
                  const opts = retOptions[rr.id] || { restock_items: false, include_delivery_fee: false };
                  const busy = retActionId === rr.id;
                  return (
                    <div key={rr.id} style={{ padding: '10px 0', borderTop: '1px solid var(--ac-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{fmt(rr.refund_amount)}</strong>
                        <span className={`badge ${rr.status === 'refunded' ? 'badge-success' : rr.status === 'refund_failed' || rr.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                          {rr.status}
                        </span>
                      </div>
                      <div className="muted text-xs" style={{ marginTop: 4 }}>{rr.reason}</div>
                      {rr.status === 'pending' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="checkbox" style={{ width: 'auto' }} checked={opts.restock_items} onChange={e => setRetOptions(prev => ({ ...prev, [rr.id]: { ...opts, restock_items: e.target.checked } }))} />
                            Restock sealed items
                          </label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => handleApprovePartialReturn(rr)}>
                              {busy ? 'Processing…' : 'Approve & Refund'}
                            </button>
                            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleRejectPartialReturn(rr)}>
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Dialogs & Modals ────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!pendingStatus}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => { const s = pendingStatus; setPendingStatus(null); changeStatus(s); }}
        title={`Mark order as ${pendingStatus}?`}
        message="This updates the order stage and sends automated status notifications to the customer."
        confirmLabel={`Mark ${pendingStatus}`}
      />

      <Modal
        open={codModalOpen}
        onClose={() => { if (!markPaidSaving) setCodModalOpen(false); }}
        title="Confirm Pay-on-Delivery Settlement"
      >
        <form onSubmit={handleConfirmCodPayment}>
          {codFromDeliver && (
            <div className="alert alert-warning" style={{ marginBottom: 14 }}>
              <strong>Unpaid COD Order ({fmt(order.total_amount)}):</strong> Confirm how the rider collected payment before marking Delivered.
            </div>
          )}

          <div className="field">
            <label>Amount Collected</label>
            <input type="text" value={fmt(order.total_amount)} disabled />
          </div>

          <div className="field">
            <label>Collection Method</label>
            <select
              value={codForm.collection_method}
              onChange={e => setCodForm(f => ({ ...f, collection_method: e.target.value }))}
            >
              <option value="cash">Cash on Delivery</option>
              <option value="momo">Mobile Money (MTN / Telecel / AT)</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>

          <div className="field">
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

          <div className="field">
            <label>Collected By (Rider / Staff Name)</label>
            <input
              type="text"
              placeholder="e.g. Kwame (In-house Bike)"
              value={codForm.collected_by}
              onChange={e => setCodForm(f => ({ ...f, collected_by: e.target.value }))}
            />
          </div>

          {order.status !== 'delivered' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: '0.86rem' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={codForm.mark_delivered}
                onChange={e => setCodForm(f => ({ ...f, mark_delivered: e.target.checked }))}
              />
              <span>Also mark order &amp; delivery as <strong>Delivered</strong></span>
            </label>
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
            <button type="button" className="btn btn-outline btn-sm" disabled={markPaidSaving} onClick={() => setCodModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-accent btn-sm" disabled={markPaidSaving}>
              {markPaidSaving ? 'Saving…' : codForm.mark_delivered ? 'Confirm Payment & Deliver' : 'Confirm Payment Received'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => { if (!cancelSaving) { setCancelOpen(false); setCancelError(''); } }}
        title="Cancel order"
        size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setCancelOpen(false)} disabled={cancelSaving}>Close</button>
            <button className="btn btn-danger" onClick={handleCancelOrder} disabled={cancelSaving}>
              {cancelSaving ? 'Cancelling…' : 'Cancel order'}
            </button>
          </>
        }
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Cancellation Reason</label>
          <textarea
            rows={4}
            maxLength={500}
            placeholder="Optional reason shared in order history"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
          />
        </div>
        {cancelError && <div className="alert alert-error" style={{ marginTop: 12 }}>{cancelError}</div>}
      </Modal>

      <Modal
        open={refundOpen}
        onClose={() => { if (!refundSaving) { setRefundOpen(false); setRefundError(''); } }}
        title="Refund order"
        size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setRefundOpen(false)} disabled={refundSaving}>Close</button>
            <button
              className="btn btn-primary"
              onClick={handleRefundOrder}
              disabled={refundSaving || (refundForm.method === 'manual' && !refundForm.reference.trim())}
            >
              {refundSaving ? 'Submitting…' : 'Confirm refund'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <span className="muted">Full refund amount</span>
          <strong>{fmt(order.total_amount)}</strong>
        </div>
        <div className="field">
          <label>Method</label>
          <select value={refundForm.method} onChange={e => setRefundForm(f => ({ ...f, method: e.target.value }))}>
            <option value="paystack">Paystack</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div className="field">
          <label>Reference{refundForm.method === 'manual' ? ' *' : ' (optional)'}</label>
          <input
            type="text"
            maxLength={255}
            placeholder={refundForm.method === 'manual' ? 'Required for manual refunds' : 'Optional provider/reference note'}
            value={refundForm.reference}
            onChange={e => setRefundForm(f => ({ ...f, reference: e.target.value }))}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Notes</label>
          <textarea
            rows={3}
            maxLength={1000}
            placeholder="Optional refund notes"
            value={refundForm.notes}
            onChange={e => setRefundForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
        {refundError && <div className="alert alert-error" style={{ marginTop: 12 }}>{refundError}</div>}
      </Modal>

      <style>{`
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
          color: #141010;
          font-weight: 700;
        }
        .track-step.current .track-dot {
          box-shadow: 0 0 0 4px rgba(201, 165, 90, 0.22);
        }
        .track-label {
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.03em;
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
        }
        .od-admin-log-entry {
          position: relative;
          padding-bottom: 14px;
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
        .od-refund-grid {
          display: grid;
          grid-template-columns: minmax(84px, auto) 1fr;
          gap: 6px 12px;
          align-items: center;
          font-size: 0.84rem;
        }
      `}</style>
    </div>
  );
}
