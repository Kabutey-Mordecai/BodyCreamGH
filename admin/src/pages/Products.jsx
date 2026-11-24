import { useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { resolveImageUrl } from '../utils/resolveImageUrl';

const PAGE_SIZE = 20;
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

const stockStatus = (qty) => {
  if (qty === 0) return 'out_of_stock';
  if (qty <= 5) return 'low_stock';
  return 'in_stock';
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

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();

  const [products, setProducts] = useState([]);
  const [total, setTotal]       = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand]       = useState('');
  const [brandList, setBrandList] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [page, setPage]         = useState(1);
  const [confirm, setConfirm]   = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText]   = useState('');
  const [importing, setImporting] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    productsAPI.getBrands()
      .then(({ data }) => {
        if (Array.isArray(data?.brands)) setBrandList(data.brands);
      })
      .catch(() => {});
    productsAPI.getCategories()
      .then(({ data }) => {
        const cats = data?.categories || data || [];
        if (Array.isArray(cats)) setCategoryList(cats.map(c => (typeof c === 'string' ? c : c?.category || c?.label)).filter(Boolean));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => { setPage(1); }, [category, brand]);

  const load = () => {
    setLoading(true);
    productsAPI.getAdminAll({ page, limit: PAGE_SIZE, search: debouncedSearch, category, brand })
      .then(({ data }) => {
        setProducts(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, debouncedSearch, category, brand]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (product) => {
    try {
      await productsAPI.remove(product.id);
      toast.success(`Deleted "${product.name}"`);
      load();
    } catch {
      toast.error('Failed to delete product');
    }
  };

  const handleToggleVisibility = async (product, e) => {
    e.stopPropagation();
    try {
      const { data } = await productsAPI.toggleVisibility(product.id);
      toast.success(`"${product.name}" is now ${data.is_active ? 'visible' : 'hidden'}`);
      load();
    } catch {
      toast.error('Failed to toggle visibility');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p className="muted">{total.toLocaleString()} product{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setImportOpen(true)}
          >
            ↑ Import CSV
          </button>
          <Link to="/products/new" className="btn btn-accent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New product
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, SKU, brand…" />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 170 }}>
            <option value="">All categories</option>
            {(categoryList.length > 0 ? categoryList : [...new Set(products.map(p => p.category).filter(Boolean))].sort()).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={brand} onChange={e => setBrand(e.target.value)} style={{ width: 170 }}>
            <option value="">All brands</option>
            {brandList.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={products}
          onRowClick={(row) => navigate(`/products/${row.id}`)}
          emptyMessage={total === 0 ? 'No products yet. Create your first one!' : 'No products match your filters.'}
          columns={[
            {
              key: 'name',
              label: 'Product',
              render: p => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: p.is_active ? 1 : 0.45 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 6, background: 'var(--ac-bg)', backgroundImage: p.image_url ? `url(${resolveImageUrl(p.image_url)})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-primary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div className="cell-muted text-xs">{p.brand || '—'}</div>
                  </div>
                </div>
              )
            },
            { key: 'sku',      label: 'SKU',      className: 'cell-mono', render: p => p.sku || '—' },
            { key: 'category', label: 'Category', render: p => p.category || '—' },
            { key: 'price',    label: 'Price',    className: 'cell-right', render: p => fmt(p.price) },
            {
              key: 'stock',
              label: 'Stock',
              render: p => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{p.stock_quantity ?? 0}</span>
                  <StatusBadge status={stockStatus(p.stock_quantity)} />
                </div>
              )
            },
            {
              key: 'visible',
              label: 'Visible',
              render: p => (
                <button
                  className={`btn btn-sm ${p.is_active ? 'btn-outline' : 'btn-ghost'}`}
                  style={{ color: p.is_active ? 'var(--ac-success)' : 'var(--ac-text-muted)' }}
                  onClick={(e) => handleToggleVisibility(p, e)}
                  title={p.is_active ? 'Hide from storefront' : 'Show on storefront'}
                >
                  {p.is_active ? '● On' : '○ Off'}
                </button>
              )
            },
            {
              key: 'actions',
              label: '',
              width: 80,
              render: p => (
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <Link to={`/products/${p.id}`} className="btn btn-ghost btn-sm" title="Edit">Edit</Link>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--ac-danger)' }}
                    onClick={() => setConfirm(p)}
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              )
            },
          ]}
        />
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={{ fontSize: '0.85rem', color: 'var(--ac-text-muted)' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-outline btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => handleDelete(confirm)}
        title="Delete product?"
        message={confirm ? `"${confirm.name}" will be permanently removed. This cannot be undone.` : ''}
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
