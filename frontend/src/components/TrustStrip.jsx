import { useSettings } from '../context/SettingsContext';
import './TrustStrip.css';

export default function TrustStrip() {
  const { trust_items } = useSettings();

  return (
    <div className="trust-strip">
      <div className="container trust-strip-grid">
        {(trust_items || []).map((b, i) => (
          <div key={i} className="trust-badge">
            <div className="trust-badge-icon">{b.icon}</div>
            <div className="trust-badge-text">
              <strong>{b.label}</strong>
              <span>{b.sub}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
