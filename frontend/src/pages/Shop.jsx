import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useSeo } from '../utils/seo';
import ProductCard from '../components/ProductCard';
import TrustStrip from '../components/TrustStrip';
import './Shop.css';

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
  const [apiCategories, setApiCategories] = useState([]);
  const [apiBrands, setApiBrands]         = useState([]);
  const [catQuery, setCatQuery]           = useState('');
  const [brandQuery, setBrandQuery]       = useState('');
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandModalLetter, setBrandModalLetter] = useState('');
  const [brandModalSearch, setBrandModalSearch] = useState('');
  const [openSections, setOpenSections]   = useState({
    category: true,
    brand: true,
    price: true,
    availability: true,
  });

  const toggleSection = (key) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    let active = true;
    productsAPI.getCategories()
      .then(({ data }) => {
        if (active && Array.isArray(data?.categories)) {
          setApiCategories(data.categories);
        }
      })
      .catch(() => {});
    productsAPI.getBrands()
      .then(({ data }) => {
        if (active && Array.isArray(data?.brands)) {
          setApiBrands(data.brands);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Local state for price range inputs — only committed to URL on "Apply"
  const [priceMinInput, setPriceMinInput] = useState('');
  const [priceMaxInput, setPriceMaxInput] = useState('');

  const search    = searchParams.get('search')    || '';
  const sort      = searchParams.get('sort')      || 'newest';
  const category  = searchParams.get('category')  || '';
  const brand     = searchParams.get('brand')     || '';
  const page      = parseInt(searchParams.get('page') || '1');
  const minPrice  = searchParams.get('min_price') || '';
  const maxPrice  = searchParams.get('max_price') || '';
  const inStock   = searchParams.get('in_stock')  || '';
  const categoryOptions = useMemo(() => {
    const seen = new Set();
    const list = [{ label: 'All Products', value: '' }];
    const addCat = (raw) => {
      const val = typeof raw === 'string' ? raw.trim() : '';
      if (!val || seen.has(val.toLowerCase())) return;
      seen.add(val.toLowerCase());
      list.push({ label: val, value: val });
    };
    if (apiCategories.length > 0) {
      apiCategories.forEach(addCat);
    } else if (Array.isArray(settings.categories)) {
      settings.categories.forEach((c) => addCat(typeof c === 'string' ? c : c?.label));
    }
    if (category) addCat(category);
    return list;
  }, [settings.categories, apiCategories, category]);

  const visibleCategoryOptions = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    if (!q) return categoryOptions;
    return categoryOptions.filter(
      (c) => c.value === '' || c.label.toLowerCase().includes(q)
    );
  }, [categoryOptions, catQuery]);

  const visibleBrandOptions = useMemo(() => {
    const list = [{ label: 'All Brands', value: '' }];
    const seen = new Set();
    apiBrands.forEach(b => {
      const val = typeof b === 'string' ? b.trim() : '';
      if (!val || seen.has(val.toLowerCase())) return;
      seen.add(val.toLowerCase());
      list.push({ label: val, value: val });
    });
    if (brand && !seen.has(brand.toLowerCase())) {
      list.push({ label: brand, value: brand });
    }
    const q = brandQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(b => b.value === '' || b.label.toLowerCase().includes(q));
  }, [apiBrands, brand, brandQuery]);

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
      if (brand)    params.brand     = brand;
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
  }, [search, sort, category, brand, page, minPrice, maxPrice, inStock]);

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
  const hasActiveFilters = hasPriceFilter || hasInStockFilter || category || brand || search;

  const activeFiltersCount = (category ? 1 : 0) + (brand ? 1 : 0) + (hasPriceFilter ? 1 : 0) + (hasInStockFilter ? 1 : 0) + (search ? 1 : 0);

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
            Curated authentic skincare, makeup, haircare, body care, and fragrances — delivered across Ghana.
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
              id="shop-mobile-sort"
              name="sort"
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
                <button
                  type="button"
                  className="shop-filter-accordion-btn"
                  onClick={() => toggleSection('category')}
                  aria-expanded={openSections.category}
                >
                  <span className="shop-filter-group-title">Category</span>
                  <span className="shop-filter-accordion-meta">
                    {category && !openSections.category && (
                      <span className="shop-filter-mini-badge">{category}</span>
                    )}
                    <span className={`shop-filter-chevron ${openSections.category ? 'open' : ''}`}>▾</span>
                  </span>
                </button>
                {openSections.category && (
                  <>
                    {categoryOptions.length > 8 && (
                      <input
                        id="shop-cat-query"
                        name="category_filter"
                        type="search"
                        value={catQuery}
                        onChange={(e) => setCatQuery(e.target.value)}
                        placeholder="Search categories…"
                        aria-label="Filter categories"
                        className="shop-sidebar-search-input"
                      />
                    )}
                    <ul className="shop-category-list">
                      {visibleCategoryOptions.map(cat => (
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
                  </>
                )}
              </div>

              {/* Filter Group: Brands — compact preview + A-Z Directory Modal for 100+ brands */}
              {visibleBrandOptions.length > 1 && (
                <div className="shop-filter-group">
                  <button
                    type="button"
                    className="shop-filter-accordion-btn"
                    onClick={() => toggleSection('brand')}
                    aria-expanded={openSections.brand}
                  >
                    <span className="shop-filter-group-title">
                      Brand <span className="shop-filter-count">({apiBrands.length})</span>
                    </span>
                    <span className="shop-filter-accordion-meta">
                      {brand && !openSections.brand && (
                        <span className="shop-filter-mini-badge">{brand}</span>
                      )}
                      <span className={`shop-filter-chevron ${openSections.brand ? 'open' : ''}`}>▾</span>
                    </span>
                  </button>
                  {openSections.brand && (
                    <>
                      {apiBrands.length > 6 && (
                        <input
                          id="shop-brand-query"
                          name="brand_filter"
                          type="search"
                          value={brandQuery}
                          onChange={(e) => setBrandQuery(e.target.value)}
                          placeholder="Search brands…"
                          aria-label="Filter brands"
                          className="shop-sidebar-search-input"
                        />
                      )}
                      {(() => {
                        const SIDEBAR_BRAND_LIMIT = 6;
                        const isSearching = brandQuery.trim().length > 0;
                        let displayList = isSearching
                          ? visibleBrandOptions.slice(0, 10)
                          : visibleBrandOptions.slice(0, SIDEBAR_BRAND_LIMIT + 1); // All Brands + 6

                        // Keep active brand visible even if it's beyond the first 6
                        if (
                          !isSearching &&
                          brand &&
                          !displayList.some(b => b.value.toLowerCase() === brand.toLowerCase())
                        ) {
                          const match = visibleBrandOptions.find(b => b.value.toLowerCase() === brand.toLowerCase());
                          if (match) displayList = [displayList[0], match, ...displayList.slice(1, SIDEBAR_BRAND_LIMIT)];
                        }

                        return (
                          <>
                            <ul className="shop-category-list">
                              {displayList.map(b => (
                                <li key={b.value || 'all-brands'}>
                                  <button
                                    type="button"
                                    className={`shop-category-item ${brand.toLowerCase() === b.value.toLowerCase() ? 'active' : ''}`}
                                    onClick={() => {
                                      setParam('brand', b.value);
                                      setMobileFiltersOpen(false);
                                    }}
                                  >
                                    <span className="cat-bullet" />
                                    <span className="cat-name">{b.label}</span>
                                    {brand.toLowerCase() === b.value.toLowerCase() && <span className="cat-check">✓</span>}
                                  </button>
                                </li>
                              ))}
                              {isSearching && visibleBrandOptions.length === 1 && (
                                <li className="shop-filter-empty-note">No matching brands</li>
                              )}
                            </ul>
                            {apiBrands.length > SIDEBAR_BRAND_LIMIT && (
                              <button
                                type="button"
                                className="shop-browse-brands-btn"
                                onClick={() => {
                                  setBrandModalLetter('');
                                  setBrandModalSearch('');
                                  setBrandModalOpen(true);
                                }}
                              >
                                <span>Browse all {apiBrands.length} brands (A–Z)</span>
                                <span aria-hidden="true">→</span>
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

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
                      id="shop-price-min"
                      name="min_price"
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
                      id="shop-price-max"
                      name="max_price"
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
                <label className="shop-instock-checkbox" htmlFor="shop-instock-only">
                  <input
                    id="shop-instock-only"
                    name="in_stock"
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
                <svg className="shop-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  id="shop-search-query"
                  name="search"
                  type="search"
                  placeholder="Search products by name, collection, ingredients…"
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
                <button type="submit" className="shop-search-submit-btn">
                  Search
                </button>
              </form>

              <div className="shop-sort-pill desktop-sort">
                <label htmlFor="shop-desktop-sort" className="shop-sort-caption">Sort:</label>
                <div className="shop-sort-select-wrap">
                  <select
                    id="shop-desktop-sort"
                    name="sort"
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
                {brand && (
                  <span className="shop-filter-pill">
                    Brand: {brand}
                    <button onClick={() => setParam('brand', '')} aria-label="Remove brand filter">✕</button>
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
                {brand    && <> by <em>{brand}</em></>}
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

      {/* ── A–Z Brand Directory Modal (scales cleanly to 100+ brands) ── */}
      {brandModalOpen && (
        <div
          className="brand-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Browse all brands"
          onClick={() => setBrandModalOpen(false)}
        >
          <div className="brand-modal" onClick={(e) => e.stopPropagation()}>
            <div className="brand-modal-header">
              <div>
                <span className="section-label" style={{ marginBottom: 2 }}>Brand Directory</span>
                <h3 className="brand-modal-title">All Brands ({apiBrands.length})</h3>
              </div>
              <button
                type="button"
                className="brand-modal-close"
                onClick={() => setBrandModalOpen(false)}
                aria-label="Close brand directory"
              >
                ✕
              </button>
            </div>

            <div className="brand-modal-controls">
              <input
                id="brand-modal-search"
                name="brand_modal_search"
                type="search"
                value={brandModalSearch}
                onChange={(e) => {
                  setBrandModalSearch(e.target.value);
                  setBrandModalLetter('');
                }}
                placeholder="Search any brand (e.g. CeraVe, Fenty, Nivea…)"
                className="brand-modal-search"
                autoFocus
              />

              {(() => {
                const letters = Array.from(
                  new Set(
                    apiBrands
                      .map(b => (b || '').trim().charAt(0).toUpperCase())
                      .filter(ch => /[A-Z]/.test(ch))
                  )
                ).sort();

                return (
                  <div className="brand-alpha-bar" role="tablist" aria-label="Filter brands by letter">
                    <button
                      type="button"
                      className={`brand-alpha-btn ${brandModalLetter === '' ? 'active' : ''}`}
                      onClick={() => setBrandModalLetter('')}
                    >
                      All
                    </button>
                    {letters.map(ch => (
                      <button
                        key={ch}
                        type="button"
                        className={`brand-alpha-btn ${brandModalLetter === ch ? 'active' : ''}`}
                        onClick={() => {
                          setBrandModalSearch('');
                          setBrandModalLetter(ch);
                        }}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="brand-modal-body">
              {(() => {
                const q = brandModalSearch.trim().toLowerCase();
                const filtered = apiBrands.filter(b => {
                  if (q) return b.toLowerCase().includes(q);
                  if (brandModalLetter) return b.trim().toUpperCase().startsWith(brandModalLetter);
                  return true;
                });

                if (filtered.length === 0) {
                  return <p className="brand-modal-empty">No brands match "{brandModalSearch}".</p>;
                }

                // Group alphabetically by first letter
                const groups = {};
                filtered.forEach(b => {
                  const key = b.trim().charAt(0).toUpperCase() || '#';
                  if (!groups[key]) groups[key] = [];
                  groups[key].push(b);
                });

                return Object.keys(groups).sort().map(letter => (
                  <div key={letter} className="brand-alpha-group">
                    <h4 className="brand-alpha-heading">{letter}</h4>
                    <div className="brand-alpha-grid">
                      {groups[letter].map(b => {
                        const isActive = brand.toLowerCase() === b.toLowerCase();
                        return (
                          <button
                            key={b}
                            type="button"
                            className={`brand-modal-pill ${isActive ? 'active' : ''}`}
                            onClick={() => {
                              setParam('brand', b);
                              setBrandModalOpen(false);
                              setMobileFiltersOpen(false);
                            }}
                          >
                            <span>{b}</span>
                            {isActive && <span className="cat-check">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
