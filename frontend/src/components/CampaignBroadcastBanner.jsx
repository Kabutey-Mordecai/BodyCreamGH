import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './CampaignBroadcastBanner.css';

// Default fallback target: 3 days ahead at 11:59:59 PM so the countdown ticks realistically
const DEFAULT_CAMPAIGN_END = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(23, 59, 59, 0);
  return d.getTime();
})();

function calculateTimeLeft(targetTimestamp) {
  const diff = Math.max(0, targetTimestamp - Date.now());

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    isExpired: diff <= 0,
  };
}

export default function CampaignBroadcastBanner({ compact = false }) {
  const settings = useSettings();
  const [copied, setCopied] = useState(false);

  const isEnabled = settings.campaign_banner_enabled !== false && settings.campaign_banner_enabled !== 'false';
  const theme = settings.campaign_theme || 'black_friday'; // 'black_friday' | 'flash_sale' | 'holiday_glow'

  const badge = settings.campaign_badge || '⚡ BLACK FRIDAY FESTIVAL · LIMITED DEALS';
  const headline = settings.campaign_headline || 'UP TO 50% OFF BESTSELLING BEAUTY';
  const subtext = settings.campaign_subtext || 'Ghana\'s biggest authentic cosmetics event. Slashed prices on CeraVe, Fenty, Lattafa & more. 100% authentic sealed packaging.';
  const couponCode = settings.campaign_coupon_code || 'BF50';
  const ctaText = settings.campaign_cta_text || 'Shop Black Friday Deals';
  const ctaLink = settings.campaign_cta_link || '/shop';
  const endsAt = settings.campaign_ends_at || '';

  const targetTimestamp = useMemo(() => {
    if (endsAt) {
      const parsed = new Date(endsAt).getTime();
      if (!isNaN(parsed) && parsed > Date.now()) return parsed;
    }
    return DEFAULT_CAMPAIGN_END;
  }, [endsAt]);

  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(targetTimestamp));

  useEffect(() => {
    setTimeLeft(calculateTimeLeft(targetTimestamp));
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetTimestamp));
    }, 1000);
    return () => clearInterval(timer);
  }, [targetTimestamp]);

  if (!isEnabled) return null;

  const handleCopyCode = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (couponCode && navigator.clipboard) {
      navigator.clipboard.writeText(couponCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (compact) {
    return (
      <div className={`cbb-compact cbb-theme-${theme}`}>
        <div className="container cbb-compact-inner">
          <div className="cbb-compact-left">
            <span className="cbb-pulse-dot" />
            <span className="cbb-compact-badge">{badge}</span>
            <span className="cbb-compact-text"><strong>{headline}</strong> — {subtext}</span>
          </div>
          <div className="cbb-compact-right">
            {couponCode && (
              <button type="button" className="cbb-code-pill" onClick={handleCopyCode} title="Click to copy code">
                Use Code: <strong>{couponCode}</strong> {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            )}
            <Link to={ctaLink} className="cbb-compact-cta">
              {ctaText} →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className={`cbb-broadcast-section cbb-theme-${theme}`} aria-label="Special Promotional Campaign">
      <div className="cbb-ambient-glow" />
      <div className="container cbb-container">
        <div className="cbb-grid">
          {/* Main Campaign Message */}
          <div className="cbb-content">
            <div className="cbb-badge-row">
              <span className="cbb-badge">
                <span className="cbb-pulse-dot" />
                {badge}
              </span>
              <span className="cbb-guarantee-pill">✓ 100% Authentic Brands</span>
            </div>

            <h2 className="cbb-headline">{headline}</h2>
            <p className="cbb-subtext">{subtext}</p>

            {/* Voucher code & CTA row */}
            <div className="cbb-action-row">
              <Link to={ctaLink} className="btn cbb-btn-primary">
                {ctaText} →
              </Link>

              {couponCode && (
                <div className="cbb-voucher-box">
                  <span className="cbb-voucher-label">Voucher Code:</span>
                  <button
                    type="button"
                    className="cbb-voucher-code"
                    onClick={handleCopyCode}
                    title="Click to copy coupon code"
                  >
                    <span>{couponCode}</span>
                    <span className="cbb-copy-badge">{copied ? '✓ Copied!' : 'Copy Code'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Trust perks row */}
            <div className="cbb-perks-row">
              <div className="cbb-perk">
                <span className="cbb-perk-icon">🚚</span>
                <span>Free delivery over GHS 200</span>
              </div>
              <div className="cbb-perk">
                <span className="cbb-perk-icon">⚡</span>
                <span>Accra same-day & 24h dispatch</span>
              </div>
              <div className="cbb-perk">
                <span className="cbb-perk-icon">💵</span>
                <span>Pay on Delivery available</span>
              </div>
            </div>
          </div>

          {/* Live Countdown & Urgency Box */}
          <div className="cbb-urgency-card">
            <div className="cbb-urgency-header">
              <span className="cbb-fire-icon">🔥</span>
              <span className="cbb-urgency-title">DEAL ENDS IN</span>
            </div>

            <div className="cbb-countdown-grid">
              <div className="cbb-timer-unit">
                <span className="cbb-timer-num">{String(timeLeft.days).padStart(2, '0')}</span>
                <span className="cbb-timer-label">DAYS</span>
              </div>
              <span className="cbb-timer-colon">:</span>
              <div className="cbb-timer-unit">
                <span className="cbb-timer-num">{String(timeLeft.hours).padStart(2, '0')}</span>
                <span className="cbb-timer-label">HOURS</span>
              </div>
              <span className="cbb-timer-colon">:</span>
              <div className="cbb-timer-unit">
                <span className="cbb-timer-num">{String(timeLeft.minutes).padStart(2, '0')}</span>
                <span className="cbb-timer-label">MINS</span>
              </div>
              <span className="cbb-timer-colon">:</span>
              <div className="cbb-timer-unit">
                <span className="cbb-timer-num">{String(timeLeft.seconds).padStart(2, '0')}</span>
                <span className="cbb-timer-label">SECS</span>
              </div>
            </div>

            <div className="cbb-stock-urgency">
              <div className="cbb-stock-bar-wrap">
                <div className="cbb-stock-bar" style={{ width: '84%' }} />
              </div>
              <div className="cbb-stock-text">
                <span>🔥 84% claimed</span>
                <span>Limited event stock</span>
              </div>
            </div>

            <Link to={ctaLink} className="cbb-urgency-cta">
              Claim Black Friday Deals Now →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
