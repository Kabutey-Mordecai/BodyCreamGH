import { useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { productsAPI, settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './Products.css';

const PAGE_SIZE = 20;
const STOREFRONT_BASE = (import.meta.env.VITE_STOREFRONT_URL || 'https://bodycreamgh-shop.vercel.app').replace(/\/$/, '');
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

const stockStatus = (qty, threshold = 5) => {
  const n = Number(qty ?? 0);
  if (n <= 0) return 'out_of_stock';
  if (n <= threshold) return 'low_stock';
  return 'in_stock';
};

const isProductOnSale = (p) => {
  const price = Number(p.price || 0);
  const compareAt = Number(p.compare_at_price || 0);
  const hasPromo = p.active_promotion && Number(p.active_promotion.discounted_price) < price;
  return Boolean(hasPromo || (compareAt > price && price > 0));
};

// Lightweight CSV parser supporting quoted fields
function parseProductCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const splitRow = (line) => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = splitRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const vals = splitRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  }).filter(r => r.name && r.price !== '');
}

function ProductThumb({ url, alt }) {
  const [failed, setFailed] = useState(false);
  const src = url ? resolveImageUrl(url) : '';
  return (
    <div className="ap-prod-thumb">
      {src && !failed ? (
        <img src={src} alt={alt || ''} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      )}
    </div>
  );
}

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();

  const [products, setProducts] = useState([]);
  const [catalogSnapshot, setCatalogSnapshot] = useState([]);
  const [total, setTotal]       = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]   = useState(true);

  const [search, setSearch]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand]       = useState('');
  const [sort, setSort]         = useState('');
  const [statusTab, setStatusTab] = useState('all'); // all | active | hidden | low_stock | out_of_stock | on_sale
  const [viewMode, setViewMode] = useState('table'); // table | grid

  const [brandList, setBrandList] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [page, setPage]         = useState(1);
  const [confirm, setConfirm]   = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText]   = useState('');
  const [importing, setImporting] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [storefrontUrl, setStorefrontUrl] = useState(STOREFRONT_BASE);
  const debounceRef = useRef(null);

  // Quick Deal & Discount modal state
  const [discountModalProduct, setDiscountModalProduct] = useState(null);
  const [discountForm, setDiscountForm] = useState({ price: '', compare_at_price: '' });
  const [savingDiscount, setSavingDiscount] = useState(false);

  const loadSnapshot = () => {
    productsAPI.getAdminAll({ page: 1, limit: 100 })
      .then(({ data }) => {
        if (Array.isArray(data?.data)) setCatalogSnapshot(data.data);
      })
      .catch(() => {});
  };

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
    productsAPI.getBrands()
      .then(({ data }) => {
        if (Array.isArray(data?.brands)) setBrandList(data.brands);
      })
      .catch(() => {});
    productsAPI.getCategories()
      .then(({ data }) => {
        const cats = data?.categories || data || [];
        if (Array.isArray(cats)) {
          setCategoryList(cats.map(c => (typeof c === 'string' ? c : c?.category || c?.label)).filter(Boolean));
        }
      })
      .catch(() => {});
    loadSnapshot();
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 320);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => { setPage(1); }, [category, brand, sort, statusTab]);

  // When a client-side status tab (active/hidden/low_stock/out_of_stock/on_sale) is active,
  // fetch up to 100 items so tab filtering & pagination stay accurate across the catalog.
  const isTabFiltered = statusTab !== 'all';

  const load = () => {
    setLoading(true);
    const reqLimit = isTabFiltered ? 100 : PAGE_SIZE;
    const reqPage  = isTabFiltered ? 1 : page;
    productsAPI.getAdminAll({
      page: reqPage,
      limit: reqLimit,
      search: debouncedSearch,
      category,
      brand,
      sort: sort || undefined,
    })
      .then(({ data }) => {
        setProducts(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, debouncedSearch, category, brand, sort, statusTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Catalog-wide KPI metrics
  const kpis = useMemo(() => {
    const source = catalogSnapshot.length > 0 ? catalogSnapshot : products;
    const totalCount = Math.max(total, source.length);
    let activeCount = 0;
    let hiddenCount = 0;
    let lowCount = 0;
    let outCount = 0;
    let saleCount = 0;
    let retailValue = 0;

    source.forEach(p => {
      const qty = Number(p.stock_quantity ?? 0);
      const price = Number(p.price || 0);
      if (p.is_active !== false) activeCount++;
      else hiddenCount++;

      if (qty <= 0) outCount++;
      else if (qty <= lowStockThreshold) lowCount++;

      if (isProductOnSale(p)) saleCount++;
      if (qty > 0 && price > 0) retailValue += qty * price;
    });

    return { totalCount, activeCount, hiddenCount, lowCount, outCount, saleCount, retailValue };
  }, [catalogSnapshot, products, total, lowStockThreshold]);

  // Apply statusTab filter + client pagination when tab-filtered
  const { visibleRows, effectiveTotal, effectiveTotalPages } = useMemo(() => {
    if (!isTabFiltered) {
      return { visibleRows: products, effectiveTotal: total, effectiveTotalPages: totalPages };
    }
    const filtered = products.filter(p => {
      const qty = Number(p.stock_quantity ?? 0);
      if (statusTab === 'active')       return p.is_active !== false;
      if (statusTab === 'hidden')       return p.is_active === false;
      if (statusTab === 'low_stock')    return qty > 0 && qty <= lowStockThreshold;
      if (statusTab === 'out_of_stock') return qty <= 0;
      if (statusTab === 'on_sale')      return isProductOnSale(p);
      return true;
    });
    const tPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, tPages);
    const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    return { visibleRows: slice, effectiveTotal: filtered.length, effectiveTotalPages: tPages };
  }, [isTabFiltered, products, total, totalPages, statusTab, lowStockThreshold, page]);

  const parsedCsvItems = useMemo(() => parseProductCsv(csvText), [csvText]);

  const handleBulkImport = async () => {
    if (!parsedCsvItems.length) return;
    setImporting(true);
    try {
      const { data } = await productsAPI.bulkImport(parsedCsvItems);
      toast.success(`Imported ${data.imported} product${data.imported !== 1 ? 's' : ''}${data.skipped ? ` (${data.skipped} skipped)` : ''}`);
      setImportOpen(false);
      setCsvText('');
      load();
      loadSnapshot();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleExportCsv = () => {
    const rowsToExport = catalogSnapshot.length > 0 ? catalogSnapshot : products;
    if (!rowsToExport.length) {
      toast.error('No products available to export');
      return;
    }
    const headers = ['name', 'brand', 'category', 'sku', 'price', 'compare_at_price', 'cost', 'stock_quantity', 'is_active'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(','),
      ...rowsToExport.map(r => headers.map(h => esc(r[h])).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rowsToExport.length} products to CSV`);
  };

  const handleDelete = async (product) => {
    try {
      await productsAPI.remove(product.id);
      toast.success(`Deleted "${product.name}"`);
      setConfirm(null);
      load();
      loadSnapshot();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete product');
    }
  };

  const handleToggleVisibility = async (product, e) => {
    e.stopPropagation();
    try {
      const { data } = await productsAPI.toggleVisibility(product.id);
      toast.success(`"${product.name}" is now ${data.is_active ? 'live on storefront' : 'hidden'}`);
      load();
      loadSnapshot();
    } catch {
      toast.error('Failed to toggle visibility');
    }
  };

  const handleDuplicate = (product, e) => {
    e.stopPropagation();
    navigate('/products/new', { state: { duplicateFrom: product } });
  };

  const openDiscountModal = (p, e) => {
    if (e) e.stopPropagation();
    setDiscountModalProduct(p);
    const regular = Number(p.compare_at_price || 0) > Number(p.price || 0)
      ? Number(p.compare_at_price)
      : Number(p.price || 0);
    const sale = Number(p.compare_at_price || 0) > Number(p.price || 0)
      ? Number(p.price)
      : '';
    setDiscountForm({
      compare_at_price: regular ? regular.toFixed(2) : '',
      price: sale ? sale.toFixed(2) : (p.price ? Number(p.price).toFixed(2) : ''),
    });
  };

  const handleSaveDiscount = async () => {
    if (!discountModalProduct) return;
    setSavingDiscount(true);
    try {
      const priceVal = Number(discountForm.price);
      const compareVal = discountForm.compare_at_price ? Number(discountForm.compare_at_price) : null;
      if (!priceVal || priceVal <= 0) {
        toast.error('Selling price must be greater than 0');
        setSavingDiscount(false);
        return;
      }
      const payload = {
        ...discountModalProduct,
        price: priceVal,
        compare_at_price: compareVal && compareVal > priceVal ? compareVal : null,
      };
      await productsAPI.update(discountModalProduct.id, payload);
      toast.success(
        payload.compare_at_price
          ? `Deal activated! ${discountModalProduct.name} is now on sale.`
          : `Price updated for ${discountModalProduct.name}.`
      );
      setDiscountModalProduct(null);
      load();
      loadSnapshot();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update discount');
    } finally {
      setSavingDiscount(false);
    }
  };

  const hasActiveFilters = Boolean(search || category || brand || sort || statusTab !== 'all');
  const clearAllFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setCategory('');
    setBrand('');
    setSort('');
    setStatusTab('all');
    setPage(1);
  };

  const startIdx = effectiveTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx   = Math.min(effectiveTotal, page * PAGE_SIZE);

  return (
    <div>
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1>Product Catalog</h1>
          <p className="muted">
            Manage cosmetics, pricing, variants, stock levels, and storefront visibility.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleExportCsv}
            title="Export catalog as CSV"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setImportOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import CSV
          </button>
          <Link to="/products/new" className="btn btn-accent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Product
          </Link>
        </div>
      </div>

      {/* ── 4-Card Catalog KPI Summary Strip ────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 18 }}>
        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => setStatusTab('all')}
          title="Show all products"
        >
          <div className="stat-card-top">
            <span className="stat-card-label">Total Products</span>
            <div className="stat-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
          </div>
          <div className="stat-card-main">
            <span className="stat-card-value">{kpis.totalCount.toLocaleString()}</span>
          </div>
          <div className="stat-card-bottom">
            <span className="stat-card-sub">
              {categoryList.length || '—'} categories · {brandList.length || '—'} brands
            </span>
          </div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => setStatusTab('active')}
          title="Filter live storefront products"
        >
          <div className="stat-card-top">
            <span className="stat-card-label">Live on Storefront</span>
            <div className="stat-card-icon" style={{ background: 'var(--ac-success-soft)', color: 'var(--ac-success)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="stat-card-main">
            <span className="stat-card-value">{kpis.activeCount.toLocaleString()}</span>
            <span className="stat-delta stat-delta--up">
              {kpis.totalCount > 0 ? `${Math.round((kpis.activeCount / kpis.totalCount) * 100)}%` : '0%'}
            </span>
          </div>
          <div className="stat-card-bottom">
            <span className="stat-card-sub">
              {kpis.hiddenCount > 0 ? `${kpis.hiddenCount} hidden draft${kpis.hiddenCount === 1 ? '' : 's'}` : 'All catalog items visible'}
            </span>
          </div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => setStatusTab('low_stock')}
          title="Filter low stock items"
        >
          <div className="stat-card-top">
            <span className="stat-card-label">Low Stock Alerts</span>
            <div className="stat-card-icon" style={{ background: 'var(--ac-warning-soft)', color: 'var(--ac-warning)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
          </div>
          <div className="stat-card-main">
            <span className="stat-card-value">{kpis.lowCount}</span>
            {kpis.lowCount > 0 && <span className="stat-delta stat-delta--down">Restock soon</span>}
          </div>
          <div className="stat-card-bottom">
            <span className="stat-card-sub">Threshold: ≤ {lowStockThreshold} units</span>
          </div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => setStatusTab(kpis.outCount > 0 ? 'out_of_stock' : 'all')}
          title="View stock health & retail value"
        >
          <div className="stat-card-top">
            <span className="stat-card-label">Retail Stock Value</span>
            <div className="stat-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
          </div>
          <div className="stat-card-main">
            <span className="stat-card-value" style={{ fontSize: '1.35rem' }}>
              GHS {Math.round(kpis.retailValue).toLocaleString()}
            </span>
          </div>
          <div className="stat-card-bottom">
            <span className="stat-card-sub">
              {kpis.outCount > 0 ? `${kpis.outCount} item${kpis.outCount === 1 ? '' : 's'} out of stock` : '0 out of stock'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Status Tabs + View Mode Toggle ──────────────────────────── */}
      <div className="ap-tabs-row">
        <div className="ap-status-tabs" role="tablist" aria-label="Product status filter">
          {[
            { id: 'all',          label: 'All',          count: kpis.totalCount },
            { id: 'active',       label: 'Live',         count: kpis.activeCount },
            { id: 'hidden',       label: 'Hidden',       count: kpis.hiddenCount },
            { id: 'low_stock',    label: 'Low Stock',    count: kpis.lowCount },
            { id: 'out_of_stock', label: 'Out of Stock', count: kpis.outCount },
            { id: 'on_sale',      label: 'On Sale',      count: kpis.saleCount },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={statusTab === tab.id}
              className={`ap-status-tab${statusTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setStatusTab(tab.id)}
            >
              <span>{tab.label}</span>
              <span className="ap-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="ap-view-toggle" role="group" aria-label="Catalog display mode">
          <button
            type="button"
            className={`ap-view-btn${viewMode === 'table' ? ' is-active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Table
          </button>
          <button
            type="button"
            className={`ap-view-btn${viewMode === 'grid' ? ' is-active' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            Cards
          </button>
        </div>
      </div>

      {/* ── Search, Facet & Sort Bar ────────────────────────────────── */}
      <div className="ap-filter-bar">
        <div className="ap-filter-controls">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by product name, SKU, or brand…"
          />
          <select
            className="ap-filter-select"
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {(categoryList.length > 0
              ? categoryList
              : [...new Set(products.map(p => p.category).filter(Boolean))].sort()
            ).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            className="ap-filter-select"
            value={brand}
            onChange={e => setBrand(e.target.value)}
            aria-label="Filter by brand"
          >
            <option value="">All brands</option>
            {brandList.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <select
            className="ap-filter-select"
            value={sort}
            onChange={e => setSort(e.target.value)}
            aria-label="Sort products"
          >
            <option value="">Sort: Newest first</option>
            <option value="price_low">Price: Low → High</option>
            <option value="price_high">Price: High → Low</option>
            <option value="name_asc">Name: A → Z</option>
            <option value="name_desc">Name: Z → A</option>
            <option value="top_rated">Highest Rated</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearAllFilters}>
            ✕ Reset filters
          </button>
        )}
      </div>

      {/* ── Main Catalog View (Table OR Visual Cards) ───────────────── */}
      {viewMode === 'table' ? (
        <DataTable
          loading={loading}
          rows={visibleRows}
          onRowClick={(row) => navigate(`/products/${row.id}`)}
          emptyMessage={total === 0 ? 'No products yet. Click "Add Product" to create your first item!' : 'No products match your current filters.'}
          columns={[
            {
              key: 'name',
              label: 'Product',
              render: p => (
                <div className={`ap-prod-cell${p.is_active === false ? ' is-hidden' : ''}`}>
                  <ProductThumb url={p.image_url} alt={p.name} />
                  <div className="ap-prod-meta">
                    <div className="ap-prod-title-row">
                      <span className="ap-prod-title" title={p.name}>{p.name}</span>
                      {p.has_variants && (
                        <span className="ap-mini-pill ap-mini-pill--variants">Variants</span>
                      )}
                      {isProductOnSale(p) && (
                        <span className="ap-mini-pill ap-mini-pill--sale">Sale</span>
                      )}
                    </div>
                    <div className="ap-prod-sub">
                      <span>{p.brand || 'Unbranded'}</span>
                      {Number(p.review_count) > 0 && (
                        <span>· ★ {Number(p.avg_rating || 0).toFixed(1)} ({p.review_count})</span>
                      )}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'category',
              label: 'Category & SKU',
              render: p => (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  {p.category ? <span className="ap-cat-chip">{p.category}</span> : <span className="cell-muted">—</span>}
                  {p.sku && <span className="ap-sku-badge">{p.sku}</span>}
                </div>
              ),
            },
            {
              key: 'price',
              label: 'Price & Margin',
              className: 'cell-right',
              render: p => {
                const price = Number(p.price || 0);
                const cost = p.cost != null && p.cost !== '' ? Number(p.cost) : null;
                const compareAt = Number(p.compare_at_price || 0);
                const minP = Number(p.min_price ?? price);
                const maxP = Number(p.max_price ?? price);
                const hasRange = p.has_variants && maxP > minP;
                const marginPct = cost != null && price > cost && price > 0
                  ? Math.round(((price - cost) / price) * 100)
                  : null;

                return (
                  <div className="ap-price-stack">
                    <span className="ap-price-main">
                      {hasRange ? `GHS ${minP.toFixed(0)} – ${maxP.toFixed(0)}` : fmt(price)}
                    </span>
                    {compareAt > price && !hasRange && (
                      <span className="ap-price-was">{fmt(compareAt)}</span>
                    )}
                    {marginPct !== null && (
                      <span className="ap-mini-pill ap-mini-pill--margin">{marginPct}% margin</span>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'stock',
              label: 'Inventory',
              render: p => {
                const qty = Number(p.stock_quantity ?? 0);
                const st = stockStatus(qty, lowStockThreshold);
                const pct = qty <= 0 ? 0 : Math.min(100, Math.round((qty / Math.max(30, lowStockThreshold * 4)) * 100));
                const fillClass = st === 'out_of_stock'
                  ? 'ap-stock-bar-fill--out'
                  : st === 'low_stock'
                    ? 'ap-stock-bar-fill--low'
                    : 'ap-stock-bar-fill--in';

                return (
                  <div className="ap-stock-cell">
                    <div className="ap-stock-top">
                      <span className="ap-stock-num">{qty} units</span>
                      <StatusBadge status={st} />
                    </div>
                    <div className="ap-stock-bar" aria-hidden="true">
                      <div className={`ap-stock-bar-fill ${fillClass}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'visible',
              label: 'Storefront',
              render: p => {
                const on = p.is_active !== false;
                return (
                  <button
                    type="button"
                    className={`ap-switch${on ? ' is-on' : ''}`}
                    onClick={(e) => handleToggleVisibility(p, e)}
                    title={on ? 'Click to hide from storefront' : 'Click to publish on storefront'}
                  >
                    <span className="ap-switch-track">
                      <span className="ap-switch-knob" />
                    </span>
                    <span>{on ? 'Live' : 'Hidden'}</span>
                  </button>
                );
              },
            },
            {
              key: 'actions',
              label: '',
              width: 132,
              render: p => (
                <div className="ap-row-actions" onClick={e => e.stopPropagation()}>
                  <a
                    href={`${storefrontUrl}/products/${p.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ap-icon-action"
                    title="View product on live storefront"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                  <button
                    type="button"
                    className="ap-icon-action"
                    onClick={(e) => openDiscountModal(p, e)}
                    title={isProductOnSale(p) ? "Edit deal / discount" : "Set deal / discount"}
                    style={isProductOnSale(p) ? { color: 'var(--ac-accent, #c9933f)', borderColor: 'var(--ac-accent, #c9933f)' } : undefined}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="19" y1="5" x2="5" y2="19" />
                      <circle cx="6.5" cy="6.5" r="2.5" />
                      <circle cx="17.5" cy="17.5" r="2.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="ap-icon-action"
                    onClick={(e) => handleDuplicate(p, e)}
                    title="Duplicate product"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                  <Link
                    to={`/products/${p.id}`}
                    className="ap-icon-action"
                    title="Edit product"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </Link>
                  <button
                    type="button"
                    className="ap-icon-action ap-icon-action--danger"
                    onClick={() => setConfirm(p)}
                    title="Delete product"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              ),
            },
          ]}
        />
      ) : loading ? (
        <div className="spinner" />
      ) : visibleRows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p className="muted">No products match your current filters.</p>
        </div>
      ) : (
        <div className="ap-cards-grid">
          {visibleRows.map(p => {
            const qty = Number(p.stock_quantity ?? 0);
            const st = stockStatus(qty, lowStockThreshold);
            const on = p.is_active !== false;
            const imgSrc = p.image_url ? resolveImageUrl(p.image_url) : '';
            return (
              <div key={p.id} className={`ap-catalog-card${!on ? ' is-hidden' : ''}`}>
                <div className="ap-catalog-card-media" onClick={() => navigate(`/products/${p.id}`)}>
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={p.name}
                      loading="lazy"
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="ap-catalog-card-placeholder">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                  )}
                  <div className="ap-catalog-card-badges">
                    <StatusBadge status={st} />
                    <button
                      type="button"
                      className={`ap-switch${on ? ' is-on' : ''}`}
                      onClick={(e) => handleToggleVisibility(p, e)}
                      style={{ background: 'var(--ac-surface)', boxShadow: 'var(--ac-shadow-sm)' }}
                    >
                      <span className="ap-switch-track"><span className="ap-switch-knob" /></span>
                      <span>{on ? 'Live' : 'Hidden'}</span>
                    </button>
                  </div>
                </div>
                <div className="ap-catalog-card-body">
                  <div className="ap-catalog-card-brand">
                    {p.brand || 'Unbranded'}{p.category ? ` · ${p.category}` : ''}
                  </div>
                  <div className="ap-catalog-card-title" onClick={() => navigate(`/products/${p.id}`)}>
                    {p.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                    <strong style={{ fontSize: '0.96rem' }}>{fmt(p.price)}</strong>
                    {Number(p.compare_at_price) > Number(p.price) && (
                      <span className="ap-price-was">{fmt(p.compare_at_price)}</span>
                    )}
                    <span className="cell-muted text-xs" style={{ marginLeft: 'auto' }}>{qty} in stock</span>
                  </div>
                  <div className="ap-catalog-card-footer">
                    <span className="ap-sku-badge">{p.sku || 'NO-SKU'}</span>
                    <div className="ap-row-actions">
                      <a
                        href={`${storefrontUrl}/products/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ap-icon-action"
                        title="View on storefront"
                      >
                        ↗
                      </a>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(e) => openDiscountModal(p, e)}
                        title="Set or adjust deal discount"
                        style={isProductOnSale(p) ? { color: 'var(--ac-accent, #c9933f)', borderColor: 'var(--ac-accent, #c9933f)' } : undefined}
                      >
                        {isProductOnSale(p) ? 'Sale %' : 'Deal %'}
                      </button>
                      <Link to={`/products/${p.id}`} className="btn btn-outline btn-sm">
                        Edit
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Numbered Pagination Footer ──────────────────────────────── */}
      {effectiveTotal > 0 && (
        <div className="ap-pagination">
          <span className="muted text-sm">
            Showing <strong>{startIdx}–{endIdx}</strong> of <strong>{effectiveTotal.toLocaleString()}</strong> products
          </span>

          {effectiveTotalPages > 1 && (
            <div className="ap-page-btns">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </button>
              {Array.from({ length: effectiveTotalPages }, (_, idx) => idx + 1)
                .filter(n => n === 1 || n === effectiveTotalPages || Math.abs(n - page) <= 1)
                .reduce((acc, n, i, arr) => {
                  if (i > 0 && n - arr[i - 1] > 1) acc.push('ellipsis-' + n);
                  acc.push(n);
                  return acc;
                }, [])
                .map(item =>
                  typeof item === 'string' ? (
                    <span key={item} style={{ padding: '0 4px', color: 'var(--ac-text-soft)' }}>…</span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={`ap-page-num${page === item ? ' is-active' : ''}`}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </button>
                  )
                )}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setPage(p => Math.min(effectiveTotalPages, p + 1))}
                disabled={page >= effectiveTotalPages}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Quick Deal & Discount Modal ─────────────────────────────── */}
      <Modal
        open={!!discountModalProduct}
        onClose={() => setDiscountModalProduct(null)}
        title={discountModalProduct ? `Set Deal / Discount: ${discountModalProduct.name}` : 'Set Deal'}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setDiscountModalProduct(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={handleSaveDiscount}
              disabled={savingDiscount}
            >
              {savingDiscount ? 'Saving…' : 'Save Deal'}
            </button>
          </>
        }
      >
        {discountModalProduct && (() => {
          const pPrice = Number(discountForm.price || 0);
          const pComp  = Number(discountForm.compare_at_price || 0);
          const onSale = pComp > pPrice && pPrice > 0;
          const pctOff = onSale ? Math.round((1 - pPrice / pComp) * 100) : 0;

          return (
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, padding: '10px 12px', background: 'var(--ac-surface-sunken, #f8fafc)', borderRadius: 8 }}>
                <ProductThumb url={discountModalProduct.image_url} alt={discountModalProduct.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ac-text)' }} className="truncate">
                    {discountModalProduct.name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ac-text-muted)' }}>
                    {discountModalProduct.category || 'Uncategorized'} · {discountModalProduct.brand || 'Unbranded'} · SKU: {discountModalProduct.sku || 'None'}
                  </div>
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="qd-compare">Original / Regular Price (Was) *</label>
                  <div className="pe-input-prefix-wrap">
                    <span className="pe-input-prefix">GHS</span>
                    <input
                      id="qd-compare"
                      type="number"
                      step="0.01"
                      min="0"
                      value={discountForm.compare_at_price}
                      onChange={e => setDiscountForm(f => ({ ...f, compare_at_price: e.target.value }))}
                      placeholder="e.g. 200.00"
                    />
                  </div>
                  <div className="hint">The normal regular anchor price.</div>
                </div>

                <div className="field">
                  <label htmlFor="qd-price">Sale Price (Customer Pays) *</label>
                  <div className="pe-input-prefix-wrap">
                    <span className="pe-input-prefix">GHS</span>
                    <input
                      id="qd-price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={discountForm.price}
                      onChange={e => setDiscountForm(f => ({ ...f, price: e.target.value }))}
                      placeholder="e.g. 160.00"
                      required
                    />
                  </div>
                  <div className="hint">Discounted checkout price.</div>
                </div>
              </div>

              {/* 1-Click Percentage Preset Buttons */}
              <div style={{ marginTop: 10, marginBottom: 16 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ac-text-muted)', display: 'block', marginBottom: 6 }}>
                  1-Click Discount Presets:
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[10, 15, 20, 25, 30, 40, 50].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.78rem',
                        fontWeight: pctOff === pct ? 700 : 500,
                        borderColor: pctOff === pct ? 'var(--ac-accent, #0f172a)' : undefined,
                        background: pctOff === pct ? 'var(--ac-accent, #0f172a)' : undefined,
                        color: pctOff === pct ? '#fff' : undefined,
                      }}
                      onClick={() => {
                        const base = pComp > 0 ? pComp : (pPrice > 0 ? pPrice : Number(discountModalProduct.price || 0));
                        if (!base || base <= 0) return;
                        const discounted = Math.round(base * (1 - pct / 100) * 100) / 100;
                        setDiscountForm({
                          compare_at_price: base.toFixed(2),
                          price: discounted.toFixed(2),
                        });
                      }}
                    >
                      {pct}% OFF
                    </button>
                  ))}
                  {onSale && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 8px', fontSize: '0.78rem', color: 'var(--ac-danger, #ef4444)' }}
                      onClick={() => {
                        const regular = pComp > 0 ? pComp : pPrice;
                        setDiscountForm({
                          compare_at_price: '',
                          price: regular > 0 ? regular.toFixed(2) : String(discountModalProduct.price),
                        });
                      }}
                    >
                      ✕ Clear Deal
                    </button>
                  )}
                </div>
              </div>

              {/* Live Preview Box */}
              {onSale ? (
                <div className="alert alert-success" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                  ✓ <strong>Active Deal:</strong> Shopper pays <strong>GHS {pPrice.toFixed(2)}</strong> (was <del>GHS {pComp.toFixed(2)}</del>).
                  {' '}Shows <strong>-{pctOff}% OFF</strong> badge and qualifies for Today&apos;s Deals shelf.
                </div>
              ) : (
                <div className="alert alert-info" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                  To activate a deal, set Original Price higher than Sale Price, or click a % preset above.
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => handleDelete(confirm)}
        title="Delete product?"
        message={confirm ? `"${confirm.name}" will be permanently removed. Products with existing customer orders cannot be deleted — toggle Storefront to Hidden instead.` : ''}
        confirmLabel="Delete"
        danger
      />

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk Import Products (CSV)"
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setImportOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={importing || parsedCsvItems.length === 0}
              onClick={handleBulkImport}
            >
              {importing ? 'Importing…' : `Import ${parsedCsvItems.length} Product${parsedCsvItems.length === 1 ? '' : 's'}`}
            </button>
          </>
        }
      >
        <p className="muted text-sm" style={{ marginBottom: 12 }}>
          Paste CSV rows or upload a <code>.csv</code> file with header columns:
          <br />
          <code>name,brand,category,price,cost,stock_quantity,sku,image_url,description</code>
        </p>
        <div style={{ marginBottom: 12 }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => setCsvText(String(ev.target?.result || ''));
              reader.readAsText(file);
            }}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="prod-csv-text">
            CSV Data {parsedCsvItems.length > 0 && `(${parsedCsvItems.length} valid rows detected)`}
          </label>
          <textarea
            id="prod-csv-text"
            rows={7}
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder={'name,brand,category,price,stock_quantity,sku\nFoaming Facial Cleanser 236ml,CeraVe,Skincare,185.00,24,CRV-CLN-236\nGloss Bomb Universal Lip Luminizer,Fenty Beauty,Makeup,260.00,15,FNT-LIP-001'}
            style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
        </div>
      </Modal>
    </div>
  );
}
