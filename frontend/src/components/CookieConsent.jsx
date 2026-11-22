import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './CookieConsent.css';

const STORAGE_KEY = 'bcgh_cookie_consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (!existing) {
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const handleReopen = () => setVisible(true);
    window.addEventListener('open-cookie-banner', handleReopen);
    return () => window.removeEventListener('open-cookie-banner', handleReopen);
  }, []);

  const handleChoice = (choice) => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
      window.dispatchEvent(
        new CustomEvent('cookie-consent-updated', { detail: { consent: choice } })
      );
    } catch {
      // safe fallback if storage is restricted
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside
      className="cookie-consent-wrapper"
      role="dialog"
      aria-label="Cookie Preferences"
      aria-describedby="cookie-consent-desc"
    >
      <div className="cookie-consent-card">
        <div className="cookie-consent-header">
          <span className="cookie-consent-icon" aria-hidden="true">🍪</span>
          <h3 className="cookie-consent-title">We value your privacy</h3>
        </div>

        <p id="cookie-consent-desc" className="cookie-consent-text">
          We use strictly necessary cookies to keep you logged in and remember your cart.
          With your permission, we also use cookies to understand site performance and tailor
          your skincare shopping experience. Learn more in our{' '}
          <Link to="/privacy-policy" className="cookie-consent-link">
            Privacy Policy
          </Link>.
        </p>

        <div className="cookie-consent-actions">
          <button
            type="button"
            className="btn btn-outline cookie-btn-essential"
            onClick={() => handleChoice('essential')}
          >
            Essential Only
          </button>
          <button
            type="button"
            className="btn btn-primary cookie-btn-accept"
            onClick={() => handleChoice('all')}
          >
            Accept All
          </button>
        </div>
      </div>
    </aside>
  );
}
