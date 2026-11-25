import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { parseRiderDispatchInput } from './RiderManifest';
import './RiderPortal.css';

function formatPhoneForWa(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/**
 * Downscales large phone camera photos (8–15 MB) to max 1280px JPEG (~180 KB)
 * so doorstep uploads succeed in <1 second even on weak 3G/4G connections.
 */
async function compressPhotoFile(file) {
  if (!file || typeof document === 'undefined') return file;
  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const maxDim = 1280;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        0.84
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      resolve(file);
    };
    img.src = objUrl;
  });
}

export default function RiderHandoff() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();

  const token = searchParams.get('token') || '';
  const manifestToken = searchParams.get('manifest') || '';

  const [info, setInfo]               = useState(null);
  const [loading, setLoading]         = useState(Boolean(token));
  const [error, setError]             = useState('');
  const [loadFailed, setLoadFailed]   = useState(false);
  const [isOnline, setIsOnline]       = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  const [pasteValue, setPasteValue]   = useState('');
  const [pasteError, setPasteError]   = useState('');

  const [resendingOtp, setResendingOtp] = useState(false);
  const [otpNotice, setOtpNotice]       = useState('');
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  const [otpDigits, setOtpDigits]     = useState(['', '', '', '', '', '']);
  const otpRefs   = useRef([]);
  const photoStepRef = useRef(null);

  const [recipientName, setRecipientName] = useState('');
  const [photoUrl, setPhotoUrl]       = useState('');
  const [uploading, setUploading]     = useState(false);
  const [gps, setGps]                 = useState({ lat: null, lng: null, accuracy: null, status: 'pending' });

  // Live in-page camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError]   = useState('');
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  const [codCollected, setCodCollected] = useState(true);
  const [collectionMethod, setCollectionMethod] = useState('cash');
  const [paymentRef, setPaymentRef]   = useState('');

  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(null);

  const otp = otpDigits.join('');
  const otpComplete = /^\d{6}$/.test(otp);
  const codReady = !(info?.cod_amount_due > 0) || (codCollected ? (collectionMethod !== 'momo' || Boolean(paymentRef.trim())) : true);

  const supportPhone = settings?.contact_phone || settings?.whatsapp_number || '';
  const supportWa = formatPhoneForWa(settings?.whatsapp_number || settings?.contact_phone || '');

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const captureGps = useCallback(() => {
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
  }, []);

  const loadHandoff = useCallback(() => {
    if (!token) {
      setInfo(null);
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    setError('');
    deliveriesAPI.getRiderHandoff(token)
      .then(({ data }) => {
        setInfo(data);
        setRecipientName(data.recipient_first_name || '');
        if (!data.already_verified) captureGps();
      })
      .catch(err => {
        setLoadFailed(true);
        setError(
          err.response?.status === 401
            ? 'This doorstep handoff link has expired or is invalid. Return to your Route Manifest or request a fresh link from Dispatch.'
            : (err.response?.data?.error || 'Could not load stop details. Check your mobile connection and retry.')
        );
      })
      .finally(() => setLoading(false));
  }, [token, captureGps]);

  useEffect(() => {
    loadHandoff();
  }, [loadHandoff]);

  const startLiveCamera = async () => {
    setCameraError('');
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera preview is unavailable in this browser. Tap "Use Phone Camera App" below.');
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
          ? 'Camera permission denied. Allow camera access or tap "Use Phone Camera App" below.'
          : 'Could not open rear camera. Tap "Use Phone Camera App" below.'
      );
    }
  };

  const captureLiveFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('Camera is warming up — tap Capture Photo again in a moment.');
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
          0.85
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

  const advanceAfterCompleteOtp = (nextDigits) => {
    if (nextDigits.every(d => /^\d$/.test(d))) {
      otpRefs.current[5]?.blur();
      if (!photoUrl && photoStepRef.current) {
        setTimeout(() => {
          photoStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
      }
    }
  };

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
    if (clean.length > 1) {
      const chars = clean.slice(0, 6).split('');
      setOtpDigits(prev => {
        const next = [...prev];
        chars.forEach((ch, offset) => {
          if (index + offset < 6) next[index + offset] = ch;
        });
        advanceAfterCompleteOtp(next);
        return next;
      });
      const focusIdx = Math.min(5, index + chars.length);
      if (index + chars.length < 6) otpRefs.current[focusIdx]?.focus();
      return;
    }
    setOtpDigits(prev => {
      const next = [...prev];
      next[index] = clean;
      advanceAfterCompleteOtp(next);
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
    if (pasted.length < 6) {
      otpRefs.current[Math.min(5, pasted.length)]?.focus();
    } else {
      advanceAfterCompleteOtp(next);
    }
  };

  const handleFallbackPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const compressed = await compressPhotoFile(file);
      const fd = new FormData();
      fd.append('media', compressed, `pod-${Date.now()}.jpg`);
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
      await deliveriesAPI.riderResendOtp({ token });
      setOtpNotice('✓ Fresh 6-digit delivery code sent to customer via SMS & email');
      setInfo(prev => prev ? { ...prev, attempts_remaining: 5 } : prev);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not resend 6-digit code.');
    } finally {
      setResendingOtp(false);
    }
  };

  const handleOpenPastedLink = (e) => {
    e.preventDefault();
    setPasteError('');
    const parsed = parseRiderDispatchInput(pasteValue);
    if (!parsed) {
      setPasteError('Paste the full WhatsApp dispatch link or route manifest URL.');
      return;
    }
    setPasteValue('');
    if (parsed.route === '/rider-manifest') {
      navigate(`/rider-manifest?token=${encodeURIComponent(parsed.token)}`);
    } else {
      const qs = { token: parsed.token };
      if (parsed.manifestToken) qs.manifest = parsed.manifestToken;
      setSearchParams(qs);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!otpComplete) {
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
                <h1 className="rp-rider-title">Loading Doorstep Handoff…</h1>
              </div>
            </div>
          </div>
        </header>
        <div className="rp-container">
          <div className="rp-step-card" style={{ textAlign: 'center', padding: '44px 20px', color: '#475569' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Preparing Proof-of-Delivery Terminal…</div>
            <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Syncing order, COD balance, and GPS lock</div>
          </div>
        </div>
      </div>
    );
  }

  // ── 2. Missing / Expired Token Portal Recovery ────────────────────────────
  if (!token || loadFailed || !info) {
    return (
      <div className="rp-shell">
        <header className="rp-topbar">
          <div className="rp-topbar-inner">
            <div className="rp-brand-group">
              <div className="rp-brand-badge" aria-hidden="true">BC</div>
              <div>
                <div className="rp-eyebrow">BodyCream GH · Logistics</div>
                <h1 className="rp-rider-title">Doorstep Proof of Delivery</h1>
              </div>
            </div>
            <Link
              to={manifestToken ? `/rider-manifest?token=${encodeURIComponent(manifestToken)}` : '/rider-manifest'}
              className="rp-sync-btn"
            >
              ← Route Console
            </Link>
          </div>
        </header>

        <div className="rp-container">
          {token && error && (
            <div className="rp-alert-banner rp-alert-banner--err" role="alert">
              <div>
                <strong style={{ display: 'block', fontSize: '0.95rem', marginBottom: 3 }}>
                  Handoff Link Unavailable
                </strong>
                <span style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>{error}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="rp-act-btn" onClick={loadHandoff}>
                  ↻ Retry
                </button>
                {manifestToken && (
                  <Link
                    to={`/rider-manifest?token=${encodeURIComponent(manifestToken)}`}
                    className="rp-act-btn"
                  >
                    ← Back to Route Manifest
                  </Link>
                )}
              </div>
            </div>
          )}

          <section className="rp-portal-hero">
            <div className="rp-portal-status-pill">
              <span>●</span>
              <span>6-Digit OTP + Parcel Photo Verification</span>
            </div>
            <h2>Select a Stop From Your Route Console</h2>
            <p>
              Each customer delivery uses a unique signed Proof-of-Delivery token. Open your <strong>Rider Route Manifest</strong> to tap into any active stop, or paste a signed handoff link below.
            </p>
          </section>

          <section className="rp-step-card">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Link
                to={manifestToken ? `/rider-manifest?token=${encodeURIComponent(manifestToken)}` : '/rider-manifest'}
                className="rp-primary-cta rp-primary-cta--gold"
              >
                Open Rider Route Console →
              </Link>
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <label htmlFor="rh-paste-input" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, marginBottom: 6 }}>
                Or Paste Direct Handoff / Route Link
              </label>
              <form onSubmit={handleOpenPastedLink} className="rp-link-input-row" style={{ marginTop: 0 }}>
                <input
                  id="rh-paste-input"
                  type="text"
                  className="rp-search-input"
                  style={{ paddingLeft: 14, flex: 1 }}
                  placeholder="Paste https://.../rider-handoff?token=... or route link"
                  value={pasteValue}
                  onChange={e => { setPasteValue(e.target.value); setPasteError(''); }}
                />
                <button type="submit" className="rp-primary-cta" style={{ width: 'auto', minWidth: 150 }}>
                  Open Stop →
                </button>
              </form>
              {pasteError && (
                <div style={{ marginTop: 8, fontSize: '0.8rem', fontWeight: 700, color: '#b91c1c' }}>
                  {pasteError}
                </div>
              )}
            </div>

            {(supportWa || supportPhone) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                {supportWa && (
                  <a
                    href={`https://wa.me/${supportWa}?text=${encodeURIComponent('Hello BodyCream GH Dispatch, please resend my active delivery link.')}`}
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
                    📞 Call Dispatch
                  </a>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // ── 3. Completed / Digital POD Certificate Screen ─────────────────────────
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
                <h1 className="rp-rider-title">Order #{info.order_number}</h1>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: '#64748b' }}>Settlement</span>
                <strong style={{ color: '#065f46', textAlign: 'right' }}>{codSummary}</strong>
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

            <Link
              to={manifestToken ? `/rider-manifest?token=${encodeURIComponent(manifestToken)}` : '/rider-manifest'}
              className="rp-primary-cta rp-primary-cta--gold"
            >
              ← Back to Next Stop on Route
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── 4. Active Doorstep Verification Flow ──────────────────────────────────
  const navTarget = info.ghana_post_gps
    ? `${info.address || ''} ${info.ghana_post_gps}`.trim()
    : info.address;
  const mapsQuery = navTarget
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(navTarget)}`
    : null;
  const customerWa = formatPhoneForWa(info.customer_phone);

  return (
    <div className="rp-shell">
      {/* ── Sticky Handoff Topbar ───────────────────────────────────── */}
      <header className="rp-topbar">
        <div className="rp-topbar-inner">
          <Link
            to={manifestToken ? `/rider-manifest?token=${encodeURIComponent(manifestToken)}` : '/rider-manifest'}
            className="rp-sync-btn"
          >
            ← Route
          </Link>

          <div style={{ textAlign: 'center', minWidth: 0 }}>
            <div className="rp-eyebrow">Doorstep Verification</div>
            <h1 className="rp-rider-title">Order #{info.order_number}</h1>
          </div>

          <span className="rp-zone-badge">{info.zone_code}</span>
        </div>
        {!isOnline && (
          <div className="rp-offline-bar">
            Offline — turn on mobile data before submitting verification
          </div>
        )}
      </header>

      <div className="rp-container">
        {/* ── Stop Overview, Customer Contact & Payment Alert ────────── */}
        <section className="rp-step-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: '1.12rem', fontWeight: 800 }}>
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

          <div className="rp-address-box">
            <div className="rp-address-text">
              📍 {info.address || 'No street address'}
            </div>
            {(info.ghana_post_gps || info.delivery_landmark) && (
              <div className="rp-location-extras">
                {info.ghana_post_gps && (
                  <span className="rp-gps-code-pill">GPS: {info.ghana_post_gps}</span>
                )}
                {info.delivery_landmark && (
                  <span className="rp-landmark-pill">Landmark: {info.delivery_landmark}</span>
                )}
              </div>
            )}
          </div>

          {info.customer_phone && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <a href={`tel:${info.customer_phone}`} className="rp-act-btn">
                📞 Call Customer
              </a>
              {customerWa && (
                <a
                  href={`https://wa.me/${customerWa}?text=${encodeURIComponent(
                    `Hello ${info.recipient_first_name}, your BodyCream GH rider has arrived outside with Order #${info.order_number}. Please share your 6-digit delivery code on handoff.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rp-act-btn rp-act-btn--wa"
                >
                  💬 I&apos;ve Arrived
                </a>
              )}
            </div>
          )}

          <div className={`rp-pay-banner ${info.cod_amount_due > 0 ? 'rp-pay-banner--cod' : 'rp-pay-banner--prepaid'}`} style={{ marginBottom: 0 }}>
            <span>
              {info.cod_amount_due > 0
                ? `Collect GHS ${Number(info.cod_amount_due).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Before Handoff`
                : '✓ Paid Online — Do Not Collect Cash'}
            </span>
          </div>
        </section>

        {error && (
          <div role="alert" style={{ background: '#fef2f2', border: '1.5px solid #ef4444', color: '#991b1b', padding: '12px 14px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 700, marginBottom: 14 }}>
            ⚠ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* ── STEP 1: 6-Box Segmented OTP Verification ────────────── */}
          <section className="rp-step-card">
            <div className="rp-step-head">
              <span className={`rp-step-num${otpComplete ? ' is-done' : ''}`}>
                {otpComplete ? '✓' : '1'}
              </span>
              <div>
                <div className="rp-step-title">Customer&apos;s 6-Digit Delivery Code</div>
                <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                  Ask the customer for the 6-digit code sent via SMS or email.
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem', color: '#64748b', flexWrap: 'wrap', gap: 8 }}>
              <span>Attempts left: <strong>{info.attempts_remaining}</strong></span>
              <button
                type="button"
                disabled={resendingOtp}
                onClick={handleResendOtp}
                style={{ background: 'none', border: 'none', minHeight: 40, padding: '8px 4px', color: '#b45309', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {resendingOtp ? 'Sending code…' : 'Resend 6-digit code to customer'}
              </button>
            </div>

            {otpNotice && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#065f46', background: '#ecfdf5', padding: '8px 10px', borderRadius: 8, fontWeight: 700 }}>
                {otpNotice}
              </div>
            )}
          </section>

          {/* ── STEP 2: Live Parcel Photo & GPS Lock ────────────────── */}
          <section className="rp-step-card" ref={photoStepRef}>
            <div className="rp-step-head">
              <span className={`rp-step-num${photoUrl ? ' is-done' : ''}`}>
                {photoUrl ? '✓' : '2'}
              </span>
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
                    style={{ flex: 1, minHeight: 44, padding: '8px 12px' }}
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
                  style={{ width: '100%', minHeight: 50, borderStyle: 'dashed', borderWidth: 2 }}
                  disabled={uploading}
                  onClick={startLiveCamera}
                >
                  {uploading ? 'Compressing & uploading photo…' : '📷 Open Rear Camera'}
                </button>

                <label className="rp-act-btn" style={{ width: '100%', fontSize: '0.78rem', color: '#334155' }}>
                  <span>{uploading ? 'Uploading…' : '📱 Or Use Phone Camera App'}</span>
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
              <span className={`rp-step-num${codReady ? ' is-done' : ''}`}>
                {codReady ? '✓' : '3'}
              </span>
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

          {/* ── Readiness Checklist + Primary Submit CTA ────────────── */}
          <div className="rp-readiness-bar" aria-label="Delivery verification checklist">
            <div className={`rp-ready-chip${otpComplete ? ' is-ready' : ''}`}>
              {otpComplete ? '✓ 6-Digit Code' : '○ 6-Digit Code'}
            </div>
            <div className={`rp-ready-chip${photoUrl ? ' is-ready' : ''}`}>
              {photoUrl ? '✓ Parcel Photo' : '○ Parcel Photo'}
            </div>
            <div className={`rp-ready-chip${codReady ? ' is-ready' : ''}`}>
              {codReady ? '✓ Settlement' : '○ MoMo Ref'}
            </div>
          </div>

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
