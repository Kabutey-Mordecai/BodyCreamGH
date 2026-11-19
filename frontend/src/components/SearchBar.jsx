import { useState, useEffect, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './SearchBar.css';

const RECENT_KEY = 'bc_recent_searches';
const MAX_RECENT = 5;

function loadRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

function saveRecent(term) {
  const clean = term.trim();
  if (!clean) return;
  try {
    const next = [clean, ...loadRecent().filter(t => t.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore storage errors */ }
}

export default function SearchBar({
  variant = 'nav',
  placeholder = 'Search products…',
  onNavigate,
}) {
  const navigate = useNavigate();
  const listId   = useId();
  const wrapRef  = useRef(null);

  const [query, setQuery]           = useState('');
  const [open, setOpen]             = useState(false);
  const [activeIdx, setActiveIdx]   = useState(-1);
  const [recent, setRecent]         = useState(() => loadRecent());
  const [results, setResults]       = useState({ products: [], categories: [] });
  const [loading, setLoading]       = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced live suggestions
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults({ products: [], categories: [] });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      productsAPI.suggest(q)
        .then(({ data }) => {
          if (!cancelled) {
            setResults({
              products: data?.products || [],
              categories: data?.categories || [],
            });
            setActiveIdx(-1);
          }
        })
        .catch(() => {
          if (!cancelled) setResults({ products: [], categories: [] });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const trimmed = query.trim();
  const showRecent = open && trimmed.length < 2 && recent.length > 0;
  const flatItems = showRecent
    ? recent.map(term => ({ kind: 'recent', label: term }))
    : [
        ...results.categories.map(cat => ({ kind: 'category', label: cat })),
        ...results.products.map(p => ({ kind: 'product', product: p })),
      ];
  const showDropdown = open && (showRecent || (trimmed.length >= 2 && (loading || flatItems.length > 0)));

  const selectItem = (item) => {
    setOpen(false);
    if (item.kind === 'recent') {
      saveRecent(item.label);
      setRecent(loadRecent());
      navigate(`/shop?search=${encodeURIComponent(item.label)}`);
    } else if (item.kind === 'category') {
      navigate(`/shop?category=${encodeURIComponent(item.label)}`);
    } else if (item.kind === 'product') {
      saveRecent(item.product.name);
      setRecent(loadRecent());
      navigate(`/products/${item.product.id}`);
    }
    setQuery('');
    onNavigate?.();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (activeIdx >= 0 && flatItems[activeIdx]) {
      selectItem(flatItems[activeIdx]);
      return;
    }
    if (trimmed) {
      saveRecent(trimmed);
      setRecent(loadRecent());
      navigate(`/shop?search=${encodeURIComponent(trimmed)}`);
    } else if (variant === 'hero') {
      navigate('/shop');
    } else {
      return;
    }
    setOpen(false);
    setQuery('');
    onNavigate?.();
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i <= 0 ? flatItems.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const isHero   = variant === 'hero';
  const isMobile = variant === 'mobile';
  const formCls  = isHero
    ? 'hero-search'
    : `nav-search${isMobile ? ' nav-search--mobile' : ''}`;

  return (
    <div className={`searchbar-wrap searchbar-wrap--${variant}`} ref={wrapRef}>
      <form className={formCls} onSubmit={handleSubmit} role="search">
        <svg
          className={isHero ? 'hero-search-icon' : 'nav-search-icon'}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-label="Search products"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          className={isHero ? 'hero-search-input' : 'nav-search-input'}
        />
        <button type="submit" className={isHero ? 'hero-search-btn' : 'nav-search-btn'}>
          Search
        </button>
      </form>

      {showDropdown && (
        <ul id={listId} role="listbox" className="searchbar-dropdown">
          {showRecent && (
            <li className="searchbar-section-label" aria-hidden="true">Recent searches</li>
          )}
          {!showRecent && loading && flatItems.length === 0 && (
            <li className="searchbar-empty">Searching…</li>
          )}
          {flatItems.map((item, idx) => {
            const isActive = idx === activeIdx;
            if (item.kind === 'recent') {
              return (
                <li key={`r-${item.label}`} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    className={`searchbar-item${isActive ? ' is-active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); selectItem(item); }}
                  >
                    <span className="searchbar-tag">Recent</span>
                    <span className="searchbar-title">{item.label}</span>
                  </button>
                </li>
              );
            }
            if (item.kind === 'category') {
              return (
                <li key={`c-${item.label}`} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    className={`searchbar-item${isActive ? ' is-active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); selectItem(item); }}
                  >
                    <span className="searchbar-tag">Category</span>
                    <span className="searchbar-title">{item.label}</span>
                  </button>
                </li>
              );
            }
            const p = item.product;
            return (
              <li key={p.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  className={`searchbar-item searchbar-item--product${isActive ? ' is-active' : ''}`}
                  onMouseDown={e => { e.preventDefault(); selectItem(item); }}
                >
                  {p.image_url && (
                    <img
                      src={resolveImageUrl(p.image_url)}
                      alt=""
                      className="searchbar-thumb"
                      loading="lazy"
                    />
                  )}
                  <span className="searchbar-prod-meta">
                    <span className="searchbar-title">{p.name}</span>
                    {p.category && <span className="searchbar-cat">{p.category}</span>}
                  </span>
                  <span className="searchbar-price">GHS {parseFloat(p.price).toFixed(2)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
