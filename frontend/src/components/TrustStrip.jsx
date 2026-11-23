import { useSettings } from '../context/SettingsContext';
import './TrustStrip.css';

const SVG_ICONS = {
  delivery: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 17h4V5H2v12h3" />
      <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" />
      <circle cx="7.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  craft: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </svg>
  ),
  returns: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  secure: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
};

function renderBadgeIcon(item) {
  const icon  = String(item.icon  || '').trim();
  const label = String(item.label || '').toLowerCase();

  if (icon === '🚚' || icon === 'delivery' || label.includes('deliver') || label.includes('ship')) {
    return SVG_ICONS.delivery;
  }
  if (icon === '✦' || icon === 'craft' || label.includes('handcraft') || label.includes('batch')) {
    return SVG_ICONS.craft;
  }
  if (icon === '↩' || icon === 'returns' || label.includes('return') || label.includes('refund')) {
    return SVG_ICONS.returns;
  }
  if (icon === '🔒' || icon === 'secure' || label.includes('secure') || label.includes('pay')) {
    return SVG_ICONS.secure;
  }

  // Fallback for custom admin-entered icon characters/emojis
  return <span aria-hidden="true">{icon}</span>;
}

export default function TrustStrip() {
  const {
    trust_items,
    trust_strip_enabled = true,
    free_delivery_over,
    pay_on_delivery_enabled,
  } = useSettings();

  if (trust_strip_enabled === false) return null;

  const items = trust_items || [];
  if (!items.length) return null;

  const freeOverNum = Number(free_delivery_over);
  const formatSub = (rawSub) => {
    let sub = String(rawSub || '');
    if (sub.includes('{free_delivery_over}')) {
      sub = freeOverNum > 0
        ? sub.replace(/\{free_delivery_over\}/g, `GHS ${freeOverNum}`)
        : 'Nationwide delivery';
    } else if (/^free over ghs\s*\d+(\.\d+)?$/i.test(sub.trim())) {
      sub = freeOverNum > 0 ? `Free over GHS ${freeOverNum}` : 'Nationwide delivery';
    }
    if (pay_on_delivery_enabled && /^paystack\s*&\s*momo$/i.test(sub.trim())) {
      sub = 'Paystack, MoMo & COD';
    }
    return sub;
  };

  return (
    <section className="trust-strip" aria-label="Store highlights">
      <ul className="container trust-strip-grid">
        {items.map((b, i) => (
          <li key={b.label || i} className="trust-badge">
            <div className="trust-badge-icon" aria-hidden="true">
              {renderBadgeIcon(b)}
            </div>
            <div className="trust-badge-text">
              <strong>{b.label}</strong>
              <span>{formatSub(b.sub)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
