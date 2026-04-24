import './TrustStrip.css';

// TO CUSTOMIZE: Edit badges to reflect your actual brand promises
const BADGES = [
  {
    icon: '🚚',
    heading: 'Ghana-wide Delivery',
    sub:     'Free on orders over GHS 200',
  },
  {
    icon: '🌿',
    heading: '100% Natural',
    sub:     'No parabens, no sulfates, no dyes',
  },
  {
    icon: '⭐',
    heading: 'Loved by Customers',
    sub:     'Real reviews from real Ghanaians',
  },
  {
    icon: '🔒',
    heading: 'Secure Checkout',
    sub:     'Cards, Mobile Money & Bank Transfer',
  },
];

export default function TrustStrip() {
  return (
    <div className="trust-strip">
      <div className="container trust-strip-grid">
        {BADGES.map(b => (
          <div key={b.heading} className="trust-badge">
            <div className="trust-badge-icon">{b.icon}</div>
            <div className="trust-badge-text">
              <strong>{b.heading}</strong>
              <span>{b.sub}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
