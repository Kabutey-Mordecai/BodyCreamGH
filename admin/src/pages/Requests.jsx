import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';

const POLL_MS = 30_000;
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Requests() {
  const toast = useToast();
  const navigate = useNavigate();

  const [tab, setTab]             = useState('cancel');
  const [rows, setRows]           = useState([]);
  const [counts, setCounts]       = useState({ cancel: 0, return: 0 });
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch]       = useState('');
  const [acting, setActing]       = useState(null);

  // Modals
  const [confirmApprove, setConfirmApprove] = useState({ open: false, order: null });
  const [rejectDialog, setRejectDialog]   = useState({ open: false, order: null, reason: '', saving: false });
  const [reasonModal, setReasonModal]     = useState({ open: false, order: null, title: '', content: '' });

  const timerRef = useRef(null);

  const fetchCounts = useCallback(() => {
    return ordersAPI.getRequestCounts()
      .then(({ data }) => {
        setCounts({
          cancel: Number(data?.cancel || 0),
          return: Number(data?.return || 0),
        });
      })
      .catch(() => {});
  }, []);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    return Promise.allSettled([
      ordersAPI.getRequests(tab),
      fetchCounts(),
    ])
      .then(([reqRes]) => {
        if (reqRes.status === 'fulfilled') {
          setRows(Array.isArray(reqRes.value.data) ? reqRes.value.data : []);
        } else {
          if (!silent) toast.error('Failed to load requests');
        }
        setLastRefresh(new Date());
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [tab, fetchCounts, toast]);

  useEffect(() => {
    load(false);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  // Client-side search filtering
  const filteredRows = rows.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const reasonText = (tab === 'cancel' ? r.cancel_reason : r.return_reason) || '';
    return (
      (r.order_number && r.order_number.toLowerCase().includes(q)) ||
      (r.customer_name && r.customer_name.toLowerCase().includes(q)) ||
      (r.customer_email && r.customer_email.toLowerCase().includes(q)) ||
      reasonText.toLowerCase().includes(q)
    );
  });

  const handleExecuteApprove = async () => {
    const order = confirmApprove.order;
    if (!order) return;
    setActing(order.id);
    try {
      if (tab === 'cancel') {
        await ordersAPI.approveCancelRequest(order.id);
        toast.success(`Cancellation approved for #${order.order_number}`);
      } else if (order.is_partial_return && order.return_id) {
        await ordersAPI.approvePartialReturn(order.return_id, {});
        toast.success(`Partial return approved for #${order.order_number}`);
      } else {
        await ordersAPI.approveReturnRequest(order.id);
        toast.success(`Return approved for #${order.order_number}`);
      }
      setConfirmApprove({ open: false, order: null });
      load(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to approve request');
    } finally {
      setActing(null);
    }
  };

  const handleExecuteReject = async (e) => {
    if (e) e.preventDefault();
    const order = rejectDialog.order;
    if (!order) return;
    setRejectDialog(d => ({ ...d, saving: true }));
    setActing(order.id);
    try {
      const payload = rejectDialog.reason.trim() ? { reason: rejectDialog.reason.trim() } : undefined;
      if (tab === 'cancel') {
        await ordersAPI.rejectCancelRequest(order.id, payload);
        toast.success(`Cancellation rejected for #${order.order_number}`);
      } else if (order.is_partial_return && order.return_id) {
        await ordersAPI.rejectPartialReturn(order.return_id, payload || {});
        toast.success(`Partial return rejected for #${order.order_number}`);
      } else {
        await ordersAPI.rejectReturnRequest(order.id, payload);
        toast.success(`Return rejected for #${order.order_number}`);
      }
      setRejectDialog({ open: false, order: null, reason: '', saving: false });
      load(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reject request');
      setRejectDialog(d => ({ ...d, saving: false }));
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <p className="muted">Pending customer cancellation &amp; return requests</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastRefresh && (
            <span style={{ fontSize: '0.75rem', color: 'var(--ac-text-muted)' }}>
              Updated {lastRefresh.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs with live count badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn btn-sm ${tab === 'cancel' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setTab('cancel'); setSearch(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span>Cancellations</span>
          <span style={{
            fontSize: '0.72rem',
            padding: '1px 6px',
            borderRadius: 10,
            background: tab === 'cancel' ? 'rgba(255,255,255,0.25)' : 'var(--ac-surface-sunken)',
            fontWeight: 600,
          }}>
            {counts.cancel}
          </span>
        </button>

        <button
          className={`btn btn-sm ${tab === 'return' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setTab('return'); setSearch(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span>Returns</span>
          <span style={{
            fontSize: '0.72rem',
            padding: '1px 6px',
            borderRadius: 10,
            background: tab === 'return' ? 'rgba(255,255,255,0.25)' : 'var(--ac-surface-sunken)',
            fontWeight: 600,
          }}>
            {counts.return}
          </span>
        </button>
      </div>

      {/* Search Toolbar */}
      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="toolbar-left" style={{ flex: 1, minWidth: 260 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${tab === 'cancel' ? 'cancellations' : 'returns'} by order #, customer, or reason…`}
          />
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={filteredRows}
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
          emptyMessage={
            rows.length === 0
              ? `No pending ${tab === 'cancel' ? 'cancellation' : 'return'} requests.`
              : 'No requests match your search.'
          }
          columns={[
            {
              key: 'order_number',
              label: 'Order #',
              render: r => (
                <div>
                  <span className="cell-primary">#{r.order_number || r.id?.slice(0, 8)}</span>
                  <div className="cell-muted text-xs" style={{ marginTop: 2 }}>
                    {new Date(tab === 'cancel' ? r.cancel_requested_at : r.return_requested_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ),
            },
            {
              key: 'customer',
              label: 'Customer',
              render: r => (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.customer_id ? (
                      <Link
                        to={`/customers/${r.customer_id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ fontWeight: 500, color: 'var(--ac-primary)', textDecoration: 'none' }}
                      >
                        {r.customer_name || '—'}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 500 }}>{r.customer_name || '—'}</span>
                    )}
                    {r.is_guest && (
                      <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: '#3b2d1d', color: '#e5c378', border: '1px solid rgba(201,165,90,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Guest
                      </span>
                    )}
                  </div>
                  <div className="cell-muted text-xs">{r.customer_email || ''}</div>
                  {r.customer_phone && (
                    <div className="cell-muted text-xs" style={{ fontSize: '0.72rem' }}>📞 {r.customer_phone}</div>
                  )}
                </div>
              ),
            },
            {
              key: 'items',
              label: 'Items',
              render: r => {
                const count = r.item_count || (r.items?.length || 1);
                const firstItem = r.items?.[0];
                return (
                  <div>
                    <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                      {count} item{count === 1 ? '' : 's'}
                    </span>
                    {firstItem && (
                      <div className="cell-muted text-xs" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {firstItem.name}{firstItem.variant_label ? ` (${firstItem.variant_label})` : ''}
                        {count > 1 ? ` +${count - 1} more` : ''}
                      </div>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'fulfillment_method',
              label: 'Fulfillment',
              render: r => r.fulfillment_method === 'pickup' ? (
                <span className="badge badge-accent" style={{ fontSize: '0.72rem' }}>Pickup Station</span>
              ) : (
                <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>Door Delivery</span>
              ),
            },
            {
              key: 'payment',
              label: 'Payment',
              render: r => (
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{fmt(r.total_amount)}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                    <StatusBadge status={r.payment_status} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--ac-text-muted)' }}>
                      {r.payment_method === 'pay_on_delivery' ? 'COD' : 'Paystack'}
                    </span>
                  </div>
                </div>
              ),
            },
            {
              key: 'status',
              label: 'Order Status',
              render: r => <StatusBadge status={r.status} />,
            },
            {
              key: 'reason',
              label: 'Customer Reason',
              render: r => {
                const reasonText = (tab === 'cancel' ? r.cancel_reason : r.return_reason) || '—';
                const isLong = reasonText.length > 55;
                return (
                  <div style={{ fontSize: '0.84rem', color: 'var(--ac-text-muted)', maxWidth: 220 }}>
                    <span style={{ fontStyle: reasonText === '—' ? 'italic' : 'normal' }}>
                      {isLong ? `${reasonText.slice(0, 52)}…` : reasonText}
                    </span>
                    {isLong && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReasonModal({
                            open: true,
                            order: r,
                            title: `${tab === 'cancel' ? 'Cancellation' : 'Return'} Reason for #${r.order_number}`,
                            content: reasonText,
                          });
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '0 0 0 4px',
                          color: 'var(--ac-primary)',
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Read more
                      </button>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'actions',
              label: '',
              className: 'cell-right',
              render: r => {
                const alreadyApproved = r.refund_status === 'pending' || r.refund_status === 'success';
                if (alreadyApproved) {
                  return (
                    <span className="badge badge-info">
                      {r.refund_status === 'success' ? 'Refunded' : 'Approved · Refund Pending'}
                    </span>
                  );
                }
                return (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ color: 'var(--ac-success)', borderColor: 'rgba(46, 133, 64, 0.4)' }}
                    disabled={acting === r.id}
                    onClick={() => setConfirmApprove({ open: true, order: r })}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ color: 'var(--ac-danger)', borderColor: 'rgba(209, 67, 67, 0.4)' }}
                    disabled={acting === r.id}
                    onClick={() => setRejectDialog({ open: true, order: r, reason: '', saving: false })}
                  >
                    Reject
                  </button>
                </div>
                );
              },
            },
          ]}
        />
      </div>

      {/* Confirmation Dialog for Approvals */}
      <ConfirmDialog
        open={confirmApprove.open}
        title={
          tab === 'cancel'
            ? `Approve Cancellation for #${confirmApprove.order?.order_number}?`
            : `Approve Return for #${confirmApprove.order?.order_number}?`
        }
        message={
          tab === 'cancel'
            ? `This will cancel Order #${confirmApprove.order?.order_number}, restore ${confirmApprove.order?.item_count || 1} item(s) to inventory, and return any applied coupon. ${confirmApprove.order?.payment_status === 'paid' ? `Since this order was paid (${fmt(confirmApprove.order?.total_amount)}), it will be flagged as refund owed.` : confirmApprove.order?.payment_status === 'payment_review' ? `Since this order has a payment under review (${fmt(confirmApprove.order?.total_amount)}), it will be flagged as refund owed.` : 'No payment was collected.'}`
            : `This will approve the return for Order #${confirmApprove.order?.order_number} and initiate a ${confirmApprove.order?.payment_method === 'paystack' ? 'Paystack refund' : 'manual refund record'} for ${fmt(confirmApprove.order?.total_amount)}.`
        }
        confirmLabel={tab === 'cancel' ? 'Yes, Approve Cancellation' : 'Yes, Approve Return & Refund'}
        cancelLabel="Keep Pending"
        danger={false}
        onConfirm={handleExecuteApprove}
        onClose={() => setConfirmApprove({ open: false, order: null })}
      />

      {/* Rejection Modal with Note Input */}
      <Modal
        open={rejectDialog.open}
        onClose={() => !rejectDialog.saving && setRejectDialog({ open: false, order: null, reason: '', saving: false })}
        title={`Reject ${tab === 'cancel' ? 'Cancellation' : 'Return'} Request`}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline"
              disabled={rejectDialog.saving}
              onClick={() => setRejectDialog({ open: false, order: null, reason: '', saving: false })}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={rejectDialog.saving}
              onClick={handleExecuteReject}
            >
              {rejectDialog.saving ? 'Rejecting…' : 'Reject Request'}
            </button>
          </>
        }
      >
        <form onSubmit={handleExecuteReject}>
          <p style={{ color: 'var(--ac-text-muted)', fontSize: '0.88rem', marginBottom: 12 }}>
            Are you sure you want to decline the {tab === 'cancel' ? 'cancellation' : 'return'} request for <strong>#{rejectDialog.order?.order_number}</strong>?
          </p>

          <div className="form-group" style={{ marginBottom: 8 }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>
              Reason / Note for Customer (Optional)
            </label>
            <textarea
              rows={3}
              placeholder={
                tab === 'cancel'
                  ? 'e.g. Order has already been dispatched with courier partner.'
                  : 'e.g. Returned item seal is broken or past the return window.'
              }
              value={rejectDialog.reason}
              onChange={e => setRejectDialog(d => ({ ...d, reason: e.target.value }))}
              style={{ width: '100%', fontSize: '0.85rem', resize: 'vertical' }}
            />
            <span className="muted text-xs" style={{ display: 'block', marginTop: 4 }}>
              This explanation will be logged and included in the notification to the customer.
            </span>
          </div>
        </form>
      </Modal>

      {/* Reason Inspection Modal */}
      <Modal
        open={reasonModal.open}
        onClose={() => setReasonModal({ open: false, order: null, title: '', content: '' })}
        title={reasonModal.title}
        size="sm"
        footer={
          <button
            className="btn btn-primary"
            onClick={() => setReasonModal({ open: false, order: null, title: '', content: '' })}
          >
            Close
          </button>
        }
      >
        <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--ac-text)' }}>
          {reasonModal.content}
        </div>
      </Modal>
    </div>
  );
}
