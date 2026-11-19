import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
const POLL_MS = 30_000;
const PAGE_SIZE = 20;
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
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus]       = useState('all');
  const [page, setPage]           = useState(1);
  const [exporting, setExporting] = useState(false);
  const timerRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Reset page when status filter changes
  useEffect(() => { setPage(1); }, [status]);

  const fetchOrders = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const params = {
      page,
      limit: PAGE_SIZE,
      ...(status !== 'all' && { status }),
      ...(debouncedSearch && { search: debouncedSearch }),
    };
    return ordersAPI.getAll(params)
      .then(({ data }) => {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setLastRefresh(new Date());
      })
      .catch(() => { if (!silent) toast.error('Failed to load orders'); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [page, status, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchOrders(false);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => fetchOrders(true), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchOrders]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
        ...(status !== 'all' && { status }),
        ...(debouncedSearch && { search: debouncedSearch }),
      };
      const { data } = await ordersAPI.exportOrders(params);
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export orders');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="muted">{total.toLocaleString()} order{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastRefresh && (
            <span style={{ fontSize: '0.75rem', color: 'var(--ac-text-muted)' }}>
              Updated {lastRefresh.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className="btn btn-outline btn-sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : '↓ Export CSV'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => fetchOrders(true)} disabled={refreshing}>
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
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by order #, customer email…"
          />
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={orders}
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
          emptyMessage={total === 0 ? 'No orders yet.' : 'No orders match your filters.'}
          columns={[
            { key: 'order_number', label: 'Order #', render: o => <span className="cell-primary">#{o.order_number || o.id?.slice(0, 8)}</span> },
            { key: 'created_at', label: 'Placed',
              render: o => new Date(o.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
            { key: 'customer', label: 'Customer',
              render: o => (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 500 }}>{o.customer_name || '—'}</span>
                    {o.is_guest && (
                      <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: '#3b2d1d', color: '#e5c378', border: '1px solid rgba(201,165,90,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Guest
                      </span>
                    )}
                  </div>
                  <div className="cell-muted text-xs">{o.customer_email || ''}</div>
                  {o.customer_phone && <div className="cell-muted text-xs" style={{ fontSize: '0.72rem' }}>📞 {o.customer_phone}</div>}
                </div>
              ) },
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={{ fontSize: '0.85rem', color: 'var(--ac-text-muted)' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-outline btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
        </div>
      )}
    </div>
  );
}
