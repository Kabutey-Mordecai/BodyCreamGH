import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import './RiderPortal.css';

function formatPhoneForWa(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

export default function RiderManifest() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [error, setError]           = useState('');
  const [search, setSearch]         = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [resendingId, setResendingId]   = useState(null);
  const [otpToast, setOtpToast]         = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const loadManifest = useCallback(async (isRefresh = false) => {
    if (!token) {
      setError('Missing signed rider manifest token.');
      setLoading(false);
      return;
    }
    if (isRefresh) setSyncing(true);
    else setLoading(true);
    setError('');
    try {
      const { data: res } = await deliveriesAPI.getRiderManifest(token);
      setData(res);
      setLastSyncedAt(new Date());
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid or expired rider manifest link.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [token]);

  useEffect(() => {
    loadManifest(false);
  }, [loadManifest]);

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

  if (loading) {
    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge">BC</div>
              <div>
                <div className="rp-eyebrow">BodyCream GH · Logistics</div>
                <div className="rp-rider-title">Loading Route Manifest…</div>
              </div>
            </div>
          </div>
        </header>
        <div className="rp-container">
          <div className="rp-step-card" style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            Syncing assigned stops and COD ledger…
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge">BC</div>
              <div>
                <div className="rp-eyebrow">BodyCream GH · Logistics</div>
                <div className="rp-rider-title">Manifest Unavailable</div>
              </div>
            </div>
          </div>
        </header>
        <div className="rp-container">
          <div className="rp-step-card" style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
            <h2 style={{ fontSize: '1.15rem', color: '#991b1b', marginBottom: 6 }}>Route Link Expired or Invalid</h2>
            <p style={{ fontSize: '0.9rem', color: '#7f1d1d', lineHeight: 1.5 }}>
              {error || 'Ask your dispatch coordinator to send a fresh Rider Manifest link on WhatsApp.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { summary } = data;
  const pctDone = summary.total_stops > 0
    ? Math.round((summary.completed_stops / summary.total_stops) * 100)
    : 0;

  return (
    <div className="rp-shell">
      {/* ── Sticky Logistics Driver Topbar ──────────────────────────── */}
      <header className="rp-topbar">
        <div className="rp-topbar-inner">
          <div className="rp-brand-group">
            <div className="rp-brand-badge" aria-hidden="true">🏍️</div>
            <div style={{ minWidth: 0 }}>
              <div className="rp-eyebrow">BodyCream GH · Dispatch Console</div>
              <div className="rp-rider-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{data.rider_label}</span>
                {data.vehicle_plate && (
                  <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.2)', color: '#fbbf24', fontFamily: 'monospace' }}>
                    {data.vehicle_plate}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="rp-sync-btn"
            onClick={() => loadManifest(true)}
            disabled={syncing}
          >
            <span>{syncing ? 'Syncing…' : '↻ Sync'}</span>
          </button>
        </div>
      </header>

      <div className="rp-container">
        {/* ── Route Progress & COD Cash Reconciliation Hero ─────────── */}
        <section className="rp-hero-card" aria-label="Route summary and cash tally">
          <div className="rp-progress-head">
            <span className="rp-progress-title">
              Today&apos;s Route Progress · {summary.completed_stops} of {summary.total_stops} delivered
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
              <div className={`rp-kpi-val ${summary.cod_pending_ghs > 0 ? 'rp-kpi-val--amber' : ''}`}>
                GHS {summary.cod_pending_ghs.toFixed(2)}
              </div>
              <div className="rp-kpi-sub">Cash or Mobile Money</div>
            </div>

            <div className="rp-kpi-box rp-kpi-box--wide">
              <div className="rp-kpi-label">COD Collected Today</div>
              <div className="rp-kpi-val rp-kpi-val--emerald">
                GHS {summary.cod_collected_ghs.toFixed(2)}
              </div>
              <div className="rp-kpi-sub">
                {lastSyncedAt
                  ? `Last synced ${lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
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
              placeholder="Search customer, order #, address, or tracking…"
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
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>
              {statusFilter === 'pending' && summary.completed_stops > 0 ? '🎉' : '📦'}
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: 4 }}>
              {statusFilter === 'pending' && summary.total_stops > 0 && !search
                ? 'All assigned stops delivered!'
                : 'No stops match this view'}
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
              {statusFilter === 'pending' && summary.completed_stops > 0 && !search
                ? 'Switch to the "Completed" tab above to review your verified deliveries and COD cash tally.'
                : 'Try clearing your search or switching status/zone filters.'}
            </p>
          </div>
        ) : (
          <div className="rp-stops-list">
            {filteredStops.map((stop, idx) => {
              const waNumber = formatPhoneForWa(stop.customer_phone);
              const waText = encodeURIComponent(
                `Hello ${stop.customer_name}, I am your BodyCream GH dispatch rider on the way with Order #${stop.order_number} (${stop.tracking_number}). Please have your 6-digit delivery code ready.`
              );
              const mapsQuery = stop.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`
                : null;
              const cardMod = stop.verified
                ? 'rp-stop-card--done'
                : stop.cod_amount_due > 0
                  ? 'rp-stop-card--cod'
                  : 'rp-stop-card--prepaid';

              return (
                <article key={stop.delivery_id} className={`rp-stop-card ${cardMod}`}>
                  <div className="rp-stop-top">
                    <div className="rp-stop-badges">
                      <span className="rp-seq-pill">STOP {String(idx + 1).padStart(2, '0')}</span>
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
                    <span>Order #{stop.order_number}</span>
                    <span>·</span>
                    <span>{stop.tracking_number}</span>
                  </div>

                  {/* Destination + Google Maps Navigation */}
                  <div className="rp-address-box">
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

                  {/* Payment Collection Callout */}
                  <div className={`rp-pay-banner ${stop.cod_amount_due > 0 ? 'rp-pay-banner--cod' : 'rp-pay-banner--prepaid'}`}>
                    <span>
                      {stop.cod_amount_due > 0
                        ? `💵 COLLECT COD: GHS ${stop.cod_amount_due.toFixed(2)}`
                        : '✓ PAID ONLINE — No Cash Collection'}
                    </span>
                    <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
                      {stop.cod_amount_due > 0 ? 'Cash or MoMo' : 'Prepaid'}
                    </span>
                  </div>

                  {/* Action Controls */}
                  {!stop.verified ? (
                    <>
                      <div className="rp-quick-actions">
                        {stop.customer_phone ? (
                          <a href={`tel:${stop.customer_phone}`} className="rp-act-btn">
                            📞 Call
                          </a>
                        ) : (
                          <button type="button" className="rp-act-btn" disabled>📞 No Phone</button>
                        )}

                        {waNumber ? (
                          <a
                            href={`https://wa.me/${waNumber}?text=${waText}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rp-act-btn rp-act-btn--wa"
                          >
                            💬 WhatsApp
                          </a>
                        ) : (
                          <button type="button" className="rp-act-btn" disabled>💬 WhatsApp</button>
                        )}

                        <button
                          type="button"
                          className="rp-act-btn"
                          disabled={resendingId === stop.delivery_id}
                          onClick={() => handleResendOtp(stop)}
                        >
                          {resendingId === stop.delivery_id
                            ? 'Sending…'
                            : stop.has_otp ? '🔑 Resend OTP' : '🔑 Send OTP'}
                        </button>
                      </div>

                      {stop.handoff_token && (
                        <Link
                          to={`/rider-handoff?token=${encodeURIComponent(stop.handoff_token)}&manifest=${encodeURIComponent(token)}`}
                          className="rp-primary-cta"
                        >
                          <span>Verify 6-Digit Code &amp; Complete Stop →</span>
                        </Link>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 700 }}>
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
