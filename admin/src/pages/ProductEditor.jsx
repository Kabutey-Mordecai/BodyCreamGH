import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import ProductImageGallery from '../components/ProductImageGallery';
import ImageInput from '../components/ImageInput';
import VariantManager from '../components/VariantManager';
import UnsavedChangesBar from '../components/UnsavedChangesBar';

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

import { GHANA_COSMETICS_BRANDS } from '../data/ghanaBrands';

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

  const formRef = useRef(null);
  const [form,          setForm]          = useState(EMPTY);
  const [initialForm,   setInitialForm]   = useState(EMPTY);
  const [initialImages, setInitialImages] = useState([]);
  const [stagedFiles,   setStagedFiles]   = useState([]);
  const [loading,       setLoading]       = useState(!isNew);
  const [saving,        setSaving]        = useState(false);
  const [uploadingText, setUploadingText] = useState('');
  const [error,         setError]         = useState('');
  const [catOptions,    setCatOptions]    = useState([]);
  const [brandOptions,  setBrandOptions]  = useState(GHANA_COSMETICS_BRANDS);
  const [skuTouched,    setSkuTouched]    = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm),
    [form, initialForm]
  );

  useEffect(() => {
    productsAPI.getCategories()
      .then(({ data }) => {
        if (Array.isArray(data?.categories)) setCatOptions(data.categories);
      })
      .catch(() => {});
    productsAPI.getBrands()
      .then(({ data }) => {
        if (Array.isArray(data?.brands)) {
          const merged = Array.from(new Set([...GHANA_COSMETICS_BRANDS, ...data.brands]))
            .sort((a, b) => a.localeCompare(b));
          setBrandOptions(merged);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    productsAPI.getById(id)
      .then(({ data }) => {
        const loaded = { ...EMPTY, ...data };
        setForm(loaded);
        setInitialForm(loaded);
        setInitialImages(data.images || []);
      })
      .catch(() => setError('Product not found.'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const discard = () => {
    setForm(initialForm);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return; // Prevent double submit
    setError('');
    setSaving(true);
    setUploadingText('');

    // Build the payload with numeric casts — the backend validator expects numbers.
    const payload = {
      ...form,
      price:             Number(form.price),
      cost:              form.cost === '' ? null : Number(form.cost),
      compare_at_price:  form.compare_at_price === '' ? null : Number(form.compare_at_price),
      stock_quantity:    Number(form.stock_quantity) || 0,
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
        setInitialForm(form);
        toast.success('Saved');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed. Please check the fields.');
    } finally {
      setSaving(false);
      setUploadingText('');
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
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

      {error && <div className="alert alert-error">{error}</div>}

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
                    // Auto-suggest SKU while creating until admin manually edits SKU
                    if (isNew && !skuTouched) update('sku', suggestSku(e.target.value));
                  }}
                  placeholder="e.g. Shea Butter Body Cream 200g"
                  required
                />
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
                  <input
                    type="text"
                    list="cat-suggestions"
                    value={form.category}
                    onChange={e => update('category', e.target.value)}
                    placeholder="Body Cream"
                  />
                  <datalist id="cat-suggestions">
                    {catOptions.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label>Brand</label>
                  <input
                    type="text"
                    list="brand-suggestions"
                    value={form.brand}
                    onChange={e => update('brand', e.target.value)}
                    placeholder="e.g. CeraVe, Fenty Beauty, SheaMoisture"
                  />
                  <datalist id="brand-suggestions">
                    {brandOptions.map(b => <option key={b} value={b} />)}
                  </datalist>
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
                    required
                  />
                  <div className="hint">What customers pay.</div>
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
                  />
                  <div className="hint">What it costs you — used for profit reporting. Optional.</div>
                </div>
              </div>
              {form.price && form.cost && Number(form.price) > Number(form.cost) && (
                <div className="alert alert-info" style={{ marginTop: 8, marginBottom: 0 }}>
                  Margin: <strong>GHS {(Number(form.price) - Number(form.cost)).toFixed(2)}</strong>
                  {' '}({Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)}%)
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
                />
                <div className="hint">
                  Optional — shows as crossed-out original price. Leave blank for no sale display.
                </div>
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
                  Number(form.compare_at_price) <= Number(form.price) && (
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

          <div className="card" style={{ opacity: 0.9 }}>
            <div className="card-header">
              <h2 className="card-title" style={{ fontSize: '0.82rem', color: 'var(--ac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Legacy fallback image
              </h2>
            </div>
            <div className="card-body">
              <div className="hint" style={{ marginBottom: 12 }}>
                Upload product photos using the <strong>Images</strong> gallery above.
                This image is only used as a last-resort fallback when the gallery has no images.
              </div>
              <ImageInput
                label="Fallback image"
                value={form.image_url}
                onChange={url => update('image_url', url)}
                hint="Direct upload or image link used if the product has no gallery images."
              />
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
                />
                <div className="hint">Decreases automatically when orders are placed.</div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={e => update('sku', e.target.value)}
                  style={{ fontFamily: 'SF Mono, Menlo, monospace' }}
                  placeholder="SKU-CODE"
                />
                <div className="hint">Unique internal code — auto-suggested from the name.</div>
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
        @media (max-width: 900px) {
          .pe-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <UnsavedChangesBar
        dirty={dirty}
        saving={saving}
        onSave={() => formRef.current?.requestSubmit()}
        onDiscard={isNew ? undefined : discard}
        saveLabel={isNew ? 'Create product' : 'Save changes'}
      />
    </form>
  );
}
