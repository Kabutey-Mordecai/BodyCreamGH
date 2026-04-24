import { useEffect, useState } from 'react';
import { settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'http://localhost:5173';

/*
 The Storefront Editor is the "non-developer magic" — it lets the store owner
 edit every piece of copy and imagery on the public home page without touching
 code. Values persist via a key/value `site_settings` table on the backend
 (endpoints: GET /api/settings, PUT /api/settings).

 If the backend endpoints aren't wired yet, this page falls back to localStorage
 so the editor still works end-to-end for demo/testing. Once the backend routes
 exist, nothing changes on this page — it already uses the real API.
*/

// Each section is one tab with its own fields.
const SECTIONS = [
  { id: 'announcement', label: 'Announcement bar' },
  { id: 'hero',         label: 'Hero banner' },
  { id: 'categories',   label: 'Category cards' },
  { id: 'testimonials', label: 'Testimonials' },
  { id: 'trust',        label: 'Trust promises' },
  { id: 'footer',       label: 'Footer' },
];

const DEFAULTS = {
  announcement_enabled: true,
  announcement_text: 'Free delivery on orders over GHS 200 · Shop now',

  hero_label:      'Handcrafted in Ghana',
  hero_headline:   'Reveal your natural glow.',
  hero_subtitle:   'Luxury body creams blended with shea butter, cocoa butter, and Africa\'s finest botanicals.',
  hero_cta_text:   'Shop the Collection',
  hero_cta_link:   '/shop',
  hero_image:      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1600&q=85',

  categories: [
    { label: 'Body Cream',  image: 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Butter', image: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Oil',    image: 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Scrub',  image: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Mask',   image: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=400&h=500&q=80' },
  ],

  testimonials: [
    { name: 'Abena K.', location: 'Accra', text: 'The Shea Butter Cream completely transformed my skin.' },
    { name: 'Ama S.',   location: 'Kumasi', text: 'I love the Rose Gold Radiance Oil! The scent is divine.' },
    { name: 'Efua M.',  location: 'Takoradi', text: 'Fast delivery, beautiful packaging, and the products actually work!' },
  ],

  trust_items: [
    { icon: '🚚', label: 'Free delivery', sub: 'Over GHS 200' },
    { icon: '✦',  label: 'Handcrafted',   sub: 'In small batches' },
    { icon: '↩',  label: '7-day returns', sub: 'No questions asked' },
    { icon: '🔒', label: 'Secure checkout', sub: 'Paystack' },
  ],

  footer_tagline: 'Luxury body creams blended with shea butter, cocoa butter, and Africa\'s finest botanicals — handcrafted in Ghana.',
  footer_instagram: 'https://instagram.com',
  footer_facebook:  'https://facebook.com',
  footer_whatsapp:  'https://wa.me',
  footer_tiktok:    'https://tiktok.com',
};

const LOCAL_KEY = 'admin_storefront_draft';

export default function Storefront() {
  const toast = useToast();
  const [active, setActive] = useState('hero');
  const [data, setData]     = useState(DEFAULTS);
  const [dirty, setDirty]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load from backend; fall back to localStorage so the editor is always usable.
  useEffect(() => {
    (async () => {
      try {
        const { data: remote } = await settingsAPI.getAll();
        // Backend returns { key1: value1, ... } — merge into defaults so new keys show up
        setData({ ...DEFAULTS, ...remote });
      } catch {
        const cached = localStorage.getItem(LOCAL_KEY);
        if (cached) {
          try { setData({ ...DEFAULTS, ...JSON.parse(cached) }); }
          catch { /* fall through to defaults */ }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (key, value) => {
    setData(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateArray = (key, index, field, value) => {
    setData(prev => ({
      ...prev,
      [key]: prev[key].map((item, i) => i === index ? { ...item, [field]: value } : item),
    }));
    setDirty(true);
  };

  const addToArray = (key, item) => {
    setData(prev => ({ ...prev, [key]: [...(prev[key] || []), item] }));
    setDirty(true);
  };

  const removeFromArray = (key, index) => {
    setData(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Try the bulk endpoint, falling back to localStorage if backend isn't ready.
      const entries = Object.entries(data).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateMany(entries);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      toast.success('Storefront updated');
      setDirty(false);
    } catch {
      // Backend endpoint may not exist yet — persist locally so the editor still demos.
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      toast.info('Saved locally (backend /api/settings endpoint pending)');
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Storefront Editor</h1>
          <p className="muted">Edit every piece of your home page — no code needed.</p>
        </div>
        <div className="page-actions">
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="btn btn-outline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
            Open storefront
          </a>
          <button className="btn btn-accent" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Publish changes' : 'All saved'}
          </button>
        </div>
      </div>

      {dirty && (
        <div className="alert alert-warning">
          You have unsaved changes. Click <strong>Publish changes</strong> to push them live.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }} className="sf-grid">

        {/* Section tabs (left rail) */}
        <div>
          <div className="card">
            <div style={{ padding: 6 }}>
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`sf-tab ${active === s.id ? 'active' : ''}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section editor + preview (right) */}
        <div>
          {active === 'announcement' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Announcement bar</h2></div>
              <div className="card-body">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!data.announcement_enabled}
                      onChange={e => update('announcement_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show the announcement bar above the navigation</span>
                  </label>
                </div>
                <div className="field">
                  <label>Announcement text</label>
                  <input
                    type="text"
                    value={data.announcement_text}
                    onChange={e => update('announcement_text', e.target.value)}
                    maxLength={100}
                  />
                  <div className="hint">Keep it short — customers scan, they don't read.</div>
                </div>

                <div className="sf-preview" style={{ background: 'var(--ac-sidebar)', color: '#fff', textAlign: 'center', padding: '10px 20px', fontSize: '0.8rem', letterSpacing: '0.04em' }}>
                  {data.announcement_enabled ? (data.announcement_text || 'Your announcement here') : <em>Bar is hidden</em>}
                </div>
              </div>
            </div>
          )}

          {active === 'hero' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Hero banner</h2></div>
              <div className="card-body">
                <div className="field">
                  <label>Eyebrow label</label>
                  <input
                    type="text"
                    value={data.hero_label}
                    onChange={e => update('hero_label', e.target.value)}
                    placeholder="Handcrafted in Ghana"
                  />
                </div>

                <div className="field">
                  <label>Headline</label>
                  <input
                    type="text"
                    value={data.hero_headline}
                    onChange={e => update('hero_headline', e.target.value)}
                    placeholder="Reveal your natural glow."
                  />
                  <div className="hint">The biggest text on your site. Make it a promise.</div>
                </div>

                <div className="field">
                  <label>Subtitle</label>
                  <textarea
                    rows={2}
                    value={data.hero_subtitle}
                    onChange={e => update('hero_subtitle', e.target.value)}
                  />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Button text</label>
                    <input
                      type="text"
                      value={data.hero_cta_text}
                      onChange={e => update('hero_cta_text', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Button link</label>
                    <input
                      type="text"
                      value={data.hero_cta_link}
                      onChange={e => update('hero_cta_link', e.target.value)}
                      placeholder="/shop"
                    />
                  </div>
                </div>

                <div className="field">
                  <label>Background image URL</label>
                  <input
                    type="url"
                    value={data.hero_image}
                    onChange={e => update('hero_image', e.target.value)}
                  />
                </div>

                <div className="sf-preview hero-preview" style={{
                  backgroundImage: data.hero_image ? `url(${data.hero_image})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  minHeight: 260, borderRadius: 10, overflow: 'hidden',
                  position: 'relative', color: '#fff',
                }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, rgba(28,20,16,0.7), transparent 60%)' }} />
                  <div style={{ position: 'relative', padding: '40px 32px', maxWidth: 480 }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                      {data.hero_label}
                    </div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.2rem', fontWeight: 500, lineHeight: 1.1, marginBottom: 10 }}>
                      {data.hero_headline}
                    </div>
                    <div style={{ fontSize: '0.88rem', marginBottom: 18, color: 'rgba(255,255,255,0.85)' }}>
                      {data.hero_subtitle}
                    </div>
                    <div style={{ display: 'inline-block', background: 'var(--ac-accent)', color: '#fff', padding: '9px 22px', borderRadius: 6, fontSize: '0.76rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      {data.hero_cta_text || 'Shop now'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {active === 'categories' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Category cards</h2>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => addToArray('categories', { label: 'New Category', image: '' })}
                >+ Add category</button>
              </div>
              <div className="card-body">
                {(data.categories || []).map((cat, i) => (
                  <div key={i} className="sf-row" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr auto', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                    <div style={{
                      width: 68, height: 80, borderRadius: 6, overflow: 'hidden',
                      backgroundImage: cat.image ? `url(${cat.image})` : 'none',
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      background: cat.image ? undefined : 'var(--ac-bg)',
                      border: '1px solid var(--ac-border)',
                    }} />
                    <input
                      type="text"
                      value={cat.label}
                      onChange={e => updateArray('categories', i, 'label', e.target.value)}
                      placeholder="Category name"
                    />
                    <input
                      type="url"
                      value={cat.image}
                      onChange={e => updateArray('categories', i, 'image', e.target.value)}
                      placeholder="Image URL"
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--ac-danger)' }}
                      onClick={() => removeFromArray('categories', i)}
                    >Remove</button>
                  </div>
                ))}
                {(data.categories || []).length === 0 && (
                  <div className="empty" style={{ padding: 30 }}>
                    <p>No categories yet. Click <strong>Add category</strong> to get started.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {active === 'testimonials' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Customer testimonials</h2>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => addToArray('testimonials', { name: '', location: '', text: '' })}
                >+ Add testimonial</button>
              </div>
              <div className="card-body">
                {(data.testimonials || []).map((t, i) => (
                  <div key={i} className="sf-testimonial" style={{ padding: 14, background: 'var(--ac-surface-2)', borderRadius: 8, marginBottom: 12 }}>
                    <div className="field-row">
                      <div className="field" style={{ marginBottom: 10 }}>
                        <label>Name</label>
                        <input value={t.name} onChange={e => updateArray('testimonials', i, 'name', e.target.value)} />
                      </div>
                      <div className="field" style={{ marginBottom: 10 }}>
                        <label>Location</label>
                        <input value={t.location} onChange={e => updateArray('testimonials', i, 'location', e.target.value)} placeholder="Accra" />
                      </div>
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Quote</label>
                      <textarea rows={2} value={t.text} onChange={e => updateArray('testimonials', i, 'text', e.target.value)} />
                    </div>
                    <div style={{ textAlign: 'right', marginTop: 6 }}>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--ac-danger)' }} onClick={() => removeFromArray('testimonials', i)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {active === 'trust' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Trust promises</h2>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => addToArray('trust_items', { icon: '✓', label: '', sub: '' })}
                >+ Add</button>
              </div>
              <div className="card-body">
                {(data.trust_items || []).map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 2fr auto', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <input value={t.icon} onChange={e => updateArray('trust_items', i, 'icon', e.target.value)} maxLength={4} style={{ textAlign: 'center', fontSize: '1.1rem' }} />
                    <input value={t.label} onChange={e => updateArray('trust_items', i, 'label', e.target.value)} placeholder="Free delivery" />
                    <input value={t.sub}   onChange={e => updateArray('trust_items', i, 'sub', e.target.value)} placeholder="Over GHS 200" />
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--ac-danger)' }} onClick={() => removeFromArray('trust_items', i)}>×</button>
                  </div>
                ))}
                <div className="hint" style={{ marginTop: 8 }}>Icons can be emoji (🚚) or single characters (✦, ↩).</div>
              </div>
            </div>
          )}

          {active === 'footer' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Footer</h2></div>
              <div className="card-body">
                <div className="field">
                  <label>Tagline</label>
                  <textarea rows={2} value={data.footer_tagline} onChange={e => update('footer_tagline', e.target.value)} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Instagram URL</label>
                    <input type="url" value={data.footer_instagram} onChange={e => update('footer_instagram', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Facebook URL</label>
                    <input type="url" value={data.footer_facebook} onChange={e => update('footer_facebook', e.target.value)} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>WhatsApp URL</label>
                    <input type="url" value={data.footer_whatsapp} onChange={e => update('footer_whatsapp', e.target.value)} placeholder="https://wa.me/233..." />
                  </div>
                  <div className="field">
                    <label>TikTok URL</label>
                    <input type="url" value={data.footer_tiktok} onChange={e => update('footer_tiktok', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .sf-grid { grid-template-columns: 1fr !important; }
        }
        .sf-tab {
          width: 100%;
          padding: 10px 12px;
          background: none;
          border: none;
          border-radius: 6px;
          text-align: left;
          font-size: 0.88rem;
          color: var(--ac-text-muted);
          font-weight: 500;
          cursor: pointer;
          display: block;
          margin-bottom: 2px;
        }
        .sf-tab:hover { background: var(--ac-bg); color: var(--ac-text); }
        .sf-tab.active {
          background: var(--ac-accent-light);
          color: var(--ac-accent-dark);
        }
        .sf-preview {
          margin-top: 16px;
          padding: 12px 18px;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
