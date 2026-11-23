import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { newsletterAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const SOURCE_LABEL = {
  storefront: 'Storefront',
  admin:      'Admin import',
  import:     'Import',
};

const FILTER_TABS = [
  { label: 'All',          value: '' },
  { label: 'Active',       value: 'active' },
  { label: 'Unsubscribed', value: 'unsubscribed' },
];

export default function Subscribers() {
  const toast = useToast();

  const [data, setData]             = useState([]);
  const [stats, setStats]           = useState({ total: 0, active: 0, unsubscribed: 0 });
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter]         = useState('');
  const [search, setSearch]         = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Import modal
  const [importOpen, setImportOpen]     = useState(false);
  const [importText, setImportText]     = useState('');
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async (pg = page) => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await newsletterAPI.getSubscribers({
        page: pg,
        limit: 20,
        status: filter,
        search: debouncedSearch,
      });
      setData(res.data || []);
      setTotal(res.total || 0);
      setPage(res.page || pg);
      setTotalPages(res.totalPages || 1);
      setStats(res.stats || { total: 0, active: 0, unsubscribed: 0 });
    } catch {
      setError('Failed to load subscribers.');
    } finally {
      setLoading(false);
    }
  }, [page, filter, debouncedSearch]);

  useEffect(() => {
    fetchData(page);
  }, [page, filter, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedImportEmails = useMemo(() => {
    const raw = importText.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
    return [...new Set(raw)];
  }, [importText]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await newsletterAPI.deleteSubscriber(deleteTarget.id);
      toast.success(`Removed ${deleteTarget.email}`);
      setDeleteTarget(null);
      fetchData(1);
    } catch {
      toast.error('Failed to delete subscriber.');
    }
  };

  const handleImport = async () => {
    if (parsedImportEmails.length === 0) return;
    setImporting(true);
    try {
      const { data: res } = await newsletterAPI.importSubscribers(parsedImportEmails);
      setImportResult(res);
      toast.success(`Imported ${res.imported} subscriber${res.imported !== 1 ? 's' : ''}`);
      fetchData(1);
    } catch {
      toast.error('Failed to import email addresses.');
    } finally {
      setImporting(false);
    }
  };

  const handleExportCSV = () => {
    if (!data.length) return;
    const headers = ['Email', 'Name', 'Status', 'Source', 'Subscribed At', 'Unsubscribed At'];
    const csvRows = data.map(r => [
      r.email,
      r.name || '',
      r.status,
      SOURCE_LABEL[r.source] || r.source || '',
      r.subscribed_at || '',
      r.unsubscribed_at || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscribers-page-${page}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const activeRate = stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Subscribers</h1>
          <p className="muted">Manage your newsletter audience &amp; email imports</p>
        </div>
        <div className="page-actions">
          <Link to="/newsletter/compose" className="btn btn-outline btn-sm">
            ✉ Compose Campaign
          </Link>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleExportCSV}
            disabled={!data.length}
          >
            ↓ Export CSV
          </button>
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={() => {
              setImportOpen(true);
              setImportResult(null);
              setImportText('');
            }}
          >
            + Import Emails
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Total Subscribers"
          value={Number(stats.total || 0).toLocaleString()}
          sub="All recorded emails"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        />
        <StatCard
          label="Active Audience"
          value={Number(stats.active || 0).toLocaleString()}
          sub={`${activeRate}% of total list`}
          accent="var(--ac-success)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />
        <StatCard
          label="Unsubscribed"
          value={Number(stats.unsubscribed || 0).toLocaleString()}
          sub="Opted out"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          }
        />
      </div>

      {/* Filter & Search Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left" style={{ flexWrap: 'wrap' }}>
          <div className="sub-tabs" role="tablist" aria-label="Filter subscribers by status">
            {FILTER_TABS.map(f => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                className={`sub-tab ${filter === f.value ? 'active' : ''}`}
                onClick={() => {
                  setFilter(f.value);
                  setPage(1);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-right">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by email or name…"
          />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Subscribers DataTable */}
      <div className="card">
        <DataTable
          loading={loading}
          rows={data}
          emptyMessage={debouncedSearch || filter ? 'No subscribers match your filters.' : 'No subscribers yet.'}
          columns={[
            {
              key: 'email',
              label: 'Subscriber',
              render: row => (
                <div>
                  <div className="cell-primary mono">{row.email}</div>
                  {row.name && <div className="cell-muted text-xs">{row.name}</div>}
                </div>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: row =>
                row.status === 'active' ? (
                  <span className="badge badge-success">Active</span>
                ) : (
                  <span className="badge badge-danger">Unsubscribed</span>
                ),
            },
            {
              key: 'source',
              label: 'Source',
              render: row => (
                <span className="badge badge-neutral">
                  {SOURCE_LABEL[row.source] || row.source || '—'}
                </span>
              ),
            },
            {
              key: 'subscribed_at',
              label: 'Subscribed',
              render: row => <span className="text-sm">{fmt(row.subscribed_at)}</span>,
            },
            {
              key: 'unsubscribed_at',
              label: 'Unsubscribed',
              render: row => <span className="cell-muted text-sm">{fmt(row.unsubscribed_at)}</span>,
            },
            {
              key: 'actions',
              label: '',
              width: 90,
              className: 'cell-right',
              render: row => (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ color: 'var(--ac-danger)' }}
                  onClick={() => setDeleteTarget(row)}
                >
                  Delete
                </button>
              ),
            },
          ]}
        />

        {totalPages > 1 && (
          <div className="pagination">
            <span>
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total.toLocaleString()} total)
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirm Dialog (Native HTML5 <dialog>) */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        danger
        title="Delete subscriber?"
        message={
          deleteTarget
            ? `${deleteTarget.email} will be permanently removed from your newsletter list.`
            : ''
        }
        confirmLabel="Delete subscriber"
      />

      {/* Import Modal (Native HTML5 <dialog>) */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import email addresses"
        size="md"
        footer={
          importResult ? (
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => setImportOpen(false)}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setImportOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-accent"
                disabled={importing || parsedImportEmails.length === 0}
                onClick={handleImport}
              >
                {importing
                  ? 'Importing…'
                  : `Import ${parsedImportEmails.length > 0 ? parsedImportEmails.length : ''} Email${parsedImportEmails.length === 1 ? '' : 's'}`}
              </button>
            </>
          )
        }
      >
        {importResult ? (
          <div className="alert alert-success" style={{ marginBottom: 0 }}>
            <strong>Import complete:</strong> {importResult.imported} imported, {importResult.skipped} skipped.
          </div>
        ) : (
          <div>
            <p className="muted text-sm" style={{ marginBottom: 12 }}>
              Paste email addresses separated by commas, semicolons, or new lines. Duplicates will be automatically skipped.
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="import-emails-textarea">
                Email list {parsedImportEmails.length > 0 && `(${parsedImportEmails.length} detected)`}
              </label>
              <textarea
                id="import-emails-textarea"
                rows={7}
                placeholder={'alice@example.com, bob@example.com\ncarol@example.com'}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
            </div>
          </div>
        )}
      </Modal>

      <style>{`
        .sub-tabs {
          display: inline-flex;
          background: var(--ac-surface-2);
          border: 1px solid var(--ac-border);
          border-radius: var(--ac-radius);
          padding: 2px;
        }
        .sub-tab {
          border: none;
          background: transparent;
          color: var(--ac-text-muted);
          font-size: 0.78rem;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .sub-tab:hover { color: var(--ac-text); }
        .sub-tab.active {
          background: var(--ac-surface);
          color: var(--ac-text);
          box-shadow: var(--ac-shadow-sm);
        }
      `}</style>
    </div>
  );
}
