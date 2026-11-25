import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import './RiderPortal.css';

const SAVED_SESSION_KEY = 'bc_rider_manifest_session';
const ACTIVE_MANIFEST_SS_KEY = 'bc_rider_active_manifest';
export const HANDOFF_SESSION_SS_KEY = 'bc_rider_handoff_session';

function formatPhoneForWa(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/**
 * Extracts a signed rider token (and target route) from a pasted WhatsApp message,
 * full URL, or raw JWT string.
 */
export function parseRiderDispatchInput(rawInput) {
  const text = String(rawInput || '').trim();
  if (!text) return null;

  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  const candidate = urlMatch ? urlMatch[0] : text;

  try {
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      const parsed = new URL(candidate);
      const tok = parsed.searchParams.get('token');
      const manifest = parsed.searchParams.get('manifest');
      if (tok) {
        const isHandoff = parsed.pathname.includes('rider-handoff');
        return {
          route: isHandoff ? '/rider-handoff' : '/rider-manifest',
          token: tok,
          manifestToken: manifest || '',
        };
      }
    }
  } catch {
    // Fall through to query/JWT extraction
  }

  const tokenParam = text.match(/[?&]token=([^&\s]+)/i);
  if (tokenParam?.[1]) {
    const isHandoff = text.includes('rider-handoff');
    return {
      route: isHandoff ? '/rider-handoff' : '/rider-manifest',
      token: decodeURIComponent(tokenParam[1]),
      manifestToken: '',
    };
  }

  // Raw JWT (3 base64url segments)
  const jwtMatch = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch?.[0]) {
    return { route: '/rider-manifest', token: jwtMatch[0], manifestToken: '' };
  }

  return null;
}

