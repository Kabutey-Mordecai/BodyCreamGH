import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './InstallAppFloat.css';

export default function InstallAppFloat() {
  const { pathname } = useLocation();
  const [isStandalone, setIsStandalone] = useState(false);
  const [bubbleDismissed, setBubbleDismissed] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return true;
    }
    try {
      return sessionStorage.getItem('pwa_float_bubble_dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');

    setIsStandalone(standalone);

    if (!bubbleDismissed) {
      const timer = setTimeout(() => setBubbleDismissed(true), 9000);
      return () => clearTimeout(timer);
    }
  }, [bubbleDismissed]);

  // Hide in standalone mode (already installed)
  if (isStandalone) return null;

  // Hide on clean focused checkout / auth routes
  if (
    pathname === '/checkout' ||
    pathname === '/cart' ||
    pathname.startsWith('/payment') ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname.startsWith('/rider-')
  ) {
    return null;
  }

  const handleTrigger = () => {
    window.dispatchEvent(new CustomEvent('bc-trigger-pwa-install'));
  };

  const dismissBubble = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBubbleDismissed(true);
    try {
      sessionStorage.setItem('pwa_float_bubble_dismissed', '1');
    } catch {
      // Ignore
    }
  };

  return (
    <div className="install-float-wrap">
      <button
        type="button"
        className="install-float-btn"
        onClick={handleTrigger}
        aria-label="Install BodyCream GH App"
        title="Install BodyCream GH App"
      >
        <div className="install-float-icon-inner">
          <img
            src="/icon-192.png"
            alt="BodyCream GH Logo"
            className="install-float-img"
            width="32"
            height="32"
          />
        </div>
        <span className="install-float-badge">APP</span>
      </button>

      {!bubbleDismissed && (
        <div className="install-float-bubble" onClick={handleTrigger}>
          <button
            type="button"
            className="install-float-bubble-close"
            onClick={dismissBubble}
            aria-label="Close tooltip"
          >
            ×
          </button>
          <span>📲 Install App</span>
        </div>
      )}
    </div>
  );
}
