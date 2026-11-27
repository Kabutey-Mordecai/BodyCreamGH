import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import './InstallAppBanner.css';

const DISMISS_KEY = 'bc_pwa_dismissed';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstallAppBanner() {
  const { cartCount } = useCart();
  const { pathname } = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIosSheet, setShowIosSheet] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  const hasCartBar =
    cartCount > 0 &&
    !['/cart', '/checkout', '/rider-manifest', '/rider-handoff'].some((p) =>
      pathname.startsWith(p)
    );

  useEffect(() => {
    // 1. Check if already installed & running in standalone mode
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');

    setIsStandalone(standalone);
    if (standalone) return;

    // 2. Detect iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua) && !window.MSStream;
    const isSafari = /safari/.test(ua) && !/chrome|crios|fxios/.test(ua);
    setIsIos(isIosDevice);

    // 3. Check dismiss cooldown
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    const isDismissCooldown =
      dismissedAt && Date.now() - parseInt(dismissedAt, 10) < SEVEN_DAYS_MS;

    // 4. Capture Chromium beforeinstallprompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      window.__bcPwaPrompt = e;
      if (!isDismissCooldown) {
        setShowBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 5. On iOS Safari (no beforeinstallprompt event), show banner after brief delay if not dismissed
    if (isIosDevice && isSafari && !isDismissCooldown) {
      const timer = setTimeout(() => {
        setShowBanner(true);
      }, 3500);
      return () => clearTimeout(timer);
    }

    // 6. Global event listener so buttons anywhere in the app can trigger installation
    const handleTriggerInstall = () => {
      if (window.__bcPwaPrompt) {
        window.__bcPwaPrompt.prompt();
        window.__bcPwaPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            setShowBanner(false);
          }
          window.__bcPwaPrompt = null;
        });
      } else if (isIosDevice) {
        setShowIosSheet(true);
      } else {
        setShowBanner(true);
      }
    };

    window.addEventListener('bc-trigger-pwa-install', handleTriggerInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('bc-trigger-pwa-install', handleTriggerInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
      window.__bcPwaPrompt = null;
    } else if (isIos) {
      setShowIosSheet(true);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  };

  if (isStandalone) return null;

  // When customer has items in cart, completely hide the floating install banner
  // so the checkout bar is 100% visible with zero visual clutter or collision.
  const shouldRenderBanner = showBanner && !hasCartBar;

  return (
    <>
      {shouldRenderBanner && (
        <aside
          className="pwa-banner-wrap"
          aria-label="Install BodyCream GH App"
        >
          <div className="pwa-banner">
            <div className="pwa-banner-left">
              <img
                src="/icon-192.png"
                alt="BodyCream GH Logo"
                className="pwa-app-icon"
                width="44"
                height="44"
              />
              <div className="pwa-banner-text">
                <span className="pwa-app-title">BodyCream GH</span>
                <span className="pwa-app-desc">Shop faster &amp; track orders easily</span>
              </div>
            </div>

            <div className="pwa-banner-actions">
              <button
                type="button"
                className="pwa-install-btn"
                onClick={handleInstallClick}
              >
                Install App
              </button>
              <button
                type="button"
                className="pwa-dismiss-btn"
                onClick={handleDismiss}
                aria-label="Dismiss app install banner"
              >
                ×
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* iOS Safari Home Screen Guide */}
      {showIosSheet && (
        <div className="pwa-ios-overlay" onClick={() => setShowIosSheet(false)}>
          <div className="pwa-ios-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pwa-ios-sheet-header">
              <span className="pwa-ios-sheet-title">Install BodyCream GH on iPhone</span>
              <button
                type="button"
                className="pwa-dismiss-btn"
                onClick={() => setShowIosSheet(false)}
                aria-label="Close guide"
              >
                ×
              </button>
            </div>

            <ul className="pwa-ios-steps">
              <li className="pwa-ios-step">
                <span className="pwa-ios-step-num">1</span>
                <span>
                  Tap the <strong className="pwa-ios-icon-pill">Share</strong> icon at the bottom of Safari.
                </span>
              </li>
              <li className="pwa-ios-step">
                <span className="pwa-ios-step-num">2</span>
                <span>
                  Scroll down and tap <strong className="pwa-ios-icon-pill">Add to Home Screen</strong>.
                </span>
              </li>
              <li className="pwa-ios-step">
                <span className="pwa-ios-step-num">3</span>
                <span>
                  Tap <strong className="pwa-ios-icon-pill">Add</strong> in the top right corner.
                </span>
              </li>
            </ul>

            <button
              type="button"
              className="pwa-ios-done-btn"
              onClick={() => {
                setShowIosSheet(false);
                handleDismiss();
              }}
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}
