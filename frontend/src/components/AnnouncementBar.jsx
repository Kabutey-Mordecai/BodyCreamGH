import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import './AnnouncementBar.css';

const SESSION_KEY = 'bar_dismissed';

export default function AnnouncementBar({ onVisibilityChange }) {
  const { announcement_enabled, announcement_text } = useSettings();
  const [dismissed, setDismissed] = useState(() => !!sessionStorage.getItem(SESSION_KEY));
  const [fading, setFading] = useState(false);

  const visible = !dismissed && announcement_enabled;

  useEffect(() => {
    document.body.classList.toggle('no-bar', !visible);
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  // Single rotating message from settings — no multi-message cycling needed
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
          {announcement_text || 'Free delivery on orders over GHS 200 · Shop now'}
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
