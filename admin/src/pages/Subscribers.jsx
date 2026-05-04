import { useState, useEffect, useRef, useCallback } from 'react';
import { newsletterAPI } from '../services/api';

const STATUS_BADGE = {
  active:       { label: 'Active',       bg: '#dcfce7', color: '#16a34a' },
  unsubscribed: { label: 'Unsubscribed', bg: '#fee2e2', color: '#dc2626' },
};

const SOURCE_LABEL = {
  storefront: 'Storefront',
  admin:      'Admin import',
  import:     'Import',
};

export default function Subscribers() {
  const [data, setData]             = useState([]);
  const [stats, setStats]           = useState({ total: 0, active: 0, unsubscribed: 0 });
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter]         = useState('');     // '' | 'active' | 'unsubscribed'
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);

  // Import modal
  const [importOpen, setImportOpen]     = useState(false);
  const [importText, setImportText]     = useState('');
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);

  const searchRef = useRef(null);

  const fetchData = useCallback(async (pg = page) => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await newsletterAPI.getSubscribers({
        page: pg, limit: 20,
        status: filter,
        search,
      });
      setData(res.data);
      setTotal(res.total);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setStats(res.stats);
    } catch {
      setError('Failed to load subscribers.');
    } finally {
      setLoading(false);
    }
  }, [page, filter, search]);

  useEffect(() => { fetchData(1); }, [filter]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchData(1), 350);
    return () => clearTimeout(t);
  }, [search]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await newsletterAPI.deleteSubscriber(deleteTarget.id);
      setDeleteTarget(null);
      fetchData(1);
    } catch {
      alert('Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const handleImport = async () => {
    const raw    = importText.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
    const emails = [...new Set(raw)];
    if (emails.length === 0) return;
    setImporting(true);
    try {
      const { data: res } = await newsletterAPI.importSubscribers(emails);
      setImportResult(res);
      fetchData(1);
    } catch {
      alert('Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Subscribers</h1>
          <p className="page-subtitle">Manage newsletter subscribers</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setImportOpen(true); setImportResult(null); setImportText(''); }}>
          Import emails
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total',        value: stats.total },
          { label: 'Active',       value: stats.active },
          { label: 'Unsubscribed', value: stats.unsubscribed },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{s.value.toLocaleString()}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ac-text-muted)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ label: 'All', value: '' }, { label: 'Active', value: 'active' }, { label: 'Unsubscribed', value: 'unsubscribed' }].map(f => (
            <button
              key={f.value}
              onClick={() => { setFilter(f.value); setPage(1); }}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: '0.82rem', fontWeight: 500,
                border: '1px solid',
                borderColor: filter === f.value ? 'var(--ac-accent)' : 'var(--ac-border)',
                background: filter === f.value ? 'var(--ac-accent)' : 'transparent',
                color: filter === f.value ? '#fff' : 'var(--ac-text)',
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          ref={searchRef}
          type="search"
          className="form-input"
          placeholder="Search by email…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Status</th>
              <th>Source</th>
              <th>Subscribed</th>
              <th>Unsubscribed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32 }}><div className="spinner" /></td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--ac-text-muted)' }}>No subscribers found.</td></tr>
            ) : data.map(row => {
              const badge = STATUS_BADGE[row.status] || STATUS_BADGE.active;
              return (
                <tr key={row.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{row.email}</td>
                  <td>{row.name || <span style={{ color: 'var(--ac-text-muted)' }}>—</span>}</td>
                  <td>
                    <span style={{ background: badge.bg, color: badge.color, borderRadius: 20, padding: '2px 10px', fontSize: '0.75rem', fontWeight: 600 }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--ac-text-soft)' }}>{SOURCE_LABEL[row.source] || row.source}</td>
                  <td style={{ fontSize: '0.82rem' }}>{fmt(row.subscribed_at)}</td>
                  <td style={{ fontSize: '0.82rem' }}>{fmt(row.unsubscribed_at)}</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      style={{ color: 'var(--ac-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '0.78rem' }}
                      onClick={() => setDeleteTarget(row)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); fetchData(page - 1); }}>Previous</button>
          <span style={{ padding: '6px 12px', fontSize: '0.85rem', color: 'var(--ac-text-muted)' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); fetchData(page + 1); }}>Next</button>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ marginBottom: 12 }}>Delete subscriber?</h3>
            <p style={{ color: 'var(--ac-text-soft)', marginBottom: 20 }}>
              <strong>{deleteTarget.email}</strong> will be permanently removed.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {importOpen && (
        <div className="modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ marginBottom: 8 }}>Import email addresses</h3>
            <p style={{ color: 'var(--ac-text-soft)', fontSize: '0.85rem', marginBottom: 16 }}>
              Paste email addresses separated by commas, semicolons, or new lines.
            </p>
            {importResult ? (
              <div>
                <p style={{ color: '#16a34a', fontWeight: 600, marginBottom: 8 }}>
                  Import complete: {importResult.imported} imported, {importResult.skipped} skipped.
                </p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setImportOpen(false)}>Done</button>
              </div>
            ) : (
              <>
                <textarea
                  className="form-input"
                  rows={8}
                  placeholder="alice@example.com, bob@example.com&#10;carol@example.com"
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn" onClick={() => setImportOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={importing || !importText.trim()} onClick={handleImport}>
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
