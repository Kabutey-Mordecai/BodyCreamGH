import { useState, useEffect, useRef } from 'react';
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
  const closeBtnRef = useRef(null);
  const cardRef = useRef(null);
  const previousActiveElement = useRef(null);

  const isEnabled = settings.promo_popup_enabled === true || settings.promo_popup_enabled === 'true';

  useEffect(() => {
    if (!isEnabled) return;

    // Check if dismissed in this session
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') {
        return;
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }

    const delaySec = Number(settings.promo_popup_delay_sec) || 2;
    const timer = setTimeout(() => {
      previousActiveElement.current = document.activeElement;
      setIsOpen(true);
    }, Math.max(500, delaySec * 1000));

    return () => clearTimeout(timer);
  }, [isEnabled, settings.promo_popup_delay_sec]);

  // Focus close button on open
  useEffect(() => {
    if (isOpen && closeBtnRef.current) {
      closeBtnRef.current.focus();
    }
  }, [isOpen]);

  // Handle escape key & tab focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopup();
        return;
      }

      if (e.key === 'Tab' && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isClosing]);

  const closePopup = () => {
    if (isClosing) return;
    setIsClosing(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Ignore
    }
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    }, 280);
  };

  if (!isEnabled || !isOpen) return null;

  const badge = settings.promo_popup_badge || '● BRAND DAY · TODAY ONLY';
  const title = settings.promo_popup_title || 'Pure Shea Radiance.';
  const highlight = settings.promo_popup_highlight || 'Slashed Prices';
  const discount = settings.promo_popup_discount || 'UP TO 50% OFF';
  const subtext = settings.promo_popup_subtext || 'Limited quantity · Handcrafted in Ghana · T&Cs apply';
  const image = settings.promo_popup_image || 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80';
  const ctaText = settings.promo_popup_cta_text || 'Claim Your Glow';
  const ctaLink = settings.promo_popup_cta_link || '/shop';

  return (
    <div
      className={`promo-popup-backdrop ${isClosing ? 'is-closing' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) closePopup();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Promotional offer"
    >
      <div
        ref={cardRef}
        className={`promo-popup-card ${isClosing ? 'is-closing' : ''}`}
      >
        {/* Dismiss Button */}
        <button
          ref={closeBtnRef}
          type="button"
          className="promo-popup-close"
          onClick={closePopup}
          aria-label="Close promotional popup"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="2" y1="2" x2="12" y2="12" />
            <line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>

        {/* Content Side */}
        <div className="promo-popup-body">
          {badge && (
            <div className="promo-popup-badge-wrap">
              <span className="promo-popup-badge">{badge}</span>
            </div>
          )}

          <h2 className="promo-popup-headline">
            {title}{' '}
            {highlight && <span className="promo-popup-highlight">{highlight}</span>}
          </h2>

          {subtext && <p className="promo-popup-subtext">{subtext}</p>}

          <div className="promo-popup-actions">
            {isExternalUrl(ctaLink) ? (
              <a
                href={ctaLink}
                className="btn btn-accent promo-popup-cta"
                onClick={closePopup}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ctaText} →
              </a>
            ) : (
              <Link
                to={ctaLink}
                className="btn btn-accent promo-popup-cta"
                onClick={closePopup}
              >
                {ctaText} →
              </Link>
            )}
          </div>
        </div>

        {/* Visual / Image Side */}
        <div className="promo-popup-visual">
          <img
            src={image}
            alt="Featured promotional offer"
            className="promo-popup-img"
            loading="eager"
          />
          {discount && (
            <div className="promo-popup-discount-badge" aria-label={discount}>
              <span className="discount-tag">{discount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
