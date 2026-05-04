import { useEffect, useState, useMemo } from 'react';
import { adminAPI, inventoryAPI, settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Inventory() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | low | out
  const [adjusting, setAdjusting] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ quantity_change: '', reason: 'restock', notes: '' });
  const [saving, setSaving] = useState(false);
  const [LOW, setLOW] = useState(5);

  const load = () => {
    setLoading(true);
    adminAPI.getInventoryOverview()
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load inventory'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    settingsAPI.getAll()
      .then(({ data }) => {
        const t = parseInt(data?.low_stock_threshold, 10);
        if (t > 0) setLOW(t);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status = (q) => q === 0 ? 'out_of_stock' : q <= LOW ? 'low_stock' : 'in_stock';


  const filtered = useMemo(() => {
    if (filter === 'low') return items.filter(p => p.stock_quantity > 0 && p.stock_quantity <= LOW);
    if (filter === 'out') return items.filter(p => p.stock_quantity === 0);
    return items;
  }, [items, filter]);

  const stats = useMemo(() => {
    const outOfStock = items.filter(p => p.stock_quantity === 0).length;
    const lowStock   = items.filter(p => p.stock_quantity > 0 && p.stock_quantity <= LOW).length;
    const value      = items.reduce((s, p) => s + Number(p.price || 0) * Number(p.stock_quantity || 0), 0);
    return { outOfStock, lowStock, value };
  }, [items]);

  const openAdjust = (p) => {
    setAdjusting(p);
    setAdjustForm({ quantity_change: '', reason: 'restock', notes: '' });
  };

  const submitAdjust = async () => {
    if (!adjusting || !adjustForm.quantity_change) return;
    setSaving(true);
    try {
      await inventoryAPI.adjust(adjusting.id, {
        quantity_change: Number(adjustForm.quantity_change),
        reason: adjustForm.reason,
        notes: adjustForm.notes,
      });
      toast.success(`Stock adjusted for "${adjusting.name}"`);
      setAdjusting(null);
      load();
    } catch {
      toast.error('Stock adjustment failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
          <p className="muted">Stock levels and quick adjustments</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Total products"
          value={items.length}
          accent="var(--ac-info)"
        />
        <StatCard
          label="Low stock"
          value={stats.lowStock}
          sub={`At or below ${LOW} unit${LOW !== 1 ? 's' : ''}`}
          accent="var(--ac-warning)"
        />
        <StatCard
          label="Out of stock"
          value={stats.outOfStock}
          sub="Needs urgent restock"
          accent="var(--ac-danger)"
        />
        <StatCard
          label="Inventory value"
          value={fmt(stats.value)}
          sub="At retail price"
          accent="var(--ac-accent)"
        />
      </div>

      {stats.outOfStock > 0 && (
        <div className="alert alert-warning">
          <strong>{stats.outOfStock}</strong> product{stats.outOfStock === 1 ? '' : 's'} sold out.
          <button className="btn btn-ghost btn-sm" onClick={() => setFilter('out')} style={{ marginLeft: 8 }}>Review →</button>
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-left">
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('all')}>All ({items.length})</button>
          <button className={`btn btn-sm ${filter === 'low' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('low')}>Low ({stats.lowStock})</button>
          <button className={`btn btn-sm ${filter === 'out' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('out')}>Out ({stats.outOfStock})</button>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={filtered}
          emptyMessage="No products to show."
          columns={[
            { key: 'name', label: 'Product', render: p => <span className="cell-primary">{p.name}</span> },
            { key: 'sku',  label: 'SKU', className: 'cell-mono', render: p => p.sku || '—' },
            { key: 'price', label: 'Price', className: 'cell-right', render: p => fmt(p.price) },
            { key: 'stock_quantity', label: 'Stock', className: 'cell-right',
              render: p => <span style={{ fontWeight: 600 }}>{p.stock_quantity ?? 0}</span> },
            { key: 'status', label: 'Status', render: p => <StatusBadge status={status(p.stock_quantity)} /> },
            { key: 'actions', label: '', width: 140, render: p => (
              <button className="btn btn-outline btn-sm" onClick={() => openAdjust(p)}>Adjust stock</button>
            )},
          ]}
        />
      </div>

      <Modal
        open={!!adjusting}
        onClose={() => setAdjusting(null)}
        title={adjusting ? `Adjust stock · ${adjusting.name}` : ''}
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setAdjusting(null)}>Cancel</button>
            <button className="btn btn-accent" onClick={submitAdjust} disabled={saving || !adjustForm.quantity_change}>
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </>
        }
      >
        {adjusting && (
          <>
            <div style={{ background: 'var(--ac-bg)', padding: 10, borderRadius: 6, marginBottom: 14, fontSize: '0.88rem' }}>
              Current stock: <strong>{adjusting.stock_quantity ?? 0}</strong>
            </div>

            <div className="field">
              <label>Change</label>
              <input
                type="number"
                value={adjustForm.quantity_change}
                onChange={e => setAdjustForm({ ...adjustForm, quantity_change: e.target.value })}
                placeholder="e.g. 20 (add) or -3 (remove)"
                autoFocus
              />
              <div className="hint">Positive to add stock, negative to remove.</div>
            </div>

            <div className="field">
              <label>Reason</label>
              <select
                value={adjustForm.reason}
                onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
              >
                <option value="restock">Restock / received shipment</option>
                <option value="correction">Inventory correction</option>
                <option value="damaged">Damaged / expired</option>
                <option value="returned">Customer return</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>Notes (optional)</label>
              <textarea
                rows={2}
                value={adjustForm.notes}
                onChange={e => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                placeholder="Anything to remember about this change"
              />
            </div>

            {adjustForm.quantity_change && (
              <div className="alert alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
                New stock will be <strong>{(adjusting.stock_quantity ?? 0) + Number(adjustForm.quantity_change)}</strong>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
