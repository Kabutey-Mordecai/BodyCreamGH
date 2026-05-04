import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Requests() {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab]           = useState('cancel');
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(null); // orderId being acted on

  const load = () => {
    setLoading(true);
    ordersAPI.getRequests(tab)
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load requests'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async (order) => {
    setActing(order.id);
    try {
      if (tab === 'cancel') {
        await ordersAPI.approveCancelRequest(order.id);
        toast.success(`Cancellation approved for #${order.order_number}`);
      } else {
        await ordersAPI.approveReturnRequest(order.id);
        toast.success(`Return approved for #${order.order_number}`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to approve request');
    } finally { setActing(null); }
  };

  const handleReject = async (order) => {
    setActing(order.id);
    try {
      if (tab === 'cancel') {
        await ordersAPI.rejectCancelRequest(order.id);
        toast.success(`Cancellation rejected for #${order.order_number}`);
      } else {
        await ordersAPI.rejectReturnRequest(order.id);
        toast.success(`Return rejected for #${order.order_number}`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reject request');
    } finally { setActing(null); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <p className="muted">Pending customer cancel &amp; return requests</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'cancel' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('cancel')}>
          Cancellations
        </button>
        <button className={`btn btn-sm ${tab === 'return' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('return')}>
          Returns
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="spinner" style={{ margin: '40px auto' }} />
        ) : rows.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ac-text-muted)' }}>
            No pending {tab === 'cancel' ? 'cancellation' : 'return'} requests.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th className="cell-right">Total</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Requested</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${r.id}`)}>
                  <td>
                    <span className="cell-primary">#{r.order_number}</span>
                  </td>
                  <td>
                    <div>{r.customer_name || '—'}</div>
                    <div className="cell-muted text-xs">{r.customer_email || ''}</div>
                  </td>
                  <td className="cell-right">{fmt(r.total_amount)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ac-text-muted)', fontSize: '0.85rem' }}>
                    {(tab === 'cancel' ? r.cancel_reason : r.return_reason) || '—'}
                  </td>
                  <td style={{ color: 'var(--ac-text-muted)', fontSize: '0.83rem' }}>
                    {new Date(tab === 'cancel' ? r.cancel_requested_at : r.return_requested_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ color: 'var(--ac-success)' }}
                        disabled={acting === r.id}
                        onClick={() => handleApprove(r)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ color: 'var(--ac-danger)' }}
                        disabled={acting === r.id}
                        onClick={() => handleReject(r)}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
