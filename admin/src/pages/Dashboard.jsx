import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';

const fmt    = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n) => Number(n || 0).toLocaleString();

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [analytics, setAnalytics] = useState([]);
  const [top, setTop]           = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    return Promise.all([
      adminAPI.getDashboard().then(r => r.data).catch(() => null),
      adminAPI.getAnalytics({ days: 30 }).then(r => r.data).catch(() => []),
      adminAPI.getTopProducts().then(r => r.data).catch(() => []),
    ]).then(([d, a, t]) => {
      setData(d);
      setAnalytics(Array.isArray(a) ? a : []);
      setTop(Array.isArray(t) ? t : []);
    }).finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (loading) return <div className="spinner" />;

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1>Dashboard</h1></div>
        <div className="alert alert-warning">
          Couldn't load dashboard data. Make sure the backend is running at <code>http://localhost:3000</code>.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Business at a glance — {new Date().toLocaleDateString('en-GH', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-outline btn-sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Low-stock alert */}
      {data.lowStockCount > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <strong>{data.lowStockCount}</strong> product{data.lowStockCount !== 1 ? 's are' : ' is'} low on stock (≤5 units).{' '}
          <Link to="/inventory" style={{ fontWeight: 600 }}>View inventory →</Link>
        </div>
      )}

      {/* KPI row */}
      <div className="stats-grid">
        <StatCard
          label="Total revenue"
          value={fmt(data.totalRevenue)}
          sub="Lifetime, paid orders only"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
        />
        <StatCard
          label="Today's revenue"
          value={fmt(data.todayRevenue)}
          sub="Paid orders placed today"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
        <StatCard
          label="Orders"
          value={fmtInt(data.totalOrders)}
          sub="All time"
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
          <div className="card-header">
            <h2 className="card-title">Revenue — last 30 days</h2>
            <Link to="/analytics" className="btn btn-ghost btn-sm">View analytics →</Link>
          </div>
          <div className="card-body">
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
      `}</style>
    </div>
  );
}

function RevenueChart({ points }) {
  if (!points || points.length === 0) {
    return (
      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>
        Not enough data yet.
      </div>
    );
  }

  const W = 640, H = 180, PAD = 28;
  const values = points.map(p => Number(p.revenue || 0));
  const max = Math.max(...values, 1);

  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(points.length - 1, 1);
  const y = (v) => H - PAD - (v / max) * (H - 2 * PAD);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(Number(p.revenue || 0))}`).join(' ');
  const area = `${path} L ${x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;

  const step = Math.max(1, Math.floor(points.length / 5));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor="var(--ac-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--ac-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(p => (
        <line key={p} x1={PAD} x2={W - PAD} y1={H - PAD - p * (H - 2 * PAD)} y2={H - PAD - p * (H - 2 * PAD)} stroke="var(--ac-border)" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="url(#rev-fill)" />
      <path d={path} fill="none" stroke="var(--ac-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(Number(p.revenue || 0))} r="3" fill="#fff" stroke="var(--ac-accent)" strokeWidth="1.5" />
      ))}
      {points.map((p, i) => i % step === 0 && (
        <text key={`l${i}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--ac-text-muted)">
          {String(p.date).slice(5)}
        </text>
      ))}
    </svg>
  );
}