function readSavedManifestSession() {
  try {
    const raw = localStorage.getItem(SAVED_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function RiderManifest() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const urlToken = searchParams.get('token') || '';

  const [token, setToken] = useState(() => {
    if (urlToken) return urlToken;
    try {
      return sessionStorage.getItem(ACTIVE_MANIFEST_SS_KEY) || '';
    } catch {
      return '';
    }
  });

  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(() => Boolean(urlToken || token));
  const [syncing, setSyncing]         = useState(false);
  const [error, setError]             = useState('');
  const [errorKind, setErrorKind]     = useState(''); // 'auth' | 'network' | ''
  const [isOnline, setIsOnline]       = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  const [pasteValue, setPasteValue]   = useState('');
  const [pasteError, setPasteError]   = useState('');
  const [savedSession, setSavedSession] = useState(() => readSavedManifestSession());

  const [search, setSearch]           = useState('');
  const [zoneFilter, setZoneFilter]   = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [resendingId, setResendingId] = useState(null);
  const [otpToast, setOtpToast]       = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const supportPhone = settings?.contact_phone || settings?.whatsapp_number || '';
  const supportWa = formatPhoneForWa(settings?.whatsapp_number || settings?.contact_phone || '');

  // Enforce strict no-referrer while on Rider Console & scrub signed JWT from browser URL bar
  useEffect(() => {
    const meta = document.querySelector('meta[name="referrer"]');
    const prevContent = meta?.getAttribute('content') || 'strict-origin-when-cross-origin';
    if (meta) meta.setAttribute('content', 'no-referrer');
    return () => {
      if (meta) meta.setAttribute('content', prevContent);
    };
  }, []);

  useEffect(() => {
    if (urlToken) {
      setToken(urlToken);
      try {
        sessionStorage.setItem(ACTIVE_MANIFEST_SS_KEY, urlToken);
      } catch {}
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState({}, '', '/rider-manifest');
      }
    }
  }, [urlToken]);

  const handleSignOutRoute = useCallback(() => {
    try {
      localStorage.removeItem(SAVED_SESSION_KEY);
      sessionStorage.removeItem(ACTIVE_MANIFEST_SS_KEY);
      sessionStorage.removeItem(HANDOFF_SESSION_SS_KEY);
    } catch {}
    setSavedSession(null);
    setToken('');
    setData(null);
    setError('');
    setErrorKind('');
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', '/rider-manifest');
    }
  }, []);

  const loadManifest = useCallback(async (isRefresh = false) => {
    if (!token) {
      setData(null);
      setError('');
      setErrorKind('');
      setLoading(false);
      return;
    }
    if (isRefresh) setSyncing(true);
    else setLoading(true);
    setError('');
    setErrorKind('');
    try {
      const { data: res } = await deliveriesAPI.getRiderManifest(token);
      setData(res);
      setLastSyncedAt(new Date());
      try {
        sessionStorage.setItem(ACTIVE_MANIFEST_SS_KEY, token);
        const nextSaved = {
          token,
          rider_label: res.rider_label || 'Active Dispatch Route',
          saved_at: new Date().toISOString(),
        };
        localStorage.setItem(SAVED_SESSION_KEY, JSON.stringify(nextSaved));
        setSavedSession(nextSaved);
      } catch {
        // ignore storage quota errors
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        setErrorKind('auth');
        setError(
          err.response?.data?.error ||
          'This dispatch route link has expired or been revoked. Request a fresh link from Dispatch or paste your newest WhatsApp link below.'
        );
        try {
          sessionStorage.removeItem(ACTIVE_MANIFEST_SS_KEY);
          if (savedSession?.token === token) {
            localStorage.removeItem(SAVED_SESSION_KEY);
            setSavedSession(null);
          }
        } catch {}
      } else {
        setErrorKind('network');
        setError(err.response?.data?.error || 'Could not reach dispatch server. Check your mobile data connection and tap Retry.');
      }
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [token, savedSession?.token]);

  useEffect(() => {
    loadManifest(false);
  }, [loadManifest]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      if (token) loadManifest(true);
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [token, loadManifest]);

  const handleOpenPastedLink = (e) => {
    e?.preventDefault?.();
    setPasteError('');
    const parsed = parseRiderDispatchInput(pasteValue);
    if (!parsed) {
      setPasteError('Paste the full WhatsApp dispatch message or link sent by BodyCream GH.');
      return;
    }
    setPasteValue('');
    if (parsed.route === '/rider-handoff') {
      try {
        sessionStorage.setItem(HANDOFF_SESSION_SS_KEY, JSON.stringify({
          token: parsed.token,
          manifestToken: parsed.manifestToken || token || '',
        }));
      } catch {}
      navigate('/rider-handoff');
    } else {
      try {
        sessionStorage.setItem(ACTIVE_MANIFEST_SS_KEY, parsed.token);
      } catch {}
      setToken(parsed.token);
    }
  };

  const handleClipboardPaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) {
        setPasteValue(clip);
        setPasteError('');
      }
    } catch {
      setPasteError('Long-press inside the box below to paste your WhatsApp link.');
    }
  };

  const zones = useMemo(() => {
    if (!data?.stops) return [];
    return Array.from(new Set(data.stops.map(s => s.zone_code).filter(Boolean))).sort();
  }, [data]);

  const filteredStops = useMemo(() => {
    if (!data?.stops) return [];
    const q = search.trim().toLowerCase();
    return data.stops.filter(s => {
      if (zoneFilter !== 'ALL' && s.zone_code !== zoneFilter) return false;
      if (statusFilter === 'pending' && s.verified) return false;
      if (statusFilter === 'done' && !s.verified) return false;
      if (q) {
        const hay = [
          s.order_number,
          s.tracking_number,
          s.customer_name,
          s.customer_phone,
          s.address,
          s.ghana_post_gps,
          s.delivery_landmark,
          s.zone_code,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, zoneFilter, statusFilter, search]);

  const handleResendOtp = async (stop) => {
    setResendingId(stop.delivery_id);
    setOtpToast('');
    try {
      await deliveriesAPI.riderResendOtp({
        token,
        delivery_id: stop.delivery_id,
      });
      setOtpToast(`✓ Fresh 6-digit delivery code sent to ${stop.customer_name} for #${stop.order_number}`);
      setData(prev => prev ? {
        ...prev,
        stops: prev.stops.map(s => s.delivery_id === stop.delivery_id ? { ...s, has_otp: true } : s),
      } : prev);
    } catch (err) {
      setOtpToast(err.response?.data?.error || 'Failed to resend delivery code.');
    } finally {
      setResendingId(null);
    }
  };

  // ── 1. Loading State ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge" aria-hidden="true">BC</div>
              <div>
                <div className="rp-eyebrow">BodyCream GH · Logistics</div>
                <h1 className="rp-rider-title">Syncing Route Console…</h1>
              </div>
            </div>
          </div>
        </header>
        <div className="rp-container">
          <div className="rp-step-card" style={{ textAlign: 'center', padding: '44px 20px', color: '#475569' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Loading Assigned Stops &amp; COD Ledger…</div>
            <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Verifying signed route credentials</div>
          </div>
        </div>
      </div>
    );
  }

  // ── 2. Rider Dispatch Portal (No Token OR Expired/Network Recovery) ───────
  if (!token || error || !data) {
    const canResumeSaved = savedSession?.token && savedSession.token !== token;

    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge" aria-hidden="true">BC</div>
              <div>
                <div className="rp-eyebrow">BodyCream GH · Logistics</div>
                <h1 className="rp-rider-title">Rider Dispatch Console</h1>
              </div>
            </div>
            <Link to="/track" className="rp-sync-btn">
              Parcel Tracker
            </Link>
          </div>
          {!isOnline && (
            <div className="rp-offline-bar">
              Offline — turn on mobile data to load your route manifest
            </div>
          )}
        </header>

        <div className="rp-container">
          {/* Contextual Error / Network Recovery Banner (only when ?token= was attempted) */}
          {token && error && (
            <div className={`rp-alert-banner ${errorKind === 'network' ? 'rp-alert-banner--warn' : 'rp-alert-banner--err'}`} role="alert">
              <div>
                <strong style={{ display: 'block', fontSize: '0.95rem', marginBottom: 3 }}>
                  {errorKind === 'network' ? 'Connection Interrupted' : 'Route Link Expired or Replaced'}
                </strong>
                <span style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>{error}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="rp-act-btn" onClick={() => loadManifest(false)}>
                  ↻ Retry Connection
                </button>
                {supportWa && (
                  <a
                    href={`https://wa.me/${supportWa}?text=${encodeURIComponent('Hello Dispatch, please send me a fresh Rider Route Manifest link.')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rp-act-btn rp-act-btn--wa"
                  >
                    💬 Request Fresh Link on WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Portal Hero */}
          <section className="rp-portal-hero">
            <div className="rp-portal-status-pill">
              <span>●</span>
              <span>Accra &amp; Nationwide Last-Mile Operations</span>
            </div>
            <h2>Mobile Route &amp; Proof-of-Delivery Terminal</h2>
            <p>
              Open the signed WhatsApp route link from BodyCream GH Dispatch, or paste your dispatch message below to view stops, Google Maps &amp; GhanaPostGPS pins, COD amounts, and 6-digit OTP handoff.
            </p>
          </section>

          {/* 1-Tap Resume Saved Route (for home-screen bookmarks!) */}
          {canResumeSaved && (
            <div className="rp-resume-card">
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#047857' }}>
                  Saved Route on This Phone
                </div>
                <div style={{ fontSize: '0.98rem', fontWeight: 800, color: '#064e3b', marginTop: 2 }}>
                  {savedSession.rider_label}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="rp-primary-cta"
                  style={{ width: 'auto', minHeight: 42, padding: '8px 16px' }}
                  onClick={() => {
                    try { sessionStorage.setItem(ACTIVE_MANIFEST_SS_KEY, savedSession.token); } catch {}
                    setToken(savedSession.token);
                  }}
                >
                  Resume Route →
                </button>
                <button
                  type="button"
                  className="rp-act-btn"
                  style={{ minHeight: 42 }}
                  onClick={handleSignOutRoute}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Paste WhatsApp Dispatch Link / Token Card */}
          <section className="rp-step-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Open Route From WhatsApp Link</h3>
              {typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
                <button type="button" className="rp-zone-chip" onClick={handleClipboardPaste}>
                  📋 Paste Clipboard
                </button>
              )}
            </div>
            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>
              Paste the WhatsApp dispatch message or signed route URL sent by your coordinator:
            </p>

            <form onSubmit={handleOpenPastedLink} className="rp-link-input-row">
              <input
                type="text"
                className="rp-text-input"
                style={{ flex: 1 }}
                placeholder="Paste https://.../rider-manifest?token=... or WhatsApp text"
                value={pasteValue}
                onChange={e => { setPasteValue(e.target.value); setPasteError(''); }}
                aria-label="WhatsApp dispatch link or token"
              />
              <button
                type="submit"
                className="rp-primary-cta rp-primary-cta--gold"
                style={{ width: 'auto', minWidth: 175 }}
              >
                Open Route Console →
              </button>
            </form>

            {pasteError && (
              <div style={{ marginTop: 8, fontSize: '0.8rem', fontWeight: 700, color: '#b91c1c' }}>
                {pasteError}
              </div>
            )}

            {(supportWa || supportPhone) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                {supportWa && (
                  <a
                    href={`https://wa.me/${supportWa}?text=${encodeURIComponent('Hello BodyCream GH Dispatch, please share my active Rider Manifest link.')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rp-act-btn rp-act-btn--wa"
                    style={{ flex: 1 }}
                  >
                    💬 WhatsApp Dispatch Hub
                  </a>
                )}
                {supportPhone && (
                  <a href={`tel:${supportPhone}`} className="rp-act-btn" style={{ flex: 1 }}>
                    📞 Call Dispatch ({supportPhone})
                  </a>
                )}
              </div>
            )}
          </section>

          {/* 3-Step Rider Workflow Guide */}
          <div className="rp-how-grid" aria-label="How Rider Dispatch works">
            <div className="rp-how-card">
              <span className="rp-how-step">Step 01</span>
              <div className="rp-how-title">Open Signed Route</div>
              <p className="rp-how-desc">
                Tap your WhatsApp link from Dispatch to view all stops sorted by zone (<strong>ACC</strong>, <strong>KSI</strong>, <strong>TAK</strong>) with zero password login.
              </p>
            </div>
            <div className="rp-how-card">
              <span className="rp-how-step">Step 02</span>
              <div className="rp-how-title">Navigate &amp; Collect COD</div>
              <p className="rp-how-desc">
                Launch Google Maps or check GhanaPostGPS &amp; landmarks. Collect exact Cash or Mobile Money on COD orders before handoff.
              </p>
            </div>
            <div className="rp-how-card">
              <span className="rp-how-step">Step 03</span>
              <div className="rp-how-title">6-Digit OTP + Photo</div>
              <p className="rp-how-desc">
                Enter the customer&apos;s 6-digit Delivery Code and snap a doorstep parcel photo to issue an instant verified receipt.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 3. Active Authenticated Route Manifest ────────────────────────────────
  const { summary } = data;
  const pctDone = summary.total_stops > 0
    ? Math.round((summary.completed_stops / summary.total_stops) * 100)
    : 0;
  const firstPendingId = filteredStops.find(s => !s.verified)?.delivery_id;

  return (
    <div className="rp-shell">
      {/* ── Sticky Logistics Driver Topbar ──────────────────────────── */}
      <header className="rp-topbar">
        <div className="rp-topbar-inner">
          <div className="rp-brand-group">
            <div className="rp-brand-badge" aria-hidden="true">BC</div>
            <div style={{ minWidth: 0 }}>
              <div className="rp-eyebrow">BodyCream GH · Dispatch Console</div>
              <h1 className="rp-rider-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{data.rider_label}</span>
                {data.vehicle_plate && (
                  <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.2)', color: '#fbbf24', fontFamily: 'monospace' }}>
                    {data.vehicle_plate}
                  </span>
                )}
              </h1>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="rp-sync-btn"
              onClick={() => loadManifest(true)}
              disabled={syncing}
            >
              <span>{syncing ? 'Syncing…' : '↻ Sync'}</span>
            </button>
            <button
              type="button"
              className="rp-sync-btn"
              onClick={handleSignOutRoute}
              title="Close route and clear saved token from this phone"
              aria-label="Exit route"
              style={{ padding: '0 10px', opacity: 0.85 }}
            >
              Exit
            </button>
          </div>
        </div>
        {!isOnline && (
          <div className="rp-offline-bar">
            Offline — reconnect mobile data before verifying doorstep OTP
          </div>
        )}
      </header>

      <div className="rp-container">
        {/* ── Route Progress & COD Cash Reconciliation Hero ─────────── */}
        <section className="rp-hero-card" aria-label="Route summary and cash tally">
          <div className="rp-progress-head">
            <span className="rp-progress-title">
              Today&apos;s Route · {summary.completed_stops} of {summary.total_stops} delivered
            </span>
            <span className="rp-progress-pct">{pctDone}%</span>
          </div>
          <div className="rp-progress-track" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100}>
            <div className="rp-progress-fill" style={{ width: `${pctDone}%` }} />
          </div>

          <div className="rp-kpi-grid">
            <div className="rp-kpi-box">
              <div className="rp-kpi-label">Remaining Stops</div>
              <div className="rp-kpi-val">{summary.pending_stops}</div>
              <div className="rp-kpi-sub">{summary.completed_stops} completed today</div>
            </div>

            <div className="rp-kpi-box">
              <div className="rp-kpi-label">COD To Collect</div>
              <div className={`rp-kpi-val ${summary.cod_pending_ghs > 0 ? 'rp-kpi-val--amber' : ''}`} style={{ whiteSpace: 'nowrap' }}>
                GHS {Number(summary.cod_pending_ghs || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="rp-kpi-sub">Cash or Mobile Money</div>
            </div>

            <div className="rp-kpi-box rp-kpi-box--wide">
              <div className="rp-kpi-label">COD Collected Today</div>
              <div className="rp-kpi-val rp-kpi-val--emerald" style={{ whiteSpace: 'nowrap' }}>
                GHS {Number(summary.cod_collected_ghs || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="rp-kpi-sub">
                {lastSyncedAt
                  ? `Synced ${lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Verified handoffs'}
              </div>
            </div>
          </div>
        </section>

        {/* ── Search, Segmented Tabs & Zone Chips ───────────────────── */}
        <section className="rp-controls-card" aria-label="Filter route stops">
          <div className="rp-search-wrap">
            <svg className="rp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="rp-search-input"
              placeholder="Search customer, order #, GPS, landmark, address…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="rp-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                ✕
              </button>
            )}
          </div>

          <div className="rp-seg-tabs" role="tablist">
            {[
              { key: 'pending', label: `To Deliver (${summary.pending_stops})` },
              { key: 'done',    label: `Completed (${summary.completed_stops})` },
              { key: 'all',     label: `All (${summary.total_stops})` },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab.key}
                className={`rp-seg-tab${statusFilter === tab.key ? ' is-active' : ''}`}
                onClick={() => setStatusFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {zones.length > 1 && (
            <div className="rp-zone-row" role="group" aria-label="Filter by zone">
              <button
                type="button"
                className={`rp-zone-chip${zoneFilter === 'ALL' ? ' is-active' : ''}`}
                onClick={() => setZoneFilter('ALL')}
              >
                All Zones
              </button>
              {zones.map(z => (
                <button
                  key={z}
                  type="button"
                  className={`rp-zone-chip${zoneFilter === z ? ' is-active' : ''}`}
                  onClick={() => setZoneFilter(z)}
                >
                  Zone {z}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Toast Notification Banner ─────────────────────────────── */}
        {otpToast && (
          <div
            role="status"
            style={{
              background: otpToast.startsWith('✓') ? '#ecfdf5' : '#fef2f2',
              border: `1.5px solid ${otpToast.startsWith('✓') ? '#10b981' : '#ef4444'}`,
              color: otpToast.startsWith('✓') ? '#065f46' : '#991b1b',
              padding: '12px 14px',
              borderRadius: 12,
              fontSize: '0.84rem',
              fontWeight: 700,
              marginBottom: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>{otpToast}</span>
            <button
              type="button"
              onClick={() => setOtpToast('')}
              style={{ background: 'none', border: 'none', fontWeight: 800, color: 'inherit', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Stops List ────────────────────────────────────────────── */}
        {filteredStops.length === 0 ? (
          <div className="rp-step-card" style={{ textAlign: 'center', padding: '42px 20px' }}>
            <h3 style={{ fontSize: '1.08rem', fontWeight: 800, marginBottom: 6 }}>
              {statusFilter === 'pending' && summary.total_stops > 0 && !search
                ? 'All Assigned Stops Delivered!'
                : 'No Stops Match This Filter'}
            </h3>
            <p style={{ fontSize: '0.86rem', color: '#64748b', margin: 0 }}>
              {statusFilter === 'pending' && summary.completed_stops > 0 && !search
                ? 'Switch to the "Completed" tab above to review your verified deliveries and COD cash tally.'
                : 'Try clearing your search text or switching status/zone filters.'}
            </p>
          </div>
        ) : (
          <div className="rp-stops-list">
            {filteredStops.map((stop, idx) => {
              const isNext = stop.delivery_id === firstPendingId;
              const waNumber = formatPhoneForWa(stop.customer_phone);
              const waText = encodeURIComponent(
                `Hello ${stop.customer_name}, I am your BodyCream GH dispatch rider on the way with Order #${stop.order_number} (${stop.tracking_number}). Please have your 6-digit delivery code ready.`
              );
              const navTarget = stop.ghana_post_gps
                ? `${stop.address || ''} ${stop.ghana_post_gps}`.trim()
                : stop.address;
              const mapsQuery = navTarget
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(navTarget)}`
                : null;
              const cardMod = stop.verified
                ? 'rp-stop-card--done'
                : stop.cod_amount_due > 0
                  ? 'rp-stop-card--cod'
                  : 'rp-stop-card--prepaid';

              return (
                <article
                  key={stop.delivery_id}
                  className={`rp-stop-card ${cardMod}${isNext ? ' rp-stop-card--next' : ''}`}
                >
                  <div className="rp-stop-top">
                    <div className="rp-stop-badges">
                      <span className="rp-seq-pill">STOP {String(idx + 1).padStart(2, '0')}</span>
                      {isNext && <span className="rp-next-pill">Next Stop</span>}
                      <span className="rp-zone-badge">{stop.zone_code}</span>
                      <span className="rp-items-tag">
                        {stop.item_count} {stop.item_count === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    {stop.verified && (
                      <span className="rp-done-pill">✓ Delivered</span>
                    )}
                  </div>

                  <div className="rp-customer-name">{stop.customer_name}</div>
                  <div className="rp-order-meta">
                    <span style={{ whiteSpace: 'nowrap' }}>#{stop.order_number}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{stop.tracking_number}</span>
                    {stop.customer_phone && (
                      <span style={{ whiteSpace: 'nowrap' }}>{stop.customer_phone}</span>
                    )}
                  </div>

                  {/* Destination + GhanaPostGPS + Landmark + Google Maps */}
                  <div className="rp-address-box">
                    <div className="rp-address-main">
                      <div className="rp-address-text">
                        📍 {stop.address || 'Address not specified — call customer'}
                      </div>
                      {mapsQuery && (
                        <a
                          href={mapsQuery}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rp-maps-btn"
                        >
                          🗺️ Navigate ↗
                        </a>
                      )}
                    </div>

                    {(stop.ghana_post_gps || stop.delivery_landmark) && (
                      <div className="rp-location-extras">
                        {stop.ghana_post_gps && (
                          <span className="rp-gps-code-pill">
                            GPS: {stop.ghana_post_gps}
                          </span>
                        )}
                        {stop.delivery_landmark && (
                          <span className="rp-landmark-pill">
                            Landmark: {stop.delivery_landmark}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Payment Collection Callout */}
                  <div className={`rp-pay-banner ${stop.cod_amount_due > 0 ? 'rp-pay-banner--cod' : 'rp-pay-banner--prepaid'}`}>
                    <span>
                      {stop.cod_amount_due > 0
                        ? `Collect COD: GHS ${Number(stop.cod_amount_due).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '✓ Paid Online — No Cash'}
                    </span>
                    <span style={{ fontSize: '0.72rem', opacity: 0.85, whiteSpace: 'nowrap' }}>
                      {stop.cod_amount_due > 0 ? 'Cash / MoMo' : 'Prepaid'}
                    </span>
                  </div>

                  {/* Action Controls */}
                  {!stop.verified ? (
                    <>
                      <div className="rp-quick-actions">
                        {stop.customer_phone ? (
                          <a href={`tel:${stop.customer_phone}`} className="rp-act-btn">
                            Call
                          </a>
                        ) : (
                          <button type="button" className="rp-act-btn" disabled>No Phone</button>
                        )}

                        {waNumber ? (
                          <a
                            href={`https://wa.me/${waNumber}?text=${waText}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rp-act-btn rp-act-btn--wa"
                          >
                            WhatsApp
                          </a>
                        ) : (
                          <button type="button" className="rp-act-btn" disabled>WhatsApp</button>
                        )}

                        <button
                          type="button"
                          className="rp-act-btn"
                          disabled={resendingId === stop.delivery_id}
                          onClick={() => handleResendOtp(stop)}
                        >
                          {resendingId === stop.delivery_id
                            ? 'Sending…'
                            : stop.has_otp ? 'Resend Code' : 'Send Code'}
                        </button>
                      </div>

                      {stop.handoff_token && (
                        <button
                          type="button"
                          className="rp-primary-cta rp-primary-cta--gold"
                          onClick={() => {
                            try {
                              sessionStorage.setItem(HANDOFF_SESSION_SS_KEY, JSON.stringify({
                                token: stop.handoff_token,
                                manifestToken: token,
                              }));
                            } catch {}
                            navigate('/rider-handoff');
                          }}
                        >
                          Verify &amp; Complete Stop →
                        </button>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: '0.82rem', color: '#166534', fontWeight: 700 }}>
                      ✓ Completed {stop.pod_verified_at ? `at ${new Date(stop.pod_verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'today'}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
