import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';

function formatPhoneForWa(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

export default function RiderManifest() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [resendingId, setResendingId]   = useState(null);
  const [otpToast, setOtpToast]         = useState('');

  const loadManifest = useCallback(async () => {
    if (!token) {
      setError('Missing signed rider manifest token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: res } = await deliveriesAPI.getRiderManifest(token);
      setData(res);
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid or expired rider manifest link.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  const zones = useMemo(() => {
    if (!data?.stops) return [];
    return Array.from(new Set(data.stops.map(s => s.zone_code).filter(Boolean))).sort();
  }, [data]);

  const filteredStops = useMemo(() => {
    if (!data?.stops) return [];
    return data.stops.filter(s => {
      if (zoneFilter !== 'ALL' && s.zone_code !== zoneFilter) return false;
      if (statusFilter === 'pending' && s.verified) return false;
      if (statusFilter === 'done' && !s.verified) return false;
      return true;
    });
  }, [data, zoneFilter, statusFilter]);

  const handleResendOtp = async (stop) => {
    setResendingId(stop.delivery_id);
    setOtpToast('');
    try {
      const { data: res } = await deliveriesAPI.riderResendOtp({
        token,
        delivery_id: stop.delivery_id,
      });
      const extra = res.demo_otp ? ` (Demo OTP: ${res.demo_otp})` : '';
      setOtpToast(`✓ Fresh 6-digit code sent to ${stop.customer_name} for #${stop.order_number}${extra}`);
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

  const wrapStyle = { maxWidth: 680, margin: '20px auto 64px', padding: '0 14px' };
  const cardStyle = {
    background: 'var(--color-surface, #fff)',
    border: '1px solid var(--color-border, #e5e0d8)',
    borderRadius: 12,
    padding: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  };

  if (loading) {
    return <div style={wrapStyle}><div style={cardStyle}>Loading rider route manifest…</div></div>;
  }

  if (error || !data) {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Rider Manifest Unavailable</h2>
          <p style={{ color: '#b91c1c' }}>{error || 'This manifest link is invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div style={wrapStyle}>
      {/* Header */}
      <div style={{ ...cardStyle, marginBottom: 14, background: '#111', color: '#fff', borderColor: '#111' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#c9a45c' }}>
              BodyCream GH · Rider Route Manifest
            </div>
            <h1 style={{ margin: '4px 0 2px', fontSize: '1.35rem', color: '#fff' }}>
              🏍️ {data.rider_label}
            </h1>
            {data.driver_phone && (
              <div style={{ fontSize: '0.82rem', color: '#d1d5db' }}>Driver Phone: {data.driver_phone}</div>
            )}
          </div>
          <button
            type="button"
            onClick={loadManifest}
            style={{
              background: '#222',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* Live End-of-Day KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 14 }}>
          <div style={{ background: '#1f2937', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase' }}>Stops Progress</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: 2 }}>
              {summary.completed_stops} / {summary.total_stops} done
            </div>
            <div style={{ fontSize: '0.75rem', color: '#fbbf24' }}>{summary.pending_stops} remaining</div>
          </div>
          <div style={{ background: '#1f2937', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase' }}>COD Cash / MoMo Tally</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: 2, color: '#34d399' }}>
              GH₵{summary.cod_collected_ghs.toFixed(2)} collected
            </div>
            <div style={{ fontSize: '0.75rem', color: '#d1d5db' }}>
              GH₵{summary.cod_pending_ghs.toFixed(2)} pending
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {[
          { key: 'pending', label: `Pending (${summary.pending_stops})` },
          { key: 'done',    label: `Delivered Today (${summary.completed_stops})` },
          { key: 'all',     label: `All (${summary.total_stops})` },
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid var(--color-border, #d6d0c4)',
              background: statusFilter === tab.key ? '#111' : '#fff',
              color: statusFilter === tab.key ? '#fff' : '#222',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}

        {zones.length > 1 && (
          <select
            value={zoneFilter}
            onChange={e => setZoneFilter(e.target.value)}
            aria-label="Filter by zone"
            style={{
              marginLeft: 'auto',
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--color-border, #d6d0c4)',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            <option value="ALL">All Zones</option>
            {zones.map(z => <option key={z} value={z}>Zone {z}</option>)}
          </select>
        )}
      </div>

      {otpToast && (
        <div
          style={{
            background: otpToast.startsWith('✓') ? '#ecfdf5' : '#fef2f2',
            border: `1px solid ${otpToast.startsWith('✓') ? '#10b981' : '#ef4444'}`,
            color: otpToast.startsWith('✓') ? '#065f46' : '#b91c1c',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: '0.85rem',
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          {otpToast}
        </div>
      )}

      {/* Stops List */}
      {filteredStops.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--color-muted)', padding: '32px 16px' }}>
          No stops match this filter.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredStops.map((stop, idx) => {
            const waNumber = formatPhoneForWa(stop.customer_phone);
            const waText = encodeURIComponent(
              `Hello ${stop.customer_name}, I am your BodyCream GH dispatch rider on the way with order #${stop.order_number} (${stop.tracking_number}). Please have your 6-digit delivery code ready.`
            );
            return (
              <div
                key={stop.delivery_id}
                style={{
                  ...cardStyle,
                  borderLeft: `5px solid ${stop.verified ? '#10b981' : (stop.cod_amount_due > 0 ? '#111' : '#c9a45c')}`,
                  opacity: stop.verified ? 0.85 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase' }}>
                      Stop #{idx + 1} · {stop.item_count} item{stop.item_count === 1 ? '' : 's'}
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                      Order #{stop.order_number} — {stop.customer_name}
                    </div>
                    <div style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--color-muted)' }}>
                      {stop.tracking_number}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ background: '#111', color: '#fff', fontWeight: 900, fontSize: '0.82rem', padding: '4px 8px', borderRadius: 5 }}>
                      {stop.zone_code}
                    </span>
                    {stop.verified && (
                      <span style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #10b981', fontWeight: 700, fontSize: '0.75rem', padding: '3px 8px', borderRadius: 999 }}>
                        ✓ Done
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: '0.86rem', margin: '8px 0', color: '#333' }}>
                  📍 {stop.address || 'No address listed'}
                </div>

                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    padding: '6px 10px',
                    borderRadius: 6,
                    marginBottom: 10,
                    background: stop.cod_amount_due > 0 ? '#fef3c7' : '#ecfdf5',
                    color: stop.cod_amount_due > 0 ? '#92400e' : '#065f46',
                  }}
                >
                  {stop.cod_amount_due > 0
                    ? `💵 COLLECT COD: GH₵${stop.cod_amount_due.toFixed(2)} (Cash or MoMo)`
                    : '✅ PREPAID ONLINE — No cash collection'}
                </div>

                {!stop.verified ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {stop.customer_phone && (
                      <a
                        href={`tel:${stop.customer_phone}`}
                        className="btn btn-outline"
                        style={{ padding: '7px 10px', fontSize: '0.8rem', textDecoration: 'none' }}
                      >
                        📞 Call
                      </a>
                    )}
                    {waNumber && (
                      <a
                        href={`https://wa.me/${waNumber}?text=${waText}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline"
                        style={{ padding: '7px 10px', fontSize: '0.8rem', textDecoration: 'none' }}
                      >
                        💬 WhatsApp
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={resendingId === stop.delivery_id}
                      onClick={() => handleResendOtp(stop)}
                      style={{ padding: '7px 10px', fontSize: '0.8rem' }}
                    >
                      {resendingId === stop.delivery_id
                        ? 'Sending…'
                        : (stop.has_otp ? '🔑 Resend OTP' : '🔑 Send OTP')}
                    </button>
                    {stop.handoff_token && (
                      <Link
                        to={`/rider-handoff?token=${encodeURIComponent(stop.handoff_token)}&manifest=${encodeURIComponent(token)}`}
                        className="btn btn-accent"
                        style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: '0.85rem', fontWeight: 700, textDecoration: 'none' }}
                      >
                        Verify Handoff →
                      </Link>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.78rem', color: '#065f46', fontWeight: 600 }}>
                    ✓ Verified at {stop.pod_verified_at ? new Date(stop.pod_verified_at).toLocaleTimeString() : 'today'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
