import { useState, useEffect, useRef } from 'react';
import { productsAPI } from '../services/api';
import './ProductImageGallery.css';

const MAX_IMAGES = 8;
const ACCEPTED   = 'image/jpeg,image/jpg,image/png,image/webp';

// Resolve a relative /uploads/... URL to an absolute URL using the API origin.
// In dev, VITE_API_URL is something like 'http://localhost:3000/api'.
// In production, it is 'https://api.yourdomain.com/api'.
// Extracting .origin gives us the server root where /uploads is served.
const _apiUrl = import.meta.env.VITE_API_URL || '';
function resolveImageUrl(url) {
  if (!url || url.startsWith('http')) return url;
  if (_apiUrl.startsWith('http')) {
    try { return `${new URL(_apiUrl).origin}${url}`; } catch { /* fall through */ }
  }
  return url; // relative — works with Vite /uploads proxy in dev
}

export default function ProductImageGallery({ productId, initialImages = [], onImagesChange }) {
  const [images, setImages] = useState(initialImages);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');
  const fileRef = useRef(null);

  // When navigating to a different product, reset to that product's images.
  useEffect(() => {
    setImages(initialImages);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (!productId) {
    return <p className="pig-unsaved">Save the product first, then add images.</p>;
  }

  function syncImages(updated) {
    setImages(updated);
    onImagesChange?.(updated);
  }

  // ── Upload ──────────────────────────────────────────────────────────────────
  async function handleUpload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same files if needed
    if (!files.length) return;

    if (images.length + files.length > MAX_IMAGES) {
      setError(
        `Cannot upload ${files.length} file${files.length !== 1 ? 's' : ''}: ` +
        `product already has ${images.length} image${images.length !== 1 ? 's' : ''} ` +
        `(max ${MAX_IMAGES}).`
      );
      return;
    }

    setError('');
    setBusy(true);
    try {
      const { data } = await productsAPI.uploadProductImages(productId, files);
      syncImages(data.images);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(imageId) {
    if (!window.confirm('Delete this image? This cannot be undone.')) return;
    setError('');
    setBusy(true);
    try {
      const { data } = await productsAPI.deleteProductImage(productId, imageId);
      syncImages(data.images);
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  // ── Set primary ─────────────────────────────────────────────────────────────
  async function handleSetPrimary(imageId) {
    setError('');
    setBusy(true);
    try {
      const { data } = await productsAPI.setPrimaryProductImage(productId, imageId);
      syncImages(data.images);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set primary image.');
    } finally {
      setBusy(false);
    }
  }

  // ── Reorder (move left / right) ─────────────────────────────────────────────
  async function handleMove(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const newOrder = images.map(img => img.id);
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];

    setError('');
    setBusy(true);
    try {
      const { data } = await productsAPI.reorderProductImages(productId, newOrder);
      syncImages(data.images);
    } catch (err) {
      setError(err.response?.data?.error || 'Reorder failed.');
    } finally {
      setBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`pig${busy ? ' pig--busy' : ''}`}>

      <div className="pig-header">
        <span className="pig-count">{images.length} / {MAX_IMAGES}</span>
        {images.length < MAX_IMAGES && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            + Add images
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          multiple
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
      </div>

      {error && <div className="pig-error" role="alert">{error}</div>}

      {images.length === 0 ? (
        <div className="pig-empty">
          <div className="pig-empty-icon">+</div>
          <p>Upload up to {MAX_IMAGES} product photos.</p>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            + Add images
          </button>
        </div>
      ) : (
        <div className="pig-grid">
          {images.map((img, index) => (
            <div
              key={img.id}
              className={`pig-item${img.is_primary ? ' pig-item--primary' : ''}`}
            >
              <div className="pig-thumb">
                <img
                  src={resolveImageUrl(img.url)}
                  alt={img.original_name || 'Product image'}
                  onError={e => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }}
                />
                <div className="pig-fallback" aria-hidden="true">?</div>
                {img.is_primary && <span className="pig-badge">Primary</span>}
              </div>

              {img.original_name && (
                <div className="pig-name" title={img.original_name}>
                  {img.original_name}
                </div>
              )}

              <div className="pig-controls">
                <button
                  type="button"
                  className={`pig-ctrl${img.is_primary ? ' pig-ctrl--star-active' : ''}`}
                  title={img.is_primary ? 'Primary image' : 'Set as primary'}
                  disabled={busy || img.is_primary}
                  onClick={() => handleSetPrimary(img.id)}
                >
                  &#9733;
                </button>
                <button
                  type="button"
                  className="pig-ctrl"
                  title="Move left"
                  disabled={busy || index === 0}
                  onClick={() => handleMove(index, -1)}
                >
                  &#8592;
                </button>
                <button
                  type="button"
                  className="pig-ctrl"
                  title="Move right"
                  disabled={busy || index === images.length - 1}
                  onClick={() => handleMove(index, 1)}
                >
                  &#8594;
                </button>
                <button
                  type="button"
                  className="pig-ctrl pig-ctrl--delete"
                  title="Delete image"
                  disabled={busy}
                  onClick={() => handleDelete(img.id)}
                >
                  &#215;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {busy && <p className="pig-loading">Working&hellip;</p>}

    </div>
  );
}
