import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;
const PAGE_SIZE = 20;

export default function Customers() {
  const toast = useToast();

  const [customers, setCustomers] = useState([]);
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort]           = useState('created_at_desc');
  const [page, setPage]           = useState(1);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => { setPage(1); }, [sort]);

  useEffect(() => {
    setLoading(true);
    adminAPI.getAllCustomers({ page, limit: PAGE_SIZE, search: debouncedSearch, sort })
      .then(({ data }) => {
        setCustomers(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .catch(() => toast.error('Failed to load customers'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p className="muted">{total.toLocaleString()} registered customer{total !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by email or name…" />
        </div>
        <div className="toolbar-right">
          <label className="text-xs muted" style={{ marginRight: 4 }}>Sort by</label>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 160 }}>
            <option value="created_at_desc">Most recent</option>
            <option value="created_at_asc">Oldest first</option>
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
          </select>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={customers}
          emptyMessage={total === 0 ? 'No customers yet.' : 'No customers match your search.'}
          columns={[
            { key: 'name', label: 'Name',
              render: c => (
                <Link to={`/customers/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--ac-accent-light)', color: 'var(--ac-accent-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.78rem', flexShrink: 0 }}>
                    {(c.first_name?.[0] || c.email?.[0] || '?').toUpperCase()}
                  </div>
                  <div>
                    <div className="cell-primary" style={{ color: 'var(--ac-accent-dark)' }}>{c.first_name || ''} {c.last_name || ''}</div>
                    <div className="cell-muted text-xs">{c.email}</div>
                  </div>
                </Link>
              )
            },
            { key: 'total_orders', label: 'Orders', className: 'cell-right',
              render: c => Number(c.total_orders || 0).toLocaleString() },
            { key: 'total_spent', label: 'Lifetime spend', className: 'cell-right',
              render: c => fmt(c.total_spent) },
            { key: 'created_at', label: 'Joined',
              render: c => new Date(c.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' }) },
            { key: 'actions', label: '',
              render: c => <Link to={`/customers/${c.id}`} className="btn btn-ghost btn-sm">View →</Link> },
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
    </div>
  );
}
