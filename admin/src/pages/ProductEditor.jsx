import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import ProductImageGallery from '../components/ProductImageGallery';
import VariantManager from '../components/VariantManager';

// Slug-ish auto-SKU — "Shea Butter Cream 200g" → "SHE-BUT-CRE-200"
const suggestSku = (name) => {
  if (!name) return '';
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map(w => w.slice(0, 3))
    .join('-');
};

const CANONICAL_CATEGORIES = [
  'Body Cream',
  'Body Butter',
  'Body Oil',
  'Body Scrub',
  'Body Mask',
];

const EMPTY = {
  name: '', description: '', price: '', cost: '', compare_at_price: '',
  category: '', brand: '', image_url: '',
  stock_quantity: 0, sku: '',
  ingredients: '', usage_instructions: '',
  is_active: true,
};

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();

  const [form,              setForm]              = useState(EMPTY);
  const [initialImages,     setInitialImages]     = useState([]);
  const [stagedFiles,       setStagedFiles]       = useState([]);
  const [loading,           setLoading]           = useState(!isNew);
  const [saving,            setSaving]            = useState(false);
  const [uploadingText,     setUploadingText]     = useState('');
  const [error,             setError]             = useState('');
  const [summaryErrors,     setSummaryErrors]     = useState([]);
  const [fieldErrors,       setFieldErrors]       = useState({});
  const [isCustomCategory,  setIsCustomCategory]  = useState(false);

  useEffect(() => {
    if (isNew) return;
    productsAPI.getById(id)
      .then(({ data }) => {
        setForm({ ...EMPTY, ...data });
        setInitialImages(data.images || []);
        if (data.category && !CANONICAL_CATEGORIES.includes(data.category)) {
          setIsCustomCategory(true);
        }
      })
      .catch(() => setError('Product not found.'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const update = (k, v) => {
    setForm(prev => ({ ...prev, [k]: v }));
    // Clear field-level error when edited
    if (fieldErrors[k] || (k === 'price' && fieldErrors.compare_at_price) || (k === 'compare_at_price' && fieldErrors.price)) {
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[k];
        if (k === 'price') delete next.compare_at_price;
        if (k === 'compare_at_price') delete next.price;
        return next;
      });
    }
  };

  const handleCustomCategoryBlur = (e) => {
    const raw = e.target.value.trim();
    if (raw) {
      const normalized = raw
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      update('category', normalized);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return; // Prevent double submit

    setError('');
    setSummaryErrors([]);
    setFieldErrors({});
    setSaving(true);
    setUploadingText('');

    // Build the payload with numeric casts — the backend validator expects numbers.
    const payload = {
      ...form,
      name:              typeof form.name === 'string' ? form.name.trim() : form.name,
      price:             Number(form.price),
      cost:              form.cost === '' || form.cost === null ? null : Number(form.cost),
      compare_at_price:  form.compare_at_price === '' || form.compare_at_price === null ? null : Number(form.compare_at_price),
      stock_quantity:    form.stock_quantity === '' ? 0 : Number(form.stock_quantity),
      sku:               form.sku === '' || form.sku === null ? null : String(form.sku).trim(),
      category:          form.category === '' || form.category === null ? null : String(form.category).trim(),
    };

    try {
      if (isNew) {
        if (stagedFiles.length > 0) {
          setUploadingText('Creating product and uploading images...');
        }
        const { data } = await productsAPI.create(payload);
        const newId = data.id || data.product?.id;

        if (stagedFiles.length > 0) {
          try {
            await productsAPI.uploadProductImages(newId, stagedFiles);
            toast.success('Product created with images');
            navigate(`/products/${newId}`);
          } catch (uploadErr) {
            const reason = uploadErr.response?.data?.error || uploadErr.message || 'Server error';
            toast.warning(`Product created, but image upload failed: ${reason}. Re-upload in the gallery.`);
            navigate(`/products/${newId}`);
          }
        } else {
          toast.success('Product created');
          navigate(`/products/${newId}`);
        }
      } else {
        await productsAPI.update(id, payload);
        toast.success('Saved');
      }
    } catch (err) {
      const resp = err.response?.data;

      // Handle structured errors array from backend 400 and 409
      if (resp?.errors && Array.isArray(resp.errors) && resp.errors.length > 0) {
        const fieldMap = {};
        const messages = [];
        resp.errors.forEach(e => {
          if (e.field) fieldMap[e.field] = e.message;
          if (e.message && !messages.includes(e.message)) messages.push(e.message);
        });
        setFieldErrors(fieldMap);
        setSummaryErrors(messages);
        setError(resp.error || 'Please correct the errors indicated below.');
      } else if (resp?.error) {
        setFieldErrors({});
        setSummaryErrors([resp.error]);
        setError(resp.error);
      } else {
        setFieldErrors({});
        setSummaryErrors(['Save failed. Please check the fields and try again.']);
        setError('Save failed.');
      }
    } finally {
      setSaving(false);
      setUploadingText('');
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="page-header">
        <div>
          <Link to="/products" className="muted text-sm" style={{ textDecoration: 'none' }}>← Back to products</Link>
          <h1 style={{ marginTop: 6 }}>{isNew ? 'New product' : (form.name || 'Edit product')}</h1>
        </div>
        <div className="page-actions">
          <Link to="/products" className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? (uploadingText || (isNew ? 'Creating product…' : 'Saving…')) : isNew ? 'Create product' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* ── TOP ERROR SUMMARY ─────────────────────────────────── */}
      {(error || summaryErrors.length > 0) && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600 }}>
            {error || 'Validation failed. Please correct the errors below.'}
          </div>
          {summaryErrors.length > 0 && (
            <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: '0.9rem' }}>
              {summaryErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }} className="pe-grid">

        {/* ── LEFT: main details ──────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Basics</h2></div>
            <div className="card-body">
              <div className="field">
                <label>Product name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => {
                    update('name', e.target.value);
                    // Only auto-suggest SKU while creating and if blank
                    if (isNew && !form.sku) update('sku', suggestSku(e.target.value));
                  }}
                  placeholder="e.g. Shea Butter Body Cream 200g"
                  className={fieldErrors.name ? 'input-error' : ''}
                  required
                />
                {fieldErrors.name && (
                  <div className="field-error-msg">{fieldErrors.name}</div>
                )}
              </div>

              <div className="field">
                <label>Description</label>
                <textarea
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  rows={5}
                  placeholder="Tell customers what makes this product special. Shown on the product page."
                />
                <div className="hint">Appears on the product page. First sentence shows in search results — make it count.</div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Category</label>
                  {!isCustomCategory ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        value={CANONICAL_CATEGORIES.includes(form.category) ? form.category : (form.category ? '__existing__' : '')}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '__custom__') {
                            setIsCustomCategory(true);
                            update('category', '');
                          } else if (val === '__existing__') {
                            // Keep existing value
                          } else {
                            update('category', val);
                          }
                        }}
                        className={fieldErrors.category ? 'input-error' : ''}
                        style={{ flex: 1 }}
                      >
                        <option value="">Select a category...</option>
                        {CANONICAL_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                        {form.category && !CANONICAL_CATEGORIES.includes(form.category) && (
                          <option value="__existing__">{form.category} (current)</option>
                        )}
                        <option value="__custom__">+ Custom category...</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setIsCustomCategory(true);
                          update('category', '');
                        }}
                        title="Add a custom category"
                      >
                        + Custom
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={form.category}
                        onChange={e => update('category', e.target.value)}
                        onBlur={handleCustomCategoryBlur}
                        placeholder="e.g. Body Wash"
                        className={fieldErrors.category ? 'input-error' : ''}
                        style={{ flex: 1 }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setIsCustomCategory(false);
                          update('category', CANONICAL_CATEGORIES[0]);
                        }}
                      >
                        Standard categories
                      </button>
                    </div>
                  )}
                  <div className="hint">Storefront catalog filters use these categories.</div>
                  {fieldErrors.category && (
                    <div className="field-error-msg">{fieldErrors.category}</div>
                  )}
                </div>
                <div className="field">
                  <label>Brand</label>
                  <input
                    type="text"
                    value={form.brand}
                    onChange={e => update('brand', e.target.value)}
                    placeholder="Your brand name"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Details for customers</h2></div>
            <div className="card-body">
              <div className="field">
                <label>Ingredients</label>
                <textarea
                  value={form.ingredients}
                  onChange={e => update('ingredients', e.target.value)}
                  rows={3}
                  placeholder="Shea butter, cocoa butter, vitamin E, jojoba oil, rose essential oil…"
                />
                <div className="hint">Shown on the product page. Listing ingredients builds trust.</div>
              </div>

              <div className="field">
                <label>Usage instructions</label>
                <textarea
                  value={form.usage_instructions}
                  onChange={e => update('usage_instructions', e.target.value)}
                  rows={3}
                  placeholder="Apply a small amount to clean skin. Massage in circular motions until fully absorbed."
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Pricing</h2></div>
            <div className="card-body">
              <div className="field-row">
                <div className="field">
                  <label>Price (GHS) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={e => update('price', e.target.value)}
                    placeholder="0.00"
                    className={fieldErrors.price ? 'input-error' : ''}
                    required
                  />
                  <div className="hint">What customers pay.</div>
                  {fieldErrors.price && (
                    <div className="field-error-msg">{fieldErrors.price}</div>
                  )}
                </div>
                <div className="field">
                  <label>Cost (GHS)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost ?? ''}
                    onChange={e => update('cost', e.target.value)}
                    placeholder="0.00"
                    className={fieldErrors.cost ? 'input-error' : ''}
                  />
                  <div className="hint">What it costs you — used for profit reporting. Optional.</div>
                  {fieldErrors.cost && (
                    <div className="field-error-msg">{fieldErrors.cost}</div>
                  )}
                </div>
              </div>
              {form.price && form.cost !== '' && form.cost !== null && Number(form.cost) >= 0 && Number(form.price) > 0 && (
                <div className="alert alert-info" style={{ marginTop: 8, marginBottom: 0 }}>
                  Profit: <strong>GHS {(Number(form.price) - Number(form.cost)).toFixed(2)}</strong>
                  {' '}| Margin: <strong>{Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)}%</strong>
                  {Number(form.cost) > 0 && (
                    <> | Markup: <strong>{Math.round(((Number(form.price) - Number(form.cost)) / Number(form.cost)) * 100)}%</strong></>
                  )}
                </div>
              )}

              <div className="field" style={{ marginTop: 12 }}>
                <label>Compare at price (GHS)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.compare_at_price ?? ''}
                  onChange={e => update('compare_at_price', e.target.value)}
                  placeholder="Leave blank for no sale"
                  className={fieldErrors.compare_at_price ? 'input-error' : ''}
                />
                <div className="hint">
                  Optional — shows as crossed-out original price. Leave blank for no sale display.
                </div>
                {fieldErrors.compare_at_price && (
                  <div className="field-error-msg">{fieldErrors.compare_at_price}</div>
                )}
                {form.compare_at_price && form.price &&
                  Number(form.compare_at_price) > Number(form.price) && (
                  <div className="alert alert-info" style={{ marginTop: 6, marginBottom: 0 }}>
                    Showing as: <strong>GHS {Number(form.price).toFixed(2)}</strong>{' '}
                    <span style={{ textDecoration: 'line-through', color: 'var(--ac-muted)' }}>
                      GHS {Number(form.compare_at_price).toFixed(2)}
                    </span>{' '}
                    — {Math.round((1 - Number(form.price) / Number(form.compare_at_price)) * 100)}% off
                  </div>
                )}
                {form.compare_at_price && form.price &&
                  Number(form.compare_at_price) > 0 &&
                  Number(form.compare_at_price) <= Number(form.price) && !fieldErrors.compare_at_price && (
                  <div className="alert alert-warning" style={{ marginTop: 6, marginBottom: 0 }}>
                    Compare at price must be higher than the selling price to show a sale.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: image + stock + SKU ──────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Images</h2></div>
            <div className="card-body">
              <ProductImageGallery
                productId={isNew ? null : id}
                initialImages={initialImages}
                stagedFiles={stagedFiles}
                onStagedChange={setStagedFiles}
              />
            </div>
          </div>

          <div className="card" style={{ opacity: 0.7 }}>
            <div className="card-header">
              <h2 className="card-title" style={{ fontSize: '0.82rem', color: 'var(--ac-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Legacy fallback — not the main image system
              </h2>
            </div>
            <div className="card-body">
              <div className="hint" style={{ marginBottom: 12 }}>
                Upload product photos using the <strong>Images</strong> gallery above.
                This URL is only used as a last-resort fallback when the gallery has no images.
                It is hidden from customers as soon as any gallery image exists.
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ color: 'var(--ac-muted, #888)' }}>Legacy fallback image URL</label>
                <input
                  type="url"
                  value={form.image_url}
                  onChange={e => update('image_url', e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Inventory</h2></div>
            <div className="card-body">
              <div className="field">
                <label>Stock quantity</label>
                <input
                  type="number"
                  min="0"
                  value={form.stock_quantity}
                  onChange={e => update('stock_quantity', e.target.value)}
                  className={fieldErrors.stock_quantity ? 'input-error' : ''}
                />
                <div className="hint">Decreases automatically when orders are placed.</div>
                {fieldErrors.stock_quantity && (
                  <div className="field-error-msg">{fieldErrors.stock_quantity}</div>
                )}
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={e => update('sku', e.target.value)}
                  style={{ fontFamily: 'SF Mono, Menlo, monospace' }}
                  placeholder="SKU-CODE"
                  className={fieldErrors.sku ? 'input-error' : ''}
                />
                <div className="hint">Unique internal code — auto-suggested from the name.</div>
                {fieldErrors.sku && (
                  <div className="field-error-msg">{fieldErrors.sku}</div>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Visibility</h2></div>
            <div className="card-body">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.is_active !== false}
                  onChange={e => update('is_active', e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Visible on storefront</div>
                  <div className="hint" style={{ marginTop: 2 }}>Uncheck to hide this product from customers without deleting it.</div>
                </div>
              </label>
            </div>
          </div>

        </div>
      </div>

      {/* ── Variants ── only shown after product is saved ─────── */}
      {!isNew && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h2 className="card-title">Product Variants</h2>
            <p className="muted" style={{ marginTop: 4, fontSize: '0.83rem' }}>
              Define option types (e.g. Size, Scent) and the system generates all combinations.
              Each combination is its own variant with its own price and stock.
              Products with no variants use the base price and stock above.
            </p>
          </div>
          <div className="card-body">
            <VariantManager productId={id} />
          </div>
        </div>
      )}
      {isNew && (
        <div className="alert alert-info" style={{ marginTop: 16 }}>
          Save this product first, then return here to add variants (sizes, scents, bundles, etc.).
        </div>
      )}

      <style>{`
        .input-error {
          border-color: #ef4444 !important;
          background-color: #fff5f5 !important;
          box-shadow: 0 0 0 1px #ef4444;
        }
        .field-error-msg {
          color: #ef4444;
          font-size: 0.82rem;
          font-weight: 500;
          margin-top: 5px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        @media (max-width: 900px) {
          .pe-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </form>
  );
}
