import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import ProductImageGallery from '../components/ProductImageGallery';

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
  name: '', description: '', price: '', cost: '',
  category: '', brand: '', image_url: '',
  stock_quantity: 0, sku: '',
  ingredients: '', usage_instructions: '',
};

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();

  const [form,          setForm]          = useState(EMPTY);
  const [initialImages, setInitialImages] = useState([]);
  const [loading,       setLoading]       = useState(!isNew);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  useEffect(() => {
    if (isNew) return;
    productsAPI.getById(id)
      .then(({ data }) => {
        setForm({ ...EMPTY, ...data });
        setInitialImages(data.images || []);
      })
      .catch(() => setError('Product not found.'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    // Build the payload with numeric casts — the backend validator expects numbers.
    const payload = {
      ...form,
      price:          Number(form.price),
      cost:           form.cost === '' ? null : Number(form.cost),
      stock_quantity: Number(form.stock_quantity) || 0,
    };

    try {
      if (isNew) {
        const { data } = await productsAPI.create(payload);
        toast.success('Product created');
        navigate(`/products/${data.id || data.product?.id}`);
      } else {
        await productsAPI.update(id, payload);
        toast.success('Saved');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed. Please check the fields.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <form onSubmit={handleSubmit}>
      <div className="page-header">
        <div>
          <Link to="/products" className="muted text-sm" style={{ textDecoration: 'none' }}>← Back to products</Link>
          <h1 style={{ marginTop: 6 }}>{isNew ? 'New product' : (form.name || 'Edit product')}</h1>
        </div>
        <div className="page-actions">
          <Link to="/products" className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
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
                    // Only auto-suggest SKU while creating and if blank
                    if (isNew && !form.sku) update('sku', suggestSku(e.target.value));
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
                    <option value="Body Cream" />
                    <option value="Body Butter" />
                    <option value="Body Oil" />
                    <option value="Body Scrub" />
                    <option value="Body Mask" />
                  </datalist>
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
              />
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Legacy image URL</h2></div>
            <div className="card-body">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Fallback image URL</label>
                <input
                  type="url"
                  value={form.image_url}
                  onChange={e => update('image_url', e.target.value)}
                  placeholder="https://…"
                />
                <div className="hint">
                  Used as a fallback when no gallery images exist.
                  Once you upload images above, this field is no longer shown to customers.
                </div>
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

        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .pe-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </form>
  );
}
