import { useEffect, useRef } from 'react';

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
const SCRIPT_ID = 'cf-turnstile-script';

/**
 * Renders a Cloudflare Turnstile widget when VITE_TURNSTILE_SITE_KEY is configured.
 * Renders nothing if unconfigured so local/dev environments work seamlessly.
 */
export default function TurnstileWidget({ onToken, onExpire, resetKey = 0 }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!SITE_KEY) return undefined;

    let cancelled = false;
    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current !== null) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
        widgetIdRef.current = null;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => onToken?.(token),
        'expired-callback': () => onExpire?.(),
        'error-callback': () => onExpire?.(),
        theme: 'light',
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      let script = document.getElementById(SCRIPT_ID);
      if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderWidget);
      return () => {
        cancelled = true;
        script.removeEventListener('load', renderWidget);
        if (widgetIdRef.current !== null && window.turnstile) {
          try { window.turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
          widgetIdRef.current = null;
        }
      };
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
        widgetIdRef.current = null;
      }
    };
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!SITE_KEY) return null;
  return <div ref={containerRef} style={{ margin: '12px 0' }} />;
}
