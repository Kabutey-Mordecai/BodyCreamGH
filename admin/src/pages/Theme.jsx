import { useEffect, useState } from 'react';
import { settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

/*
 Theme Customizer — lets the owner rebrand the entire customer-facing site
 with color pickers. The storefront reads these values on page load and
 applies them as CSS custom properties (--color-accent, etc.), so the change
 is instant and site-wide.

 Persistence: same settingsAPI as Storefront editor. Falls back to
 localStorage if the /api/settings endpoint isn't wired up yet.
*/

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'http://localhost:5173';

const THEME_PRESETS = [
  {
    name: 'Gold · default',
    colors: { primary: '#1c1410', accent: '#c9a55a', accentDark: '#a8863d', bg: '#faf7f4', blush: '#fdf4f0' },
  },
  {
    name: 'Rose quartz',
    colors: { primary: '#2a1a22', accent: '#d4899e', accentDark: '#b56e83', bg: '#fdf7f8', blush: '#f9ecef' },
  },
  {
    name: 'Deep plum',
    colors: { primary: '#1f0f1e', accent: '#8e4585', accentDark: '#6f3466', bg: '#faf7fa', blush: '#f3e8f2' },
  },
  {
    name: 'Natural green',
    colors: { primary: '#1a2418', accent: '#7a9969', accentDark: '#5d7d4d', bg: '#f7f9f5', blush: '#eaf1e4' },
  },
  {
    name: 'Terracotta',
    colors: { primary: '#2a1510', accent: '#c97155', accentDark: '#a75739', bg: '#fbf6f3', blush: '#f5e5dc' },
  },
  {
    name: 'Midnight gold',
    colors: { primary: '#0d1220', accent: '#d4af37', accentDark: '#aa8a28', bg: '#f5f6fa', blush: '#e8ebf5' },
  },
];

const FONT_PAIRINGS = [
  { name: 'Classic luxury', display: 'Cormorant Garamond', body: 'Inter' },
  { name: 'Modern editorial', display: 'Playfair Display', body: 'Inter' },
  { name: 'Soft feminine',   display: 'DM Serif Display', body: 'DM Sans' },
  { name: 'Bold minimal',    display: 'Fraunces', body: 'Inter' },
  { name: 'Clean sans',      display: 'Inter', body: 'Inter' },
];

const DEFAULTS = {
  theme_color_primary:     '#1c1410',
  theme_color_accent:      '#c9a55a',
  theme_color_accent_dark: '#a8863d',
  theme_color_bg:          '#faf7f4',
  theme_color_blush:       '#fdf4f0',
  theme_font_display:      'Cormorant Garamond',
  theme_font_body:         'Inter',
};

const LOCAL_KEY = 'admin_theme_draft';

export default function Theme() {
  const toast = useToast();
  const [theme, setTheme] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await settingsAPI.getAll();
        const filtered = Object.fromEntries(
          Object.entries(data || {}).filter(([k]) => k.startsWith('theme_'))
        );
        setTheme({ ...DEFAULTS, ...filtered });
      } catch {
        const cached = localStorage.getItem(LOCAL_KEY);
        if (cached) {
          try { setTheme({ ...DEFAULTS, ...JSON.parse(cached) }); } catch { /* ignore */ }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (key, value) => {
    setTheme(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const applyPreset = (preset) => {
    setTheme(prev => ({
      ...prev,
      theme_color_primary:     preset.colors.primary,
      theme_color_accent:      preset.colors.accent,
      theme_color_accent_dark: preset.colors.accentDark,
      theme_color_bg:          preset.colors.bg,
      theme_color_blush:       preset.colors.blush,
    }));
    setDirty(true);
  };

  const applyFontPair = (pair) => {
    setTheme(prev => ({
      ...prev,
      theme_font_display: pair.display,
      theme_font_body:    pair.body,
    }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(theme).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateMany(entries);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(theme));
      toast.success('Theme published');
      setDirty(false);
    } catch {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(theme));
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
          <h1>Theme &amp; Colors</h1>
          <p className="muted">Rebrand your entire storefront without touching code.</p>
        </div>
        <div className="page-actions">
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="btn btn-outline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
            See changes
          </a>
          <button className="btn btn-accent" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Publish theme' : 'All saved'}
          </button>
        </div>
      </div>

      {dirty && <div className="alert alert-warning">You have unsaved changes.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="theme-grid">

        {/* ── LEFT: controls ───────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Quick presets</h2></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                {THEME_PRESETS.map(p => (
                  <button
                    key={p.name}
                    className="preset-card"
                    onClick={() => applyPreset(p)}
                  >
                    <div className="preset-swatches">
                      {Object.values(p.colors).slice(0, 4).map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </div>
                    <div className="preset-name">{p.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Colors</h2></div>
            <div className="card-body">
              <ColorField
                label="Accent (buttons, highlights)"
                hint="The single color most associated with your brand."
                value={theme.theme_color_accent}
                onChange={v => update('theme_color_accent', v)}
              />
              <ColorField
                label="Accent dark (hover state)"
                value={theme.theme_color_accent_dark}
                onChange={v => update('theme_color_accent_dark', v)}
              />
              <ColorField
                label="Primary (headings, dark sections)"
                value={theme.theme_color_primary}
                onChange={v => update('theme_color_primary', v)}
              />
              <ColorField
                label="Page background"
                value={theme.theme_color_bg}
                onChange={v => update('theme_color_bg', v)}
              />
              <ColorField
                label="Tinted section background"
                hint="Used for the brand story and other highlighted sections."
                value={theme.theme_color_blush}
                onChange={v => update('theme_color_blush', v)}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Fonts</h2></div>
            <div className="card-body">
              <label className="text-xs muted" style={{ marginBottom: 10, display: 'block' }}>Choose a pairing — headings use the first font, body text uses the second.</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {FONT_PAIRINGS.map(pair => {
                  const isActive = theme.theme_font_display === pair.display && theme.theme_font_body === pair.body;
                  return (
                    <button
                      key={pair.name}
                      onClick={() => applyFontPair(pair)}
                      className={`font-pair ${isActive ? 'active' : ''}`}
                    >
                      <div className="font-pair-meta">
                        <strong>{pair.name}</strong>
                        <span className="muted text-xs">{pair.display} · {pair.body}</span>
                      </div>
                      <div className="font-pair-sample" style={{ fontFamily: `"${pair.display}", serif`, fontSize: '1.4rem', fontWeight: 500 }}>
                        Aa
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: live preview ──────────────────── */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 76 }}>
            <div className="card-header"><h2 className="card-title">Live preview</h2></div>
            <div className="card-body" style={{ padding: 0 }}>
              <ThemePreview theme={theme} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .theme-grid { grid-template-columns: 1fr !important; }
        }
        .preset-card {
          background: #fff;
          border: 1px solid var(--ac-border);
          border-radius: 8px;
          padding: 10px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
        }
        .preset-card:hover { border-color: var(--ac-accent); transform: translateY(-1px); box-shadow: var(--ac-shadow); }
        .preset-swatches {
          display: flex;
          gap: 0;
          border-radius: 5px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .preset-swatches span {
          flex: 1;
          height: 32px;
        }
        .preset-name {
          font-size: 0.82rem;
          font-weight: 500;
          color: var(--ac-text);
        }
        .font-pair {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: #fff;
          border: 1px solid var(--ac-border);
          border-radius: 8px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
        }
        .font-pair:hover { border-color: var(--ac-accent); }
        .font-pair.active { border-color: var(--ac-accent); background: var(--ac-accent-light); }
        .font-pair-meta { display: flex; flex-direction: column; gap: 2px; }
        .font-pair-sample {
          color: var(--ac-text);
          line-height: 1;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function ColorField({ label, hint, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ width: 48, height: 40, padding: 2, cursor: 'pointer' }}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ fontFamily: 'SF Mono, Menlo, monospace', flex: 1 }}
        />
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function ThemePreview({ theme }) {
  return (
    <div style={{
      background: theme.theme_color_bg,
      fontFamily: `"${theme.theme_font_body}", sans-serif`,
      color: theme.theme_color_primary,
      overflow: 'hidden',
      borderRadius: '0 0 10px 10px',
    }}>
      {/* Fake nav */}
      <div style={{ background: '#fff', borderBottom: '1px solid var(--ac-border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: `"${theme.theme_font_display}", serif`, fontWeight: 600, fontStyle: 'italic', color: theme.theme_color_primary }}>Your Store</div>
        <div style={{ fontSize: '0.7rem', color: '#9ca3af', flex: 1, textAlign: 'right' }}>Home · Shop · Cart</div>
      </div>

      {/* Hero */}
      <div style={{ background: theme.theme_color_primary, padding: '32px 20px', color: '#fff' }}>
        <div style={{ fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.theme_color_accent, marginBottom: 8 }}>
          Handcrafted in Ghana
        </div>
        <div style={{ fontFamily: `"${theme.theme_font_display}", serif`, fontSize: '1.8rem', lineHeight: 1.1, marginBottom: 12 }}>
          Reveal your natural glow.
        </div>
        <div style={{
          display: 'inline-block',
          background: theme.theme_color_accent,
          color: '#fff',
          padding: '8px 18px',
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          borderRadius: 4,
        }}>
          Shop the Collection
        </div>
      </div>

      {/* Tinted section */}
      <div style={{ background: theme.theme_color_blush, padding: '24px 20px' }}>
        <div style={{ fontSize: '0.64rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: theme.theme_color_accent_dark, marginBottom: 6, fontWeight: 600 }}>
          Bestsellers
        </div>
        <div style={{ fontFamily: `"${theme.theme_font_display}", serif`, fontSize: '1.4rem', marginBottom: 16 }}>
          Loved by thousands
        </div>

        {/* Fake product cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ background: '#fff', borderRadius: 6, padding: 8 }}>
              <div style={{ aspectRatio: '1/1', background: theme.theme_color_blush, borderRadius: 4, marginBottom: 8 }} />
              <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase' }}>Body cream</div>
              <div style={{ fontFamily: `"${theme.theme_font_display}", serif`, fontSize: '0.88rem', fontWeight: 600 }}>Shea Glow</div>
              <div style={{ color: theme.theme_color_accent_dark, fontWeight: 600, fontSize: '0.8rem', marginTop: 2 }}>GHS 85.00</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
