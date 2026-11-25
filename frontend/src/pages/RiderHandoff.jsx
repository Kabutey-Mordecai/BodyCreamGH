import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './RiderPortal.css';

export default function RiderHandoff() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const manifestToken = searchParams.get('manifest') || '';

  const [info, setInfo]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [resendingOtp, setResendingOtp] = useState(false);
  const [otpNotice, setOtpNotice]       = useState('');
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  const [otpDigits, setOtpDigits]   = useState(['', '', '', '', '', '']);
  const otpRefs = useRef([]);

  const [recipientName, setRecipientName] = useState('');
  const [photoUrl, setPhotoUrl]     = useState('');
  const [uploading, setUploading]   = useState(false);
  const [gps, setGps]               = useState({ lat: null, lng: null, accuracy: null, status: 'pending' });

  // Live in-page camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError]   = useState('');
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  const [codCollected, setCodCollected] = useState(true);
  const [collectionMethod, setCollectionMethod] = useState('cash');
  const [paymentRef, setPaymentRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]             = useState(null);

  const otp = otpDigits.join('');

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => () => stopCamera(), []);

  const startLiveCamera = async () => {
    setCameraError('');
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera API is unavailable in this browser. Tap below to open your phone camera.');
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access or use the device camera button below.'
          : 'Could not open rear camera. Tap below to capture with your device camera.'
      );
    }
  };

  const captureLiveFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('Camera is still warming up — tap Capture again in a moment.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          b => (b ? resolve(b) : reject(new Error('Failed to capture image'))),
          'image/jpeg',
          0.88
        );
      });

      const fd = new FormData();
      fd.append('media', blob, `pod-${Date.now()}.jpg`);
      const { data } = await deliveriesAPI.uploadRiderPhoto(token, fd);
      if (data?.url) {
        setPhotoUrl(data.url);
        stopCamera();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to upload captured photo.');
    } finally {
      setUploading(false);
    }
  };

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

  const handleDigitChange = (index, rawVal) => {
    const clean = rawVal.replace(/\D/g, '');
    if (!clean) {
      setOtpDigits(prev => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }
    // Support multi-digit paste/autofill into any box
    if (clean.length > 1) {
      const chars = clean.slice(0, 6).split('');
      setOtpDigits(prev => {
        const next = [...prev];
        chars.forEach((ch, offset) => {
          if (index + offset < 6) next[index + offset] = ch;
        });
        return next;
      });
      const focusIdx = Math.min(5, index + chars.length);
      otpRefs.current[focusIdx]?.focus();
      return;
    }
    setOtpDigits(prev => {
      const next = [...prev];
      next[index] = clean;
      return next;
    });
    if (index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitPaste = (e) => {
    const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    pasted.split('').forEach((c, i) => { next[i] = c; });
    setOtpDigits(next);
    otpRefs.current[Math.min(5, pasted.length)]?.focus();
  };

  const handleFallbackPhotoChange = async (e) => {
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

  const handleResendOtp = async () => {
    setResendingOtp(true);
    setOtpNotice('');
    setError('');
    try {
      const { data } = await deliveriesAPI.riderResendOtp({ token });
      const extra = data.demo_otp ? ` (Demo OTP: ${data.demo_otp})` : '';
      setOtpNotice(`✓ Fresh 6-digit delivery code sent to customer${extra}`);
      setInfo(prev => prev ? { ...prev, attempts_remaining: 5 } : prev);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not resend 6-digit code.');
    } finally {
      setResendingOtp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp.trim())) {
      setError("Enter all 6 digits of the customer's Delivery Verification Code.");
      return;
    }
    if (!photoUrl) {
      setError('Capture a live photo of the parcel before completing delivery.');
      return;
    }
    if (info?.cod_amount_due > 0 && codCollected && collectionMethod === 'momo' && !paymentRef.trim()) {
      setError('Enter the MoMo Transaction ID / Reference.');
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
      stopCamera();
      setDone(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed. Double-check the 6-digit code with the customer.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge">🏍️</div>
              <div>
                <div className="rp-eyebrow">Proof of Delivery</div>
                <div className="rp-rider-title">Loading Stop Handoff…</div>
              </div>
            </div>
          </div>
        </header>
        <div className="rp-container">
          <div className="rp-step-card" style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            Preparing verification terminal…
          </div>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge">🏍️</div>
              <div>
                <div className="rp-eyebrow">Proof of Delivery</div>
                <div className="rp-rider-title">Handoff Unavailable</div>
              </div>
            </div>
          </div>
        </header>
        <div className="rp-container">
          <div className="rp-step-card" style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
            <h2 style={{ fontSize: '1.15rem', color: '#991b1b', marginBottom: 6 }}>Dispatch Link Invalid or Expired</h2>
            <p style={{ fontSize: '0.9rem', color: '#7f1d1d' }}>{error || 'Return to your route manifest and refresh.'}</p>
            {manifestToken && (
              <Link to={`/rider-manifest?token=${encodeURIComponent(manifestToken)}`} className="rp-primary-cta" style={{ marginTop: 14 }}>
                ← Return to Route Manifest
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Completed / Digital POD Certificate Screen ────────────────
  if (done || info.already_verified) {
    const verifiedAtStr = done?.verified_at || info.pod_verified_at || new Date().toISOString();
    const recName = done?.recipient_name || recipientName || info.recipient_first_name || 'Customer';
    const recLat = done?.lat ?? gps.lat;
    const recLng = done?.lng ?? gps.lng;
    const mapsUrl = recLat != null && recLng != null
      ? `https://www.google.com/maps?q=${recLat},${recLng}`
      : null;
    const codSummary = done?.cod_paid
      ? `COD Collected: GHS ${Number(done.amount || info.cod_amount_due || 0).toFixed(2)} (${(done.collection_method || collectionMethod || 'cash').toUpperCase()}${done.payment_reference ? ` · Ref: ${done.payment_reference}` : ''})`
      : (info.payment_status === 'paid' ? 'Payment: PAID ONLINE' : 'Payment: Settled');

    const receiptText = [
      `✅ BODYCREAM GH — PROOF OF DELIVERY RECEIPT`,
      `Order: #${info.order_number}`,
      `Tracking: ${info.tracking_number}`,
      `Rider: ${done?.rider_name || info.delivery_partner || 'In-house Dispatch'}`,
      `Received By: ${recName}`,
      `Verified At: ${new Date(verifiedAtStr).toLocaleString()}`,
      codSummary,
      mapsUrl ? `GPS Pin: ${mapsUrl}` : null,
    ].filter(Boolean).join('\n');

    const copyReceipt = async () => {
      try {
        await navigator.clipboard.writeText(receiptText);
        setCopiedReceipt(true);
        setTimeout(() => setCopiedReceipt(false), 2500);
      } catch {
        // ignore
      }
    };

    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge" style={{ background: '#10b981', color: '#fff' }}>✓</div>
              <div>
                <div className="rp-eyebrow" style={{ color: '#34d399' }}>Proof of Delivery Confirmed</div>
                <div className="rp-rider-title">Order #{info.order_number}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="rp-container">
          <div className="rp-step-card" style={{ borderTop: '5px solid #10b981' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#dcfce7', color: '#166534', fontSize: '1.6rem', fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                ✓
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#065f46' }}>Delivery Verified &amp; Logged</h2>
              <p style={{ fontSize: '0.84rem', color: '#475569', marginTop: 4 }}>
                Confirmation receipts have been emailed to the customer and admin operations.
              </p>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, fontSize: '0.85rem', lineHeight: 1.7, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Tracking #</span>
                <strong style={{ fontFamily: 'monospace' }}>{info.tracking_number}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Received By</span>
                <strong>{recName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Timestamp</span>
                <strong>{new Date(verifiedAtStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Settlement</span>
                <strong style={{ color: '#065f46' }}>{codSummary}</strong>
              </div>
              {mapsUrl && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>GPS Stamp</span>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', fontWeight: 700 }}>
                    {Number(recLat).toFixed(4)}, {Number(recLng).toFixed(4)} ↗
                  </a>
                </div>
              )}
            </div>

            {(photoUrl || info.pod_photo_url) && (
              <div className="rp-photo-preview" style={{ marginBottom: 14 }}>
                <span className="rp-photo-ok-tag">✓ Parcel Photo Recorded</span>
                <img src={resolveImageUrl(photoUrl || info.pod_photo_url)} alt="Delivered parcel" />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <button type="button" className="rp-act-btn" onClick={copyReceipt}>
                {copiedReceipt ? '✓ Copied!' : '📋 Copy Receipt'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(receiptText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rp-act-btn rp-act-btn--wa"
              >
                💬 Share Receipt
              </a>
            </div>

            {manifestToken && (
              <Link
                to={`/rider-manifest?token=${encodeURIComponent(manifestToken)}`}
                className="rp-primary-cta rp-primary-cta--gold"
              >
                ← Back to Next Stop on Route
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const mapsQuery = info.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}`
    : null;

  return (
    <div className="rp-shell">
      {/* ── Sticky Handoff Topbar ───────────────────────────────────── */}
      <header className="rp-topbar">
        <div className="rp-topbar-inner">
          {manifestToken ? (
            <Link
              to={`/rider-manifest?token=${encodeURIComponent(manifestToken)}`}
              className="rp-sync-btn"
              style={{ textDecoration: 'none' }}
            >
              ← Route
            </Link>
          ) : (
            <div className="rp-brand-badge">🏍️</div>
          )}

          <div style={{ textAlign: 'center', minWidth: 0 }}>
            <div className="rp-eyebrow">Doorstep Handoff</div>
            <div className="rp-rider-title">Order #{info.order_number}</div>
          </div>

          <span className="rp-zone-badge">{info.zone_code}</span>
        </div>
      </header>

      <div className="rp-container">
        {/* ── Stop Overview & Payment Alert ─────────────────────────── */}
        <section className="rp-step-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: '1.08rem', fontWeight: 800 }}>
                {info.recipient_first_name}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                {info.tracking_number} · {info.item_count} {info.item_count === 1 ? 'item' : 'items'}
              </div>
            </div>
            {mapsQuery && (
              <a href={mapsQuery} target="_blank" rel="noopener noreferrer" className="rp-maps-btn">
                🗺️ Maps ↗
              </a>
            )}
          </div>

          <div style={{ fontSize: '0.86rem', color: '#334155', marginBottom: 12, lineHeight: 1.45 }}>
            📍 {info.address || 'No street address'}
          </div>

          <div className={`rp-pay-banner ${info.cod_amount_due > 0 ? 'rp-pay-banner--cod' : 'rp-pay-banner--prepaid'}`} style={{ marginBottom: 0 }}>
            <span>
              {info.cod_amount_due > 0
                ? `💵 COLLECT GHS ${info.cod_amount_due.toFixed(2)} BEFORE HANDOFF`
                : '✓ PREPAID ONLINE — DO NOT COLLECT CASH'}
            </span>
          </div>
        </section>

        {error && (
          <div style={{ background: '#fef2f2', border: '1.5px solid #ef4444', color: '#991b1b', padding: '12px 14px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 700, marginBottom: 14 }}>
            ⚠ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* ── STEP 1: 6-Box Segmented OTP Verification ────────────── */}
          <section className="rp-step-card">
            <div className="rp-step-head">
              <span className="rp-step-num">1</span>
              <div>
                <div className="rp-step-title">Customer&apos;s 6-Digit Delivery Code</div>
                <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                  Ask the customer for the 6-digit code sent to their SMS or email.
                </div>
              </div>
            </div>

            <div className="rp-otp-grid" onPaste={handleDigitPaste}>
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={el => { otpRefs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                  maxLength={6}
                  aria-label={`Digit ${idx + 1}`}
                  value={digit}
                  onChange={e => handleDigitChange(idx, e.target.value)}
                  onKeyDown={e => handleDigitKeyDown(idx, e)}
                  className={`rp-otp-digit${digit ? ' is-filled' : ''}`}
                />
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem', color: '#64748b' }}>
              <span>Attempts left: <strong>{info.attempts_remaining}</strong></span>
              <button
                type="button"
                disabled={resendingOtp}
                onClick={handleResendOtp}
                style={{ background: 'none', border: 'none', padding: 0, color: '#b45309', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {resendingOtp ? 'Sending code…' : '🔑 Resend 6-digit code to customer'}
              </button>
            </div>

            {otpNotice && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#065f46', background: '#ecfdf5', padding: '8px 10px', borderRadius: 8, fontWeight: 700 }}>
                {otpNotice}
              </div>
            )}
          </section>

          {/* ── STEP 2: Live Parcel Photo & GPS Lock ────────────────── */}
          <section className="rp-step-card">
            <div className="rp-step-head">
              <span className="rp-step-num">2</span>
              <div>
                <div className="rp-step-title">Parcel Photo &amp; GPS Location</div>
                <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                  Snap a clear photo of the sealed parcel or waybill at the doorstep.
                </div>
              </div>
            </div>

            {cameraActive ? (
              <div className="rp-camera-stage">
                <video ref={videoRef} autoPlay playsInline muted />
                <div className="rp-camera-bar">
                  <button
                    type="button"
                    className="rp-primary-cta rp-primary-cta--gold"
                    style={{ flex: 1, minHeight: 42, padding: '8px 12px' }}
                    disabled={uploading}
                    onClick={captureLiveFrame}
                  >
                    {uploading ? 'Uploading…' : '📸 Capture Photo'}
                  </button>
                  <button
                    type="button"
                    className="rp-sync-btn"
                    disabled={uploading}
                    onClick={stopCamera}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : photoUrl ? (
              <div>
                <div className="rp-photo-preview" style={{ marginBottom: 10 }}>
                  <span className="rp-photo-ok-tag">✓ Photo Ready</span>
                  <img src={resolveImageUrl(photoUrl)} alt="Captured parcel proof" />
                </div>
                <button type="button" className="rp-act-btn" style={{ width: '100%' }} onClick={startLiveCamera} disabled={uploading}>
                  📷 Retake Parcel Photo
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className="rp-act-btn"
                  style={{ width: '100%', minHeight: 48, borderStyle: 'dashed', borderWidth: 2 }}
                  disabled={uploading}
                  onClick={startLiveCamera}
                >
                  {uploading ? 'Uploading photo…' : '📷 Open Rear Camera'}
                </button>

                <label className="rp-act-btn" style={{ width: '100%', fontSize: '0.76rem', color: '#475569' }}>
                  <span>Or use phone native camera app</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    disabled={uploading}
                    onChange={handleFallbackPhotoChange}
                  />
                </label>
              </div>
            )}

            {cameraError && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: 8 }}>
                {cameraError}
              </div>
            )}

            <div className="rp-gps-strip" style={{ marginTop: 12 }}>
              <span style={{ color: gps.status === 'ok' ? '#166534' : '#475569' }}>
                {gps.status === 'ok'
                  ? `● GPS Locked: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)} (±${gps.accuracy}m)`
                  : gps.status === 'locating'
                    ? '◌ Acquiring GPS coordinates…'
                    : '○ GPS optional (permission not granted)'}
              </span>
              <button type="button" className="rp-zone-chip" onClick={captureGps}>
                Refresh GPS
              </button>
            </div>
          </section>

          {/* ── STEP 3: Recipient Name & COD Settlement ─────────────── */}
          <section className="rp-step-card">
            <div className="rp-step-head">
              <span className="rp-step-num">3</span>
              <div>
                <div className="rp-step-title">Recipient &amp; Payment Confirmation</div>
              </div>
            </div>

            <div style={{ marginBottom: info.cod_amount_due > 0 ? 14 : 0 }}>
              <label htmlFor="pod-recipient" style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 5 }}>
                Received By (Name)
              </label>
              <input
                id="pod-recipient"
                type="text"
                value={recipientName}
                onChange={e => setRecipientName(e.target.value)}
                placeholder="Customer or receptionist name"
                className="rp-search-input"
                style={{ paddingLeft: 12 }}
              />
            </div>

            {info.cod_amount_due > 0 && (
              <div style={{ padding: 12, borderRadius: 12, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '0.86rem', color: '#92400e', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    style={{ width: 18, height: 18 }}
                    checked={codCollected}
                    onChange={e => setCodCollected(e.target.checked)}
                  />
                  <span>Collected GHS {info.cod_amount_due.toFixed(2)} from customer</span>
                </label>

                {codCollected && (
                  <>
                    <div className="rp-method-pills" role="group" aria-label="COD collection method">
                      {[
                        { key: 'cash',          label: '💵 Cash' },
                        { key: 'momo',          label: '📱 MoMo' },
                        { key: 'bank_transfer', label: '🏦 Bank' },
                      ].map(m => (
                        <button
                          key={m.key}
                          type="button"
                          className={`rp-method-pill${collectionMethod === m.key ? ' is-active' : ''}`}
                          onClick={() => setCollectionMethod(m.key)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {collectionMethod === 'momo' && (
                      <input
                        type="text"
                        required
                        placeholder="Enter MoMo Transaction ID *"
                        value={paymentRef}
                        onChange={e => setPaymentRef(e.target.value)}
                        className="rp-search-input"
                        style={{ marginTop: 10, paddingLeft: 12, background: '#fff' }}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          <button
            type="submit"
            className="rp-primary-cta rp-primary-cta--gold"
            disabled={submitting || uploading || cameraActive}
            style={{ minHeight: 54, fontSize: '1rem' }}
          >
            {submitting ? 'Verifying Delivery…' : '✓ Confirm & Complete Delivery'}
          </button>
        </form>
      </div>
    </div>
  );
}
