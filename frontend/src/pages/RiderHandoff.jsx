import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';

export default function RiderHandoff() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [info, setInfo]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  const [otp, setOtp]               = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [photoUrl, setPhotoUrl]     = useState('');
  const [uploading, setUploading]   = useState(false);
  const [gps, setGps]               = useState({ lat: null, lng: null, accuracy: null, status: 'pending' });

  const [codCollected, setCodCollected] = useState(true);
  const [collectionMethod, setCollectionMethod] = useState('cash');
  const [paymentRef, setPaymentRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]             = useState(null);

  const captureGps = () => {
    if (!navigator.geolocation) {
      setGps(g => ({ ...g, status: 'unsupported' }));
      return;
    }
    setGps(g => ({ ...g, status: 'locating' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          status: 'ok',
        });
      },
      () => setGps(g => ({ ...g, status: 'denied' })),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (!token) {
      setError('Missing signed rider handoff token.');
      setLoading(false);
      return;
    }
    deliveriesAPI.getRiderHandoff(token)
      .then(({ data }) => {
        setInfo(data);
        setRecipientName(data.recipient_first_name || '');
        if (!data.already_verified) captureGps();
      })
      .catch(err => setError(err.response?.data?.error || 'Invalid or expired rider link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('media', file);
      const { data } = await deliveriesAPI.uploadRiderPhoto(token, fd);
      if (data?.url) setPhotoUrl(data.url);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload parcel photo.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the customer\'s 6-digit delivery code.');
      return;
    }
    if (!photoUrl) {
      setError('Please snap a live photo of the parcel before confirming.');
      return;
    }
    if (info?.cod_amount_due > 0 && codCollected && collectionMethod === 'momo' && !paymentRef.trim()) {
      setError('Please enter the MoMo Transaction ID / Reference.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await deliveriesAPI.confirmRiderDelivery({
        token,
        otp: otp.trim(),
        pod_photo_url: photoUrl,
        lat: gps.lat,
        lng: gps.lng,
        accuracy: gps.accuracy,
        recipient_name: recipientName.trim(),
        cod_collected: info?.cod_amount_due > 0 ? codCollected : false,
        collection_method: collectionMethod,
        payment_reference: paymentRef.trim(),
      });
      setDone(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed. Please check the 6-digit code.');
    } finally {
      setSubmitting(false);
    }
  };

  const wrapStyle = {
    maxWidth: 460,
    margin: '24px auto 60px',
    padding: '0 16px',
  };
  const cardStyle = {
    background: 'var(--color-surface, #fff)',
    border: '1px solid var(--color-border, #e5e0d8)',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 4px 18px rgba(0,0,0,0.05)',
  };

  if (loading) {
    return <div style={wrapStyle}><div style={cardStyle}>Loading dispatch handoff…</div></div>;
  }

  if (!info) {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Rider Handoff Unavailable</h2>
          <p style={{ color: '#b91c1c' }}>{error || 'This dispatch link is invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  if (done || info.already_verified) {
    return (
      <div style={wrapStyle}>
        <div style={{ ...cardStyle, borderColor: '#10b981', background: '#ecfdf5' }}>
          <h2 style={{ marginTop: 0, color: '#065f46' }}>✓ Delivery Verified</h2>
          <p style={{ margin: '6px 0' }}>
            Order <strong>#{info.order_number}</strong> ({info.tracking_number}) has been verified and closed.
          </p>
          {(done?.cod_paid || info.payment_status === 'paid') && (
            <p style={{ margin: '6px 0', fontWeight: 700, color: '#047857' }}>
              Payment status: PAID
            </p>
          )}
          {(photoUrl || info.pod_photo_url) && (
            <img
              src={resolveImageUrl(photoUrl || info.pod_photo_url)}
              alt="Delivered parcel"
              style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, marginTop: 12 }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)' }}>
              Proof of Delivery Handoff
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem' }}>Order #{info.order_number}</h2>
          </div>
          <div style={{ background: '#111', color: '#fff', fontWeight: 900, fontSize: '1.1rem', padding: '6px 12px', borderRadius: 6, letterSpacing: '0.06em' }}>
            {info.zone_code}
          </div>
        </div>

        <div style={{ fontSize: '0.86rem', color: 'var(--color-muted)', marginBottom: 12 }}>
          <div><strong>Tracking:</strong> <span style={{ fontFamily: 'monospace' }}>{info.tracking_number}</span></div>
          <div><strong>Recipient:</strong> {info.recipient_first_name} ({info.item_count} item{info.item_count === 1 ? '' : 's'})</div>
          <div><strong>Address:</strong> {info.address}</div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            fontWeight: 800,
            textAlign: 'center',
            marginBottom: 16,
            background: info.cod_amount_due > 0 ? '#111' : '#ecfdf5',
            color: info.cod_amount_due > 0 ? '#fff' : '#065f46',
            border: info.cod_amount_due > 0 ? '2px solid #111' : '1px solid #10b981',
          }}
        >
          {info.cod_amount_due > 0
            ? `COLLECT GHS ${info.cod_amount_due.toFixed(2)} (CASH OR MOMO)`
            : 'PREPAID ONLINE — DO NOT COLLECT CASH'}
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', padding: '10px 12px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="pod-otp" style={{ fontWeight: 700, display: 'block', marginBottom: 4 }}>
              1. Customer&apos;s 6-Digit Delivery Code *
            </label>
            <input
              id="pod-otp"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="Enter 6-digit code from customer"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ width: '100%', padding: '12px', fontSize: '1.25rem', letterSpacing: '0.3em', textAlign: 'center', fontWeight: 700 }}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: 4 }}>
              Attempts remaining: {info.attempts_remaining}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label style={{ fontWeight: 700, display: 'block', marginBottom: 6 }}>
              2. Live Photo of Parcel / Label *
            </label>
            <label className="btn btn-outline btn-full" style={{ cursor: 'pointer', display: 'block', textAlign: 'center' }}>
              {uploading ? 'Uploading photo…' : photoUrl ? 'Retake Parcel Photo' : '📷 Snap Live Parcel Photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={handlePhotoChange}
              />
            </label>
            {photoUrl && (
              <img
                src={resolveImageUrl(photoUrl)}
                alt="Uploaded parcel proof"
                style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginTop: 8, border: '1px solid var(--color-border)' }}
              />
            )}
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="pod-recipient" style={{ fontWeight: 700, display: 'block', marginBottom: 4 }}>
              3. Received By (Name)
            </label>
            <input
              id="pod-recipient"
              type="text"
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              placeholder="Recipient name"
              style={{ width: '100%', padding: 10 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', padding: '8px 10px', background: '#f8f7f4', borderRadius: 6, marginBottom: 14 }}>
            <span>
              📍 GPS:{' '}
              {gps.status === 'ok'
                ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)} (±${gps.accuracy}m)`
                : gps.status === 'locating'
                  ? 'Locating…'
                  : 'Not captured'}
            </span>
            <button type="button" className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={captureGps}>
              Refresh GPS
            </button>
          </div>

          {info.cod_amount_due > 0 && (
            <div style={{ padding: 12, border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={codCollected}
                  onChange={e => setCodCollected(e.target.checked)}
                />
                Collected GHS {info.cod_amount_due.toFixed(2)} from customer
              </label>
              {codCollected && (
                <>
                  <select
                    value={collectionMethod}
                    onChange={e => setCollectionMethod(e.target.value)}
                    style={{ width: '100%', padding: 8, marginBottom: 8 }}
                  >
                    <option value="cash">Cash</option>
                    <option value="momo">Mobile Money (MoMo)</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                  {collectionMethod === 'momo' && (
                    <input
                      type="text"
                      required
                      placeholder="MoMo Transaction ID *"
                      value={paymentRef}
                      onChange={e => setPaymentRef(e.target.value)}
                      style={{ width: '100%', padding: 8 }}
                    />
                  )}
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-accent btn-full"
            disabled={submitting || uploading}
            style={{ padding: '12px 16px', fontSize: '1rem', fontWeight: 700 }}
          >
            {submitting ? 'Verifying…' : '✓ Verify & Complete Delivery'}
          </button>
        </form>
      </div>
    </div>
  );
}
