import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ordersAPI, deliveriesAPI, settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import StatCard from '../components/StatCard';
import { buildWhatsAppLink } from '../utils/whatsappTemplates';
import { printBulkWaybills } from '../utils/printWaybill';
import { printBulkInvoices } from '../utils/printInvoice';
import './Orders.css';

// Top workflow queues (clean 5-tab bar — never clips horizontally)
const QUEUE_TABS = [
  { key: 'open',         label: 'Active Queue' },
  { key: 'needs_action', label: 'To Pack / Dispatch' },
  { key: 'shipped',      label: 'In Transit / Pickup' },
  { key: 'completed',    label: 'Completed' },
  { key: 'all',          label: 'All Orders' },
];

const EXACT_STATUS_KEYS = new Set(['pending', 'confirmed', 'processing', 'delivered', 'cancelled', 'refunded']);

const POLL_MS = 30_000;
const PAGE_SIZE = 20;
const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pageRevenueOrZero(val) {
  return Number.isFinite(val) ? val : 0;
}

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
  const [bulkPrinting, setBulkPrinting]     = useState(false);

  // Rider Manifest Dispatch Hub Modal
  const [manifestOpen, setManifestOpen]     = useState(false);
  const [manifestPartner, setManifestPartner] = useState('In-house Dispatch Bike');
  const [manifestSupervisorAll, setManifestSupervisorAll] = useState(false);
  const [manifestPhone, setManifestPhone]   = useState('');
  const [manifestExpiry, setManifestExpiry] = useState('7d');
  const [manifestBusy, setManifestBusy]     = useState(false);
  const [manifestResult, setManifestResult] = useState(null);
  const [knownPartners, setKnownPartners]   = useState([]);

  // Bulk Dispatch Modal
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

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 320);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

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
    if (!manifestOpen) return;
    const isAll = manifestSupervisorAll && !manifestPartner.trim() && !manifestPhone.trim();
    if (!isAll && !manifestPartner.trim() && !manifestPhone.trim()) {
      setManifestResult(null);
      return;
    }
    const t = setTimeout(async () => {
      setManifestBusy(true);
      try {
        const { data } = await deliveriesAPI.createManifestLink({
          delivery_partner: isAll ? undefined : (manifestPartner.trim() || undefined),
          driver_phone: isAll ? undefined : (manifestPhone.trim() || undefined),
          scope: isAll ? 'all' : 'rider',
          expires_in: manifestExpiry,
        });
        setManifestResult(data);
      } catch (err) {
        setManifestResult(null);
        if (err.response?.status === 403 || err.response?.status === 400) {
          toast.error(err.response?.data?.error || 'Could not generate route link');
        }
      } finally {
        setManifestBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [manifestOpen, manifestPartner, manifestPhone, manifestExpiry, manifestSupervisorAll]); // eslint-disable-line react-hooks/exhaustive-deps

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
    status !== 'open' ||
    dateRange !== 'all' ||
    fulfillmentFilter !== 'all' ||
    paymentFilter !== 'all' ||
    search.trim() !== '';

  const clearAllFilters = () => {
    setStatus('open');
    setDateRange('all');
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

  const handleBulkPrintInvoices = async () => {
    if (!selectedIds.length) return;
    setBulkPrinting(true);
    try {
      const [storeRes, ...ordersResponses] = await Promise.all([
        settingsAPI.getAll().catch(() => ({ data: {} })),
        ...selectedIds.map(id => ordersAPI.getById(id).catch(() => null)),
      ]);
      const store = storeRes?.data || {};
      const validOrders = ordersResponses
        .filter(Boolean)
        .map(r => (r.data?.order ? { ...r.data.order, items: r.data.items } : r.data));

      if (!validOrders.length) {
        toast.error('Could not load order details for printing');
        return;
      }
      printBulkInvoices(validOrders, store);
    } catch {
      toast.error('Failed to prepare bulk invoices');
    } finally {
      setBulkPrinting(false);
    }
  };

  const handleBulkPrintWaybills = async () => {
    if (!selectedIds.length) return;
    setBulkPrinting(true);
    try {
      const [storeRes, ...results] = await Promise.all([
        settingsAPI.getAll().catch(() => ({ data: {} })),
        ...selectedIds.map(async id => {
          try {
            const ordRes = await ordersAPI.getById(id);
            const rawOrder = ordRes.data?.order ? { ...ordRes.data.order, items: ordRes.data.items } : ordRes.data;
            let delivery = null;
            try {
              const delRes = await deliveriesAPI.getByOrder(id);
              delivery = delRes.data?.delivery || delRes.data || null;
            } catch (_) {}
            return { order: rawOrder, delivery };
          } catch (_) {
            return null;
          }
        }),
      ]);
      const store = storeRes?.data || {};
      const validItems = results.filter(Boolean);
      if (!validItems.length) {
        toast.error('Could not load order waybill data');
        return;
      }
      printBulkWaybills(validItems, store);
    } catch {
      toast.error('Failed to prepare bulk waybills');
    } finally {
      setBulkPrinting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
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
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1>Orders &amp; Dispatch</h1>
          <p className="muted">
            {total.toLocaleString()} matching order{total !== 1 ? 's' : ''}
            {lastRefresh && (
              <> · Synced {lastRefresh.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </p>
        </div>

        <div className="page-actions" style={{ alignItems: 'center' }}>
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
                Rider Manifest
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
                {refreshing ? 'Syncing…' : '↻ Refresh'}
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
                    <div className="muted text-xs">{s.email}{s.phone ? ` · ${s.phone}` : ''}</div>
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
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
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
                  const waText = `Hi ${customerName}, we noticed you left items in your BodyCream GH cart (${fmt(s.subtotal)}). Complete your order today and get 5% off with coupon code GLOW5!`;

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
                              prev.map(row => row.id === s.id ? { ...row, reminder_sent_at: new Date().toISOString() } : row)
                            );
                          } catch (err) {
                            toast.error(err.response?.data?.error || 'Failed to send reminder');
                          } finally {
                            setRemindingId(null);
                          }
                        }}
                      >
                        {remindingId === s.id ? 'Sending…' : s.reminder_sent_at ? 'Resend Email' : 'Send Recovery Email'}
                      </button>
                      {waNumber ? (
                        <a
                          href={`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm btn-whatsapp"
                          style={{ textDecoration: 'none' }}
                          onClick={e => e.stopPropagation()}
                        >
                          💬 WhatsApp
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
          {/* ── KPI Summary Strip ─────────────────────────────────────── */}
          <div className="stats-grid" style={{ marginBottom: 16 }}>
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
              label="Page Order Value"
              value={fmt(pageRevenueOrZero(pageStats.pageRevenue))}
              sub={`${pageStats.paidCount} settled on this page`}
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
              sub="Pending confirm, cancel, return or refund"
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              }
            />
          </div>

          {/* ── 5 Clean Operational Queue Tabs (No Overflow!) ─────────── */}
          <div className="ord-queue-bar">
            <div className="ord-queue-tabs" role="tablist" aria-label="Order operational queues">
              {QUEUE_TABS.map(tab => {
                const badgeCount = queueCounts && tab.key in queueCounts ? queueCounts[tab.key] : null;
                const isActive = status === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`ord-queue-tab${isActive ? ' is-active' : ''}`}
                    onClick={() => setStatus(tab.key)}
                  >
                    <span>{tab.label}</span>
                    {badgeCount !== null && <span className="ord-queue-count">{badgeCount}</span>}
                  </button>
                );
              })}
            </div>

            {EXACT_STATUS_KEYS.has(status) && (
              <span className="badge badge-accent" style={{ textTransform: 'capitalize' }}>
                Filtered Status: {status}
              </span>
            )}
          </div>

          {/* ── Search & Facets Toolbar Card ──────────────────────────── */}
          <div className="ord-filter-card">
            <div className="ord-filter-search">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search order #, customer name, phone, or email…"
              />
            </div>

            <div className="ord-filter-selects">
              <select
                value={EXACT_STATUS_KEYS.has(status) ? status : ''}
                onChange={e => setStatus(e.target.value || 'all')}
                aria-label="Filter by exact status"
              >
                <option value="">Exact Status: Any</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="processing">Processing</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
              </select>

              <select
                value={dateRange}
                onChange={e => setDateRange(e.target.value)}
                aria-label="Filter by date"
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
              >
                <option value="all">All Payments</option>
                <option value="unpaid_cod">Unpaid COD (With Riders)</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="payment_review">Payment Review</option>
                <option value="refunded">Refunded</option>
              </select>

              <select
                value={fulfillmentFilter}
                onChange={e => setFulfillmentFilter(e.target.value)}
                aria-label="Filter by fulfillment method"
              >
                <option value="all">All Fulfillment</option>
                <option value="delivery">Door Delivery</option>
                <option value="pickup">Pickup Station</option>
              </select>

              {hasActiveFilters && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAllFilters}>
                  ✕ Reset
                </button>
              )}
            </div>
          </div>

          {/* ── Orders Table (No Double Border, Zero Column Wrapping!) ── */}
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
                    deliveriesAPI.getPartners()
                      .then(({ data }) => setKnownPartners(Array.isArray(data?.partners) ? data.partners : []))
                      .catch(() => {});
                  }}
                >
                  Assign / Dispatch ({selectedIds.length})
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleBulkPrintWaybills}
                  disabled={bulkPrinting}
                  title="Print dispatch waybills for selected orders"
                >
                  {bulkPrinting ? 'Preparing…' : `🖨️ Waybills (${selectedIds.length})`}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleBulkPrintInvoices}
                  disabled={bulkPrinting}
                  title="Print customer invoices for selected orders"
                >
                  {bulkPrinting ? 'Preparing…' : `📄 Invoices (${selectedIds.length})`}
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleExportSelectedCSV}>
                  ↓ Export Selected
                </button>
              </div>
            }
            onRowClick={row => navigate(`/orders/${row.id}`)}
            emptyMessage={total === 0 ? 'No orders placed yet.' : 'No orders match your current filters.'}
            columns={[
              {
                key: 'order_number',
                label: 'Order #',
                render: o => (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <span className="ord-num-chip">#{o.order_number || o.id?.slice(0, 8)}</span>
                    {o.cancel_requested && !o.cancel_request_rejected && (
                      <span className="badge badge-warning" style={{ fontSize: '0.64rem' }}>⚠ Cancel Req</span>
                    )}
                    {o.return_requested && !o.return_request_rejected && (
                      <span className="badge badge-warning" style={{ fontSize: '0.64rem' }}>↩ Return Req</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'created_at',
                label: 'Placed',
                render: o => {
                  const dt = new Date(o.created_at);
                  return (
                    <div className="ord-date-cell">
                      <span className="ord-date-day">
                        {dt.toLocaleDateString('en-GH', { day: '2-digit', month: 'short' })}
                      </span>
                      <span className="ord-date-time">
                        {dt.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                },
              },
              {
                key: 'customer',
                label: 'Customer',
                render: o => (
                  <div style={{ minWidth: 165 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {o.customer_id ? (
                        <Link
                          to={`/customers/${o.customer_id}`}
                          onClick={e => e.stopPropagation()}
                          className="cell-primary"
                          style={{ color: 'var(--ac-accent)', fontWeight: 600 }}
                        >
                          {o.customer_name || 'Customer'}
                        </Link>
                      ) : (
                        <span className="cell-primary" style={{ fontWeight: 600 }}>{o.customer_name || 'Guest'}</span>
                      )}
                      {o.is_guest && (
                        <span className="badge badge-accent" style={{ fontSize: '0.6rem', padding: '1px 6px' }}>Guest</span>
                      )}
                    </div>
                    <div className="cell-muted text-xs" style={{ maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.customer_phone || o.customer_email || ''}</span>
                      {o.customer_phone && buildWhatsAppLink(o.customer_phone) && (
                        <a
                          href={buildWhatsAppLink(o.customer_phone)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'var(--ac-success)', textDecoration: 'none', fontSize: '0.84rem', fontWeight: 600, flexShrink: 0 }}
                          title="Open WhatsApp chat with customer"
                        >
                          💬
                        </a>
                      )}
                    </div>
                  </div>
                ),
              },
              {
                key: 'items',
                label: 'Items',
                render: o => (
                  <span className="ord-items-pill">
                    {o.item_count || 1} {Number(o.item_count || 1) === 1 ? 'item' : 'items'}
                  </span>
                ),
              },
              {
                key: 'fulfillment_method',
                label: 'Fulfillment',
                render: o => (
                  <span style={{ whiteSpace: 'nowrap' }} className={`badge ${o.fulfillment_method === 'pickup' ? 'badge-accent' : 'badge-neutral'}`}>
                    {o.fulfillment_method === 'pickup' ? 'Pickup Station' : 'Door Delivery'}
                  </span>
                ),
              },
              {
                key: 'total_amount',
                label: 'Total',
                className: 'cell-right',
                render: o => <span className="ord-total-cell">{fmt(o.total_amount)}</span>,
              },
              {
                key: 'payment_status',
                label: 'Payment',
                render: o => (
                  <div className="ord-pay-cell">
                    <div className="ord-pay-row">
                      <StatusBadge status={o.payment_status} />
                      <span className="ord-pay-method">
                        {o.payment_method === 'pay_on_delivery' ? 'COD' : 'Paystack'}
                      </span>
                    </div>
                    {needsRefund(o) && <span className="badge badge-warning" style={{ fontSize: '0.64rem' }}>Refund owed</span>}
                    {o.refund_status === 'failed' && <span className="badge badge-danger" style={{ fontSize: '0.64rem' }}>Refund failed</span>}
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Stage & Rider',
                render: o => {
                  const rawPartner = o.delivery_partner ? String(o.delivery_partner).trim() : '';
                  const isPool = rawPartner.toLowerCase() === 'in-house dispatch bike' || rawPartner.toLowerCase() === 'in-house dispatch';
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                      <StatusBadge
                        status={
                          o.fulfillment_method === 'pickup' && o.status === 'shipped'
                            ? 'ready_for_pickup'
                            : o.status
                        }
                      />
                      {rawPartner && o.fulfillment_method !== 'pickup' && (
                        <span
                          className="text-xs"
                          style={{
                            color: isPool ? 'var(--ac-text-muted)' : 'var(--ac-text)',
                            fontWeight: isPool ? 400 : 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isPool ? 'In-house pool' : rawPartner}
                        </span>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />

          {/* ── Pagination Bar ────────────────────────────────────────── */}
          {total > 0 && (
            <div className="ord-pagination-bar">
              <span className="muted text-sm">
                Showing <strong>{startIdx}–{endIdx}</strong> of <strong>{total.toLocaleString()}</strong> orders
              </span>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    ← Prev
                  </button>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                    Page {page} of {totalPages}
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
              )}
            </div>
          )}
        </>
      )}

      {/* ── Upgraded Rider Manifest Dispatch Hub Modal ──────────────── */}
      {manifestOpen && (
        <div
          className="rm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Rider Route Manifest Hub"
          onClick={() => setManifestOpen(false)}
        >
          <div className="rm-modal-shell" onClick={e => e.stopPropagation()}>
            <div className="rm-modal-head">
              <div>
                <div className="rm-modal-eyebrow">Dispatch</div>
                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Rider Route Link</h3>
                <p className="muted text-xs" style={{ marginTop: 3 }}>
                  Share delivery stops and map directions with your rider.
                </p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setManifestOpen(false)} aria-label="Close modal">
                ✕
              </button>
            </div>

            <div className="rm-modal-body">
              {/* Step 1: Select Rider */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div className="rm-step-label" style={{ marginBottom: 0 }}>1. Select Rider</div>
                  <Link
                    to="/riders"
                    onClick={() => setManifestOpen(false)}
                    style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--ac-accent)', textDecoration: 'none' }}
                  >
                    Manage Riders →
                  </Link>
                </div>
                <div className="rm-rider-grid">
                  {knownPartners.map(p => {
                    const selected = !manifestSupervisorAll && manifestPartner.toLowerCase() === p.delivery_partner.toLowerCase();
                    return (
                      <button
                        key={p.delivery_partner}
                        type="button"
                        className={`rm-rider-card${selected ? ' is-selected' : ''}`}
                        onClick={() => {
                          setManifestSupervisorAll(false);
                          setManifestPartner(p.delivery_partner);
                          setManifestPhone(p.driver_phone || '');
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="rm-rider-name">{p.delivery_partner}</div>
                          <div className="rm-rider-sub">{p.driver_phone || 'General courier'}</div>
                        </div>
                        <span className="rm-rider-stop-pill">{p.active_count}</span>
                      </button>
                    );
                  })}

                  {(() => {
                    const totalActive = knownPartners.reduce((sum, p) => sum + (p.active_count || 0), 0);
                    const isAll = manifestSupervisorAll && !manifestPartner.trim();
                    return (
                      <button
                        type="button"
                        className={`rm-rider-card${isAll ? ' is-selected' : ''}`}
                        onClick={() => {
                          setManifestSupervisorAll(true);
                          setManifestPartner('');
                          setManifestPhone('');
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="rm-rider-name">All Active Stops</div>
                          <div className="rm-rider-sub">All assigned riders</div>
                        </div>
                        <span className="rm-rider-stop-pill">{totalActive}</span>
                      </button>
                    );
                  })()}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10, marginTop: 10 }}>
                  <input
                    type="text"
                    placeholder="Rider name…"
                    value={manifestPartner}
                    onChange={e => {
                      setManifestSupervisorAll(false);
                      setManifestPartner(e.target.value);
                    }}
                  />
                  <input
                    type="text"
                    placeholder="WhatsApp phone (e.g. 0241234567)"
                    value={manifestPhone}
                    onChange={e => {
                      setManifestSupervisorAll(false);
                      setManifestPhone(e.target.value);
                    }}
                  />
                </div>
              </div>

              {/* Step 2: Link Validity */}
              <div>
                <div className="rm-step-label">2. Link Valid For</div>
                <div className="rm-validity-grid">
                  {[
                    { key: '24h', label: '24 Hours' },
                    { key: '3d',  label: '3 Days' },
                    { key: '7d',  label: '7 Days' },
                    { key: '14d', label: '14 Days' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`rm-validity-btn${manifestExpiry === opt.key ? ' is-active' : ''}`}
                      onClick={() => setManifestExpiry(opt.key)}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>{opt.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3: Live Route Link & Share Controls */}
              <div className="rm-share-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>
                    {manifestBusy
                      ? 'Generating route link…'
                      : `${manifestResult?.delivery_partner || 'All Riders'} · ${manifestResult?.active_count ?? 0} Pending Stop${manifestResult?.active_count === 1 ? '' : 's'}`}
                  </div>
                  <span className="badge badge-success">Valid {manifestExpiry.toUpperCase()}</span>
                </div>

                <div className="rm-url-box">
                  <input
                    type="text"
                    readOnly
                    value={manifestResult?.manifest_url || 'Generating manifest link…'}
                    onFocus={e => e.target.select()}
                    style={{ opacity: manifestBusy ? 0.6 : 1 }}
                  />
                </div>

                <div className="rm-action-grid">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={!manifestResult?.manifest_url}
                    onClick={() => {
                      navigator.clipboard?.writeText(manifestResult.manifest_url);
                      toast.success('Link copied');
                    }}
                  >
                    Copy Link
                  </button>
                  <a
                    href={manifestResult?.manifest_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-sm"
                    style={{ textDecoration: 'none', pointerEvents: manifestResult?.manifest_url ? 'auto' : 'none' }}
                  >
                    Open Route ↗
                  </a>
                  <a
                    href={`https://wa.me/${(() => {
                      const d = (manifestResult?.driver_phone || manifestPhone || '').replace(/\D/g, '');
                      return d.length === 10 && d.startsWith('0') ? `233${d.slice(1)}` : d;
                    })()}?text=${encodeURIComponent(
                      `BodyCream GH Dispatch Route\nRider: ${manifestResult?.delivery_partner || 'All Stops'}\nStops: ${manifestResult?.active_count || 0}\n\nOpen route link:\n${manifestResult?.manifest_url || ''}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm"
                    style={{ textDecoration: 'none', pointerEvents: manifestResult?.manifest_url ? 'auto' : 'none' }}
                  >
                    Send WhatsApp
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Dispatch Selected Orders Modal ─────────────────────── */}
      {bulkOpen && (
        <div
          className="rm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Dispatch Selected Orders"
          onClick={() => setBulkOpen(false)}
        >
          <div className="rm-modal-shell" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="rm-modal-head">
              <div>
                <div className="rm-modal-eyebrow">Batch Fulfilment</div>
                <h3 style={{ margin: 0, fontSize: '1.08rem' }}>Dispatch {selectedIds.length} selected order{selectedIds.length === 1 ? '' : 's'}</h3>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setBulkOpen(false)}>✕</button>
            </div>

            <div className="rm-modal-body">
              <p className="muted text-xs" style={{ margin: 0 }}>
                Mark selected orders as <strong>Shipped</strong> and generate a delivery route for your rider.
              </p>

              {!bulkResult ? (
                <>
                  {knownPartners.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="muted text-xs" style={{ fontWeight: 700 }}>Select Registered Rider</span>
                        <Link to="/riders" onClick={() => setBulkOpen(false)} style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--ac-accent)', textDecoration: 'none' }}>
                          + Add / Edit Riders →
                        </Link>
                      </div>
                      <div className="od-rider-chips" style={{ marginBottom: 4 }}>
                        {knownPartners.slice(0, 8).map(p => (
                          <button
                            key={p.delivery_partner}
                            type="button"
                            className={`od-rider-chip${bulkPartner.toLowerCase() === p.delivery_partner.toLowerCase() ? ' is-selected' : ''}`}
                            onClick={() => {
                              setBulkPartner(p.delivery_partner);
                              setBulkPhone(p.driver_phone || '');
                            }}
                          >
                            {p.delivery_partner}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Rider / Courier Name *</label>
                    <input
                      type="text"
                      value={bulkPartner}
                      onChange={e => setBulkPartner(e.target.value)}
                      placeholder="e.g. In-house Dispatch Bike, Kwame Bike"
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
                    <div>
                      <label>Rider WhatsApp Phone</label>
                      <input
                        type="text"
                        value={bulkPhone}
                        onChange={e => setBulkPhone(e.target.value)}
                        placeholder="e.g. 0241234567"
                      />
                    </div>
                    <div>
                      <label>Link Validity</label>
                      <select value={bulkExpiry} onChange={e => setBulkExpiry(e.target.value)}>
                        <option value="24h">24 Hours</option>
                        <option value="3d">3 Days</option>
                        <option value="7d">7 Days</option>
                        <option value="14d">14 Days</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-accent"
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
                    {bulkBusy ? 'Dispatching…' : 'Dispatch batch & generate link'}
                  </button>
                </>
              ) : (
                <div className="rm-share-card">
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--ac-success)', marginBottom: 6 }}>
                    Dispatched {bulkResult.dispatched_count} order{bulkResult.dispatched_count === 1 ? '' : 's'} to {bulkResult.delivery_partner}
                    {bulkResult.skipped_count > 0 ? ` (${bulkResult.skipped_count} skipped)` : ''}
                  </div>
                  <div className="rm-url-box">
                    <input type="text" readOnly value={bulkResult.manifest_url} onFocus={e => e.target.select()} />
                  </div>
                  <div className="rm-action-grid">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(bulkResult.manifest_url);
                        toast.success('Rider link copied');
                      }}
                    >
                      Copy link
                    </button>
                    <a href={bulkResult.manifest_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
                      Open console ↗
                    </a>
                    <a
                      href={`https://wa.me/${(() => {
                        const d = (bulkResult.driver_phone || bulkPhone || '').replace(/\D/g, '');
                        return d.length === 10 && d.startsWith('0') ? `233${d.slice(1)}` : d;
                      })()}?text=${encodeURIComponent(
                        `BodyCream GH Dispatch Manifest (${bulkResult.dispatched_count} stops · ${bulkResult.delivery_partner}):\n${bulkResult.manifest_url}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-sm"
                      style={{ textDecoration: 'none' }}
                    >
                      Send WhatsApp
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
