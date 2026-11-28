import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { productsAPI, settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import ProductImageGallery from '../components/ProductImageGallery';
import ImageInput from '../components/ImageInput';
import VariantManager from '../components/VariantManager';
import StatusBadge from '../components/StatusBadge';
import UnsavedChangesBar from '../components/UnsavedChangesBar';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { GHANA_COSMETICS_BRANDS } from '../data/ghanaBrands';
import './Products.css';

const STOREFRONT_BASE = (import.meta.env.VITE_STOREFRONT_URL || 'https://bodycreamgh-shop.vercel.app').replace(/\/$/, '');

const DEFAULT_QUICK_CATEGORIES = [
  'Skincare',
  'Body Care',
  'Makeup',
  'Haircare',
  'Fragrances',
  'Tools & Accessories',
];

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

const EMPTY = {
  name: '', description: '', highlights: '', price: '', cost: '', compare_at_price: '',
  category: '', brand: '', image_url: '',
  stock_quantity: 0, sku: '',
  ingredients: '', usage_instructions: '',
  is_active: true,
};

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const duplicateSeed = isNew ? location.state?.duplicateFrom : null;

  const formRef = useRef(null);
  const [form,          setForm]          = useState(() => {
    if (duplicateSeed) {
      const copyName = `${duplicateSeed.name || 'Product'} (Copy)`;
      return {
        ...EMPTY,
        name: copyName,
        description: duplicateSeed.description || '',
        highlights: duplicateSeed.highlights || '',
        price: duplicateSeed.price ?? '',
        cost: duplicateSeed.cost ?? '',
        compare_at_price: duplicateSeed.compare_at_price ?? '',
        category: duplicateSeed.category || '',
        brand: duplicateSeed.brand || '',
        image_url: duplicateSeed.image_url || '',
        stock_quantity: duplicateSeed.stock_quantity ?? 0,
        sku: suggestSku(copyName),
        ingredients: duplicateSeed.ingredients || '',
        usage_instructions: duplicateSeed.usage_instructions || '',
        is_active: false, // start duplicated items hidden as draft so admin can review
      };
    }
    return EMPTY;
  });
  const [initialForm,   setInitialForm]   = useState(EMPTY);
  const [initialImages, setInitialImages] = useState([]);
  const [stagedFiles,   setStagedFiles]   = useState([]);
  const [stagedPreviewUrl, setStagedPreviewUrl] = useState('');
  const [loading,       setLoading]       = useState(!isNew);
  const [saving,        setSaving]        = useState(false);
  const [uploadingText, setUploadingText] = useState('');
  const [error,         setError]         = useState('');
  const [catOptions,    setCatOptions]    = useState([]);
  const [brandOptions,  setBrandOptions]  = useState(GHANA_COSMETICS_BRANDS);
  const [skuTouched,    setSkuTouched]    = useState(Boolean(duplicateSeed));
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [storefrontUrl, setStorefrontUrl] = useState(STOREFRONT_BASE);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm) || stagedFiles.length > 0,
    [form, initialForm, stagedFiles.length]
  );

  useEffect(() => {
    if (stagedFiles.length > 0) {
      const url = URL.createObjectURL(stagedFiles[0]);
      setStagedPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setStagedPreviewUrl('');
    return undefined;
  }, [stagedFiles]);

  useEffect(() => {
    settingsAPI.getAll()
      .then(({ data }) => {
        const t = parseInt(data?.low_stock_threshold, 10);
        if (t > 0) setLowStockThreshold(t);
        if (data?.storefront_url && String(data.storefront_url).startsWith('http')) {
          setStorefrontUrl(String(data.storefront_url).replace(/\/$/, ''));
        }
      })
      .catch(() => {});

    productsAPI.getCategories()
      .then(({ data }) => {
        const cats = data?.categories || data || [];
        if (Array.isArray(cats)) {
          setCatOptions(cats.map(c => (typeof c === 'string' ? c : c?.category || c?.label)).filter(Boolean));
        }
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
    setLoading(true);
    productsAPI.getById(id)
      .then(({ data }) => {
        const loaded = {
          ...EMPTY,
          ...data,
          cost: data.cost ?? '',
          compare_at_price: data.compare_at_price ?? '',
          highlights: data.highlights ?? '',
          ingredients: data.ingredients ?? '',
          usage_instructions: data.usage_instructions ?? '',
        };
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
    setStagedFiles([]);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    setSaving(true);
    setUploadingText('');

    const payload = {
      ...form,
      price:            Number(form.price),
      cost:             form.cost === '' || form.cost == null ? null : Number(form.cost),
      compare_at_price: form.compare_at_price === '' || form.compare_at_price == null ? null : Number(form.compare_at_price),
      stock_quantity:   Number(form.stock_quantity) || 0,
    };

    try {
      if (isNew) {
        if (stagedFiles.length > 0) {
          setUploadingText('Creating product & uploading photos…');
        }
        const { data } = await productsAPI.create(payload);
        const newId = data.id || data.product?.id;

        if (stagedFiles.length > 0) {
          try {
            await productsAPI.uploadProductImages(newId, stagedFiles);
            setStagedFiles([]);
            setInitialForm(form);
            toast.success('Product created with gallery photos');
            navigate(`/products/${newId}`, { replace: true });
          } catch (uploadErr) {
            setStagedFiles([]);
            setInitialForm(form);
            const reason = uploadErr.response?.data?.error || uploadErr.message || 'Server error';
            toast.warning(`Product created, but image upload failed: ${reason}. Re-upload in the gallery.`);
            navigate(`/products/${newId}`, { replace: true });
          }
        } else {
          setInitialForm(form);
          toast.success('Product created');
          navigate(`/products/${newId}`, { replace: true });
        }
      } else {
        await productsAPI.update(id, payload);
        setInitialForm(form);
        toast.success('Product changes saved');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed. Please check the fields.');
    } finally {
      setSaving(false);
      setUploadingText('');
    }
  };

  // Live financial & merchandising calculations
  const priceNum     = form.price !== '' ? Number(form.price) : 0;
  const compareNum   = form.compare_at_price !== '' && form.compare_at_price != null ? Number(form.compare_at_price) : 0;
  const costNum      = form.cost !== '' && form.cost != null ? Number(form.cost) : null;
  const hasDiscount  = compareNum > priceNum && priceNum > 0;
  const discountPct  = hasDiscount ? Math.round((1 - priceNum / compareNum) * 100) : 0;
  const unitProfit   = costNum != null && priceNum > 0 ? priceNum - costNum : null;
  const marginPct    = unitProfit != null && priceNum > 0 ? Math.round((unitProfit / priceNum) * 100) : null;

  const stockNum = Number(form.stock_quantity ?? 0);
  const currentStockStatus = stockNum <= 0 ? 'out_of_stock' : stockNum <= lowStockThreshold ? 'low_stock' : 'in_stock';

  // Resolve primary preview image
  const primaryGalleryImg = useMemo(() => {
    if (stagedPreviewUrl) return stagedPreviewUrl;
    if (initialImages.length > 0) {
      const pri = initialImages.find(i => i.is_primary) || initialImages[0];
      if (pri?.url) return resolveImageUrl(pri.url);
    }
    if (form.image_url) return resolveImageUrl(form.image_url);
    return '';
  }, [stagedPreviewUrl, initialImages, form.image_url]);

  const quickCategories = useMemo(() => {
    const merged = Array.from(new Set([...DEFAULT_QUICK_CATEGORIES, ...catOptions]));
    return merged.slice(0, 8);
  }, [catOptions]);

  if (loading) return <div className="spinner" />;

  const isLive = form.is_active !== false;

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      {/* ── Top Merchandising Studio Header ─────────────────────────── */}
      <div className="pe-header-bar">
        <div>
          <Link to="/products" className="pe-back-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Product Catalog
          </Link>
          <div className="pe-title-row">
            <h1>{isNew ? (duplicateSeed ? 'Duplicate Product' : 'Add New Product') : (form.name || 'Edit Product')}</h1>
            <span className={`pe-status-pill ${isLive ? 'pe-status-pill--live' : 'pe-status-pill--draft'}`}>
              {isLive ? '● Live on Storefront' : '○ Hidden / Draft'}
            </span>
            {form.sku && <span className="ap-sku-badge">{form.sku}</span>}
          </div>
        </div>

        <div className="page-actions">
          {!isNew && (
            <>
              <a
                href={`${storefrontUrl}/products/${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-sm"
                title="Preview this product on the live customer storefront"
              >
                View Storefront ↗
              </a>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => navigate('/products/new', { state: { duplicateFrom: form } })}
              >
                Duplicate
              </button>
            </>
          )}
          <Link to="/products" className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving
              ? (uploadingText || (isNew ? 'Creating…' : 'Saving…'))
              : isNew ? 'Create Product' : 'Save Changes'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="pe-layout">
        {/* ── LEFT COLUMN: Identity, Pricing & Margin, Details ──────── */}
        <div className="pe-col">

          {/* 1. Product Identity & Storytelling */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Product Identity &amp; Copy</h2>
                <p className="pe-card-subtitle">Core title, brand taxonomy, and customer-facing description.</p>
              </div>
            </div>
            <div className="card-body">
              <div className="field">
                <div className="pe-label-row">
                  <label htmlFor="pe-name">Product Name *</label>
                  <span className="pe-char-count">{(form.name || '').length} / 120</span>
                </div>
                <input
                  id="pe-name"
                  type="text"
                  maxLength={120}
                  value={form.name}
                  onChange={e => {
                    update('name', e.target.value);
                    if (isNew && !skuTouched) update('sku', suggestSku(e.target.value));
                  }}
                  placeholder="e.g. Foaming Facial Cleanser 236ml"
                  required
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="pe-category">Category</label>
                  <input
                    id="pe-category"
                    type="text"
                    list="cat-suggestions"
                    value={form.category}
                    onChange={e => update('category', e.target.value)}
                    placeholder="e.g. Skincare"
                  />
                  <datalist id="cat-suggestions">
                    {catOptions.map(c => <option key={c} value={c} />)}
                  </datalist>
                  <div className="pe-quick-chips" aria-label="Quick category selection">
                    {quickCategories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        className={`pe-quick-chip${form.category === cat ? ' is-selected' : ''}`}
                        onClick={() => update('category', cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="pe-brand">Brand</label>
                  <input
                    id="pe-brand"
                    type="text"
                    list="brand-suggestions"
                    value={form.brand}
                    onChange={e => update('brand', e.target.value)}
                    placeholder="e.g. CeraVe, Fenty Beauty, SheaMoisture"
                  />
                  <datalist id="brand-suggestions">
                    {brandOptions.map(b => <option key={b} value={b} />)}
                  </datalist>
                  <div className="hint">Powers brand filter pages and Google Merchant Product schema.</div>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <div className="pe-label-row">
                  <label htmlFor="pe-desc">Product Description</label>
                  <span className="pe-char-count">
                    {(form.description || '').length} chars · first 160 used for SEO meta description
                  </span>
                </div>
                <textarea
                  id="pe-desc"
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  rows={4}
                  placeholder="Describe texture, skin benefits, target concerns, and finish…"
                />
              </div>
            </div>
          </div>

          {/* 2. Pricing & Profit Margin Studio */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Pricing &amp; Margin</h2>
                <p className="pe-card-subtitle">Set retail price, optional strike-through sale anchor, and unit cost.</p>
              </div>
            </div>
            <div className="card-body">
              <div className="pe-price-grid">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pe-price">Selling Price *</label>
                  <div className="pe-input-prefix-wrap">
                    <span className="pe-input-prefix">GHS</span>
                    <input
                      id="pe-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={e => update('price', e.target.value)}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div className="hint">Base customer price.</div>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pe-compare">Compare-at (Was)</label>
                  <div className="pe-input-prefix-wrap">
                    <span className="pe-input-prefix">GHS</span>
                    <input
                      id="pe-compare"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.compare_at_price ?? ''}
                      onChange={e => update('compare_at_price', e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="hint">Original price; triggers Sale & Deals.</div>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pe-cost">Unit Cost (Internal)</label>
                  <div className="pe-input-prefix-wrap">
                    <span className="pe-input-prefix">GHS</span>
                    <input
                      id="pe-cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cost ?? ''}
                      onChange={e => update('cost', e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="hint">Hidden from shoppers; tracks profit.</div>
                </div>
              </div>

              {/* Quick Discount Calculator Shortcuts */}
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--ac-surface-sunken, #f8fafc)', borderRadius: 8, border: '1px solid var(--ac-border, #e2e8f0)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ac-text-muted, #64748b)' }}>
                    Quick Deal &amp; Discount Presets:
                  </span>
                  {hasDiscount && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.75rem', padding: '2px 8px', height: 'auto', color: 'var(--ac-danger, #ef4444)' }}
                      onClick={() => {
                        const original = compareNum > 0 ? compareNum : priceNum;
                        update('price', original.toFixed(2));
                        update('compare_at_price', '');
                      }}
                    >
                      ✕ Clear Discount
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[10, 15, 20, 25, 30, 40, 50].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{
                        fontSize: '0.75rem',
                        padding: '4px 10px',
                        fontWeight: discountPct === pct ? 700 : 500,
                        borderColor: discountPct === pct ? 'var(--ac-accent, #0f172a)' : undefined,
                        background: discountPct === pct ? 'var(--ac-accent, #0f172a)' : undefined,
                        color: discountPct === pct ? '#fff' : undefined,
                      }}
                      onClick={() => {
                        const base = compareNum > 0 ? compareNum : priceNum;
                        if (!base || base <= 0) return;
                        const discounted = Math.round(base * (1 - pct / 100) * 100) / 100;
                        update('compare_at_price', base.toFixed(2));
                        update('price', discounted.toFixed(2));
                      }}
                    >
                      {pct}% OFF
                    </button>
                  ))}
                </div>
              </div>

              {compareNum > 0 && compareNum <= priceNum && (
                <div className="alert alert-warning" style={{ marginTop: 12, marginBottom: 0 }}>
                  Compare-at price must be higher than Selling Price (`GHS {priceNum.toFixed(2)}`) to trigger a storefront Sale badge.
                </div>
              )}

              {/* Live 4-Metric Financial Bar */}
              <div className="pe-metrics-strip">
                <div className="pe-metric-item">
                  <span className="pe-metric-label">Customer Pays</span>
                  <span className="pe-metric-val">GHS {priceNum.toFixed(2)}</span>
                </div>
                <div className="pe-metric-item">
                  <span className="pe-metric-label">Sale Badge</span>
                  <span className={`pe-metric-val ${hasDiscount ? 'pe-metric-val--good' : ''}`}>
                    {hasDiscount ? `${discountPct}% OFF` : 'Standard'}
                  </span>
                </div>
                <div className="pe-metric-item">
                  <span className="pe-metric-label">Profit / Unit</span>
                  <span className={`pe-metric-val ${unitProfit != null ? (unitProfit > 0 ? 'pe-metric-val--good' : 'pe-metric-val--bad') : ''}`}>
                    {unitProfit != null ? `GHS ${unitProfit.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="pe-metric-item">
                  <span className="pe-metric-label">Gross Margin</span>
                  <span
                    className={`pe-metric-val ${
                      marginPct == null
                        ? ''
                        : marginPct >= 30
                          ? 'pe-metric-val--good'
                          : marginPct > 0
                            ? 'pe-metric-val--warn'
                            : 'pe-metric-val--bad'
                    }`}
                  >
                    {marginPct != null ? `${marginPct}%` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Ingredients & Usage Ritual */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Ingredients &amp; Daily Ritual</h2>
                <p className="pe-card-subtitle">Displayed inside the expandable product detail accordions on the storefront.</p>
              </div>
            </div>
            <div className="card-body">
              <div className="field">
                <label htmlFor="pe-highlights">Key Highlights (Bullet Box)</label>
                <textarea
                  id="pe-highlights"
                  value={form.highlights}
                  onChange={e => update('highlights', e.target.value)}
                  rows={4}
                  placeholder={'One highlight per line, e.g.:\n12 warm neutral matte & metallic shades\nRichly pigmented for deep skin tones\nLong-wearing crease-resistant formula'}
                />
                <div className="hint">Shown in the bullet box on the product page. Leave blank to hide the box.</div>
              </div>

              <div className="field">
                <label htmlFor="pe-ingredients">Ingredients</label>
                <textarea
                  id="pe-ingredients"
                  value={form.ingredients}
                  onChange={e => update('ingredients', e.target.value)}
                  rows={3}
                  placeholder="e.g. Aqua, Niacinamide, Ceramide NP, Ceramide AP, Hyaluronic Acid, Glycerin…"
                />
                <div className="hint">Clear ingredient transparency increases skincare conversion and buyer trust.</div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="pe-usage">How to Use / Application Instructions</label>
                <textarea
                  id="pe-usage"
                  value={form.usage_instructions}
                  onChange={e => update('usage_instructions', e.target.value)}
                  rows={3}
                  placeholder="e.g. Massage onto damp skin morning and night, then rinse thoroughly and follow with moisturizer."
                />
              </div>
            </div>
          </div>

        </div>

        {/* ── RIGHT COLUMN: Live Preview, Media Studio, Stock & Visibility ── */}
        <div className="pe-col">

          {/* 1. Live Storefront Preview Widget */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Live Storefront Preview</h2>
              <span className="ap-mini-pill ap-mini-pill--variants">Real-time</span>
            </div>
            <div className="card-body">
              <div className="pe-preview-stage">
                <div className="pe-preview-card">
                  <div className="pe-preview-img">
                    {hasDiscount && <span className="pe-preview-sale-tag">-{discountPct}%</span>}
                    {primaryGalleryImg ? (
                      <img
                        src={primaryGalleryImg}
                        alt={form.name || 'Preview'}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    )}
                  </div>
                  <div className="pe-preview-info">
                    <div className="pe-preview-brand">
                      {form.brand || 'Brand'}{form.category ? ` · ${form.category}` : ''}
                    </div>
                    <div className="pe-preview-name">
                      {form.name || 'Untitled Product'}
                    </div>
                    <div className="pe-preview-price-row">
                      <span className="pe-preview-price">GHS {priceNum.toFixed(2)}</span>
                      {hasDiscount && (
                        <span className="pe-preview-was">GHS {compareNum.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Unified Product Media Studio */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Product Media</h2>
                <p className="pe-card-subtitle">Drag to reorder · ★ star sets the cover photo (up to 8 images).</p>
              </div>
            </div>
            <div className="card-body">
              <ProductImageGallery
                productId={isNew ? null : id}
                initialImages={initialImages}
                onImagesChange={setInitialImages}
                stagedFiles={stagedFiles}
                onStagedChange={setStagedFiles}
              />

              <details className="pe-fallback-details">
                <summary>External image URL fallback (optional)</summary>
                <div style={{ marginTop: 10 }}>
                  <ImageInput
                    label="Fallback image URL"
                    value={form.image_url}
                    onChange={url => update('image_url', url)}
                    hint="Used only when no gallery images are uploaded above."
                  />
                </div>
              </details>
            </div>
          </div>

          {/* 3. Inventory & SKU */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Inventory &amp; SKU</h2>
              <StatusBadge status={currentStockStatus} />
            </div>
            <div className="card-body">
              <div className="field">
                <label htmlFor="pe-stock">Available Stock Quantity</label>
                <input
                  id="pe-stock"
                  type="number"
                  min="0"
                  value={form.stock_quantity}
                  onChange={e => update('stock_quantity', e.target.value)}
                />
                <div className="hint">Automatically deducted when orders are placed (unless overridden by variants below).</div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="pe-sku">SKU (Stock Keeping Unit)</label>
                <div className="pe-sku-row">
                  <input
                    id="pe-sku"
                    type="text"
                    value={form.sku}
                    onChange={e => { setSkuTouched(true); update('sku', e.target.value); }}
                    placeholder="SKU-CODE"
                  />
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSkuTouched(true);
                      update('sku', suggestSku(form.name));
                    }}
                    disabled={!form.name}
                    title="Generate SKU from product name"
                  >
                    Auto
                  </button>
                </div>
                <div className="hint">Printed on A4 &amp; 80mm thermal dispatch waybills.</div>
              </div>
            </div>
          </div>

          {/* 4. Storefront Visibility Toggle */}
          <div className="card">
            <div className="card-body">
              <div
                className="pe-visibility-row"
                role="switch"
                aria-checked={isLive}
                tabIndex={0}
                onClick={() => update('is_active', !isLive)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    update('is_active', !isLive);
                  }
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {isLive ? 'Published on Storefront' : 'Hidden Draft'}
                  </div>
                  <div className="hint" style={{ marginTop: 2 }}>
                    {isLive
                      ? 'Visible to shoppers in search, categories, and mobile app.'
                      : 'Hidden from shoppers while preserving order history and stock.'}
                  </div>
                </div>
                <span className={`ap-switch${isLive ? ' is-on' : ''}`}>
                  <span className="ap-switch-track">
                    <span className="ap-switch-knob" />
                  </span>
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Variants Studio ── */}
      {!isNew ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div>
              <h2 className="card-title">Product Variants (Sizes, Shades &amp; Bundles)</h2>
              <p className="pe-card-subtitle">
                Add option groups (e.g. Size: 88ml, 236ml, 473ml) to give each combination its own price, SKU, and stock count.
              </p>
            </div>
          </div>
          <div className="card-body">
            <VariantManager productId={id} />
          </div>
        </div>
      ) : (
        <div className="alert alert-info" style={{ marginTop: 20 }}>
          <strong>Need size or shade variants?</strong> Click <strong>Create Product</strong> first — the Variant Matrix unlocks immediately once saved.
        </div>
      )}

      <UnsavedChangesBar
        dirty={dirty}
        saving={saving}
        onSave={() => formRef.current?.requestSubmit()}
        onDiscard={isNew ? undefined : discard}
        saveLabel={isNew ? 'Create Product' : 'Save Changes'}
      />
    </form>
  );
}
