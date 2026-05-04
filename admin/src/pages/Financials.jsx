import { useEffect, useState } from 'react';
import { adminAPI } from '../services/api';
import StatCard from '../components/StatCard';

const fmt = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n || 0).toFixed(2)}%`;

export default function Financials() {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [rangeMode, setRangeMode] = useState('preset');
  const [days, setDays]         = useState(30);
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');

  const load = () => {
    setLoading(true);
    const params = rangeMode === 'custom' && from && to ? { from, to } : { days };
    adminAPI.getFinancials(params)
      .then(({ data: d }) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [days, rangeMode, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = rangeMode === 'custom' && from && to ? `${from} → ${to}` : `${days}d`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Financials</h1>
          <p className="muted">Revenue, refunds, and financial health</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={rangeMode === 'custom' ? 'custom' : String(days)}
            onChange={e => {
              if (e.target.value === 'custom') setRangeMode('custom');
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
        </div>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : !data ? (
        <div className="alert alert-warning">Failed to load financials data.</div>
      ) : (
        <>
          {data.pending_refunds > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <strong>{fmt(data.pending_refunds)}</strong> in pending refunds awaiting processing.
            </div>
          )}

          <div className="stats-grid">
            <StatCard label={`Gross revenue · ${label}`} value={fmt(data.gross_revenue)} sub="All paid orders" />
            <StatCard label={`Refunded · ${label}`}      value={fmt(data.total_refunded)} sub="Completed refunds" />
            <StatCard label={`Net revenue · ${label}`}   value={fmt(data.net_revenue)}    sub="Gross minus refunds" />
            <StatCard label="Avg. order value"           value={fmt(data.avg_order_value)} sub="Paid orders in period" />
            <StatCard label="Refund rate"                value={pct(data.refund_rate)}     sub="Refunded ÷ paid orders" />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><h2 className="card-title">Daily revenue vs. refunds</h2></div>
            <div className="card-body">
              <DualChart points={data.daily_series} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DualChart({ points }) {
  if (!points || points.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>No data in this range.</div>;
  }

  const W = 800, H = 220, PAD = 32;
  const revVals  = points.map(p => Number(p.revenue  || 0));
  const refVals  = points.map(p => Number(p.refunded || 0));
  const max = Math.max(...revVals, ...refVals, 1);

  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(points.length - 1, 1);
  const y = (v) => H - PAD - (v / max) * (H - 2 * PAD);

  const mkPath = (vals) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const revPath = mkPath(revVals);
  const refPath = mkPath(refVals);
  const step = Math.max(1, Math.floor(points.length / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0.25, 0.5, 0.75, 1].map(p => (
        <line key={p} x1={PAD} x2={W - PAD} y1={H - PAD - p * (H - 2 * PAD)} y2={H - PAD - p * (H - 2 * PAD)} stroke="var(--ac-border)" strokeDasharray="3 4" />
      ))}
      <path d={revPath} fill="none" stroke="var(--ac-accent)"  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={refPath} fill="none" stroke="var(--ac-danger)"  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 3" />
      {revVals.map((v, i) => (
        <circle key={`r${i}`} cx={x(i)} cy={y(v)} r="3" fill="var(--ac-accent)" opacity="0.8">
          <title>{points[i].date} — Revenue: {`GHS ${v.toFixed(2)}`}</title>
        </circle>
      ))}
      {refVals.map((v, i) => v > 0 && (
        <circle key={`f${i}`} cx={x(i)} cy={y(v)} r="3" fill="var(--ac-danger)" opacity="0.8">
          <title>{points[i].date} — Refunded: {`GHS ${v.toFixed(2)}`}</title>
        </circle>
      ))}
      {points.map((p, i) => i % step === 0 && (
        <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--ac-text-muted)">
          {String(p.date).slice(5)}
        </text>
      ))}
      {/* Legend */}
      <circle cx={PAD} cy={12} r="4" fill="var(--ac-accent)" />
      <text x={PAD + 10} y={16} fontSize="10" fill="var(--ac-text-muted)">Revenue</text>
      <line x1={PAD + 70} x2={PAD + 90} y1={12} y2={12} stroke="var(--ac-danger)" strokeWidth="2" strokeDasharray="5 3" />
      <text x={PAD + 96} y={16} fontSize="10" fill="var(--ac-text-muted)">Refunded</text>
    </svg>
  );
}
