/**
 * Modern Dashboard KPI StatCard:
 * - Supports comparative delta badges (e.g. +14.2% vs yesterday)
 * - Supports micro inline SVG sparkline with gradient fill
 * - Preserves full backward compatibility with { label, value, sub, icon, accent }
 */
export default function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
  delta,
  deltaLabel,
  sparkline,
}) {
  const hasDelta = typeof delta === 'number' && !Number.isNaN(delta);
  const isPositive = delta > 0;
  const isNegative = delta < 0;

  return (
    <div
      className="stat-card stat-card--modern"
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      <div className="stat-card-top">
        <div className="stat-card-label">{label}</div>
        {icon && <div className="stat-card-icon">{icon}</div>}
      </div>

      <div className="stat-card-main">
        <div className="stat-card-value">{value}</div>

        {Array.isArray(sparkline) && sparkline.length > 1 && (
          <MiniSparkline data={sparkline} positive={!isNegative} />
        )}
      </div>

      <div className="stat-card-bottom">
        {hasDelta ? (
          <span
            className={`stat-delta ${
              isPositive ? 'stat-delta--up' : isNegative ? 'stat-delta--down' : 'stat-delta--flat'
            }`}
          >
            <span aria-hidden="true">{isPositive ? '↑' : isNegative ? '↓' : '→'}</span>
            {Math.abs(delta).toFixed(1)}%
            {deltaLabel && <span className="stat-delta-label"> {deltaLabel}</span>}
          </span>
        ) : null}

        {sub && <span className="stat-card-sub">{sub}</span>}
      </div>
    </div>
  );
}

function MiniSparkline({ data, positive = true }) {
  const W = 76;
  const H = 26;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - 3 - ((v - min) / range) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = pts.join(' ');
  const color = positive ? 'var(--ac-accent)' : 'var(--ac-danger)';

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="stat-sparkline"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polyline}
      />
    </svg>
  );
}
