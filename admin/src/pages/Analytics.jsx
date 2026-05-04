import { useEffect, useState, useMemo } from 'react';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { Link } from 'react-router-dom';

const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Analytics() {
  const [points, setPoints]       = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [rangeMode, setRangeMode] = useState('preset'); // 'preset' | 'custom'
  const [days, setDays]           = useState(30);
  const [from, setFrom]           = useState('');
  const [to, setTo]               = useState('');

  const fetchAnalytics = () => {
    setLoading(true);
    const params = rangeMode === 'custom' && from && to ? { from, to } : { days };
    Promise.all([
      adminAPI.getAnalytics(params).then(r => r.data).catch(() => []),
      adminAPI.getTopProducts().then(r => r.data).catch(() => []),
    ]).then(([a, t]) => {
      setPoints(Array.isArray(a) ? a : []);
      setTopProducts(Array.isArray(t) ? t : []);
    }).finally(() => setLoading(false));
  };

  useEffect(fetchAnalytics, [days, rangeMode, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const revenue = points.reduce((s, p) => s + Number(p.revenue || 0), 0);
    const orders  = points.reduce((s, p) => s + Number(p.orders || 0), 0);
    const aov     = orders > 0 ? revenue / orders : 0;
    return { revenue, orders, aov };
  }, [points]);

  const handleExportCSV = () => {
    if (!points.length) return;
    const headers = ['Date', 'Orders', 'Revenue (GHS)'];
    const csvRows = points.map(p => [
      p.date,
      p.orders,
      Number(p.revenue || 0).toFixed(2),
    ].map(v => `"${v}"`).join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const label = rangeMode === 'custom' && from && to
    ? `${from} → ${to}`
    : `${days}d`;

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Sales trends over time</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={rangeMode === 'custom' ? 'custom' : String(days)}
            onChange={e => {
              if (e.target.value === 'custom') { setRangeMode('custom'); }
              else { setRangeMode('preset'); setDays(Number(e.target.value)); }
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range…</option>
          </select>
          {rangeMode === 'custom' && (
            <>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 140 }} />
              <span className="muted">→</span>
              <input type="date" value={to}   onChange={e => setTo(e.target.value)}   style={{ width: 140 }} />
            </>
          )}
          <button className="btn btn-outline btn-sm" onClick={handleExportCSV} disabled={!points.length}>
            ↓ Export CSV
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label={`Revenue · ${label}`} value={fmt(totals.revenue)} />
        <StatCard label={`Orders · ${label}`}  value={totals.orders.toLocaleString()} />
        <StatCard label="Average order value" value={fmt(totals.aov)} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title">Revenue</h2></div>
        <div className="card-body">
          <Chart points={points} metric="revenue" valueFormat={fmt} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title">Orders</h2></div>
        <div className="card-body">
          <Chart points={points} metric="orders" valueFormat={v => Number(v || 0)} />
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">Top products · all time</h2></div>
        <DataTable
          rows={topProducts}
          emptyMessage="No sales data yet."
          columns={[
            { key: 'rank', label: '#', width: 50,
              render: (p) => <span style={{ fontWeight: 700, color: 'var(--ac-accent-dark)' }}>{topProducts.indexOf(p) + 1}</span> },
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

function Chart({ points, metric, valueFormat }) {
  if (!points || points.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>No data in this range.</div>;
  }

  const W = 800, H = 200, PAD = 30;
  const vals = points.map(p => Number(p[metric] || 0));
  const max = Math.max(...vals, 1);
  const bw = Math.max(2, (W - 2 * PAD) / points.length - 4);

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
            <rect x={x} y={H - PAD - h} width={bw} height={h} fill="var(--ac-accent)" opacity="0.85" rx="2">
              <title>{`${p.date} — ${valueFormat(v)}`}</title>
            </rect>
            {i % Math.max(1, Math.floor(points.length / 8)) === 0 && (
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--ac-text-muted)">
                {String(p.date).slice(5)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--ac-border-strong)" />
    </svg>
  );
}
