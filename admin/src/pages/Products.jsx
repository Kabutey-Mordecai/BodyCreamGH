import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';

const PAGE_SIZE = 20;
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

const stockStatus = (qty) => {
  if (qty === 0) return 'out_of_stock';
  if (qty <= 5) return 'low_stock';
  return 'in_stock';
};

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
  const [page, setPage]         = useState(1);
  const [confirm, setConfirm]   = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => { setPage(1); }, [category]);

  const load = () => {
    setLoading(true);
    productsAPI.getAdminAll({ page, limit: PAGE_SIZE, search: debouncedSearch, category })
      .then(({ data }) => {
        setProducts(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, debouncedSearch, category]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Link to="/products/new" className="btn btn-accent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New product
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, SKU, brand…" />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 180 }}>
            <option value="">All categories</option>
            {/* categories derive from loaded data — let user filter after they appear */}
            {[...new Set(products.map(p => p.category).filter(Boolean))].sort().map(c => (
              <option key={c} value={c}>{c}</option>
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
                  <div style={{ width: 42, height: 42, borderRadius: 6, background: 'var(--ac-bg)', backgroundImage: p.image_url ? `url(${p.image_url})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0 }} />
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
    </div>
  );
}
