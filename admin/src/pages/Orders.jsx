import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ordersAPI, deliveriesAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import StatCard from '../components/StatCard';

const STATUS_FILTERS = [
  { key: 'open',         label: 'Active Queue' },
  { key: 'needs_action', label: 'To Pack / Dispatch' },
  { key: 'shipped',      label: 'In Transit / Pickup' },
  { key: 'completed',    label: 'Completed' },
  { key: 'all',          label: 'All Orders' },
  { key: 'pending',      label: 'Pending' },
  { key: 'confirmed',    label: 'Confirmed' },
  { key: 'processing',   label: 'Processing' },
  { key: 'delivered',    label: 'Delivered' },
  { key: 'cancelled',    label: 'Cancelled' },
  { key: 'refunded',     label: 'Refunded' },
];
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
  const [status, setStatus]                 = useState('open');
  const [dateRange, setDateRange]           = useState('all');
  const [queueCounts, setQueueCounts]       = useState(null);
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [paymentFilter, setPaymentFilter]   = useState('all');
  const [page, setPage]                     = useState(1);
  const [exporting, setExporting]           = useState(false);
  const [viewMode, setViewMode]             = useState('orders'); // 'orders' | 'abandoned'
  const [abandoned, setAbandoned]           = useState([]);
  const [abandonedLoading, setAbandonedLoading] = useState(false);
  const [remindingId, setRemindingId]       = useState(null);
  const [selectedIds, setSelectedIds]       = useState([]);
  const [manifestOpen, setManifestOpen]     = useState(false);
  const [manifestPartner, setManifestPartner] = useState('');
  const [manifestPhone, setManifestPhone]   = useState('');
  const [manifestExpiry, setManifestExpiry] = useState('7d');
  const [manifestBusy, setManifestBusy]     = useState(false);
  const [manifestResult, setManifestResult] = useState(null);

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
  }, [status, dateRange, fulfillmentFilter, paymentFilter, debouncedSearch]);

  const fetchOrders = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const params = {
      page,
      limit: PAGE_SIZE,
      ...(status !== 'all' && { status }),
      ...(dateRange !== 'all' && { date_range: dateRange }),
      ...(fulfillmentFilter !== 'all' && { fulfillment_method: fulfillmentFilter }),
      ...(paymentFilter === 'unpaid_cod'
        ? { payment_status: 'unpaid', payment_method: 'pay_on_delivery' }
        : paymentFilter !== 'all'
          ? { payment_status: paymentFilter }
          : {}),
      ...(debouncedSearch && { search: debouncedSearch }),
    };
    return ordersAPI
      .getAll(params)
      .then(({ data }) => {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        if (data.queue_counts) setQueueCounts(data.queue_counts);
        setLastRefresh(new Date());
      })
      .catch(() => {
        if (!silent) toast.error('Failed to load orders');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [page, status, dateRange, fulfillmentFilter, paymentFilter, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

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
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setManifestResult(null);
                  setManifestOpen(true);
                }}
              >
                🏍️ Rider Manifest
              </button>
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
                render: s => {
                  const cleanPhone = String(s.phone || '').replace(/\D/g, '');
                  const waNumber = cleanPhone.length === 10 && cleanPhone.startsWith('0')
                    ? `233${cleanPhone.slice(1)}`
                    : cleanPhone;
                  const customerName = s.first_name || 'there';
                  const waText = `Hi ${customerName}, we noticed you left items in your BodyCream GH cart (${fmt(s.subtotal)}). Complete your order today and get 5% off with coupon code GLOW5! Visit: https://bodycreamgh.com/cart`;

                  return (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                      {waNumber ? (
                        <a
                          href={`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm btn-outline"
                          style={{ color: '#16a34a', borderColor: '#86efac', textDecoration: 'none' }}
                          title="Open WhatsApp chat with pre-filled 5% recovery discount"
                          onClick={e => e.stopPropagation()}
                        >
                          WhatsApp Recovery
                        </a>
                      ) : null}
                    </div>
                  );
                },
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
            {STATUS_FILTERS.map(tab => {
              const badgeCount = queueCounts && tab.key in queueCounts ? queueCounts[tab.key] : null;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={status === tab.key}
                  className={`ord-status-tab ${status === tab.key ? 'active' : ''}`}
                  onClick={() => setStatus(tab.key)}
                >
                  {tab.label}
                  {badgeCount !== null && (
                    <span
                      style={{
                        marginLeft: 6,
                        padding: '1px 6px',
                        borderRadius: 999,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        background: status === tab.key ? 'rgba(255,255,255,0.22)' : 'rgba(128,128,128,0.18)',
                      }}
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
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
            <div className="toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select
                value={dateRange}
                onChange={e => setDateRange(e.target.value)}
                aria-label="Filter by date"
                style={{ width: 145 }}
              >
                <option value="all">All Dates</option>
                <option value="today">Today{queueCounts ? ` (${queueCounts.today})` : ''}</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>

              <select
                value={paymentFilter}
                onChange={e => setPaymentFilter(e.target.value)}
                aria-label="Filter by payment status"
                style={{ width: 155 }}
              >
                <option value="all">All Payments</option>
                <option value="unpaid_cod">Unpaid COD (With Riders)</option>
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

      {manifestOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Generate Multi-Stop Rider Manifest"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setManifestOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 480, padding: 20, margin: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>🏍️ Multi-Stop Rider Manifest Link</h3>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setManifestOpen(false)}
              >
                ✕
              </button>
            </div>
            <p className="muted text-xs" style={{ marginTop: 0, marginBottom: 14 }}>
              Generate <strong>1 signed link</strong> for an in-house rider OR a <strong>3rd-party courier company</strong> (Speedaf, DHL, VIP/STC, Bolt/Yango — no login required).
              For external couriers who don&apos;t use links, customers can also tap <em>Confirm Package Received</em> in the storefront/app.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                  Rider or 3rd-Party Courier Company (optional)
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Leave blank for all active dispatches, or type company/rider"
                  value={manifestPartner}
                  onChange={e => setManifestPartner(e.target.value)}
                  style={{ width: '100%', marginBottom: 6 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {['In-house Dispatch Bike', 'Speedaf Ghana', 'DHL', 'VIP / STC Parcel', 'Bolt / Yango'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                      onClick={() => setManifestPartner(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                    Courier / Driver Phone (optional)
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 0241234567"
                    value={manifestPhone}
                    onChange={e => setManifestPhone(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                    Link Validity (Transit Time)
                  </label>
                  <select
                    className="input"
                    value={manifestExpiry}
                    onChange={e => setManifestExpiry(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="24h">24 Hours (Same-Day Accra)</option>
                    <option value="3d">3 Days (Kumasi / Intercity)</option>
                    <option value="7d">7 Days (Nationwide / 3rd-Party)</option>
                    <option value="14d">14 Days (Extended Transit)</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginBottom: 12 }}
              disabled={manifestBusy}
              onClick={async () => {
                setManifestBusy(true);
                try {
                  const { data } = await deliveriesAPI.createManifestLink({
                    delivery_partner: manifestPartner.trim() || undefined,
                    driver_phone: manifestPhone.trim() || undefined,
                    expires_in: manifestExpiry,
                  });
                  setManifestResult(data);
                  toast.success(`Manifest link ready (${data.active_count} active stop${data.active_count === 1 ? '' : 's'} · valid ${data.expires_in})`);
                } catch (err) {
                  toast.error(err.response?.data?.error || 'Failed to generate manifest link');
                } finally {
                  setManifestBusy(false);
                }
              }}
            >
              {manifestBusy ? 'Generating Link…' : `Generate ${manifestExpiry.toUpperCase()} Courier / Rider Manifest Link`}
            </button>

            {manifestResult && (
              <div style={{ background: 'var(--ac-bg-subtle, #f8f7f4)', border: '1px solid var(--ac-border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>
                  {manifestResult.delivery_partner} · {manifestResult.active_count} active stop{manifestResult.active_count === 1 ? '' : 's'} · Valid {manifestResult.expires_in}
                </div>
                <input
                  type="text"
                  readOnly
                  className="input"
                  value={manifestResult.manifest_url}
                  onFocus={e => e.target.select()}
                  style={{ width: '100%', fontSize: '0.75rem', fontFamily: 'monospace', marginBottom: 10 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(manifestResult.manifest_url);
                      toast.success('Manifest link copied');
                    }}
                  >
                    📋 Copy Link
                  </button>
                  <a
                    href={manifestResult.manifest_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    ↗ Open Manifest
                  </a>
                  <a
                    href={`https://wa.me/${(() => {
                      const d = (manifestResult.driver_phone || manifestPhone || '').replace(/\D/g, '');
                      return d.length === 10 && d.startsWith('0') ? `233${d.slice(1)}` : d;
                    })()}?text=${encodeURIComponent(
                      `BodyCream GH Rider Route Manifest (${manifestResult.active_count} stops):\n${manifestResult.manifest_url}\n\nOpen this single link to view all stops, resend 6-digit OTPs at the doorstep, capture live parcel photos, and track your COD cash/MoMo tally.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm"
                    style={{ textDecoration: 'none', marginLeft: 'auto' }}
                  >
                    💬 WhatsApp Rider
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
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
