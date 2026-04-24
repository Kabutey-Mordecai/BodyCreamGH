import { useState, useEffect } from 'react';
import './AnnouncementBar.css';

// TO CUSTOMIZE: Edit these messages for your current promotions
const MESSAGES = [
  '🚚  Free delivery on orders over GHS 200',
  '🌿  Handcrafted in Ghana with 100% natural ingredients',
  '✨  New arrivals every week — Shop the latest',
  '↩  7-day hassle-free returns on all orders',
];

const SESSION_KEY = 'bar_dismissed';

export default function AnnouncementBar({ onVisibilityChange }) {
  const [visible, setVisible]   = useState(() => !sessionStorage.getItem(SESSION_KEY));
  const [current, setCurrent]   = useState(0);
  const [fading, setFading]     = useState(false);

  // Cycle through messages every 4 seconds with a brief fade
  useEffect(() => {
    if (!visible || MESSAGES.length <= 1) return;

    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setCurrent(i => (i + 1) % MESSAGES.length);
        setFading(false);
      }, 350);
    }, 4000);

    return () => clearInterval(interval);
  }, [visible]);

  // Keep body class + notify parent in sync with bar visibility
  useEffect(() => {
    document.body.classList.toggle('no-bar', !visible);
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(SESSION_KEY, '1');
  };

  if (!visible) return null;

  return (
    <div className="announcement-bar" role="banner">
      <div className="announcement-bar-inner">
        {/* Dot indicators */}
        <div className="announcement-dots">
          {MESSAGES.map((_, i) => (
            <button
              key={i}
              className={`announcement-dot ${i === current ? 'active' : ''}`}
              onClick={() => setCurrent(i)}
              aria-label={`Message ${i + 1}`}
            />
          ))}
        </div>

        {/* Message */}
        <p className={`announcement-msg ${fading ? 'fade-out' : 'fade-in'}`}>
          {MESSAGES[current]}
        </p>

        {/* Dismiss */}
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
