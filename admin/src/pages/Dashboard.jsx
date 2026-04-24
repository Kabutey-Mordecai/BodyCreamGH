import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';

const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n) => Number(n || 0).toLocaleString();

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState([]);
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminAPI.getDashboard().then(r => r.data).catch(() => null),
      adminAPI.getAnalytics().then(r => r.data).catch(() => []),
      adminAPI.getTopProducts().then(r => r.data).catch(() => []),
    ]).then(([d, a, t]) => {
      setData(d);
      setAnalytics(Array.isArray(a) ? a.slice().reverse() : []); // oldest → newest for chart
      setTop(Array.isArray(t) ? t : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="spinner" />;

  // Gracefully handle the case where the backend isn't running yet
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
      </div>

      {/* KPI row */}
      <div className="stats-grid">
        <StatCard
          label="Total revenue"
          value={fmt(data.totalRevenue)}
          sub="Lifetime, paid orders only"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
        />
        <StatCard
          label="Orders"
          value={fmtInt(data.totalOrders)}
          sub="All time"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 11a2 2 0 01-2 2H9a2 2 0 01-2-2L6 8z"/><path d="M9 8V6a3 3 0 116 0v2"/></svg>}
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

      {/* Revenue chart + top products side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}
           className="dash-split">
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
          <div className="card-header">
            <h2 className="card-title">Top products</h2>
          </div>
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
            { key: 'total_amount', label: 'Total',   className: 'cell-right', render: r => fmt(r.total_amount) },
            { key: 'status',       label: 'Status',  render: r => <StatusBadge status={r.status} /> },
          ]}
          rows={data.recentOrders || []}
          emptyMessage="No orders yet."
        />
      </div>

      <style>{`
        .dash-split { }
        @media (max-width: 900px) {
          .dash-split { grid-template-columns: 1fr !important; }
        }
        .top-list { list-style: none; }
        .top-list li {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 18px;
          border-bottom: 1px solid var(--ac-border);
          font-size: 0.87rem;
        }
        .top-list li:last-child { border-bottom: none; }
        .top-rank {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--ac-accent-light);
          color: var(--ac-accent-dark);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 700;
          flex-shrink: 0;
        }
        .top-name { flex: 1; font-weight: 500; color: var(--ac-text); }
        .top-qty  { color: var(--ac-text-muted); font-size: 0.78rem; }
      `}</style>
    </div>
  );
}

// Pure-SVG sparkline chart — no recharts/chart.js dependency.
function RevenueChart({ points }) {
  if (!points || points.length === 0) {
    return (
      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>
        Not enough data yet — chart will populate after the first paid orders.
      </div>
    );
  }

  const W = 640, H = 180, PAD = 28;
  const values = points.map(p => Number(p.revenue || 0));
  const max = Math.max(...values, 1);
  const min = 0;

  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(points.length - 1, 1);
  const y = (v) => H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(Number(p.revenue || 0))}`).join(' ');
  const area = `${path} L ${x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="var(--ac-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--ac-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* horizontal gridlines at 25/50/75/100 % */}
      {[0.25, 0.5, 0.75, 1].map(p => (
        <line
          key={p}
          x1={PAD} x2={W - PAD}
          y1={H - PAD - p * (H - 2 * PAD)} y2={H - PAD - p * (H - 2 * PAD)}
          stroke="var(--ac-border)"
          strokeDasharray="3 4"
        />
      ))}

      <path d={area} fill="url(#rev-fill)" />
      <path d={path} fill="none" stroke="var(--ac-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* dots */}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(Number(p.revenue || 0))} r="3" fill="#fff" stroke="var(--ac-accent)" strokeWidth="1.5" />
      ))}
    </svg>
  );
}
