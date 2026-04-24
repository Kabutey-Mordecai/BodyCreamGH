import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import SearchInput from '../components/SearchInput';

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function Customers() {
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [query, setQuery]         = useState('');
  const [sortKey, setSortKey]     = useState('recent');

  useEffect(() => {
    adminAPI.getAllCustomers()
      .then(({ data }) => setCustomers(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load customers'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = customers.filter(c =>
      !q || [c.email, c.first_name, c.last_name]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
    if (sortKey === 'spent')  rows = [...rows].sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0));
    if (sortKey === 'orders') rows = [...rows].sort((a, b) => Number(b.total_orders || 0) - Number(a.total_orders || 0));
    if (sortKey === 'recent') rows = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [customers, query, sortKey]);

  // Quick headline stats
  const totalSpent = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0);
  const withOrders = customers.filter(c => Number(c.total_orders || 0) > 0).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p className="muted">{customers.length} registered · {withOrders} with orders · {fmt(totalSpent)} lifetime value</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by email or name…"
          />
        </div>
        <div className="toolbar-right">
          <label className="text-xs muted" style={{ marginRight: 4 }}>Sort by</label>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={{ width: 160 }}>
            <option value="recent">Most recent</option>
            <option value="spent">Highest spend</option>
            <option value="orders">Most orders</option>
          </select>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={filtered}
          emptyMessage={customers.length === 0 ? 'No customers yet.' : 'No customers match your search.'}
          columns={[
            { key: 'name', label: 'Name',
              render: c => (
                <Link to={`/customers/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--ac-accent-light)', color: 'var(--ac-accent-dark)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, fontSize: '0.78rem', flexShrink: 0,
                  }}>
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
    </div>
  );
}
