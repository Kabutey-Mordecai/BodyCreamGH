import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';

const LOW_STOCK_THRESHOLD = 5;
const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();

  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState('');
  const [category, setCategory] = useState('');
  const [confirm, setConfirm]   = useState(null);

  const load = () => {
    setLoading(true);
    productsAPI.getAll({ limit: 500 })
      .then(({ data }) => setProducts(Array.isArray(data) ? data : (data.products || [])))
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Derive category list from existing products — no separate categories table needed.
  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.category).filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(p => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      return [p.name, p.sku, p.brand, p.category]
        .some(f => String(f || '').toLowerCase().includes(q));
    });
  }, [products, query, category]);

  const stockStatus = (qty) => {
    if (qty === 0) return 'out_of_stock';
    if (qty <= LOW_STOCK_THRESHOLD) return 'low_stock';
    return 'in_stock';
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p className="muted">{filtered.length} of {products.length} products</p>
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
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name, SKU, brand…"
          />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 180 }}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={filtered}
          onRowClick={(row) => navigate(`/products/${row.id}`)}
          emptyMessage={products.length === 0 ? 'No products yet. Create your first one!' : 'No products match your filters.'}
          columns={[
            {
              key: 'name',
              label: 'Product',
              render: p => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 6, background: 'var(--ac-bg)',
                    backgroundImage: p.image_url ? `url(${p.image_url})` : 'none',
                    backgroundSize: 'cover', backgroundPosition: 'center',
                    flexShrink: 0,
                  }} />
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
