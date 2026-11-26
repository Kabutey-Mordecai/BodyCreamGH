import { useEffect, useState, useMemo } from 'react';
import { adminAPI, inventoryAPI, settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';
import SearchInput from '../components/SearchInput';

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Inventory() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | low | out
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ quantity_change: '', reason: 'restock', notes: '' });
  const [saving, setSaving] = useState(false);
  const [LOW, setLOW] = useState(5);

  const [historyItem, setHistoryItem] = useState(undefined); // undefined = closed, null = all, object = single product
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = () => {
    setLoading(true);
    adminAPI.getInventoryOverview()
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load inventory'))
      .finally(() => setLoading(false));
  };

  const openHistory = async (product = null) => {
    setHistoryItem(product);
    setHistoryLoading(true);
    try {
      const res = await inventoryAPI.getHistory(product ? product.id : null);
      setHistoryList(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error('Failed to load stock history');
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleQuickStep = async (p, delta) => {
    const current = Number(p.stock_quantity ?? 0);
    if (current + delta < 0) return toast.warning('Stock cannot be negative');
    setItems(prev => prev.map(item => item.id === p.id ? { ...item, stock_quantity: current + delta } : item));
    try {
      await inventoryAPI.adjust(p.id, {
        quantity_change: delta,
        reason: delta > 0 ? 'restock' : 'correction',
        notes: `Quick step (${delta > 0 ? '+' : ''}${delta})`,
      });
      toast.success(`${p.name}: stock is now ${current + delta}`);
    } catch {
      toast.error('Failed to adjust stock');
      load();
    }
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
    let list = items;
    if (filter === 'low') list = list.filter(p => p.stock_quantity > 0 && p.stock_quantity <= LOW);
    if (filter === 'out') list = list.filter(p => p.stock_quantity === 0);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filter, search, LOW]);

  const stats = useMemo(() => {
    const outOfStock = items.filter(p => p.stock_quantity === 0).length;
    const lowStock   = items.filter(p => p.stock_quantity > 0 && p.stock_quantity <= LOW).length;
    const value      = items.reduce((s, p) => s + Number(p.price || 0) * Number(p.stock_quantity || 0), 0);
    return { outOfStock, lowStock, value };
  }, [items, LOW]);

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
          <SearchInput value={search} onChange={setSearch} placeholder="Search product, SKU, brand…" />
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('all')}>All ({items.length})</button>
          <button className={`btn btn-sm ${filter === 'low' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('low')}>Low ({stats.lowStock})</button>
          <button className={`btn btn-sm ${filter === 'out' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('out')}>Out ({stats.outOfStock})</button>
        </div>
        <div className="toolbar-right">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => openHistory(null)}>
            📜 Full Stock Log
          </button>
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
              render: p => (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 7px', fontSize: '0.78rem', height: 26, minWidth: 24, border: '1px solid var(--ac-border)' }}
                    onClick={() => handleQuickStep(p, -1)}
                    title="Subtract 1"
                    disabled={Number(p.stock_quantity ?? 0) <= 0}
                  >
                    -
                  </button>
                  <span style={{ fontWeight: 700, minWidth: 28, textAlign: 'center' }}>{p.stock_quantity ?? 0}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 7px', fontSize: '0.78rem', height: 26, minWidth: 24, border: '1px solid var(--ac-border)' }}
                    onClick={() => handleQuickStep(p, 1)}
                    title="Add 1"
                  >
                    +
                  </button>
                </div>
              )
            },
            { key: 'status', label: 'Status', render: p => <StatusBadge status={status(p.stock_quantity)} /> },
            { key: 'actions', label: '', width: 170, render: p => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openHistory(p)} title="View stock history">
                  📋 Log
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openAdjust(p)}>
                  Adjust
                </button>
              </div>
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

      {/* Stock Movement Audit Log Modal */}
      <Modal
        open={historyItem !== undefined}
        onClose={() => setHistoryItem(undefined)}
        title={historyItem ? `Stock Movement History · ${historyItem.name}` : 'Storewide Stock Movement History'}
      >
        {historyLoading ? (
          <div className="spinner" />
        ) : historyList.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ac-text-muted)' }}>
            No stock movement recorded yet.
          </div>
        ) : (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--ac-border)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Date</th>
                  {!historyItem && <th style={{ padding: '8px 10px' }}>Product</th>}
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Change</th>
                  <th style={{ padding: '8px 10px' }}>Reason</th>
                  <th style={{ padding: '8px 10px' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {historyList.map(h => {
                  const change = Number(h.quantity_change || 0);
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--ac-border)' }}>
                      <td style={{ padding: '8px 10px', color: 'var(--ac-text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(h.created_at).toLocaleString('en-GH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      {!historyItem && (
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{h.product_name || '—'}</td>
                      )}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: change > 0 ? 'var(--ac-success)' : 'var(--ac-danger)' }}>
                        {change > 0 ? `+${change}` : change}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span className={`badge ${change > 0 ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '0.7rem', textTransform: 'capitalize' }}>
                          {h.reason || 'adjustment'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--ac-text-muted)', fontSize: '0.78rem' }}>
                        {h.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
