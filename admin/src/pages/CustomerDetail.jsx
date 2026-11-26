import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { customersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import { buildWhatsAppLink } from '../utils/whatsappTemplates';

const fmt = (n) => `GHS ${Number(n || 0).toFixed(2)}`;

export default function CustomerDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [customer, setCustomer] = useState(null);
  const [orders, setOrders]     = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      customersAPI.getById(id),
      customersAPI.getOrders(id),
    ])
      .then(([cRes, oRes]) => {
        setCustomer(cRes.data);
        setOrders(Array.isArray(oRes.data) ? oRes.data : []);
      })
      .catch(() => toast.error('Failed to load customer'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="spinner" />;

  if (!customer) {
    return (
      <div>
        <Link to="/customers" className="muted text-sm">← Back to customers</Link>
        <div className="alert alert-error" style={{ marginTop: 16 }}>Customer not found.</div>
      </div>
    );
  }

  const initials = (customer.first_name?.[0] || customer.email?.[0] || '?').toUpperCase();

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--ac-accent-light)', color: 'var(--ac-accent-dark)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '1.1rem', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div>
            <Link to="/customers" className="muted text-sm" style={{ textDecoration: 'none' }}>
              ← Back to customers
            </Link>
            <h1 style={{ marginTop: 4 }}>
              {customer.first_name || ''} {customer.last_name || ''}
              {!customer.first_name && !customer.last_name && customer.email}
            </h1>
            <p className="muted">{customer.email}</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }} className="cd-grid">

        {/* Profile card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header"><h2 className="card-title">Profile</h2></div>
            <div className="card-body">
              <table style={{ width: '100%', fontSize: '0.88rem', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['Email',    customer.email],
                    ['Phone',    (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{customer.phone || '—'}</span>
                        {customer.phone && buildWhatsAppLink(customer.phone) && (
                          <a
                            href={buildWhatsAppLink(customer.phone)}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-whatsapp btn-sm text-xs"
                            style={{ padding: '2px 8px', fontSize: '0.74rem', textDecoration: 'none' }}
                          >
                            💬 WhatsApp
                          </a>
                        )}
                      </div>
                    )],
                    ['Joined',   new Date(customer.created_at).toLocaleDateString('en-GH', { year: 'numeric', month: 'long', day: 'numeric' })],
                    ['Address',  customer.address || '—'],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ padding: '7px 0', color: 'var(--ac-text-muted)', width: '40%' }}>{label}</td>
                      <td style={{ padding: '7px 0', wordBreak: 'break-word' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Lifetime stats</h2></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['Total orders',   Number(customer.order_count  || customer.total_orders || 0).toLocaleString()],
                ['Total spent',    fmt(customer.total_spent)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="muted text-sm">{label}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Order history */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Order history</h2>
            <span className="muted text-sm">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
          </div>

          {orders.length === 0 ? (
            <div className="card-body" style={{ color: 'var(--ac-text-muted)', fontSize: '0.88rem' }}>
              No orders yet.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="cell-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td className="cell-primary mono">{o.order_number || o.id?.slice(0, 8)}</td>
                    <td className="cell-muted">
                      {new Date(o.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="cell-right">{fmt(o.total_amount)}</td>
                    <td>
                      <Link to={`/orders/${o.id}`} className="btn btn-ghost btn-sm">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .cd-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
