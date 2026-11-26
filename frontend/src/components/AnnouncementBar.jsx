import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './AnnouncementBar.css';

const SESSION_KEY = 'bar_dismissed';

export default function AnnouncementBar({ onVisibilityChange }) {
  const { announcement_enabled, announcement_text } = useSettings();
  const [dismissed, setDismissed] = useState(() => !!sessionStorage.getItem(SESSION_KEY));
  const [fading] = useState(false);

  const visible = !dismissed && announcement_enabled;

  useEffect(() => {
    document.body.classList.toggle('no-bar', !visible);
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(SESSION_KEY, '1');
  };

  if (!visible) return null;

  return (
    <div className="announcement-bar" role="banner">
      <div className="announcement-bar-inner">
        <div className="announcement-dots" />

        <p className={`announcement-msg ${fading ? 'fade-out' : 'fade-in'}`}>
          <Link to="/shop" style={{ color: 'inherit', textDecoration: 'none' }}>
            {announcement_text || 'Free delivery on orders over GHS 200 · Shop now →'}
          </Link>
        </p>

        <button
          className="announcement-close"
          onClick={dismiss}
          aria-label="Dismiss announcement"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
