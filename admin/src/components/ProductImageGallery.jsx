import { useState, useEffect, useRef } from 'react';
import { productsAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './ProductImageGallery.css';

const MAX_IMAGES = 8;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ACCEPTED   = 'image/jpeg,image/jpg,image/png,image/webp';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export default function ProductImageGallery({
  productId,
  initialImages = [],
  onImagesChange,
  stagedFiles = [],
  onStagedChange,
}) {
  const [images, setImages] = useState(initialImages);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');
  const fileRef = useRef(null);

  // Object URL tracking for staged files: Map<File, string>
  const previewMapRef = useRef(new Map());

  // Helper to retrieve or create a stable Object URL for a staged file
  const getPreviewUrl = (file) => {
    if (!previewMapRef.current.has(file)) {
      previewMapRef.current.set(file, URL.createObjectURL(file));
    }
    return previewMapRef.current.get(file);
  };

  // Revoke all Object URLs on unmount
  useEffect(() => {
    const map = previewMapRef.current;
    return () => {
      map.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      map.clear();
    };
  }, []);

  // Sync internal images state whenever the parent finishes loading product data
  // (initialImages goes from [] to the real array after the async fetch) OR
  // when the user navigates to a different product (productId changes).
  useEffect(() => {
    setImages(initialImages);
    setError('');
  }, [productId, initialImages]);

  function syncImages(updated) {
    setImages(updated);
    onImagesChange?.(updated);
  }

  // ── Staged Mode Handlers (Create Mode: !productId) ──────────────────────────

  function handleStagedSelect(e) {
    const selected = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting same file
    if (!selected.length) return;

    // Check count limit
    if (stagedFiles.length + selected.length > MAX_IMAGES) {
      setError(
        `Cannot add ${selected.length} file${selected.length !== 1 ? 's' : ''}: ` +
        `product already has ${stagedFiles.length} image${stagedFiles.length !== 1 ? 's' : ''} ` +
        `(max ${MAX_IMAGES}).`
      );
      return;
    }

    // Validate type and size per file
    const validFiles = [];
    for (const file of selected) {
      const typeValid = ALLOWED_MIME_TYPES.has(file.type.toLowerCase()) ||
        /\.(jpe?g|png|webp)$/i.test(file.name);

      if (!typeValid) {
        setError(`"${file.name}" is not a supported format. Please upload JPEG, PNG, or WebP images.`);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        setError(`"${file.name}" exceeds the 5 MB limit (${sizeMB} MB). Please choose a smaller image.`);
        return;
      }

      validFiles.push(file);
    }

    setError('');
    onStagedChange?.([...stagedFiles, ...validFiles]);
  }

  function handleRemoveStaged(index) {
    const fileToRemove = stagedFiles[index];
    if (fileToRemove) {
      const url = previewMapRef.current.get(fileToRemove);
      if (url) {
        URL.revokeObjectURL(url);
        previewMapRef.current.delete(fileToRemove);
      }
    }
    const next = stagedFiles.filter((_, i) => i !== index);
    onStagedChange?.(next);
  }

  function handleSetPrimaryStaged(index) {
    if (index === 0) return;
    const target = stagedFiles[index];
    const next = [target, ...stagedFiles.filter((_, i) => i !== index)];
    onStagedChange?.(next);
  }

  function handleMoveStaged(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= stagedFiles.length) return;
    const next = [...stagedFiles];
    [next[index], next[target]] = [next[target], next[index]];
    onStagedChange?.(next);
  }

  // ── Edit Mode Handlers (Server-backed: productId present) ───────────────────

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

  // ── Render: Staged Mode (Create Mode) ───────────────────────────────────────
  if (!productId) {
    return (
      <div className="pig">
        <div className="pig-header">
          <span className="pig-count">{stagedFiles.length} / {MAX_IMAGES}</span>
          {stagedFiles.length < MAX_IMAGES && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
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
            onChange={handleStagedSelect}
          />
        </div>

        {error && <div className="pig-error" role="alert">{error}</div>}

        {stagedFiles.length === 0 ? (
          <div className="pig-empty">
            <div className="pig-empty-icon">+</div>
            <p>Select up to {MAX_IMAGES} product photos.</p>
            <p className="pig-unsaved" style={{ marginTop: -4 }}>
              Photos will be uploaded automatically when you create the product.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => fileRef.current?.click()}
            >
              + Add images
            </button>
          </div>
        ) : (
          <div className="pig-grid">
            {stagedFiles.map((file, index) => {
              const isPrimary = index === 0;
              const previewUrl = getPreviewUrl(file);
              return (
                <div
                  key={`${file.name}-${file.size}-${index}`}
                  className={`pig-item${isPrimary ? ' pig-item--primary' : ''}`}
                >
                  <div className="pig-thumb">
                    <img
                      src={previewUrl}
                      alt={file.name}
                      onError={e => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }}
                    />
                    <div className="pig-fallback" aria-hidden="true">?</div>
                    {isPrimary && <span className="pig-badge">Primary</span>}
                  </div>

                  <div className="pig-name" title={file.name}>
                    {file.name}
                  </div>

                  <div className="pig-controls">
                    <button
                      type="button"
                      className={`pig-ctrl${isPrimary ? ' pig-ctrl--star-active' : ''}`}
                      title={isPrimary ? 'Primary image' : 'Set as primary (moves to first position)'}
                      disabled={isPrimary}
                      onClick={() => handleSetPrimaryStaged(index)}
                    >
                      &#9733;
                    </button>
                    <button
                      type="button"
                      className="pig-ctrl"
                      title="Move left"
                      disabled={index === 0}
                      onClick={() => handleMoveStaged(index, -1)}
                    >
                      &#8592;
                    </button>
                    <button
                      type="button"
                      className="pig-ctrl"
                      title="Move right"
                      disabled={index === stagedFiles.length - 1}
                      onClick={() => handleMoveStaged(index, 1)}
                    >
                      &#8594;
                    </button>
                    <button
                      type="button"
                      className="pig-ctrl pig-ctrl--delete"
                      title="Remove image"
                      onClick={() => handleRemoveStaged(index)}
                    >
                      &#215;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Render: Edit Mode (Existing Product) ────────────────────────────────────
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
