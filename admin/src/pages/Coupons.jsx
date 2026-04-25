import { useEffect, useState, useMemo } from 'react';
import { couponsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';

const fmt = (n) => Number(n || 0).toFixed(2);

// Generate a random promo code like SAVE20-A3F9
function generateCode() {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const prefixes = ['SAVE', 'DEAL', 'CREAM', 'VIP', 'GHANA', 'GIFT'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  return `${prefix}-${suffix}`;
}

const EMPTY_FORM = {
  code:       '',
  type:       'percentage',
  value:      '',
  min_order:  '',
  max_uses:   '',
  expires_at: '',
};

export default function Coupons() {
  const toast = useToast();

  const [coupons, setCoupons]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');
  const [confirmId, setConfirmId]   = useState(null); // id to delete
  const [deactivateId, setDeactivateId] = useState(null);

  const load = () => {
    setLoading(true);
    couponsAPI.getAll()
      .then(({ data }) => setCoupons(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load coupons'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.code.trim()) return setFormError('Code is required.');
    if (!form.value) return setFormError('Value is required.');
    setSaving(true);
    try {
      await couponsAPI.create({
        code:       form.code.trim(),
        type:       form.type,
        value:      parseFloat(form.value),
        min_order:  form.min_order  ? parseFloat(form.min_order)  : 0,
        max_uses:   form.max_uses   ? parseInt(form.max_uses)     : null,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      });
      toast.success('Coupon created');
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create coupon.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    try {
      await couponsAPI.deactivate(deactivateId);
      toast.success('Coupon deactivated');
      load();
    } catch {
      toast.error('Failed to deactivate coupon');
    } finally {
      setDeactivateId(null);
    }
  };

  const handleDelete = async () => {
    try {
      await couponsAPI.remove(confirmId);
      toast.success('Coupon deleted');
      load();
    } catch {
      toast.error('Failed to delete coupon');
    } finally {
      setConfirmId(null);
    }
  };

  const now = new Date();
  const rows = useMemo(() => coupons.map(c => ({
    ...c,
    expired: c.expires_at && new Date(c.expires_at) < now,
    exhausted: c.max_uses !== null && c.uses_count >= c.max_uses,
  })), [coupons]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Coupons</h1>
          <p className="muted">{coupons.length} coupon{coupons.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent" onClick={() => { setShowForm(v => !v); setFormError(''); }}>
            {showForm ? 'Cancel' : '+ New Coupon'}
          </button>
        </div>
      </div>

      {/* ── Create form ───────────────────────── */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><h2 className="card-title">Create Coupon</h2></div>
          <div className="card-body">
            <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>

              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Coupon code</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    name="code"
                    value={form.code}
                    onChange={handleChange}
                    placeholder="e.g. SAVE20"
                    style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setForm(f => ({ ...f, code: generateCode() }))}
                  >
                    Generate
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Type</label>
                <select name="type" value={form.type} onChange={handleChange}>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount (GHS)</option>
                </select>
              </div>

              <div className="form-group">
                <label>
                  {form.type === 'percentage' ? 'Discount (%)' : 'Discount (GHS)'}
                </label>
                <input
                  name="value"
                  type="number"
                  min="0.01"
                  max={form.type === 'percentage' ? 100 : undefined}
                  step="0.01"
                  value={form.value}
                  onChange={handleChange}
                  placeholder={form.type === 'percentage' ? 'e.g. 15' : 'e.g. 20.00'}
                  required
                />
              </div>

              <div className="form-group">
                <label>Min. order (GHS, optional)</label>
                <input
                  name="min_order"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.min_order}
                  onChange={handleChange}
                  placeholder="e.g. 100"
                />
              </div>

              <div className="form-group">
                <label>Max uses (optional)</label>
                <input
                  name="max_uses"
                  type="number"
                  min="1"
                  value={form.max_uses}
                  onChange={handleChange}
                  placeholder="Unlimited"
                />
              </div>

              <div className="form-group">
                <label>Expiry date (optional)</label>
                <input
                  name="expires_at"
                  type="date"
                  value={form.expires_at}
                  onChange={handleChange}
                />
              </div>

              <div style={{ gridColumn: '1/-1' }}>
                {formError && <p style={{ color: 'var(--ac-danger)', fontSize: '0.85rem', marginBottom: 10 }}>{formError}</p>}
                <button type="submit" className="btn btn-accent" disabled={saving}>
                  {saving ? 'Saving…' : 'Create Coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="spinner" style={{ margin: '40px auto' }} />
        ) : rows.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ac-text-muted)' }}>
            No coupons yet. Create one above.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Min order</th>
                <th className="cell-right">Uses</th>
                <th>Expires</th>
                <th>Status</th>
                <th style={{ width: 130 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const status = !c.active ? 'inactive'
                  : c.expired    ? 'expired'
                  : c.exhausted  ? 'exhausted'
                  : 'active';
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="cell-primary" style={{ fontFamily: 'monospace', letterSpacing: '0.06em' }}>
                        {c.code}
                      </span>
                    </td>
                    <td>
                      {c.type === 'percentage'
                        ? `${fmt(c.value)}%`
                        : `GHS ${fmt(c.value)}`}
                    </td>
                    <td>{parseFloat(c.min_order) > 0 ? `GHS ${fmt(c.min_order)}` : '—'}</td>
                    <td className="cell-right">
                      {c.uses_count}
                      {c.max_uses !== null && <span className="cell-muted"> / {c.max_uses}</span>}
                    </td>
                    <td className="cell-muted" style={{ fontSize: '0.83rem' }}>
                      {c.expires_at
                        ? new Date(c.expires_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Never'}
                    </td>
                    <td>
                      <CouponStatus status={status} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {c.active && !c.expired && !c.exhausted && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setDeactivateId(c.id)}
                            title="Deactivate"
                          >
                            Deactivate
                          </button>
                        )}
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-danger-soft)' }}
                          onClick={() => setConfirmId(c.id)}
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!deactivateId}
        onClose={() => setDeactivateId(null)}
        onConfirm={handleDeactivate}
        title="Deactivate coupon?"
        message="This coupon will no longer be accepted at checkout."
        confirmLabel="Deactivate"
      />

      <ConfirmDialog
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        onConfirm={handleDelete}
        title="Delete coupon?"
        message="This will permanently delete the coupon. This cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function CouponStatus({ status }) {
  const map = {
    active:    { cls: 'badge-success', label: 'Active' },
    inactive:  { cls: 'badge-neutral', label: 'Inactive' },
    expired:   { cls: 'badge-warning', label: 'Expired' },
    exhausted: { cls: 'badge-warning', label: 'Used up' },
  };
  const cfg = map[status] || map.inactive;
  return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>;
}
