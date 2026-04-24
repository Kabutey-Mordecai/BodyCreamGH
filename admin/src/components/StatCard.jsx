// Dashboard metric tile. The icon prop is any JSX (a <svg> usually).
export default function StatCard({ label, value, sub, icon, accent }) {
  return (
    <div className="stat-card" style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
      {icon && <div className="stat-card-icon">{icon}</div>}
    </div>
  );
}
