import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './InstallAppModal.css';

const DISMISS_KEY = 'bc_install_modal_dismissed';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstallAppModal() {
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    // 1. Check if running in standalone mode (already installed)
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');

    setIsStandalone(standalone);
    if (standalone) return;

    // 2. Detect iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua) && !window.MSStream;
    setIsIos(isIosDevice);

    // 3. Capture Chromium beforeinstallprompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      window.__bcPwaPrompt = e;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 4. Auto-trigger modal after 8 seconds of browsing if not on sensitive routes & not on cooldown
    const isCheckoutOrPayment = ['/checkout', '/payment'].some((p) =>
      pathname.startsWith(p)
    );

    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    const isDismissCooldown =
      dismissedAt && Date.now() - parseInt(dismissedAt, 10) < SEVEN_DAYS_MS;

    let timer;
    if (!isDismissCooldown && !isCheckoutOrPayment) {
      timer = setTimeout(() => {
        setIsOpen(true);
      }, 8000);
    }

    // 5. Global listener so buttons in the Account Dropdown / Footer trigger this exact modal!
    const handleManualTrigger = () => {
      setIsOpen(true);
      if (isIosDevice) {
        setShowIosSteps(true);
      }
    };

    window.addEventListener('bc-trigger-pwa-install', handleManualTrigger);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('bc-trigger-pwa-install', handleManualTrigger);
    };
  }, [pathname]);

  const handleInstallClick = async () => {
    const prompt = deferredPrompt || window.__bcPwaPrompt;
    if (prompt) {
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsOpen(false);
      }
      setDeferredPrompt(null);
      window.__bcPwaPrompt = null;
    } else if (isIos) {
      setShowIosSteps(true);
    } else {
      // In desktop Chrome or unsupported browsers without saved prompt
      setShowIosSteps(true);
    }
  };

  const handleDismiss = () => {
    setIsOpen(false);
    setShowIosSteps(false);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  };

  if (isStandalone || !isOpen) return null;

  return (
    <div className="install-modal-overlay" onClick={handleDismiss}>
      <div
        className="install-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-modal-title"
      >
        <button
          type="button"
          className="install-modal-close"
          onClick={handleDismiss}
          aria-label="Close install popup"
        >
          ×
        </button>

        <div className="install-badge-pill">
          <span>✨ 100% Authentic Beauty</span>
        </div>

        <div className="install-icon-wrap">
          <img
            src="/icon-192.png"
            alt="BodyCream GH Logo"
            className="install-app-icon"
            width="72"
            height="72"
          />
          <span className="install-icon-badge">✓</span>
        </div>

        <h3 id="install-modal-title" className="install-modal-title">
          Install BodyCream GH App
        </h3>

        <p className="install-modal-subtext">
          Add our official web app to your home screen for the fastest shopping experience in Ghana.
        </p>

        {!showIosSteps ? (
          <>
            <div className="install-perks-list">
              <div className="install-perk-item">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <span><strong>Instant Loading:</strong> Browse even on slow mobile data</span>
              </div>
              <div className="install-perk-item">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span><strong>Live OTP Verification:</strong> Doorstep delivery code security</span>
              </div>
              <div className="install-perk-item">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <span><strong>1-Tap Checkout:</strong> Quick MoMo &amp; card payments</span>
              </div>
            </div>

            <div className="install-actions">
              <button
                type="button"
                className="install-primary-btn"
                onClick={handleInstallClick}
              >
                📲 Install App (Free)
              </button>
              <button
                type="button"
                className="install-secondary-btn"
                onClick={handleDismiss}
              >
                Continue in Browser
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="install-ios-steps">
              <li className="install-ios-step">
                <span className="install-ios-step-num">1</span>
                <span>
                  Tap the <span className="install-ios-pill">Share</span> icon at the bottom of your browser.
                </span>
              </li>
              <li className="install-ios-step">
                <span className="install-ios-step-num">2</span>
                <span>
                  Scroll down and tap <span className="install-ios-pill">Add to Home Screen</span>.
                </span>
              </li>
              <li className="install-ios-step">
                <span className="install-ios-step-num">3</span>
                <span>
                  Tap <span className="install-ios-pill">Add</span> in the top right corner.
                </span>
              </li>
            </ul>

            <div className="install-actions">
              <button
                type="button"
                className="install-primary-btn"
                onClick={handleDismiss}
              >
                Got It, Thank You!
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
