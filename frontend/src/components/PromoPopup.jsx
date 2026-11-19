import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './PromoPopup.css';

const SESSION_KEY = 'bodycream_promo_popup_dismissed';

function isExternalUrl(url) {
  return /^(https?:\/\/|mailto:|tel:|wa\.me)/i.test(url);
}

export default function PromoPopup() {
  const settings = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const isEnabled = settings.promo_popup_enabled === true || settings.promo_popup_enabled === 'true';

  useEffect(() => {
    // Clear any previous dismissal flag so refreshing or revisiting always displays the promo
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore
    }

    if (!isEnabled) return;

    const delaySec = Number(settings.promo_popup_delay_sec) || 2;
    const timer = setTimeout(() => {
      setIsOpen(true);
    }, Math.max(300, delaySec * 1000));

    return () => clearTimeout(timer);
  }, [isEnabled, settings.promo_popup_delay_sec]);

  const closePopup = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 250);
  };

  if (!isEnabled || !isOpen) return null;

  const badge = settings.promo_popup_badge || '● BRAND DAY · TODAY ONLY';
  const title = settings.promo_popup_title || 'Power Your Daily Routine';
  const highlight = settings.promo_popup_highlight || '';
  const discount = settings.promo_popup_discount || 'UP TO 40% OFF';
  const subtext = settings.promo_popup_subtext || 'Limited quantity · T&Cs apply';
  const image = settings.promo_popup_image || 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80';
  const ctaLink = settings.promo_popup_cta_link || '/shop';

  const cardContent = (
    <div className="promo-floating-card-inner">
      {/* Text side */}
      <div className="promo-floating-body">
        {badge && (
          <span className="promo-floating-badge">{badge}</span>
        )}

        <h3 className="promo-floating-title">
          {title}{' '}
          {highlight && <span className="promo-floating-highlight">{highlight}</span>}
        </h3>

        {subtext && <p className="promo-floating-subtext">{subtext}</p>}
      </div>

      {/* Visual / Image side */}
      <div className="promo-floating-visual">
        <img
          src={image}
          alt={title}
          className="promo-floating-img"
          loading="eager"
        />
        {discount && (
          <div className="promo-floating-discount-badge" aria-label={discount}>
            <span className="discount-tag">{discount}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <aside
      className={`promo-floating-widget ${isClosing ? 'is-closing' : ''}`}
      aria-label="Promotional offer"
    >
      {/* Circular white close button */}
      <button
        type="button"
        className="promo-floating-close"
        onClick={closePopup}
        aria-label="Close promotion"
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="2" y1="2" x2="12" y2="12" />
          <line x1="12" y1="2" x2="2" y2="12" />
        </svg>
      </button>

      {/* Clickable Card navigating to offer */}
      {isExternalUrl(ctaLink) ? (
        <a
          href={ctaLink}
          className="promo-floating-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          {cardContent}
        </a>
      ) : (
        <Link to={ctaLink} className="promo-floating-link">
          {cardContent}
        </Link>
      )}
    </aside>
  );
}
