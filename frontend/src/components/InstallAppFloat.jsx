import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './InstallAppFloat.css';

export default function InstallAppFloat() {
  const { pathname } = useLocation();
  const [isStandalone, setIsStandalone] = useState(false);
  const [canInstall, setCanInstall] = useState(Boolean(typeof window !== 'undefined' && window.__bcPwaPrompt));
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

    const onPromptReady = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.__bcPwaPrompt = e;
      setCanInstall(true);
    });
    window.addEventListener('bc-pwa-ready', onPromptReady);

    if (!bubbleDismissed) {
      const timer = setTimeout(() => setBubbleDismissed(true), 9000);
      return () => clearTimeout(timer);
    }

    return () => {
      window.removeEventListener('bc-pwa-ready', onPromptReady);
    };
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

  // 1-Click native installation
  const handleInstallClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const prompt = window.__bcPwaPrompt;
    if (prompt) {
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          window.__bcPwaPrompt = null;
          setIsStandalone(true);
        }
      } catch (err) {
        console.error('Install prompt failed:', err);
      }
    } else {
      // In Chromium browsers when already prompted, inform user directly
      alert('To install BodyCream GH, tap your browser menu (⋮ or Share) and select "Install app" or "Add to Home screen".');
    }
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
        onClick={handleInstallClick}
        aria-label="Install BodyCream GH App"
        title="1-Click Install BodyCream GH App"
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
        <div className="install-float-bubble" onClick={handleInstallClick}>
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
