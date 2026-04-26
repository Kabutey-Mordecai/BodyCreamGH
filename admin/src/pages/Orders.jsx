import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
const POLL_MS = 30_000; // auto-refresh every 30 s
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

function needsRefund(order) {
  return order.status === 'cancelled' &&
    order.payment_status === 'paid' &&
    (order.refund_status || 'not_requested') === 'not_requested';
}

export default function Orders() {
  const navigate = useNavigate();
  const toast = useToast();

  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [query, setQuery]         = useState('');
  const [status, setStatus]       = useState('all');
  const timerRef = useRef(null);

  const fetchOrders = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    return ordersAPI.getAll()
      .then(({ data }) => {
        setOrders(Array.isArray(data) ? data : (data.orders || []));
        setLastRefresh(new Date());
      })
      .catch(() => { if (!silent) toast.error('Failed to load orders'); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load + 30-second polling
  useEffect(() => {
    fetchOrders(false);
    timerRef.current = setInterval(() => fetchOrders(true), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchOrders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter(o => {
      if (status !== 'all' && o.status !== status) return false;
      if (!q) return true;
      return [o.order_number, o.id, o.email, o.first_name, o.last_name, o.shipping_city]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [orders, query, status]);

  // Compute quick counts for the tab labels
  const counts = useMemo(() => {
    const c = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [orders]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="muted">{filtered.length} of {orders.length} orders</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <span style={{ fontSize: '0.75rem', color: 'var(--ac-text-muted)' }}>
              Updated {lastRefresh.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className="btn btn-outline btn-sm"
            onClick={() => fetchOrders(true)}
            disabled={refreshing}
            title="Refresh orders"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setStatus(s)}
            style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}
          >
            {s === 'all' ? 'All' : s}
            {counts[s] > 0 && <span style={{ opacity: 0.65, marginLeft: 4 }}>({counts[s]})</span>}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by order #, customer email, city…"
          />
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={filtered}
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
          emptyMessage={orders.length === 0 ? 'No orders yet.' : 'No orders match your filters.'}
          columns={[
            { key: 'order_number', label: 'Order #', render: o => <span className="cell-primary">#{o.order_number || o.id?.slice(0, 8)}</span> },
            { key: 'created_at', label: 'Placed',
              render: o => new Date(o.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
            { key: 'customer', label: 'Customer',
              render: o => (
                <div>
                  <div>{o.first_name || o.customer_name || '—'} {o.last_name || ''}</div>
                  <div className="cell-muted text-xs">{o.email || ''}</div>
                </div>
              ) },
            { key: 'shipping_city', label: 'Location',
              render: o => (o.shipping_city || o.shipping_region) ? `${o.shipping_city || ''}${o.shipping_region ? ', ' + o.shipping_region : ''}` : '—' },
            { key: 'total_amount', label: 'Total', className: 'cell-right', render: o => fmt(o.total_amount) },
            { key: 'payment_status', label: 'Payment',
              render: o => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <StatusBadge status={o.payment_status} />
                  {needsRefund(o) && <span className="badge badge-warning">Refund owed</span>}
                  {o.refund_status === 'pending' && <span className="badge badge-warning">Refund pending</span>}
                  {o.refund_status === 'failed' && <span className="badge badge-danger">Refund failed</span>}
                </div>
              ) },
            { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> },
          ]}
        />
      </div>
    </div>
  );
}
