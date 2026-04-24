import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ordersAPI, settingsAPI, deliveriesAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import { printInvoice } from '../utils/printInvoice';

// Fulfilment flow is strictly forward-moving. Skipping to "delivered" is allowed
// if the merchant updates late (e.g. phone-confirmed pickups).
const STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [order, setOrder]     = useState(null);
  const [store, setStore]     = useState({});
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);

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
      .then(({ data }) => setOrder(data))
      .catch(() => toast.error('Failed to load order'))
      .finally(() => setLoading(false));
    loadDelivery();
  };

  useEffect(load, [id]);

  useEffect(() => {
    settingsAPI.getAll().then(({ data }) => setStore(data)).catch(() => {});
  }, []);

  const changeStatus = async (next) => {
    setSaving(true);
    try {
      await ordersAPI.updateStatus(id, next);
      toast.success(`Status updated to ${next}`);
      load();
    } catch {
      toast.error('Failed to update status — endpoint may not be implemented yet');
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
  const isCancelled = order.status === 'cancelled';
  const subtotal = (order.items || []).reduce((s, it) => s + Number(it.subtotal || (it.price_at_purchase * it.quantity) || 0), 0);

  // Phone from user profile; delivery phone is stored in notes as "Phone: 233..."
  const phoneFromNotes = order.notes?.match(/^Phone:\s*(.+?)(\n|$)/i)?.[1]?.trim();
  const displayPhone = order.customer_phone || phoneFromNotes;

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
      {!isCancelled && (
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
                  disabled={saving || i <= currentIdx}
                  onClick={() => setPendingStatus(s)}
                  style={{ textTransform: 'capitalize' }}
                >
                  Mark as {s}
                </button>
              ))}
              <button
                className="btn btn-sm btn-outline"
                style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-danger-soft)' }}
                disabled={saving}
                onClick={() => setCancelOpen(true)}
              >
                Cancel order
              </button>
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
            <div className="card-header"><h2 className="card-title">Customer</h2></div>
            <div className="card-body">
              <div style={{ fontSize: '0.92rem', marginBottom: 4 }}>
                {order.first_name || order.customer_name || '—'} {order.last_name || ''}
              </div>
              {order.email && <div className="text-sm muted" style={{ marginBottom: 2 }}>{order.email}</div>}
              {displayPhone && <div className="text-sm muted">{displayPhone}</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Shipping</h2></div>
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
              <div style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="muted">Status</span><StatusBadge status={order.payment_status} />
              </div>
              {order.payment_reference && (
                <div style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  <div className="muted text-xs">Reference</div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>{order.payment_reference}</div>
                </div>
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

      <ConfirmDialog
        open={!!pendingStatus}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => { const s = pendingStatus; setPendingStatus(null); changeStatus(s); }}
        title={`Mark as ${pendingStatus}?`}
        message={`This will update the order status and may trigger customer notifications.`}
        confirmLabel={`Mark ${pendingStatus}`}
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => changeStatus('cancelled')}
        title="Cancel this order?"
        message="The order will be cancelled. If it was paid, handle the refund with the customer separately."
        confirmLabel="Cancel order"
        danger
      />

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
      `}</style>
    </div>
  );
}
