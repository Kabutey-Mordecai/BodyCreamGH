import { useEffect, useState, useMemo } from 'react';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { Link } from 'react-router-dom';

const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Analytics() {
  const [points, setPoints] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30); // days

  useEffect(() => {
    Promise.all([
      adminAPI.getAnalytics().then(r => r.data).catch(() => []),
      adminAPI.getTopProducts().then(r => r.data).catch(() => []),
    ]).then(([a, t]) => {
      setPoints(Array.isArray(a) ? a.slice().reverse() : []);
      setTopProducts(Array.isArray(t) ? t : []);
    }).finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => points.slice(-range), [points, range]);

  const totals = useMemo(() => {
    const revenue = visible.reduce((s, p) => s + Number(p.revenue || 0), 0);
    const orders  = visible.reduce((s, p) => s + Number(p.orders || 0), 0);
    const aov     = orders > 0 ? revenue / orders : 0;
    return { revenue, orders, aov };
  }, [visible]);

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Sales trends over time</p>
        </div>
        <div className="page-actions">
          <select value={range} onChange={e => setRange(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label={`Revenue · ${range}d`} value={fmt(totals.revenue)} />
        <StatCard label={`Orders · ${range}d`}  value={totals.orders.toLocaleString()} />
        <StatCard label="Average order value" value={fmt(totals.aov)} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title">Revenue</h2></div>
        <div className="card-body">
          <Chart points={visible} metric="revenue" valueFormat={fmt} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title">Orders</h2></div>
        <div className="card-body">
          <Chart points={visible} metric="orders" valueFormat={v => Number(v || 0)} />
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">Top products · all time</h2></div>
        <DataTable
          rows={topProducts}
          emptyMessage="No sales data yet."
          columns={[
            { key: 'rank', label: '#', width: 50,
              render: (_, i) => <span style={{ fontWeight: 700, color: 'var(--ac-accent-dark)' }}>{topProducts.indexOf(_) + 1}</span> },
            { key: 'name', label: 'Product', render: p => <Link to={`/products/${p.id}`} className="cell-primary">{p.name}</Link> },
            { key: 'price', label: 'Price', className: 'cell-right', render: p => fmt(p.price) },
            { key: 'total_quantity', label: 'Units sold', className: 'cell-right',
              render: p => Number(p.total_quantity || 0).toLocaleString() },
            { key: 'times_sold', label: 'Orders', className: 'cell-right',
              render: p => Number(p.times_sold || 0).toLocaleString() },
          ]}
        />
      </div>
    </div>
  );
}

// Lightweight pure-SVG bar chart — no chart library dependency.
function Chart({ points, metric, valueFormat }) {
  if (!points || points.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>No data in this range.</div>;
  }

  const W = 800, H = 200, PAD = 30;
  const vals = points.map(p => Number(p[metric] || 0));
  const max = Math.max(...vals, 1);
  const bw = (W - 2 * PAD) / points.length - 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0.25, 0.5, 0.75].map(p => (
        <line key={p} x1={PAD} x2={W - PAD} y1={H - PAD - p * (H - 2 * PAD)} y2={H - PAD - p * (H - 2 * PAD)} stroke="var(--ac-border)" strokeDasharray="3 4" />
      ))}
      {points.map((p, i) => {
        const v = Number(p[metric] || 0);
        const h = (v / max) * (H - 2 * PAD);
        const x = PAD + i * ((W - 2 * PAD) / points.length);
        return (
          <g key={i}>
            <rect
              x={x}
              y={H - PAD - h}
              width={bw}
              height={h}
              fill="var(--ac-accent)"
              opacity="0.85"
              rx="2"
            >
              <title>{`${p.date} — ${valueFormat(v)}`}</title>
            </rect>
          </g>
        );
      })}
      <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--ac-border-strong)" />
    </svg>
  );
}
