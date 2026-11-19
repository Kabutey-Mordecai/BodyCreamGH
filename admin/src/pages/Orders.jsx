import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
    ['paid', 'payment_review'].includes(order.payment_status) &&
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
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
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

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [status, fulfillmentFilter, paymentFilter]);

  const fetchOrders = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const params = {
      page,
      limit: PAGE_SIZE,
      ...(status !== 'all' && { status }),
      ...(fulfillmentFilter !== 'all' && { fulfillment_method: fulfillmentFilter }),
      ...(paymentFilter !== 'all' && { payment_status: paymentFilter }),
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
  }, [page, status, fulfillmentFilter, paymentFilter, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

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
        ...(fulfillmentFilter !== 'all' && { fulfillment_method: fulfillmentFilter }),
        ...(paymentFilter !== 'all' && { payment_status: paymentFilter }),
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

      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="toolbar-left" style={{ flex: 1, minWidth: 260 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by order #, customer email…"
          />
        </div>
        <div className="toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={paymentFilter}
            onChange={e => setPaymentFilter(e.target.value)}
            aria-label="Filter by payment status"
            style={{ fontSize: '0.85rem', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--ac-border)', background: 'var(--ac-surface)', color: 'inherit' }}
          >
            <option value="all">All Payments</option>
            <option value="unpaid">Unpaid</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="payment_review">Payment Review</option>
            <option value="refunded">Refunded</option>
          </select>
          <select
            value={fulfillmentFilter}
            onChange={e => setFulfillmentFilter(e.target.value)}
            aria-label="Filter by fulfillment method"
            style={{ fontSize: '0.85rem', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--ac-border)', background: 'var(--ac-surface)', color: 'inherit' }}
          >
            <option value="all">All Fulfillment</option>
            <option value="delivery">Door Delivery</option>
            <option value="pickup">Pickup Station</option>
          </select>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={orders}
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
          emptyMessage={total === 0 ? 'No orders yet.' : 'No orders match your filters.'}
          columns={[
            {
              key: 'order_number',
              label: 'Order #',
              render: o => (
                <div>
                  <span className="cell-primary">#{o.order_number || o.id?.slice(0, 8)}</span>
                  {o.cancel_requested && !o.cancel_request_rejected && (
                    <div style={{ marginTop: 2 }}>
                      <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>⚠ Cancel Requested</span>
                    </div>
                  )}
                  {o.return_requested && !o.return_request_rejected && (
                    <div style={{ marginTop: 2 }}>
                      <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>↩ Return Requested</span>
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'created_at',
              label: 'Placed',
              render: o => new Date(o.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            },
            {
              key: 'customer',
              label: 'Customer',
              render: o => (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {o.customer_id ? (
                      <Link
                        to={`/customers/${o.customer_id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ fontWeight: 500, color: 'var(--ac-primary)', textDecoration: 'none' }}
                      >
                        {o.customer_name || '—'}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 500 }}>{o.customer_name || '—'}</span>
                    )}
                    {o.is_guest && (
                      <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: '#3b2d1d', color: '#e5c378', border: '1px solid rgba(201,165,90,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Guest
                      </span>
                    )}
                  </div>
                  <div className="cell-muted text-xs">{o.customer_email || ''}</div>
                  {o.customer_phone && <div className="cell-muted text-xs" style={{ fontSize: '0.72rem' }}>📞 {o.customer_phone}</div>}
                </div>
              ),
            },
            {
              key: 'items',
              label: 'Items',
              render: o => (
                <span style={{ fontSize: '0.85rem' }}>
                  {o.item_count || 1} item{Number(o.item_count) === 1 ? '' : 's'}
                </span>
              ),
            },
            {
              key: 'fulfillment_method',
              label: 'Fulfillment',
              render: o => o.fulfillment_method === 'pickup' ? (
                <span className="badge badge-accent" style={{ fontSize: '0.72rem' }}>Pickup Station</span>
              ) : (
                <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>Door Delivery</span>
              ),
            },
            {
              key: 'total_amount',
              label: 'Total',
              className: 'cell-right',
              render: o => fmt(o.total_amount),
            },
            {
              key: 'payment_status',
              label: 'Payment',
              render: o => (
                <div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <StatusBadge status={o.payment_status} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--ac-text-muted)' }}>
                      {o.payment_method === 'pay_on_delivery' ? 'COD' : 'Paystack'}
                    </span>
                  </div>
                  {needsRefund(o) && <div style={{ marginTop: 4 }}><span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Refund owed</span></div>}
                  {o.refund_status === 'pending' && <div style={{ marginTop: 4 }}><span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Refund pending</span></div>}
                  {o.refund_status === 'needs_attention' && <div style={{ marginTop: 4 }}><span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Refund needs attention</span></div>}
                  {o.refund_status === 'failed' && <div style={{ marginTop: 4 }}><span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>Refund failed</span></div>}
                </div>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: o => (
                <StatusBadge status={o.fulfillment_method === 'pickup' && o.status === 'shipped' ? 'ready_for_pickup' : o.status} />
              ),
            },
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
