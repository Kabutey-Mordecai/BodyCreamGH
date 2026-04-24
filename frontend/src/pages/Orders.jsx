import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import './Orders.css';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    ordersAPI.getAll()
      .then(({ data }) => setOrders(data))
      .catch(() => setError('Failed to load orders.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  return (
    <div className="page-section">
      <div className="container">
        <div className="orders-header">
          <span className="section-label">Order History</span>
          <h1 className="page-title">My Orders</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {orders.length === 0
              ? 'No orders yet — your future purchases will appear here.'
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
            {orders.map(order => {
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
        )}
      </div>
    </div>
  );
}
