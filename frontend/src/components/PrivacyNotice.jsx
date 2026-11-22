import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './PrivacyNotice.css';

const STORAGE_KEY = 'bcgh_privacy_preference';

export default function PrivacyNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (!existing) {
        const timer = setTimeout(() => setVisible(true), 600);
        return () => clearTimeout(timer);
      }
    } catch {
      setVisible(true);
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
      className="privacy-notice-wrapper"
      role="dialog"
      aria-label="Privacy & Cookie Preferences"
      aria-describedby="privacy-notice-desc"
    >
      <div className="privacy-notice-card">
        <div className="privacy-notice-header">
          <span className="privacy-notice-icon" aria-hidden="true">🍪</span>
          <h3 className="privacy-notice-title">We value your privacy</h3>
        </div>

        <p id="privacy-notice-desc" className="privacy-notice-text">
          We use strictly necessary cookies to keep you logged in and remember your cart.
          With your permission, we also use cookies to understand site performance and tailor
          your skincare shopping experience. Learn more in our{' '}
          <Link to="/privacy-policy" className="privacy-notice-link">
            Privacy Policy
          </Link>.
        </p>

        <div className="privacy-notice-actions">
          <button
            type="button"
            className="btn btn-outline privacy-btn-essential"
            onClick={() => handleChoice('essential')}
          >
            Essential Only
          </button>
          <button
            type="button"
            className="btn btn-primary privacy-btn-accept"
            onClick={() => handleChoice('all')}
          >
            Accept All
          </button>
        </div>
      </div>
    </aside>
  );
}
