import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useSeo } from '../utils/seo';
import ProductCard from '../components/ProductCard';
import TrustStrip from '../components/TrustStrip';
import './Shop.css';

const CATEGORIES = [
  { label: 'All Products', value: '' },
  { label: 'Body Cream',   value: 'Body Cream' },
  { label: 'Body Butter',  value: 'Body Butter' },
  { label: 'Body Oil',     value: 'Body Oil' },
  { label: 'Body Scrub',   value: 'Body Scrub' },
  { label: 'Body Mask',    value: 'Body Mask' },
];

const SORT_OPTIONS = [
  { label: 'Newest first',      value: 'newest' },
  { label: 'Price: low → high', value: 'price_low' },
  { label: 'Price: high → low', value: 'price_high' },
  { label: 'Name: A–Z',         value: 'name_asc' },
  { label: 'Top rated',         value: 'top_rated' },
];

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useSettings();

  const [products, setProducts] = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Local state for price range inputs — only committed to URL on "Apply"
  const [priceMinInput, setPriceMinInput] = useState('');
  const [priceMaxInput, setPriceMaxInput] = useState('');

  const search    = searchParams.get('search')    || '';
  const sort      = searchParams.get('sort')      || 'newest';
  const category  = searchParams.get('category')  || '';
  const page      = parseInt(searchParams.get('page') || '1');
  const minPrice  = searchParams.get('min_price') || '';
  const maxPrice  = searchParams.get('max_price') || '';
  const inStock   = searchParams.get('in_stock')  || '';
  const LIMIT     = 12;

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== search) {
        const next = new URLSearchParams(searchParams);
        if (searchInput.trim()) next.set('search', searchInput.trim());
        else next.delete('search');
        next.set('page', '1');
        setSearchParams(next, { replace: true });
      }
    }, 350);
    return () => clearTimeout(handler);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const shopSeo = useMemo(() => {
    const storeName = settings.store_name || 'BodyCream GH';
    let title = `Shop All Products — ${storeName}`;
    let description = `Browse handcrafted body creams, body butters, oils, and scrubs made in Ghana by ${storeName}.`;
    if (search) {
      title = `Search "${search}" — ${storeName}`;
      description = `Search results for ${search} at ${storeName}.`;
    } else if (category) {
      title = `${category} — ${storeName}`;
      description = `Shop handcrafted ${category.toLowerCase()} products made in Ghana by ${storeName}.`;
    }
    return { title, description };
  }, [category, search, settings.store_name]);

  useSeo(shopSeo);

  // Keep price inputs in sync when URL changes (e.g. browser back)
  useEffect(() => {
    setPriceMinInput(minPrice);
    setPriceMaxInput(maxPrice);
  }, [minPrice, maxPrice]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: LIMIT, offset: (page - 1) * LIMIT };
      if (search)   params.search    = search;
      if (sort)     params.sort      = sort;
      if (category) params.category  = category;
      if (minPrice) params.min_price = minPrice;
      if (maxPrice) params.max_price = maxPrice;
      if (inStock)  params.in_stock  = inStock;

      const { data } = await productsAPI.getAll(params);
      if (Array.isArray(data)) {
        setProducts(data);
        setTotal(data.length);
      } else {
        setProducts(data.products || []);
        setTotal(data.total     || 0);
      }
    } catch {
      setError('Failed to load products. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, [search, sort, category, page, minPrice, maxPrice, inStock]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else       next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next);
    if (key === 'page') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const applyPriceFilter = () => {
    const next = new URLSearchParams(searchParams);
    if (priceMinInput) next.set('min_price', priceMinInput);
    else               next.delete('min_price');
    if (priceMaxInput) next.set('max_price', priceMaxInput);
    else               next.delete('max_price');
    next.set('page', '1');
    setSearchParams(next);
  };

  const clearPriceFilter = () => {
    setPriceMinInput('');
    setPriceMaxInput('');
    const next = new URLSearchParams(searchParams);
    next.delete('min_price');
    next.delete('max_price');
    next.set('page', '1');
    setSearchParams(next);
  };

  const clearAllFilters = () => {
    setPriceMinInput('');
    setPriceMaxInput('');
    setSearchParams({});
  };

  const hasPriceFilter   = minPrice || maxPrice;
  const hasInStockFilter = inStock === 'true';
  const hasActiveFilters = hasPriceFilter || hasInStockFilter || category || search;

  const activeFiltersCount = (category ? 1 : 0) + (hasPriceFilter ? 1 : 0) + (hasInStockFilter ? 1 : 0) + (search ? 1 : 0);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="page-section shop-page">
      <div className="container">

        {/* ── Editorial header ──────────────────── */}
        <div className="shop-header">
          <span className="section-label">The Collection</span>
          <h1 className="page-title">Shop all products</h1>
          <div className="gold-divider" style={{ margin: '0 auto 16px' }} />
          <p className="page-subtitle">
            Handcrafted body creams, oils, and scrubs — blended in small batches
            with Ghana's finest botanicals.
          </p>
        </div>

        {/* ── Mobile filter toggle bar (hidden on desktop) ── */}
        <div className="shop-mobile-filter-bar">
          <button 
            type="button" 
            className="btn btn-outline shop-mobile-filter-btn"
            onClick={() => setMobileFiltersOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
            </svg>
            <span>Filters {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ''}</span>
          </button>

          <div className="shop-sort-wrap mobile-sort">
            <select
              value={sort}
              onChange={e => setParam('sort', e.target.value)}
              className="shop-sort"
              aria-label="Sort products"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Main Two-Column Layout ──────────────── */}
        <div className="shop-layout">

          {/* ── SIDEBAR FILTERS ── */}
          <aside className={`shop-sidebar ${mobileFiltersOpen ? 'open' : ''}`}>
            <div className="shop-sidebar-inner">
              <div className="shop-sidebar-header">
                <div className="shop-sidebar-title-wrap">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
                  </svg>
                  <h3 className="shop-sidebar-title">Filters</h3>
                </div>
                {hasActiveFilters && (
                  <button type="button" className="shop-sidebar-reset" onClick={clearAllFilters}>
                    Reset All
                  </button>
                )}
                <button 
                  type="button" 
                  className="shop-sidebar-close" 
                  onClick={() => setMobileFiltersOpen(false)}
                  aria-label="Close filters"
                >
                  ✕
                </button>
              </div>

              {/* Filter Group: Categories */}
              <div className="shop-filter-group">
                <h4 className="shop-filter-group-title">Category</h4>
                <ul className="shop-category-list">
                  {CATEGORIES.map(cat => (
                    <li key={cat.value}>
                      <button
                        type="button"
                        className={`shop-category-item ${category === cat.value ? 'active' : ''}`}
                        onClick={() => {
                          setParam('category', cat.value);
                          setMobileFiltersOpen(false);
                        }}
                      >
                        <span className="cat-bullet" />
                        <span className="cat-name">{cat.label}</span>
                        {category === cat.value && <span className="cat-check">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Filter Group: Price Range */}
              <div className="shop-filter-group">
                <div className="shop-filter-group-header">
                  <h4 className="shop-filter-group-title">Price (GH₵)</h4>
                  {hasPriceFilter && (
                    <button type="button" className="shop-filter-clear-link" onClick={clearPriceFilter}>
                      Clear
                    </button>
                  )}
                </div>
                <div className="shop-price-inputs-row">
                  <div className="shop-price-field">
                    <span className="shop-price-sublabel">Min</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={priceMinInput}
                      onChange={e => setPriceMinInput(e.target.value)}
                      className="shop-price-input"
                      aria-label="Minimum price"
                    />
                  </div>
                  <span className="shop-price-sep">–</span>
                  <div className="shop-price-field">
                    <span className="shop-price-sublabel">Max</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="500"
                      value={priceMaxInput}
                      onChange={e => setPriceMaxInput(e.target.value)}
                      className="shop-price-input"
                      aria-label="Maximum price"
                      onKeyDown={e => e.key === 'Enter' && applyPriceFilter()}
                    />
                  </div>
                </div>
                <button 
                  type="button" 
                  className="btn btn-sm btn-primary shop-price-apply-btn" 
                  onClick={() => {
                    applyPriceFilter();
                    setMobileFiltersOpen(false);
                  }}
                >
                  Apply Price
                </button>
              </div>

              {/* Filter Group: Availability */}
              <div className="shop-filter-group">
                <h4 className="shop-filter-group-title">Availability</h4>
                <label className="shop-instock-checkbox">
                  <input
                    type="checkbox"
                    checked={hasInStockFilter}
                    onChange={e => setParam('in_stock', e.target.checked ? 'true' : '')}
                  />
                  <span className="shop-checkbox-custom" />
                  <span className="shop-checkbox-text">In stock only</span>
                </label>
              </div>

              {/* Mobile Drawer Close / Apply */}
              <div className="shop-mobile-drawer-footer">
                <button 
                  type="button" 
                  className="btn btn-primary btn-full"
                  onClick={() => setMobileFiltersOpen(false)}
                >
                  View {total} Result{total !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </aside>

          {/* Mobile Overlay */}
          {mobileFiltersOpen && (
            <div 
              className="shop-sidebar-backdrop" 
              onClick={() => setMobileFiltersOpen(false)} 
            />
          )}

          {/* ── PRODUCTS MAIN CONTENT ── */}
          <main className="shop-main">

            {/* Redesigned Toolbar: Luxury Search Bar + Standalone Sort Pill */}
            <div className="shop-toolbar-redesign">
              <form 
                className="shop-search-form" 
                onSubmit={(e) => { 
                  e.preventDefault(); 
                  setParam('search', searchInput.trim()); 
                }}
              >
                <div className="shop-search-input-wrapper">
                  <svg className="shop-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Search body creams, oils, scrubs, butters…"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    className="shop-search-input"
                    aria-label="Search products"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      className="shop-search-clear-btn"
                      onClick={() => {
                        setSearchInput('');
                        setParam('search', '');
                      }}
                      aria-label="Clear search"
                    >✕</button>
                  )}
                </div>
                <button type="submit" className="shop-search-submit-btn">
                  <span>Search</span>
                </button>
              </form>

              <div className="shop-sort-pill desktop-sort">
                <span className="shop-sort-caption">Sort:</span>
                <div className="shop-sort-select-wrap">
                  <select
                    value={sort}
                    onChange={e => setParam('sort', e.target.value)}
                    className="shop-sort-select"
                    aria-label="Sort products"
                  >
                    {SORT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <svg className="shop-sort-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Active filter pills */}
            {hasActiveFilters && (
              <div className="shop-active-filters">
                {category && (
                  <span className="shop-filter-pill">
                    Category: {category}
                    <button onClick={() => setParam('category', '')} aria-label="Remove category filter">✕</button>
                  </span>
                )}
                {hasPriceFilter && (
                  <span className="shop-filter-pill">
                    GH₵{minPrice || '0'} – GH₵{maxPrice || '∞'}
                    <button onClick={clearPriceFilter} aria-label="Remove price filter">✕</button>
                  </span>
                )}
                {hasInStockFilter && (
                  <span className="shop-filter-pill">
                    In stock only
                    <button onClick={() => setParam('in_stock', '')} aria-label="Remove in-stock filter">✕</button>
                  </span>
                )}
                {search && (
                  <span className="shop-filter-pill">
                    "{search}"
                    <button onClick={() => { setSearchInput(''); setParam('search', ''); }} aria-label="Remove search filter">✕</button>
                  </span>
                )}
                <button className="shop-clear-all-pill" onClick={clearAllFilters}>
                  Clear All
                </button>
              </div>
            )}

            {/* Results meta line */}
            {!loading && !error && (
              <p className="shop-count">
                Showing <strong>{products.length}</strong> of <strong>{total}</strong> product{total !== 1 ? 's' : ''}
                {category && <> in <em>{category}</em></>}
                {search   && <> matching "<em>{search}</em>"</>}
              </p>
            )}

            {/* Grid & states */}
            {error && <div className="alert alert-error">{error}</div>}

            {loading ? (
              <div className="spinner" />
            ) : products.length === 0 ? (
              <div className="shop-empty">
                <span className="shop-empty-icon">✦</span>
                <h3>Nothing found</h3>
                <p>
                  {search
                    ? `No products match "${search}".`
                    : category
                      ? `No ${category} products yet.`
                      : hasPriceFilter
                        ? 'No products in that price range.'
                        : 'No products are available right now.'}
                </p>
                {hasActiveFilters && (
                  <button
                    className="btn btn-outline"
                    onClick={clearAllFilters}
                    style={{ marginTop: '20px' }}
                  >
                    Clear All Filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="products-grid">
                  {products.map(p => <ProductCard key={p.id} product={p} />)}
                </div>

                {totalPages > 1 && (
                  <div className="pagination">
                    <button
                      className="btn btn-outline"
                      disabled={page <= 1}
                      onClick={() => setParam('page', page - 1)}
                    >← Prev</button>
                    <span className="pagination-info">
                      Page <strong>{page}</strong> of {totalPages}
                    </span>
                    <button
                      className="btn btn-outline"
                      disabled={page >= totalPages}
                      onClick={() => setParam('page', page + 1)}
                    >Next →</button>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      <TrustStrip />
    </div>
  );
}
