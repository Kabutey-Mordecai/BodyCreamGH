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
  const [knownPartners, setKnownPartners]   = useState([]);
  const [bulkOpen, setBulkOpen]             = useState(false);
  const [bulkPartner, setBulkPartner]       = useState('In-house Dispatch Bike');
  const [bulkPhone, setBulkPhone]           = useState('');
  const [bulkExpiry, setBulkExpiry]         = useState('7d');
  const [bulkBusy, setBulkBusy]             = useState(false);
  const [bulkResult, setBulkResult]         = useState(null);

  const timerRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!manifestOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setManifestOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manifestOpen]);

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

  // Auto-generate manifest link whenever modal opens or rider/expiry selection changes
  useEffect(() => {
    if (!manifestOpen) return;
    const t = setTimeout(async () => {
      setManifestBusy(true);
      try {
        const { data } = await deliveriesAPI.createManifestLink({
          delivery_partner: manifestPartner.trim() || undefined,
          driver_phone: manifestPhone.trim() || undefined,
          expires_in: manifestExpiry,
        });
        setManifestResult(data);
      } catch {
        // handled silently on auto-refresh
      } finally {
        setManifestBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [manifestOpen, manifestPartner, manifestPhone, manifestExpiry]);

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
                  deliveriesAPI.getPartners()
                    .then(({ data }) => setKnownPartners(Array.isArray(data?.partners) ? data.partners : []))
                    .catch(() => {});
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setBulkResult(null);
                      setBulkOpen(true);
                    }}
                  >
                    🚚 Dispatch Selected ({selectedIds.length})
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={handleExportSelectedCSV}
                  >
                    ↓ Export CSV
                  </button>
                </div>
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
          aria-label="Multi-Stop Rider Manifest"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.62)',
            backdropFilter: 'blur(3px)',
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
            role="dialog"
            aria-modal="true"
            aria-label="Rider and Courier Manifest"
            style={{
              width: '100%',
              maxWidth: 620,
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: 0,
              margin: 0,
              boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Pinned Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 18px', borderBottom: '1px solid var(--ac-border)', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ac-accent)' }}>
                  Dispatch Route Sharing
                </div>
                <h3 style={{ margin: '2px 0 2px', fontSize: '1.1rem' }}>🏍️ Rider &amp; Courier Manifest</h3>
                <p className="muted text-xs" style={{ margin: 0 }}>
                  One link for assigned stops — no rider login needed.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setManifestOpen(false)}
                aria-label="Close modal"
                style={{ flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            {/* Scrollable Body */}
            <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
            {/* 1. Rider / Courier Quick-Select Chips */}
            <div style={{ marginBottom: 12 }}>
              <div className="text-xs" style={{ fontWeight: 700, marginBottom: 6, color: 'var(--ac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                1. Choose Rider or Courier
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 6, maxHeight: 164, overflowY: 'auto', paddingRight: 2, marginBottom: 8 }}>
                {(() => {
                  const totalActive = knownPartners.reduce((sum, p) => sum + (p.active_count || 0), 0);
                  const isAll = !manifestPartner.trim();
                  return (
                    <button
                      type="button"
                      onClick={() => { setManifestPartner(''); setManifestPhone(''); }}
                      style={{
                        textAlign: 'left',
                        padding: '9px 11px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: isAll ? '1.5px solid var(--ac-accent)' : '1px solid var(--ac-border)',
                        background: isAll ? 'rgba(201,165,90,0.14)' : 'var(--ac-surface-2)',
                        color: 'var(--ac-text)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>All Dispatches</div>
                      <div style={{ fontSize: '0.72rem', color: isAll ? 'var(--ac-accent)' : 'var(--ac-text-muted)', fontWeight: 600 }}>
                        {totalActive} active stop{totalActive === 1 ? '' : 's'}
                      </div>
                    </button>
                  );
                })()}
                {knownPartners.filter(p => (p.active_count || 0) > 0).map(p => {
                  const selected = manifestPartner.toLowerCase() === p.delivery_partner.toLowerCase();
                  return (
                    <button
                      key={p.delivery_partner}
                      type="button"
                      onClick={() => {
                        setManifestPartner(p.delivery_partner);
                        setManifestPhone(p.driver_phone || '');
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '9px 11px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: selected ? '1.5px solid var(--ac-accent)' : '1px solid var(--ac-border)',
                        background: selected ? 'rgba(201,165,90,0.14)' : 'var(--ac-surface-2)',
                        color: 'var(--ac-text)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.delivery_partner}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: p.active_count > 0 ? '#22c55e' : 'var(--ac-text-muted)', fontWeight: 600 }}>
                        {p.active_count} active stop{p.active_count === 1 ? '' : 's'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Compact custom filter + WhatsApp phone row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Or type courier / rider name…"
                  value={manifestPartner}
                  onChange={e => setManifestPartner(e.target.value)}
                  style={{ width: '100%', fontSize: '0.82rem', padding: '7px 10px' }}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Rider WhatsApp phone (optional)"
                  value={manifestPhone}
                  onChange={e => setManifestPhone(e.target.value)}
                  style={{ width: '100%', fontSize: '0.82rem', padding: '7px 10px' }}
                />
              </div>
            </div>

            {/* 2. Segmented Transit Validity Pills (no truncated dropdown) */}
            <div style={{ marginBottom: 16 }}>
              <div className="text-xs" style={{ fontWeight: 700, marginBottom: 6, color: 'var(--ac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                2. Link Validity (Transit Window)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[
                  { key: '24h', label: '24 Hours', sub: 'Same-Day' },
                  { key: '3d',  label: '3 Days',   sub: 'Intercity' },
                  { key: '7d',  label: '7 Days',   sub: 'Nationwide' },
                  { key: '14d', label: '14 Days',  sub: 'Extended' },
                ].map(opt => {
                  const active = manifestExpiry === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setManifestExpiry(opt.key)}
                      style={{
                        padding: '7px 6px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        textAlign: 'center',
                        border: active ? '1.5px solid var(--ac-accent)' : '1px solid var(--ac-border)',
                        background: active ? 'rgba(201,165,90,0.14)' : 'var(--ac-surface-2)',
                        color: 'var(--ac-text)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{opt.label}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--ac-text-muted)' }}>{opt.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Always-On Ready Link Box */}
            <div
              style={{
                background: 'var(--ac-surface-2)',
                border: '1px solid var(--ac-border)',
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                  {manifestBusy
                    ? 'Updating link…'
                    : `${manifestResult?.delivery_partner || 'All Active Riders'} · ${manifestResult?.active_count ?? 0} Active Stop${manifestResult?.active_count === 1 ? '' : 's'}`}
                </div>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: (manifestResult?.active_count || 0) > 0 ? 'rgba(34,197,94,0.16)' : 'rgba(156,163,175,0.16)',
                    color: (manifestResult?.active_count || 0) > 0 ? '#22c55e' : 'var(--ac-text-muted)',
                  }}
                >
                  Valid {manifestExpiry.toUpperCase()}
                </span>
              </div>

              <input
                type="text"
                readOnly
                className="input"
                value={manifestResult?.manifest_url || 'Generating signed link…'}
                onFocus={e => e.target.select()}
                style={{ width: '100%', fontSize: '0.74rem', fontFamily: 'monospace', marginBottom: 10, opacity: manifestBusy ? 0.6 : 1 }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={!manifestResult?.manifest_url}
                  onClick={() => {
                    navigator.clipboard?.writeText(manifestResult.manifest_url);
                    toast.success('Manifest link copied to clipboard');
                  }}
                  style={{ justifyContent: 'center' }}
                >
                  📋 Copy Link
                </button>
                <a
                  href={manifestResult?.manifest_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center', justifyContent: 'center', pointerEvents: manifestResult?.manifest_url ? 'auto' : 'none' }}
                >
                  ↗ Open Route
                </a>
                <a
                  href={`https://wa.me/${(() => {
                    const d = (manifestResult?.driver_phone || manifestPhone || '').replace(/\D/g, '');
                    return d.length === 10 && d.startsWith('0') ? `233${d.slice(1)}` : d;
                  })()}?text=${encodeURIComponent(
                    `BodyCream GH Dispatch Route (${manifestResult?.active_count || 0} stop${manifestResult?.active_count === 1 ? '' : 's'} · ${manifestResult?.delivery_partner || 'All Stops'}):\n${manifestResult?.manifest_url || ''}\n\nOpen this link to view addresses, resend 6-digit OTPs at the doorstep, capture parcel photos, and track COD cash/MoMo.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center', justifyContent: 'center', pointerEvents: manifestResult?.manifest_url ? 'auto' : 'none' }}
                >
                  💬 Send WhatsApp
                </a>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Dispatch Selected Orders"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.62)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setBulkOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 460, padding: 22, margin: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>🚚 Dispatch {selectedIds.length} Selected Order{selectedIds.length === 1 ? '' : 's'}</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setBulkOpen(false)}>✕</button>
            </div>
            <p className="muted text-xs" style={{ marginTop: 0, marginBottom: 14 }}>
              Marks selected orders as <strong>Shipped</strong>, emails each customer their tracking # + 6-digit delivery code, and gives you <strong>1 WhatsApp link</strong> for the rider.
            </p>

            {!bulkResult ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  <div>
                    <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                      Rider / Courier Name *
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={bulkPartner}
                      onChange={e => setBulkPartner(e.target.value)}
                      placeholder="e.g. In-house Dispatch Bike, Kwame Bike"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                    <div>
                      <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                        Rider WhatsApp Phone (optional)
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={bulkPhone}
                        onChange={e => setBulkPhone(e.target.value)}
                        placeholder="e.g. 0241234567"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                        Link Validity
                      </label>
                      <select
                        className="input"
                        value={bulkExpiry}
                        onChange={e => setBulkExpiry(e.target.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="24h">24 Hours</option>
                        <option value="3d">3 Days</option>
                        <option value="7d">7 Days</option>
                        <option value="14d">14 Days</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={bulkBusy}
                  onClick={async () => {
                    setBulkBusy(true);
                    try {
                      const { data } = await deliveriesAPI.bulkDispatch({
                        order_ids: selectedIds,
                        delivery_partner: bulkPartner.trim() || 'In-house Dispatch Bike',
                        driver_phone: bulkPhone.trim() || undefined,
                        expires_in: bulkExpiry,
                      });
                      setBulkResult(data);
                      setSelectedIds([]);
                      fetchOrders(true);
                      toast.success(`Dispatched ${data.dispatched_count} order${data.dispatched_count === 1 ? '' : 's'}!`);
                    } catch (err) {
                      toast.error(err.response?.data?.error || 'Bulk dispatch failed');
                    } finally {
                      setBulkBusy(false);
                    }
                  }}
                >
                  {bulkBusy ? 'Dispatching…' : `Dispatch & Get 1 Rider Link`}
                </button>
              </>
            ) : (
              <div style={{ background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#22c55e', marginBottom: 6 }}>
                  ✓ Dispatched {bulkResult.dispatched_count} order{bulkResult.dispatched_count === 1 ? '' : 's'} to {bulkResult.delivery_partner}
                  {bulkResult.skipped_count > 0 ? ` (${bulkResult.skipped_count} already shipped/closed skipped)` : ''}
                </div>
                <input
                  type="text"
                  readOnly
                  className="input"
                  value={bulkResult.manifest_url}
                  onFocus={e => e.target.select()}
                  style={{ width: '100%', fontSize: '0.74rem', fontFamily: 'monospace', marginBottom: 10 }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(bulkResult.manifest_url);
                      toast.success('Rider link copied');
                    }}
                  >
                    📋 Copy
                  </button>
                  <a
                    href={bulkResult.manifest_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-sm"
                    style={{ textDecoration: 'none', textAlign: 'center' }}
                  >
                    ↗ Open
                  </a>
                  <a
                    href={`https://wa.me/${(() => {
                      const d = (bulkResult.driver_phone || bulkPhone || '').replace(/\D/g, '');
                      return d.length === 10 && d.startsWith('0') ? `233${d.slice(1)}` : d;
                    })()}?text=${encodeURIComponent(
                      `BodyCream GH Dispatch Route (${bulkResult.dispatched_count} stops · ${bulkResult.delivery_partner}):\n${bulkResult.manifest_url}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm"
                    style={{ textDecoration: 'none', textAlign: 'center' }}
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
