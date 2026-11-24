import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './Footer.css';

const YEAR = new Date().getFullYear();

const ACCOUNT_LINKS = [
  { label: 'My Account',  to: '/account' },
  { label: 'My Orders',   to: '/orders' },
  { label: 'Cart',        to: '/cart' },
  { label: 'Login',       to: '/login' },
  { label: 'Register',    to: '/register' },
];

const INFO_LINKS = [
  { label: 'About Us',           to: '/#our-story' },
  { label: 'Shipping Policy',    to: '/shipping-policy' },
  { label: 'Refund & Returns',   to: '/refund-policy' },
  { label: 'Privacy Policy',     to: '/privacy-policy' },
  { label: 'Terms & Conditions', to: '/terms' },
  { label: 'Contact Us',         to: '/contact' },
  { label: 'Track your order',   to: '/track' },
];

const SOCIALS_META = [
  {
    label: 'Instagram',
    href: 'https://instagram.com',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
        <circle cx="12" cy="12" r="4"/>
        <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    label: 'Facebook',
    href: 'https://facebook.com',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/>
      </svg>
    ),
  },
  {
    label: 'TikTok',
    href: 'https://tiktok.com',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
      </svg>
    ),
  },
  {
    label: 'WhatsApp',
    href: 'https://wa.me',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.555 4.112 1.524 5.84L.057 23.27l5.565-1.455A11.93 11.93 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.802 9.802 0 01-5.002-1.371l-.36-.213-3.303.865.88-3.22-.233-.37A9.79 9.79 0 012.182 12C2.182 6.597 6.597 2.182 12 2.182S21.818 6.597 21.818 12 17.403 21.818 12 21.818z"/>
      </svg>
    ),
  },
];

export default function Footer() {
  const settings = useSettings();
  const {
    store_name,
    store_phone,
    store_email,
    footer_tagline,
    footer_instagram,
    footer_facebook,
    footer_whatsapp,
    footer_tiktok,
    whatsapp_number,
    pickup_enabled,
    pay_on_delivery_enabled,
    back_to_top_enabled,
    footer_payment_badges_enabled,
    categories,
  } = settings;

  const cleanPhone = store_phone || settings.contact_phone || settings.whatsapp_number || '+233 24 585 2804';
  const cleanEmail = store_email || settings.contact_email || 'hello@glowhausbeauty.com';

  const rawWa = String(whatsapp_number || cleanPhone || '').replace(/\D/g, '');
  const waDigits = rawWa.length === 10 && rawWa.startsWith('0') ? `233${rawWa.slice(1)}` : rawWa;
  const waHref = waDigits
    ? `https://wa.me/${waDigits}?text=Hello%20${encodeURIComponent(store_name || 'GlowHaus Beauty')},%20I%20have%20an%20inquiry.`
    : (footer_whatsapp || 'https://wa.me/233245852804');

  const pickupEnabled = pickup_enabled !== false && pickup_enabled !== 'false';
  const podEnabled = pay_on_delivery_enabled === true || pay_on_delivery_enabled === 'true';
  const showBackToTop = back_to_top_enabled !== false && back_to_top_enabled !== 'false';
  const showPaymentBadges = footer_payment_badges_enabled !== false && footer_payment_badges_enabled !== 'false';

  const defaultHandle = 'glowhausbeauty';
  const getSocialHref = (label, customHref) => {
    if (customHref && !customHref.endsWith('.com') && !customHref.endsWith('.com/')) {
      return customHref;
    }
    switch (label) {
      case 'Instagram': return `https://instagram.com/${defaultHandle}`;
      case 'Facebook':  return `https://facebook.com/${defaultHandle}`;
      case 'TikTok':    return `https://tiktok.com/@${defaultHandle}`;
      default:          return customHref;
    }
  };

  const socials = SOCIALS_META.map(s => ({
    ...s,
    href: s.label === 'Instagram' ? getSocialHref(s.label, footer_instagram)
        : s.label === 'Facebook'  ? getSocialHref(s.label, footer_facebook)
        : s.label === 'TikTok'    ? getSocialHref(s.label, footer_tiktok)
        : s.label === 'WhatsApp'  ? waHref
        : s.href,
  }));

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="footer">

      {/* ── Back to top strip ────────────────── */}
      {showBackToTop && (
        <button
          type="button"
          className="footer-back-to-top"
          onClick={scrollToTop}
        >
          Back to top ↑
        </button>
      )}

      {/* ── Main footer body ─────────────────── */}
      <div className="footer-body">
        <div className="container footer-grid">

          {/* Brand column */}
          <div className="footer-brand">
            <span className="footer-logo">{store_name}</span>
            <p className="footer-tagline">
              {footer_tagline}
            </p>

            {/* Social icons */}
            <div className="footer-socials">
              {socials.map(s => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-social-icon"
                  aria-label={s.label}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Account links */}
          <div className="footer-col">
            <h4 className="footer-col-head">Account</h4>
            <ul>
              {ACCOUNT_LINKS.map(l => (
                <li key={l.label}>
                  <Link to={l.to}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Help & Support links */}
          <div id="contact-footer" className="footer-col">
            <h4 className="footer-col-head">Help &amp; Support</h4>
            <ul>
              {INFO_LINKS.map(l => (
                <li key={l.label}>
                  <Link to={l.to}>{l.label}</Link>
                </li>
              ))}
              {cleanPhone && (
                <li>
                  <a href={`tel:${cleanPhone.replace(/\s+/g, '')}`}>{cleanPhone}</a>
                </li>
              )}
              {cleanEmail && (
                <li>
                  <a href={`mailto:${cleanEmail}`}>{cleanEmail}</a>
                </li>
              )}
            </ul>
          </div>

        </div>
      </div>

      {/* ── Bottom bar ───────────────────────── */}
      <div className="footer-bottom">
        <div className="container footer-bottom-inner">
          <p>© {YEAR} {store_name}. All rights reserved.</p>
        </div>
      </div>

    </footer>
  );
}
