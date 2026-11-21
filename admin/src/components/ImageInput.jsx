import { useState, useRef } from 'react';
import { adminAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ACCEPTED = 'image/jpeg,image/jpg,image/png,image/webp';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export default function ImageInput({
  value = '',
  onChange,
  label,
  hint,
  placeholder = 'https://…',
  aspectRatio = 'auto',
  className = '',
}) {
  const [mode, setMode] = useState('upload'); // 'upload' | 'url'
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [imgError, setImgError] = useState(false);
  const fileRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // 1. Client-side MIME validation
    const typeValid = ALLOWED_MIME_TYPES.has(file.type.toLowerCase()) ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!typeValid) {
      setError(`"${file.name}" is not supported. Please choose a JPEG, PNG, or WebP image.`);
      return;
    }

    // 2. Client-side size validation
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setError(`"${file.name}" exceeds the 5 MB limit (${sizeMB} MB). Please choose a smaller file.`);
      return;
    }

    setError('');
    setImgError(false);
    setUploading(true);

    try {
      const { data } = await adminAPI.uploadMedia(file);
      onChange?.(data.url);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setError('');
    setImgError(false);
    onChange?.('');
  };

  const hasValue = Boolean(value && String(value).trim() !== '');

  return (
    <div className={`image-input-container ${className}`} style={{ marginBottom: 16 }}>
      {label && <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '0.88rem' }}>{label}</label>}

      {/* Mode toggle tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'upload' ? 'btn-primary' : 'btn-outline'}`}
          style={{ fontSize: '0.78rem', padding: '3px 10px' }}
          onClick={() => { setMode('upload'); setError(''); }}
        >
          Upload Photo
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'url' ? 'btn-primary' : 'btn-outline'}`}
          style={{ fontSize: '0.78rem', padding: '3px 10px' }}
          onClick={() => { setMode('url'); setError(''); }}
        >
          Image Link (URL)
        </button>
      </div>

      {/* Upload Mode UI */}
      {mode === 'upload' && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={uploading}
          />

          {!hasValue ? (
            <div
              style={{
                border: '1.5px dashed var(--ac-border-strong, #ccc)',
                borderRadius: 'var(--ac-radius, 6px)',
                padding: '20px 16px',
                textAlign: 'center',
                background: 'var(--ac-bg, #fafafa)',
                cursor: uploading ? 'not-allowed' : 'pointer',
                transition: 'border-color 0.15s ease',
              }}
              onClick={() => !uploading && fileRef.current?.click()}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6, color: 'var(--ac-text-muted)' }}>
                {uploading ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                )}
              </div>
              <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--ac-text)' }}>
                {uploading ? 'Uploading image…' : 'Click to choose image from device'}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--ac-text-muted)', marginTop: 2 }}>
                JPEG, PNG, or WebP up to 5 MB
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)', padding: 10, borderRadius: 'var(--ac-radius)' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : 'Change photo'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--ac-danger)' }}
                onClick={handleClear}
                disabled={uploading}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {/* URL Mode UI */}
      {mode === 'url' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="url"
            value={value}
            onChange={(e) => {
              setImgError(false);
              onChange?.(e.target.value);
            }}
            placeholder={placeholder}
            style={{ flex: 1 }}
          />
          {hasValue && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--ac-danger)' }}
              onClick={handleClear}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{ color: 'var(--ac-danger)', fontSize: '0.8rem', marginTop: 6, fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* Live Preview Display */}
      {hasValue && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, padding: 8, background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)', borderRadius: 'var(--ac-radius)' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 'var(--ac-radius)',
              overflow: 'hidden',
              background: 'var(--ac-border)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: aspectRatio !== 'auto' ? aspectRatio : '1/1',
            }}
          >
            {!imgError ? (
              <img
                src={resolveImageUrl(value)}
                alt="Preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={() => setImgError(true)}
              />
            ) : (
              <span style={{ fontSize: '0.7rem', color: 'var(--ac-text-muted)', textAlign: 'center', padding: 2 }}>
                No preview
              </span>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ac-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--ac-text-muted)', marginTop: 2 }}>
              {value.startsWith('/uploads/') ? 'Hosted locally on server' : 'External link'}
            </div>
          </div>
        </div>
      )}

      {hint && <div className="hint" style={{ marginTop: 6 }}>{hint}</div>}
    </div>
  );
}
