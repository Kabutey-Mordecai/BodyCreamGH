import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import './AnnouncementBar.css';

const SESSION_KEY = 'bar_dismissed';

export default function AnnouncementBar({ onVisibilityChange }) {
  const { announcement_enabled, announcement_text, announcement_show_whatsapp, whatsapp_number } = useSettings();
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

  const showWa = announcement_show_whatsapp !== false && announcement_show_whatsapp !== 'false';
  const rawWa = showWa ? String(whatsapp_number || '').replace(/\D/g, '') : '';
  const waHref = rawWa
    ? `https://wa.me/${rawWa.length === 10 && rawWa.startsWith('0') ? `233${rawWa.slice(1)}` : rawWa}`
    : '';

  return (
    <div className="announcement-bar" role="banner">
      <div className="announcement-bar-inner">
        <div className="announcement-dots" />

        <p className={`announcement-msg ${fading ? 'fade-out' : 'fade-in'}`}>
          {announcement_text || 'Free delivery on orders over GHS 200 · Shop now'}
          {waHref && (
            <>
              {' · '}
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="announcement-wa-link"
              >
                Order on WhatsApp: {whatsapp_number}
              </a>
            </>
          )}
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
