import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import './Orders.css';

function getDateLabel(dateStr) {
  const now  = new Date();
  const date = new Date(dateStr);

  const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
  const weekStart      = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 6);

  const orderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (orderDay >= todayStart)     return 'Today';
  if (orderDay >= yesterdayStart) return 'Yesterday';
  if (orderDay >= weekStart)      return 'This week';
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Preserve insertion order of groups (orders are already newest-first from the API)
function groupOrders(orders) {
  const map = new Map();
  for (const order of orders) {
    const label = getDateLabel(order.created_at);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(order);
  }
  return map;
}

export default function Orders() {
  const [orders, setOrders]         = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  useEffect(() => {
    setLoading(true);
    ordersAPI.getAll({ page, limit: 20 })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data.orders || []);
        setOrders(list);
        if (data.pagination) setPagination(data.pagination);
      })
      .catch(() => setError('Failed to load orders.'))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  const grouped = groupOrders(orders);

  return (
    <div className="page-section">
      <div className="container">
        <div className="orders-header">
          <span className="section-label">Order History</span>
          <h1 className="page-title">My Orders</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {orders.length === 0
              ? 'No orders yet — your future purchases will appear here.'
              : pagination
                ? `${pagination.total} order${pagination.total === 1 ? '' : 's'} total`
                : `You've placed ${orders.length} order${orders.length === 1 ? '' : 's'} with us.`}
          </p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {orders.length === 0 ? (
          <div className="orders-empty">
            <span className="orders-empty-icon">✦</span>
            <h3>Nothing here yet</h3>
            <p>When you place an order, you'll be able to track it right here.</p>
            <Link to="/shop" className="btn btn-accent" style={{ marginTop: '24px' }}>
              Start Shopping
            </Link>
          </div>
        ) : (
          <div className="orders-list">
            {[...grouped.entries()].map(([label, group]) => (
              <div key={label} className="orders-group">
                <div className="orders-group-label">{label}</div>

                {group.map(order => {
                  const orderNum = order.order_number || order.id.slice(0, 8).toUpperCase();
                  return (
                    <Link
                      key={order.id}
                      to={`/orders/${order.id}`}
                      className="order-row"
                    >
                      <div className="order-row-main">
                        <div className="order-row-id">
                          <span className="section-label" style={{ marginBottom: 4 }}>Order</span>
                          <span className="order-number">#{orderNum}</span>
                        </div>
                        <div className="order-row-date">
                          <span className="order-meta-label">Placed on</span>
                          <span>
                            {new Date(order.created_at).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </span>
                        </div>
                        <div className="order-row-total">
                          <span className="order-meta-label">Total</span>
                          <span className="order-total-amt">
                            GHS {parseFloat(order.total_amount).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="order-row-side">
                        <span className={`badge badge-${order.status}`}>
                          {order.status}
                        </span>
                        <span className="order-view-link">View details →</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {pagination && pagination.pages > 1 && (
          <div className="pagination" style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '32px' }}>
            <button
              className="btn btn-outline"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              ← Previous
            </button>
            <span style={{ alignSelf: 'center', fontSize: '14px', color: 'var(--color-muted)' }}>
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              className="btn btn-outline"
              disabled={page >= pagination.pages}
              onClick={() => setPage(p => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
