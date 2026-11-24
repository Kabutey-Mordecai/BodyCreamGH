import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';

const fmt    = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n) => Number(n || 0).toLocaleString();

function calcDelta(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) return c > 0 ? 100 : 0;
  return ((c - p) / p) * 100;
}

const CHART_RANGES = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData]             = useState(null);
  const [analytics, setAnalytics]   = useState([]);
  const [top, setTop]               = useState([]);
  const [chartDays, setChartDays]   = useState(30);
  const [chartLoading, setChartLoading] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    return Promise.all([
      adminAPI.getDashboard().then(r => r.data).catch(() => null),
      adminAPI.getAnalytics({ days: chartDays }).then(r => r.data).catch(() => []),
      adminAPI.getTopProducts().then(r => r.data).catch(() => []),
    ]).then(([d, a, t]) => {
      setData(d);
      setAnalytics(Array.isArray(a) ? a : []);
      setTop(Array.isArray(t) ? t : []);
    }).finally(() => { setLoading(false); setRefreshing(false); });
  }, [chartDays]);

  useEffect(() => { load(false); }, [load]);

  const handleRangeChange = (days) => {
    if (days === chartDays) return;
    setChartDays(days);
    setChartLoading(true);
    adminAPI.getAnalytics({ days })
      .then(r => setAnalytics(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  };

  const revSparkline = useMemo(
    () => analytics.slice(-14).map(p => Number(p.revenue || 0)),
    [analytics]
  );

  const orderSparkline = useMemo(
    () => analytics.slice(-14).map(p => Number(p.orders || 0)),
    [analytics]
  );

  if (loading) return <div className="spinner" />;

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1>Dashboard</h1></div>
        <div className="alert alert-warning">
          Couldn't load dashboard data. Please check your API connection and try again.
        </div>
      </div>
    );
  }

  const todayDelta = calcDelta(data.todayRevenue, data.yesterdayRevenue);
  const rev7dDelta = calcDelta(data.rev7d, data.revPrev7d);
  const orders7dDelta = calcDelta(data.orders7d, data.ordersPrev7d);

  const hasUrgentItems =
    (data.pendingFulfillmentCount > 0) ||
    (data.pendingReturnsCount > 0) ||
    (data.lowStockCount > 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            Business at a glance — {new Date().toLocaleDateString('en-GH', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Live Operational Status Counter Pills */}
      {hasUrgentItems && (
        <div className="ops-status-strip" role="region" aria-label="Operational alerts">
          {data.pendingFulfillmentCount > 0 && (
            <Link to="/orders" className="ops-pill ops-pill--info">
              <span className="ops-dot" />
              <strong>{data.pendingFulfillmentCount}</strong> Order{data.pendingFulfillmentCount !== 1 ? 's' : ''} Awaiting Fulfillment →
            </Link>
          )}
          {data.pendingReturnsCount > 0 && (
            <Link to="/requests" className="ops-pill ops-pill--warning">
              <span className="ops-dot" />
              <strong>{data.pendingReturnsCount}</strong> Return Request{data.pendingReturnsCount !== 1 ? 's' : ''} Pending →
            </Link>
          )}
          {data.lowStockCount > 0 && (
            <Link to="/inventory" className="ops-pill ops-pill--danger">
              <span className="ops-dot" />
              <strong>{data.lowStockCount}</strong> Low-Stock Warning{data.lowStockCount !== 1 ? 's' : ''} →
            </Link>
          )}
        </div>
      )}

      {/* KPI row */}
      <div className="stats-grid">
        <StatCard
          label="Total revenue"
          value={fmt(data.totalRevenue)}
          delta={rev7dDelta}
          deltaLabel="7d vs prev"
          sparkline={revSparkline}
          sub="Lifetime paid"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
        />
        <StatCard
          label="Today's revenue"
          value={fmt(data.todayRevenue)}
          delta={todayDelta}
          deltaLabel="vs yesterday"
          sub={`Yesterday: ${fmt(data.yesterdayRevenue)}`}
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
        <StatCard
          label="Orders"
          value={fmtInt(data.totalOrders)}
          delta={orders7dDelta}
          deltaLabel="7d vs prev"
          sparkline={orderSparkline}
          sub={`${fmtInt(data.paidOrders)} paid`}
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 11a2 2 0 01-2 2H9a2 2 0 01-2-2L6 8z"/><path d="M9 8V6a3 3 0 116 0v2"/></svg>}
        />
        <StatCard
          label="Avg. order value"
          value={fmt(data.avgOrderValue)}
          sub="Paid revenue ÷ paid orders"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>}
        />
        <StatCard
          label="Customers"
          value={fmtInt(data.totalCustomers)}
          sub="Registered accounts"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>}
        />
        <StatCard
          label="Products"
          value={fmtInt(data.totalProducts)}
          sub="In catalog"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>}
        />
      </div>

      {/* Revenue chart + top products */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }} className="dash-split">
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="card-title">Revenue — last {chartDays} days</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chart-range-pills" role="group" aria-label="Chart date range">
                {CHART_RANGES.map(r => (
                  <button
                    key={r.days}
                    type="button"
                    className={`range-pill ${chartDays === r.days ? 'active' : ''}`}
                    onClick={() => handleRangeChange(r.days)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <Link to="/analytics" className="btn btn-ghost btn-sm">View analytics →</Link>
            </div>
          </div>
          <div className="card-body" style={{ position: 'relative', opacity: chartLoading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <RevenueChart points={analytics} />
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Top products</h2></div>
          <div className="card-body" style={{ padding: 0 }}>
            {top.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>No sales yet.</div>
            ) : (
              <ul className="top-list">
                {top.slice(0, 5).map((p, i) => (
                  <li key={p.id}>
                    <span className="top-rank">{i + 1}</span>
                    <Link to={`/products/${p.id}`} className="top-name">{p.name}</Link>
                    <span className="top-qty">{fmtInt(p.total_quantity)} sold</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent orders</h2>
          <Link to="/orders" className="btn btn-ghost btn-sm">All orders →</Link>
        </div>
        <DataTable
          columns={[
            { key: 'order_number', label: 'Order',   render: r => <span className="cell-primary">#{r.order_number || r.id?.slice(0, 8)}</span> },
            { key: 'created_at',   label: 'Placed',  render: r => new Date(r.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
            { key: 'customer',     label: 'Customer',
              render: r => (
                <div>
                  <div>{r.customer_name || '—'}</div>
                  {r.customer_email && <div className="cell-muted text-xs">{r.customer_email}</div>}
                </div>
              )
            },
            { key: 'total_amount',   label: 'Total',   className: 'cell-right', render: r => fmt(r.total_amount) },
            { key: 'payment_status', label: 'Payment', render: r => <StatusBadge status={r.payment_status} /> },
            { key: 'status',         label: 'Status',  render: r => <StatusBadge status={r.status} /> },
          ]}
          rows={data.recentOrders || []}
          onRowClick={r => navigate(`/orders/${r.id}`)}
          emptyMessage="No orders yet."
        />
      </div>

      <style>{`
        @media (max-width: 900px) { .dash-split { grid-template-columns: 1fr !important; } }
        .top-list { list-style: none; }
        .top-list li { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--ac-border); font-size: 0.87rem; }
        .top-list li:last-child { border-bottom: none; }
        .top-rank { width: 22px; height: 22px; border-radius: 50%; background: var(--ac-accent-light); color: var(--ac-accent-dark); display: inline-flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; flex-shrink: 0; }
        .top-name { flex: 1; font-weight: 500; color: var(--ac-text); }
        .top-qty  { color: var(--ac-text-muted); font-size: 0.78rem; }

        .ops-status-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 20px;
        }
        .ops-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 14px;
          border-radius: 9999px;
          font-size: 0.82rem;
          font-weight: 500;
          text-decoration: none;
          border: 1px solid transparent;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .ops-pill:hover { transform: translateY(-1px); box-shadow: var(--ac-shadow-sm); }
        .ops-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .ops-pill--info { background: var(--ac-info-soft); color: var(--ac-info); border-color: rgba(59, 130, 246, 0.25); }
        .ops-pill--info .ops-dot { background: var(--ac-info); }
        .ops-pill--warning { background: var(--ac-warning-soft); color: var(--ac-warning); border-color: rgba(245, 158, 11, 0.25); }
        .ops-pill--warning .ops-dot { background: var(--ac-warning); }
        .ops-pill--danger { background: var(--ac-danger-soft); color: var(--ac-danger); border-color: rgba(239, 68, 68, 0.25); }
        .ops-pill--danger .ops-dot { background: var(--ac-danger); }

        .chart-range-pills {
          display: inline-flex;
          background: var(--ac-surface-2);
          border: 1px solid var(--ac-border);
          border-radius: var(--ac-radius);
          padding: 2px;
        }
        .range-pill {
          border: none;
          background: transparent;
          color: var(--ac-text-muted);
          font-size: 0.74rem;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .range-pill:hover { color: var(--ac-text); }
        .range-pill.active {
          background: var(--ac-surface);
          color: var(--ac-text);
          box-shadow: var(--ac-shadow-sm);
        }
      `}</style>
    </div>
  );
}

function RevenueChart({ points }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!points || points.length === 0) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>
        Not enough revenue data for this period.
      </div>
    );
  }

  const W = 640, H = 200, PAD = 32;
  const values = points.map(p => Number(p.revenue || 0));
  const max = Math.max(...values, 1);

  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(points.length - 1, 1);
  const y = (v) => H - PAD - (v / max) * (H - 2 * PAD);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(Number(p.revenue || 0))}`).join(' ');
  const area = `${path} L ${x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
  const step = Math.max(1, Math.floor(points.length / 6));

  const handleMouseMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    // Find nearest point index
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(x(i) - relX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  };

  const activePoint = hoverIdx !== null ? points[hoverIdx] : null;
  const activeX = hoverIdx !== null ? x(hoverIdx) : 0;
  const activeY = hoverIdx !== null ? y(Number(activePoint.revenue || 0)) : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="var(--ac-accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--ac-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map(p => (
          <line
            key={p}
            x1={PAD}
            x2={W - PAD}
            y1={H - PAD - p * (H - 2 * PAD)}
            y2={H - PAD - p * (H - 2 * PAD)}
            stroke="var(--ac-border)"
            strokeDasharray="3 4"
          />
        ))}

        <path d={area} fill="url(#rev-fill)" />
        <path d={path} fill="none" stroke="var(--ac-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Crosshair guideline on hover */}
        {hoverIdx !== null && (
          <line
            x1={activeX}
            x2={activeX}
            y1={PAD / 2}
            y2={H - PAD}
            stroke="var(--ac-accent)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {points.map((p, i) => {
          const isHovered = i === hoverIdx;
          return (
            <circle
              key={i}
              cx={x(i)}
              cy={y(Number(p.revenue || 0))}
              r={isHovered ? 5.5 : 3}
              fill={isHovered ? 'var(--ac-accent)' : 'var(--ac-surface)'}
              stroke="var(--ac-accent)"
              strokeWidth={isHovered ? 2.5 : 1.5}
              style={{ transition: 'r 0.1s ease' }}
            />
          );
        })}

        {points.map((p, i) => i % step === 0 && (
          <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ac-text-muted)">
            {String(p.date).slice(5, 10)}
          </text>
        ))}
      </svg>

      {/* Floating Tooltip */}
      {activePoint && (
        <div
          className="rev-chart-tooltip"
          style={{
            left: `${Math.min(82, Math.max(12, (activeX / W) * 100))}%`,
            top: `${Math.max(8, (activeY / H) * 100 - 22)}%`,
          }}
        >
          <div className="rev-tooltip-date">
            {new Date(activePoint.date).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="rev-tooltip-val">{fmt(activePoint.revenue)}</div>
          <div className="rev-tooltip-orders">{fmtInt(activePoint.orders)} order{Number(activePoint.orders) !== 1 ? 's' : ''}</div>
        </div>
      )}

      <style>{`
        .rev-chart-tooltip {
          position: absolute;
          transform: translate(-50%, -100%);
          background: var(--ac-surface);
          border: 1px solid var(--ac-border);
          box-shadow: var(--ac-shadow-md);
          border-radius: var(--ac-radius);
          padding: 8px 12px;
          pointer-events: none;
          z-index: 10;
          white-space: nowrap;
        }
        .rev-tooltip-date { font-size: 0.7rem; color: var(--ac-text-muted); margin-bottom: 2px; }
        .rev-tooltip-val  { font-size: 0.9rem; font-weight: 700; color: var(--ac-text); }
        .rev-tooltip-orders { font-size: 0.72rem; color: var(--ac-accent-dark); font-weight: 500; }
      `}</style>
    </div>
  );
}
