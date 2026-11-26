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

  const isEnabled = settings.campaign_banner_enabled !== false && settings.campaign_banner_enabled !== 'false';
  const theme = settings.campaign_theme || 'black_friday'; // 'black_friday' | 'flash_sale' | 'holiday_glow'

  const badge = settings.campaign_badge || 'BLACK FRIDAY EVENT · LIMITED TIME DEALS';
  const headline = settings.campaign_headline || 'Up to 50% Off Bestselling Beauty';
  const subtext = settings.campaign_subtext || 'Slashed prices on authentic, direct-sourced skincare, fragrances, and haircare. Sealed guarantee with fast nationwide delivery.';
  const ctaText = settings.campaign_cta_text || 'Shop Black Friday Deals';
  const rawLink = settings.campaign_cta_link || '/shop?on_sale=true';
  const ctaLink = rawLink === '/shop' ? '/shop?on_sale=true' : rawLink;
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

  if (compact) {
    return (
      <div className={`cbb-compact cbb-theme-${theme}`}>
        <div className="container cbb-compact-inner">
          <div className="cbb-compact-left">
            <span className="cbb-pulse-dot" />
            <span className="cbb-compact-badge">{badge}</span>
            <span className="cbb-compact-text"><strong>{headline}</strong></span>
          </div>
          <div className="cbb-compact-right">
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
      <div className="container cbb-container">
        <div className="cbb-strip-layout">

          {/* Left: Event Branding & Editorial Copy */}
          <div className="cbb-strip-brand">
            <div className="cbb-badge-row">
              <span className="cbb-badge">
                <span className="cbb-pulse-dot" />
                {badge}
              </span>
            </div>
            <h2 className="cbb-headline">{headline}</h2>
            {subtext && <p className="cbb-subtext">{subtext}</p>}
          </div>

          {/* Right: Elegant Ticking Countdown & Single Clean CTA */}
          <div className="cbb-strip-actions">
            <div className="cbb-strip-timer" aria-label="Campaign countdown timer">
              <span className="cbb-timer-title">ENDS IN</span>
              <div className="cbb-timer-digits">
                <span className="cbb-digit-group">
                  <strong>{String(timeLeft.days).padStart(2, '0')}</strong><small>D</small>
                </span>
                <span className="cbb-sep">:</span>
                <span className="cbb-digit-group">
                  <strong>{String(timeLeft.hours).padStart(2, '0')}</strong><small>H</small>
                </span>
                <span className="cbb-sep">:</span>
                <span className="cbb-digit-group">
                  <strong>{String(timeLeft.minutes).padStart(2, '0')}</strong><small>M</small>
                </span>
                <span className="cbb-sep">:</span>
                <span className="cbb-digit-group">
                  <strong>{String(timeLeft.seconds).padStart(2, '0')}</strong><small>S</small>
                </span>
              </div>
            </div>

            <Link to={ctaLink} className="btn cbb-btn-primary">
              {ctaText} →
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
}
