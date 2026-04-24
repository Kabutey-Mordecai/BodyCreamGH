import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Orders() {
  const navigate = useNavigate();
  const toast = useToast();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]   = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    ordersAPI.getAll()
      .then(({ data }) => setOrders(Array.isArray(data) ? data : (data.orders || [])))
      .catch(() => toast.error('Failed to load orders'))
      .finally(() => setLoading(false));
  }, []);

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
            { key: 'payment_status', label: 'Payment', render: o => <StatusBadge status={o.payment_status} /> },
            { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> },
          ]}
        />
      </div>
    </div>
  );
}
