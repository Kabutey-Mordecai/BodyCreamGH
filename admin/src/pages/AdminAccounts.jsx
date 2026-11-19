import { useEffect, useState } from 'react';
import { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const EMPTY_FORM = { email: '', password: '', first_name: '', last_name: '' };

export default function AdminAccounts() {
  const { user: me } = useAuth();
  const toast = useToast();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState('');

  const load = () => {
    setLoading(true);
    adminAPI.getAdminAccounts()
      .then(({ data }) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load admin accounts'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.email || !form.password || !form.first_name) {
      return setFormError('Email, password, and first name are required.');
    }
    if (form.password.length < 8) {
      return setFormError('Password must be at least 8 characters.');
    }
    setSaving(true);
    try {
      await adminAPI.createAdminAccount(form);
      toast.success('Admin account created');
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create account.');
    } finally { setSaving(false); }
  };

  const handleToggle = async (account) => {
    if (!account.is_active && account.id === me?.id) return;
    try {
      if (account.is_active) {
        if (account.id === me?.id) {
          toast.error('You cannot deactivate your own account.');
          return;
        }
        await adminAPI.deactivateAdminAccount(account.id);
        toast.success(`${account.first_name} deactivated`);
      } else {
        await adminAPI.activateAdminAccount(account.id);
        toast.success(`${account.first_name} activated`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update account status');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Admin Accounts</h1>
          <p className="muted">{accounts.length} admin{accounts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent" onClick={() => { setShowForm(v => !v); setFormError(''); setForm(EMPTY_FORM); }}>
            {showForm ? 'Cancel' : '+ New Admin'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><h2 className="card-title">Create Admin Account</h2></div>
          <div className="card-body">
            <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              <div className="form-group">
                <label>First name</label>
                <input name="first_name" value={form.first_name} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Last name (optional)</label>
                <input name="last_name" value={form.last_name} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Password (min. 8 characters)</label>
                <input name="password" type="password" autoComplete="new-password" value={form.password} onChange={handleChange} required minLength={8} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                {formError && <p style={{ color: 'var(--ac-danger)', fontSize: '0.85rem', marginBottom: 10 }}>{formError}</p>}
                <button type="submit" className="btn btn-accent" disabled={saving}>
                  {saving ? 'Creating…' : 'Create Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="spinner" style={{ margin: '40px auto' }} />
        ) : accounts.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ac-text-muted)' }}>No admin accounts found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Admin</th>
                <th>Email</th>
                <th>Last login</th>
                <th>Status</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--ac-accent-light)', color: 'var(--ac-accent-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.78rem', flexShrink: 0 }}>
                        {(a.first_name?.[0] || a.email?.[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <div className="cell-primary">{a.first_name} {a.last_name || ''}</div>
                        {a.id === me?.id && <div className="cell-muted text-xs">You</div>}
                      </div>
                    </div>
                  </td>
                  <td className="cell-muted">{a.email}</td>
                  <td className="cell-muted" style={{ fontSize: '0.83rem' }}>
                    {a.last_login_at
                      ? new Date(a.last_login_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'Never'}
                  </td>
                  <td>
                    <span className={`badge ${a.is_active ? 'badge-success' : 'badge-neutral'}`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ color: a.is_active ? 'var(--ac-danger)' : 'var(--ac-success)' }}
                      disabled={a.id === me?.id && a.is_active}
                      title={a.id === me?.id ? 'Cannot deactivate your own account' : (a.is_active ? 'Deactivate' : 'Activate')}
                      onClick={() => handleToggle(a)}
                    >
                      {a.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
