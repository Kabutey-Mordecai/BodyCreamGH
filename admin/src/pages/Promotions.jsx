import { useEffect, useState, useMemo } from 'react';
import { promotionsAPI, productsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';

const EMPTY_FORM = {
  name: '',
  discount_type: 'percentage',
  discount_value: '',
  applies_to: 'all',
  category: '',
  product_id: '',
  starts_at: '',
  ends_at: '',
};

const TYPE_LABEL   = { percentage: 'Percentage', fixed: 'Fixed (GHS)' };
const APPLIES_LABEL = { all: 'All products', category: 'By category', product: 'Specific product' };

function toDatetimeLocal(iso) {
  if (!iso) return '';
  try { return new Date(iso).toISOString().slice(0, 16); } catch { return ''; }
}

function promoStatus(row) {
  const now = Date.now();
  const start = new Date(row.starts_at).getTime();
  const end   = new Date(row.ends_at).getTime();
  if (!row.is_active) return 'inactive';
  if (now < start)    return 'scheduled';
  if (now > end)      return 'expired';
  return 'active';
}

const STATUS_STYLE = {
  active:    { background: 'rgba(34,197,94,0.12)', color: '#16a34a' },
  scheduled: { background: 'rgba(59,130,246,0.12)', color: '#2563eb' },
  expired:   { background: 'rgba(107,114,128,0.12)', color: '#6b7280' },
  inactive:  { background: 'rgba(239,68,68,0.12)', color: '#dc2626' },
};
const STATUS_LABEL = {
  active: 'Active', scheduled: 'Scheduled', expired: 'Expired', inactive: 'Inactive',
};

function StatusBadge({ row }) {
  const s = promoStatus(row);
  return (
    <span style={{
      ...STATUS_STYLE[s],
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {STATUS_LABEL[s]}
    </span>
  );
}

export default function Promotions() {
  const toast = useToast();
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const LIMIT               = 20;

  const [modal, setModal]   = useState(null); // null | 'create' | 'edit'
  const [editId, setEditId] = useState(null);
  const [catOptions, setCatOptions] = useState([]);

  useEffect(() => {
    productsAPI.getCategories()
      .then(({ data }) => {
        if (Array.isArray(data?.categories)) setCatOptions(data.categories);
      })
      .catch(() => {});
  }, []);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [productList, setProductList] = useState([]);

  useEffect(() => {
    productsAPI.getAdminAll({ limit: 300 })
      .then(({ data }) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.products)
              ? data.products
              : [];
        setProductList(list);
      })
      .catch(() => {});
  }, []);

  const load = (p = page) => {
    setLoading(true);
    promotionsAPI.getAll({ page: p, limit: LIMIT })
      .then(({ data }) => {
        setRows(data.data || []);
        setTotal(data.total || 0);
      })
      .catch(() => toast.error('Failed to load promotions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / LIMIT);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active    = rows.filter(r => promoStatus(r) === 'active').length;
    const scheduled = rows.filter(r => promoStatus(r) === 'scheduled').length;
    return { total: rows.length, active, scheduled };
  }, [rows]);

  // ── Form helpers ───────────────────────────────────────────────────────────
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setFormError('');
    setModal('create');
  };

  const openEdit = (row) => {
    setForm({
      name:           row.name,
      discount_type:  row.discount_type,
      discount_value: String(row.discount_value),
      applies_to:     row.applies_to,
      category:       row.category || '',
      product_id:     row.product_id || '',
      starts_at:      toDatetimeLocal(row.starts_at),
      ends_at:        toDatetimeLocal(row.ends_at),
    });
    setEditId(row.id);
    setFormError('');
    setModal('edit');
  };

  const closeModal = () => { setModal(null); setEditId(null); setFormError(''); };

  const handleSave = async () => {
    setFormError('');
    if (!form.name.trim())      return setFormError('Name is required.');
    if (!form.discount_value)   return setFormError('Discount value is required.');
    if (!form.starts_at)        return setFormError('Start date/time is required.');
    if (!form.ends_at)          return setFormError('End date/time is required.');
    if (new Date(form.ends_at) <= new Date(form.starts_at))
      return setFormError('End time must be after start time.');

    const payload = {
      ...form,
      discount_value: Number(form.discount_value),
      category:   form.applies_to === 'category' ? form.category : undefined,
      product_id: form.applies_to === 'product'  ? form.product_id : undefined,
    };

    setSaving(true);
    try {
      if (modal === 'create') {
        await promotionsAPI.create(payload);
        toast.success('Promotion created');
      } else {
        await promotionsAPI.update(editId, payload);
        toast.success('Promotion updated');
      }
      closeModal();
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed. Please check the fields.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (row) => {
    try {
      const { data } = await promotionsAPI.toggle(row.id);
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_active: data.is_active } : r));
      toast.success(data.is_active ? 'Promotion activated' : 'Promotion deactivated');
    } catch {
      toast.error('Failed to toggle promotion');
    }
  };

  const confirmDelete = (id) => setDeleteId(id);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await promotionsAPI.remove(deleteId);
      toast.success('Promotion deleted');
      setDeleteId(null);
      load();
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const fmtValue = (row) =>
    row.discount_type === 'percentage'
      ? `${row.discount_value}%`
      : `GHS ${Number(row.discount_value).toFixed(2)}`;

  const fmtApplies = (row) => {
    if (row.applies_to === 'category') return `Category: ${row.category || '—'}`;
    if (row.applies_to === 'product')  return `Product: ${row.product_name || row.product_id?.slice(0, 8) || '—'}`;
    return 'All products';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Promotions</h1>
          <p className="muted">Timed discounts applied automatically to matching products.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent" onClick={openCreate}>+ Create promotion</button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Total"     value={total}         accent="var(--ac-info)" />
        <StatCard label="Active now" value={stats.active}  accent="var(--ac-success)" />
        <StatCard label="Scheduled" value={stats.scheduled} accent="var(--ac-accent)" />
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={rows}
          emptyMessage="No promotions yet — create one to get started."
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: r => <span className="cell-primary">{r.name}</span>,
            },
            {
              key: 'discount',
              label: 'Discount',
              render: r => <span style={{ fontWeight: 600 }}>{fmtValue(r)}</span>,
            },
            {
              key: 'applies_to',
              label: 'Applies to',
              render: r => fmtApplies(r),
            },
            {
              key: 'starts_at',
              label: 'Start',
              render: r => <span className="text-sm">{fmtDate(r.starts_at)}</span>,
            },
            {
              key: 'ends_at',
              label: 'End',
              render: r => <span className="text-sm">{fmtDate(r.ends_at)}</span>,
            },
            {
              key: 'status',
              label: 'Status',
              render: r => <StatusBadge row={r} />,
            },
            {
              key: 'actions',
              label: '',
              width: 180,
              render: r => (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                  <button
                    className={`btn btn-sm ${r.is_active ? 'btn-outline' : 'btn-accent'}`}
                    onClick={() => handleToggle(r)}
                    title={r.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {r.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-danger)' }}
                    onClick={() => confirmDelete(r.id)}
                  >
                    Delete
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="pagination-info">Page <strong>{page}</strong> of {totalPages}</span>
          <button className="btn btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {/* ── Create / Edit modal ─────────────────────────────────────────── */}
      <Modal
        open={!!modal}
        onClose={closeModal}
        title={modal === 'create' ? 'Create promotion' : 'Edit promotion'}
        footer={
          <>
            <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
            <button className="btn btn-accent" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save changes'}
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-error" style={{ marginBottom: 14 }}>{formError}</div>}

        <div className="field">
          <label>Promotion name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => upd('name', e.target.value)}
            placeholder="e.g. Summer Sale, Festive Discount"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label>Discount type *</label>
            <select value={form.discount_type} onChange={e => upd('discount_type', e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label>
              {form.discount_type === 'percentage' ? 'Percentage off *' : 'Amount off (GHS) *'}
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={form.discount_type === 'percentage' ? 100 : undefined}
              value={form.discount_value}
              onChange={e => upd('discount_value', e.target.value)}
              placeholder={form.discount_type === 'percentage' ? '10' : '5.00'}
            />
          </div>
        </div>

        <div className="field">
          <label>Applies to *</label>
          <select value={form.applies_to} onChange={e => upd('applies_to', e.target.value)}>
            {Object.entries(APPLIES_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {form.applies_to === 'category' && (
          <div className="field">
            <label>Category *</label>
            <input
              type="text"
              list="promo-cat-list"
              value={form.category}
              onChange={e => upd('category', e.target.value)}
              placeholder="Body Cream"
            />
            <datalist id="promo-cat-list">
              {catOptions.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
        )}

        {form.applies_to === 'product' && (
          <div className="field">
            <label>Target Product *</label>
            <select
              value={form.product_id}
              onChange={e => upd('product_id', e.target.value)}
            >
              <option value="">— Select a product —</option>
              {productList.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku || p.category || ('GHS ' + p.price)})
                </option>
              ))}
            </select>
            {form.product_id && !productList.some(p => p.id === form.product_id) && (
              <div className="hint" style={{ marginTop: 4, fontFamily: 'monospace' }}>
                Selected ID: {form.product_id}
              </div>
            )}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label>Starts at *</label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={e => upd('starts_at', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Ends at *</label>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={e => upd('ends_at', e.target.value)}
            />
          </div>
        </div>

        {form.discount_value && form.starts_at && form.ends_at && (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>
            {form.discount_type === 'percentage'
              ? `${form.discount_value}% off`
              : `GHS ${Number(form.discount_value).toFixed(2)} off`}
            {' '}applied to <strong>{APPLIES_LABEL[form.applies_to]?.toLowerCase()}</strong>.
          </div>
        )}
      </Modal>

      {/* ── Delete confirm modal ───────────────────────────────────────── */}
      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete promotion"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setDeleteId(null)}>Cancel</button>
            <button
              className="btn btn-accent"
              style={{ background: 'var(--ac-danger)', borderColor: 'var(--ac-danger)' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p>This will permanently delete the promotion. Active discounts on product pages will disappear immediately.</p>
      </Modal>
    </div>
  );
}
