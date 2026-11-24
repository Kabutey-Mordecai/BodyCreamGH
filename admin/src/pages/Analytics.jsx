import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';

const fmt = (n) =>
  `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtCompact = (n) => {
  const num = Number(n || 0);
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(Math.round(num));
};

const PRESET_RANGES = [
  { label: '7D',  days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

export default function Analytics() {
  const [points, setPoints]           = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [traffic, setTraffic]         = useState({
    unique_visitors: 0,
    page_views: 0,
    today_visitors: 0,
    today_page_views: 0,
    daily: [],
    top_pages: [],
  });
  const [loading, setLoading]         = useState(true);
  const [rangeMode, setRangeMode]     = useState('preset'); // 'preset' | 'custom'
  const [days, setDays]               = useState(30);
  const [from, setFrom]               = useState('');
  const [to, setTo]                   = useState('');
  const [metric, setMetric]           = useState('revenue'); // 'revenue' | 'orders'
  const [chartType, setChartType]     = useState('area');    // 'area' | 'bar'
  const [sortField, setSortField]     = useState('total_quantity');
  const [sortDir, setSortDir]         = useState('desc');

  const fetchAnalytics = () => {
    setLoading(true);
    const params = rangeMode === 'custom' && from && to ? { from, to } : { days };
    Promise.all([
      adminAPI.getAnalytics(params).then(r => r.data).catch(() => []),
      adminAPI.getTopProducts().then(r => r.data).catch(() => []),
      adminAPI.getTraffic(params).then(r => r.data).catch(() => null),
    ])
      .then(([a, t, tr]) => {
        setPoints(Array.isArray(a) ? a : []);
        setTopProducts(Array.isArray(t) ? t : []);
        if (tr && typeof tr === 'object') setTraffic(tr);
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchAnalytics, [days, rangeMode, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const revenue = points.reduce((s, p) => s + Number(p.revenue || 0), 0);
    const orders  = points.reduce((s, p) => s + Number(p.orders || 0), 0);
    const aov     = orders > 0 ? revenue / orders : 0;
    const avgDailyRev = points.length > 0 ? revenue / points.length : 0;
    const avgDailyOrd = points.length > 0 ? orders / points.length : 0;

    let peakDay = null;
    for (const p of points) {
      if (!peakDay || Number(p.revenue || 0) > Number(peakDay.revenue || 0)) {
        peakDay = p;
      }
    }

    return {
      revenue,
      orders,
      aov,
      avgDailyRev,
      avgDailyOrd,
      peakDay,
      revSpark: points.slice(-14).map(p => Number(p.revenue || 0)),
      ordSpark: points.slice(-14).map(p => Number(p.orders || 0)),
    };
  }, [points]);

  const maxProductUnits = useMemo(() => {
    return Math.max(...topProducts.map(p => Number(p.total_quantity || 0)), 1);
  }, [topProducts]);

  const sortedProducts = useMemo(() => {
    const list = [...topProducts];
    list.sort((a, b) => {
      const av = sortField === 'name' ? String(a.name || '') : Number(a[sortField] || 0);
      const bv = sortField === 'name' ? String(b.name || '') : Number(b[sortField] || 0);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [topProducts, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleExportCSV = () => {
    if (!points.length) return;
    const headers = ['Date', 'Orders', 'Revenue (GHS)'];
    const csvRows = points.map(p =>
      [p.date, p.orders, Number(p.revenue || 0).toFixed(2)].map(v => `"${v}"`).join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rangeLabel =
    rangeMode === 'custom' && from && to ? `${from} → ${to}` : `Last ${days} days`;

  return (
    <div>
      {/* Header & Range Controls */}
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Sales performance &amp; product demand · {rangeLabel}</p>
        </div>

        <div className="page-actions" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="an-range-pills" role="group" aria-label="Date range presets">
            {PRESET_RANGES.map(r => (
              <button
                key={r.days}
                type="button"
                className={`an-pill ${rangeMode === 'preset' && days === r.days ? 'active' : ''}`}
                onClick={() => {
                  setRangeMode('preset');
                  setDays(r.days);
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              className={`an-pill ${rangeMode === 'custom' ? 'active' : ''}`}
              onClick={() => setRangeMode('custom')}
            >
              Custom
            </button>
          </div>

          {rangeMode === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                aria-label="Start date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                style={{ width: 140 }}
              />
              <span className="muted">→</span>
              <input
                type="date"
                aria-label="End date"
                value={to}
                onChange={e => setTo(e.target.value)}
                style={{ width: 140 }}
              />
            </div>
          )}

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleExportCSV}
            disabled={!points.length}
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="stats-grid" style={{ opacity: loading ? 0.65 : 1, transition: 'opacity 0.15s' }}>
        <StatCard
          label={`Revenue · ${rangeMode === 'custom' ? 'Range' : `${days}d`}`}
          value={fmt(stats.revenue)}
          sparkline={stats.revSpark}
          sub={`Avg ${fmt(stats.avgDailyRev)} / active day`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          }
        />
        <StatCard
          label={`Orders · ${rangeMode === 'custom' ? 'Range' : `${days}d`}`}
          value={fmtInt(stats.orders)}
          sparkline={stats.ordSpark}
          sub={`Avg ${stats.avgDailyOrd.toFixed(1)} orders / active day`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 8h12l-1 11a2 2 0 01-2 2H9a2 2 0 01-2-2L6 8z" />
              <path d="M9 8V6a3 3 0 116 0v2" />
            </svg>
          }
        />
        <StatCard
          label="Average order value"
          value={fmt(stats.aov)}
          sub="Paid revenue ÷ paid orders"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 4 4 5-6" />
            </svg>
          }
        />
        <StatCard
          label="Peak revenue day"
          value={stats.peakDay ? fmt(stats.peakDay.revenue) : '—'}
          sub={
            stats.peakDay
              ? `${new Date(stats.peakDay.date).toLocaleDateString('en-GH', { month: 'short', day: 'numeric' })} · ${fmtInt(stats.peakDay.orders)} order${Number(stats.peakDay.orders) !== 1 ? 's' : ''}`
              : 'No sales in range'
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }
        />
        <StatCard
          label={`Site Visitors · ${rangeMode === 'custom' ? 'Range' : `${days}d`}`}
          value={fmtInt(traffic.unique_visitors)}
          sparkline={(traffic.daily || []).slice(-14).map(d => Number(d.visitors || 0))}
          sub={`${fmtInt(traffic.today_visitors)} today`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
          }
        />
        <StatCard
          label={`Page Views · ${rangeMode === 'custom' ? 'Range' : `${days}d`}`}
          value={fmtInt(traffic.page_views)}
          sparkline={(traffic.daily || []).slice(-14).map(d => Number(d.page_views || 0))}
          sub={
            traffic.unique_visitors > 0
              ? `${((stats.orders / traffic.unique_visitors) * 100).toFixed(1)}% order conversion`
              : `${fmtInt(traffic.today_page_views)} views today`
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
        />
      </div>

      {/* Interactive Trend Chart Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 className="card-title">Performance Trend</h2>
            <div className="an-range-pills" role="tablist" aria-label="Chart metric">
              <button
                type="button"
                role="tab"
                aria-selected={metric === 'revenue'}
                className={`an-pill ${metric === 'revenue' ? 'active' : ''}`}
                onClick={() => setMetric('revenue')}
              >
                Revenue (GHS)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={metric === 'orders'}
                className={`an-pill ${metric === 'orders' ? 'active' : ''}`}
                onClick={() => setMetric('orders')}
              >
                Orders
              </button>
            </div>
          </div>

          <div className="an-range-pills" role="group" aria-label="Chart style">
            <button
              type="button"
              className={`an-pill ${chartType === 'area' ? 'active' : ''}`}
              onClick={() => setChartType('area')}
              title="Area line chart"
            >
              Area
            </button>
            <button
              type="button"
              className={`an-pill ${chartType === 'bar' ? 'active' : ''}`}
              onClick={() => setChartType('bar')}
              title="Bar chart"
            >
              Bar
            </button>
          </div>
        </div>

        <div className="card-body" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s' }}>
          <InteractiveChart
            points={points}
            metric={metric}
            chartType={chartType}
            valueFormat={metric === 'revenue' ? fmt : (v) => `${fmtInt(v)} order${Number(v) !== 1 ? 's' : ''}`}
          />
        </div>
      </div>

      {/* Top Products Leaderboard */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Top selling products · all time</h2>
          <Link to="/products" className="btn btn-ghost btn-sm">All products →</Link>
        </div>
        <DataTable
          loading={loading && topProducts.length === 0}
          rows={sortedProducts}
          emptyMessage="No sales data yet."
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          columns={[
            {
              key: 'rank',
              label: '#',
              width: 56,
              render: (p) => {
                const idx = topProducts.findIndex(x => x.id === p.id) + 1;
                return (
                  <span className={`an-rank-badge ${idx <= 3 ? 'top' : ''}`}>
                    {idx}
                  </span>
                );
              },
            },
            {
              key: 'name',
              label: 'Product',
              sortable: true,
              render: p => (
                <Link to={`/products/${p.id}`} className="cell-primary" style={{ textDecoration: 'none' }}>
                  {p.name}
                </Link>
              ),
            },
            {
              key: 'price',
              label: 'Unit Price',
              sortable: true,
              className: 'cell-right',
              render: p => fmt(p.price),
            },
            {
              key: 'total_quantity',
              label: 'Units Sold',
              sortable: true,
              render: p => {
                const qty = Number(p.total_quantity || 0);
                const pct = Math.round((qty / maxProductUnits) * 100);
                return (
                  <div className="an-share-cell">
                    <span className="an-share-val">{fmtInt(qty)}</span>
                    <div className="an-share-bar" aria-hidden="true">
                      <div className="an-share-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'times_sold',
              label: 'Orders',
              sortable: true,
              className: 'cell-right',
              render: p => fmtInt(p.times_sold),
            },
          ]}
        />
      </div>

      {/* Top Visited Pages Card */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h2 className="card-title">Top Visited Pages</h2>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {fmtInt(traffic.today_page_views)} views · {fmtInt(traffic.today_visitors)} visitors today
          </span>
        </div>
        <DataTable
          rows={traffic.top_pages || []}
          rowKey={(r) => r.path}
          loading={loading}
          emptyTitle="No visits recorded yet"
          emptySubtitle="Storefront page views will appear here automatically as shoppers browse."
          columns={[
            {
              key: 'path',
              label: 'Page Path',
              render: (r) => <code style={{ fontSize: '0.85rem' }}>{r.path}</code>,
            },
            {
              key: 'visitors',
              label: 'Unique Visitors',
              className: 'cell-right',
              render: (r) => fmtInt(r.visitors),
            },
            {
              key: 'views',
              label: 'Page Views',
              className: 'cell-right',
              render: (r) => fmtInt(r.views),
            },
          ]}
        />
      </div>

      <style>{`
        .an-range-pills {
          display: inline-flex;
          background: var(--ac-surface-2);
          border: 1px solid var(--ac-border);
          border-radius: var(--ac-radius);
          padding: 2px;
        }
        .an-pill {
          border: none;
          background: transparent;
          color: var(--ac-text-muted);
          font-size: 0.76rem;
          font-weight: 600;
          padding: 5px 11px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s ease;
          white-space: nowrap;
        }
        .an-pill:hover { color: var(--ac-text); }
        .an-pill.active {
          background: var(--ac-surface);
          color: var(--ac-text);
          box-shadow: var(--ac-shadow-sm);
        }

        .an-rank-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          font-size: 0.74rem;
          font-weight: 700;
          background: var(--ac-surface-2);
          color: var(--ac-text-muted);
        }
        .an-rank-badge.top {
          background: var(--ac-accent-light);
          color: var(--ac-accent-dark);
        }

        .an-share-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 120px;
        }
        .an-share-val {
          font-weight: 600;
          min-width: 28px;
          font-variant-numeric: tabular-nums;
        }
        .an-share-bar {
          flex: 1;
          height: 6px;
          border-radius: 99px;
          background: var(--ac-surface-2);
          overflow: hidden;
        }
        .an-share-fill {
          height: 100%;
          border-radius: 99px;
          background: var(--ac-accent);
          transition: width 0.3s ease;
        }
      `}</style>
    </div>
  );
}

function InteractiveChart({ points, metric, chartType, valueFormat }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!points || points.length === 0) {
    return (
      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>
        No data recorded in this date range.
      </div>
    );
  }

  const W = 820, H = 220, PAD_L = 48, PAD_R = 24, PAD_T = 20, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const vals = points.map(p => Number(p[metric] || 0));
  const max = Math.max(...vals, 1);

  const xPos = (i) => {
    if (chartType === 'bar') {
      const slot = plotW / points.length;
      return PAD_L + i * slot + slot / 2;
    }
    return PAD_L + (i * plotW) / Math.max(points.length - 1, 1);
  };
  const yPos = (v) => PAD_T + plotH - (v / max) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(Number(p[metric] || 0))}`).join(' ');
  const area = `${path} L ${xPos(points.length - 1)} ${PAD_T + plotH} L ${xPos(0)} ${PAD_T + plotH} Z`;
  const bw = Math.max(4, Math.min(34, plotW / points.length - 6));
  const labelStep = Math.max(1, Math.floor(points.length / 8));

  const handleMouseMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(xPos(i) - relX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  };

  const activePoint = hoverIdx !== null ? points[hoverIdx] : null;
  const activeX = hoverIdx !== null ? xPos(hoverIdx) : 0;
  const activeY = hoverIdx !== null ? yPos(Number(activePoint[metric] || 0)) : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="an-area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="var(--ac-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--ac-accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Y-axis horizontal gridlines & labels */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const gy = PAD_T + plotH - frac * plotH;
          const labelVal = max * frac;
          return (
            <g key={frac}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={gy}
                y2={gy}
                stroke={frac === 0 ? 'var(--ac-border-strong)' : 'var(--ac-border)'}
                strokeDasharray={frac === 0 ? undefined : '3 4'}
              />
              <text
                x={PAD_L - 8}
                y={gy + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--ac-text-soft)"
              >
                {metric === 'revenue' ? fmtCompact(labelVal) : Math.round(labelVal)}
              </text>
            </g>
          );
        })}

        {/* Hover Crosshair */}
        {hoverIdx !== null && (
          <line
            x1={activeX}
            x2={activeX}
            y1={PAD_T}
            y2={PAD_T + plotH}
            stroke="var(--ac-accent)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {chartType === 'area' ? (
          <>
            <path d={area} fill="url(#an-area-fill)" />
            <path
              d={path}
              fill="none"
              stroke="var(--ac-accent)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, i) => {
              const isH = i === hoverIdx;
              return (
                <circle
                  key={i}
                  cx={xPos(i)}
                  cy={yPos(Number(p[metric] || 0))}
                  r={isH ? 5.5 : 3}
                  fill={isH ? 'var(--ac-accent)' : 'var(--ac-surface)'}
                  stroke="var(--ac-accent)"
                  strokeWidth={isH ? 2.5 : 1.5}
                />
              );
            })}
          </>
        ) : (
          points.map((p, i) => {
            const v = Number(p[metric] || 0);
            const h = (v / max) * plotH;
            const cx = xPos(i);
            const isH = i === hoverIdx;
            return (
              <rect
                key={i}
                x={cx - bw / 2}
                y={PAD_T + plotH - h}
                width={bw}
                height={Math.max(h, 2)}
                fill="var(--ac-accent)"
                opacity={hoverIdx === null || isH ? 0.92 : 0.45}
                rx="3"
                style={{ transition: 'opacity 0.12s ease' }}
              />
            );
          })
        )}

        {/* X-axis date labels */}
        {points.map((p, i) =>
          i % labelStep === 0 && (
            <text
              key={`l${i}`}
              x={xPos(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ac-text-muted)"
            >
              {String(p.date).slice(5, 10)}
            </text>
          )
        )}
      </svg>

      {/* Floating Tooltip */}
      {activePoint && (
        <div
          className="an-tooltip"
          style={{
            left: `${Math.min(86, Math.max(14, (activeX / W) * 100))}%`,
            top: `${Math.max(8, (activeY / H) * 100 - 18)}%`,
          }}
        >
          <div className="an-tooltip-date">
            {new Date(activePoint.date).toLocaleDateString('en-GH', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </div>
          <div className="an-tooltip-val">{valueFormat(activePoint[metric])}</div>
          <div className="an-tooltip-sub">
            {metric === 'revenue'
              ? `${fmtInt(activePoint.orders)} order${Number(activePoint.orders) !== 1 ? 's' : ''}`
              : fmt(activePoint.revenue)}
          </div>
        </div>
      )}

      <style>{`
        .an-tooltip {
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
        .an-tooltip-date { font-size: 0.7rem; color: var(--ac-text-muted); margin-bottom: 2px; }
        .an-tooltip-val  { font-size: 0.92rem; font-weight: 700; color: var(--ac-text); }
        .an-tooltip-sub  { font-size: 0.72rem; color: var(--ac-accent-dark); font-weight: 500; }
      `}</style>
    </div>
  );
}
