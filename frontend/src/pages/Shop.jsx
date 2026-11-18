import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useSeo } from '../utils/seo';
import ProductCard from '../components/ProductCard';
import TrustStrip from '../components/TrustStrip';
import './Shop.css';

const CATEGORIES = [
  { label: 'All',         value: '' },
  { label: 'Body Cream',  value: 'Body Cream' },
  { label: 'Body Butter', value: 'Body Butter' },
  { label: 'Body Oil',    value: 'Body Oil' },
  { label: 'Body Scrub',  value: 'Body Scrub' },
  { label: 'Body Mask',   value: 'Body Mask' },
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

        {/* ── Category pills ────────────────────── */}
        <div className="shop-categories">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              className={`shop-cat-pill ${category === cat.value ? 'active' : ''}`}
              onClick={() => setParam('category', cat.value)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* ── Price range + In-stock filter bar ──── */}
        <div className="shop-filter-bar">
          <div className="shop-price-range">
            <span className="shop-filter-label">Price (GH₵)</span>
            <input
              type="number"
              min="0"
              placeholder="Min"
              value={priceMinInput}
              onChange={e => setPriceMinInput(e.target.value)}
              className="shop-price-input"
              aria-label="Minimum price"
            />
            <span className="shop-price-sep">–</span>
            <input
              type="number"
              min="0"
              placeholder="Max"
              value={priceMaxInput}
              onChange={e => setPriceMaxInput(e.target.value)}
              className="shop-price-input"
              aria-label="Maximum price"
              onKeyDown={e => e.key === 'Enter' && applyPriceFilter()}
            />
            <button className="btn btn-sm btn-outline" onClick={applyPriceFilter}>
              Apply
            </button>
            {hasPriceFilter && (
              <button className="shop-filter-clear" onClick={clearPriceFilter}>
                Clear
              </button>
            )}
          </div>

          <label className="shop-instock-label">
            <input
              type="checkbox"
              checked={hasInStockFilter}
              onChange={e => setParam('in_stock', e.target.checked ? 'true' : '')}
            />
            In stock only
          </label>
        </div>

        {/* ── Active filter pills ──────────────────── */}
        {(hasPriceFilter || hasInStockFilter) && (
          <div className="shop-active-filters">
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
          </div>
        )}

        {/* ── Search + Sort toolbar ─────────────── */}
        <div className="shop-toolbar">
          <div className="shop-search-wrap">
            <svg className="shop-search-icon" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="search"
              placeholder="Search products…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="shop-search"
              aria-label="Search products"
            />
            {searchInput && (
              <button
                className="shop-search-clear"
                onClick={() => {
                  setSearchInput('');
                  setParam('search', '');
                }}
                aria-label="Clear search"
              >✕</button>
            )}
          </div>

          <div className="shop-sort-wrap">
            <span className="shop-sort-label">Sort by</span>
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

        {/* ── Results meta line ─────────────────── */}
        {!loading && !error && products.length > 0 && (
          <p className="shop-count">
            {total} product{total !== 1 ? 's' : ''}
            {category && <> in <strong>{category}</strong></>}
            {search   && <> matching "<strong>{search}</strong>"</>}
          </p>
        )}

        {/* ── Grid ──────────────────────────────── */}
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
      </div>

      <TrustStrip />
    </div>
  );
}
