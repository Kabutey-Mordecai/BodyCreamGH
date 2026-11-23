import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import StatCard from '../components/StatCard';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
const POLL_MS = 30_000;
const PAGE_SIZE = 20;
const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function needsRefund(order) {
  return (
    order.status === 'cancelled' &&
    ['paid', 'payment_review'].includes(order.payment_status) &&
    (order.refund_status || 'not_requested') === 'not_requested'
  );
}

export default function Orders() {
  const navigate = useNavigate();
  const toast = useToast();

  const [orders, setOrders]                 = useState([]);
  const [total, setTotal]                   = useState(0);
  const [totalPages, setTotalPages]         = useState(1);
  const [loading, setLoading]               = useState(true);
  const [refreshing, setRefreshing]         = useState(false);
  const [lastRefresh, setLastRefresh]       = useState(null);
  const [search, setSearch]                 = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus]                 = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [paymentFilter, setPaymentFilter]   = useState('all');
  const [page, setPage]                     = useState(1);
  const [exporting, setExporting]           = useState(false);
  const [viewMode, setViewMode]             = useState('orders'); // 'orders' | 'abandoned'
  const [abandoned, setAbandoned]           = useState([]);
  const [abandonedLoading, setAbandonedLoading] = useState(false);
  const [remindingId, setRemindingId]       = useState(null);
  const [selectedIds, setSelectedIds]       = useState([]);

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

  // Reset page & selection when filters change
  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [status, fulfillmentFilter, paymentFilter, debouncedSearch]);

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
    return ordersAPI
      .getAll(params)
      .then(({ data }) => {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setLastRefresh(new Date());
      })
      .catch(() => {
        if (!silent) toast.error('Failed to load orders');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [page, status, fulfillmentFilter, paymentFilter, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchOrders(false);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => fetchOrders(true), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchOrders]);

  const pageStats = useMemo(() => {
    const pageRevenue = orders
      .filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
      .reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const attentionCount = orders.filter(
      o =>
        needsRefund(o) ||
        (o.cancel_requested && !o.cancel_request_rejected) ||
        (o.return_requested && !o.return_request_rejected) ||
        o.status === 'pending'
    ).length;
    const paidCount = orders.filter(o => o.payment_status === 'paid').length;
    return { pageRevenue, attentionCount, paidCount };
  }, [orders]);

  const hasActiveFilters =
    status !== 'all' ||
    fulfillmentFilter !== 'all' ||
    paymentFilter !== 'all' ||
    search.trim() !== '';

  const clearAllFilters = () => {
    setStatus('all');
    setFulfillmentFilter('all');
    setPaymentFilter('all');
    setSearch('');
  };

  const handleToggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleExportSelectedCSV = () => {
    const chosen = orders.filter(o => selectedIds.includes(o.id));
    if (!chosen.length) return;
    const headers = ['Order #', 'Date', 'Customer', 'Email', 'Total (GHS)', 'Payment', 'Status', 'Fulfillment'];
    const csvRows = chosen.map(o =>
      [
        o.order_number || o.id?.slice(0, 8),
        new Date(o.created_at).toISOString(),
        o.customer_name || 'Guest',
        o.customer_email || '',
        Number(o.total_amount || 0).toFixed(2),
        o.payment_status,
        o.status,
        o.fulfillment_method || 'delivery',
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-selected-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${chosen.length} order${chosen.length !== 1 ? 's' : ''}`);
  };

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

  const startIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(total, page * PAGE_SIZE);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="muted">
            {total.toLocaleString()} order{total !== 1 ? 's' : ''}
            {lastRefresh && (
              <> · Updated {lastRefresh.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </p>
        </div>

        <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="ord-segmented" role="tablist" aria-label="Order view mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'orders'}
              className={`ord-seg-btn ${viewMode === 'orders' ? 'active' : ''}`}
              onClick={() => setViewMode('orders')}
            >
              Orders
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'abandoned'}
              className={`ord-seg-btn ${viewMode === 'abandoned' ? 'active' : ''}`}
              onClick={async () => {
                setViewMode('abandoned');
                setAbandonedLoading(true);
                try {
                  const { data } = await ordersAPI.getAbandoned();
                  setAbandoned(data.sessions || []);
                } catch {
                  toast.error('Failed to load abandoned checkouts');
                } finally {
                  setAbandonedLoading(false);
                }
              }}
            >
              Abandoned Carts
            </button>
          </div>

          {viewMode === 'orders' && (
            <>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? 'Exporting…' : '↓ Export CSV'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => fetchOrders(true)}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'abandoned' ? (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Abandoned Checkouts</h2>
            <span className="muted text-xs">{abandoned.length} captured session{abandoned.length !== 1 ? 's' : ''}</span>
          </div>
          <DataTable
            loading={abandonedLoading}
            rows={abandoned}
            emptyMessage="No abandoned checkouts captured yet."
            columns={[
              {
                key: 'email',
                label: 'Customer',
                render: s => (
                  <div>
                    <div className="cell-primary">{s.first_name || s.email}</div>
                    <div className="muted text-xs">
                      {s.email}
                      {s.phone ? ` · ${s.phone}` : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'step_reached',
                label: 'Step',
                render: s => (
                  <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>
                    {s.step_reached}
                  </span>
                ),
              },
              {
                key: 'subtotal',
                label: 'Cart Value',
                className: 'cell-right',
                render: s => <strong>{fmt(s.subtotal)}</strong>,
              },
              {
                key: 'updated_at',
                label: 'Last Active',
                render: s =>
                  new Date(s.updated_at).toLocaleString('en-GH', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
              },
              {
                key: 'actions',
                label: 'Recovery',
                render: s => (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={remindingId === s.id}
                    onClick={async e => {
                      e.stopPropagation();
                      setRemindingId(s.id);
                      try {
                        await ordersAPI.sendAbandonedReminder(s.id);
                        toast.success(`Recovery email sent to ${s.email}`);
                        setAbandoned(prev =>
                          prev.map(row =>
                            row.id === s.id
                              ? { ...row, reminder_sent_at: new Date().toISOString() }
                              : row
                          )
                        );
                      } catch (err) {
                        toast.error(err.response?.data?.error || 'Failed to send reminder');
                      } finally {
                        setRemindingId(null);
                      }
                    }}
                  >
                    {remindingId === s.id
                      ? 'Sending…'
                      : s.reminder_sent_at
                        ? 'Resend Email'
                        : 'Send Recovery Email'}
                  </button>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <>
          {/* Quick Page KPI Summary Strip */}
          <div className="stats-grid" style={{ marginBottom: 18 }}>
            <StatCard
              label="Matching Orders"
              value={total.toLocaleString()}
              sub={`Page ${page} of ${totalPages}`}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 8h12l-1 11a2 2 0 01-2 2H9a2 2 0 01-2-2L6 8z" />
                  <path d="M9 8V6a3 3 0 116 0v2" />
                </svg>
              }
            />
            <StatCard
              label="Page Value"
              value={fmt(pageRevenueOrZero(pageStats.pageRevenue))}
              sub={`${pageStats.paidCount} paid on this page`}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                </svg>
              }
            />
            <StatCard
              label="Needs Attention"
              value={pageStats.attentionCount}
              accent={pageStats.attentionCount > 0 ? 'var(--ac-warning)' : undefined}
              sub="Pending, cancel, return or refund"
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              }
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="ord-status-tabs" role="tablist" aria-label="Filter orders by status">
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={status === s}
                className={`ord-status-tab ${status === s ? 'active' : ''}`}
                onClick={() => setStatus(s)}
              >
                {s === 'all' ? 'All Orders' : s}
              </button>
            ))}
          </div>

          {/* Search & Dropdown Filters Toolbar */}
          <div className="toolbar">
            <div className="toolbar-left" style={{ flex: 1, minWidth: 260 }}>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search by order #, customer name, email…"
              />
            </div>
            <div className="toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                value={paymentFilter}
                onChange={e => setPaymentFilter(e.target.value)}
                aria-label="Filter by payment status"
                style={{ width: 155 }}
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
                style={{ width: 165 }}
              >
                <option value="all">All Fulfillment</option>
                <option value="delivery">Door Delivery</option>
                <option value="pickup">Pickup Station</option>
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={clearAllFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Orders DataTable */}
          <div className="card">
            <DataTable
              loading={loading}
              rows={orders}
              selectable
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={setSelectedIds}
              bulkActions={
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleExportSelectedCSV}
                >
                  ↓ Export CSV
                </button>
              }
              onRowClick={row => navigate(`/orders/${row.id}`)}
              emptyMessage={total === 0 ? 'No orders yet.' : 'No orders match your filters.'}
              columns={[
                {
                  key: 'order_number',
                  label: 'Order #',
                  render: o => (
                    <div>
                      <span className="cell-primary mono">#{o.order_number || o.id?.slice(0, 8)}</span>
                      {o.cancel_requested && !o.cancel_request_rejected && (
                        <div style={{ marginTop: 3 }}>
                          <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
                            ⚠ Cancel Req
                          </span>
                        </div>
                      )}
                      {o.return_requested && !o.return_request_rejected && (
                        <div style={{ marginTop: 3 }}>
                          <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
                            ↩ Return Req
                          </span>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'created_at',
                  label: 'Placed',
                  render: o => (
                    <span className="text-sm">
                      {new Date(o.created_at).toLocaleDateString('en-GH', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  ),
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
                            className="cell-primary"
                            style={{ textDecoration: 'none', color: 'var(--ac-accent-dark)' }}
                          >
                            {o.customer_name || '—'}
                          </Link>
                        ) : (
                          <span className="cell-primary">{o.customer_name || '—'}</span>
                        )}
                        {o.is_guest && (
                          <span className="badge badge-accent" style={{ fontSize: '0.62rem', padding: '1px 6px' }}>
                            Guest
                          </span>
                        )}
                      </div>
                      <div className="cell-muted text-xs">{o.customer_email || ''}</div>
                      {o.customer_phone && (
                        <div className="cell-muted text-xs" style={{ fontSize: '0.72rem' }}>
                          {o.customer_phone}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'items',
                  label: 'Items',
                  render: o => (
                    <span className="text-sm">
                      {o.item_count || 1} item{Number(o.item_count) === 1 ? '' : 's'}
                    </span>
                  ),
                },
                {
                  key: 'fulfillment_method',
                  label: 'Fulfillment',
                  render: o =>
                    o.fulfillment_method === 'pickup' ? (
                      <span className="badge badge-accent">Pickup Station</span>
                    ) : (
                      <span className="badge badge-neutral">Door Delivery</span>
                    ),
                },
                {
                  key: 'total_amount',
                  label: 'Total',
                  className: 'cell-right',
                  render: o => <strong>{fmt(o.total_amount)}</strong>,
                },
                {
                  key: 'payment_status',
                  label: 'Payment',
                  render: o => (
                    <div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <StatusBadge status={o.payment_status} />
                        <span className="cell-muted text-xs">
                          {o.payment_method === 'pay_on_delivery' ? 'COD' : 'Paystack'}
                        </span>
                      </div>
                      {needsRefund(o) && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>
                            Refund owed
                          </span>
                        </div>
                      )}
                      {o.refund_status === 'pending' && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>
                            Refund pending
                          </span>
                        </div>
                      )}
                      {o.refund_status === 'needs_attention' && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>
                            Refund attention
                          </span>
                        </div>
                      )}
                      {o.refund_status === 'failed' && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-danger" style={{ fontSize: '0.68rem' }}>
                            Refund failed
                          </span>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: o => (
                    <StatusBadge
                      status={
                        o.fulfillment_method === 'pickup' && o.status === 'shipped'
                          ? 'ready_for_pickup'
                          : o.status
                      }
                    />
                  ),
                },
              ]}
            />

            {/* Card Footer Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <span>
                  Showing <strong>{startIdx}</strong>–<strong>{endIdx}</strong> of <strong>{total}</strong>
                </span>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    ← Prev
                  </button>
                  <span style={{ padding: '0 8px', fontWeight: 500 }}>
                    Page {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <style>{`
        .ord-segmented {
          display: inline-flex;
          background: var(--ac-surface-2);
          border: 1px solid var(--ac-border);
          border-radius: var(--ac-radius);
          padding: 2px;
        }
        .ord-seg-btn {
          border: none;
          background: transparent;
          color: var(--ac-text-muted);
          font-size: 0.78rem;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .ord-seg-btn:hover { color: var(--ac-text); }
        .ord-seg-btn.active {
          background: var(--ac-surface);
          color: var(--ac-text);
          box-shadow: var(--ac-shadow-sm);
        }

        .ord-status-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 14px;
          overflow-x: auto;
          padding-bottom: 4px;
          scrollbar-width: none;
        }
        .ord-status-tabs::-webkit-scrollbar { display: none; }

        .ord-status-tab {
          border: 1px solid var(--ac-border);
          background: var(--ac-surface);
          color: var(--ac-text-muted);
          font-size: 0.8rem;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 9999px;
          text-transform: capitalize;
          white-space: nowrap;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .ord-status-tab:hover {
          border-color: var(--ac-border-strong);
          color: var(--ac-text);
        }
        .ord-status-tab.active {
          background: var(--ac-btn-primary-bg);
          color: var(--ac-btn-primary-text);
          border-color: var(--ac-btn-primary-border);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

function pageRevenueOrZero(val) {
  return Number.isFinite(val) ? val : 0;
}
