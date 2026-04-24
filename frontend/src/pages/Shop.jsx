import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productsAPI } from '../services/api';
import ProductCard from '../components/ProductCard';
import TrustStrip from '../components/TrustStrip';
import './Shop.css';

// TO CUSTOMIZE: Add/remove categories to match your actual product range
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
];

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const search   = searchParams.get('search')   || '';
  const sort     = searchParams.get('sort')     || 'newest';
  const category = searchParams.get('category') || '';
  const page     = parseInt(searchParams.get('page') || '1');
  const LIMIT    = 12;

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: LIMIT, offset: (page - 1) * LIMIT };
      if (search)   params.search   = search;
      if (sort)     params.sort     = sort;
      if (category) params.category = category;

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
  }, [search, sort, category, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else       next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next);
  };

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
              value={search}
              onChange={e => setParam('search', e.target.value)}
              className="shop-search"
            />
            {search && (
              <button
                className="shop-search-clear"
                onClick={() => setParam('search', '')}
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
                  : 'No products are available right now.'}
            </p>
            {(search || category) && (
              <button
                className="btn btn-outline"
                onClick={() => setSearchParams({})}
                style={{ marginTop: '20px' }}
              >
                Clear Filters
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
