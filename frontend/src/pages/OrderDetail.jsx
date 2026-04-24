import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ordersAPI, deliveriesAPI } from '../services/api';
import './OrderDetail.css';

export default function OrderDetail() {
  const { id } = useParams();

  const [order, setOrder]       = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    // Load order and delivery info in parallel for speed
    Promise.all([
      ordersAPI.getById(id),
      deliveriesAPI.getByOrder(id).catch(() => null), // delivery may not exist yet
    ])
      .then(([orderRes, deliveryRes]) => {
        // Backend returns { order: {...}, items: [...] } — flatten into one object
        const { order: orderData, items } = orderRes.data;
        setOrder({ ...orderData, items });
        setDelivery(deliveryRes?.data || null);
      })
      .catch(() => setError('Order not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  if (error || !order) {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center' }}>
          <p>{error || 'Order not found.'}</p>
          <Link to="/orders" className="btn btn-outline" style={{ marginTop: '16px' }}>
            Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const orderNum = order.order_number || order.id.slice(0, 8).toUpperCase();

  return (
    <div className="page-section">
      <div className="container">
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <Link to="/orders">My Orders</Link>
          <span>/</span>
          <span>#{orderNum}</span>
        </nav>

        <div className="order-detail-header">
          <div>
            <span className="section-label">Order Receipt</span>
            <h1 className="page-title" style={{ marginBottom: '6px' }}>
              Order #{orderNum}
            </h1>
            <p className="order-detail-date">
              Placed on{' '}
              {new Date(order.created_at).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
          </div>
          <span className={`badge badge-${order.status} order-detail-badge`}>
            {order.status}
          </span>
        </div>

        <div className="order-detail-grid">
          {/* ── Items ordered ──────────────────────────── */}
          <section className="order-section">
            <div className="order-section-head">
              <h2>Items</h2>
            </div>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            <ul className="order-items-list">
              {(order.items || []).map((item, i) => (
                <li key={i} className="order-item">
                  <div className="order-item-meta">
                    <span className="order-item-name">
                      {item.name || item.product_name}
                    </span>
                    <span className="order-item-qty">
                      Qty × {item.quantity}
                    </span>
                  </div>
                  <span className="order-item-amt">
                    GHS {(parseFloat(item.unit_price || item.price) * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="order-totals">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>GHS {parseFloat(order.subtotal || order.total_amount).toFixed(2)}</span>
              </div>
              {order.delivery_fee != null && (
                <div className="summary-row">
                  <span>Delivery</span>
                  <span>GHS {parseFloat(order.delivery_fee).toFixed(2)}</span>
                </div>
              )}
              <div className="summary-row summary-total">
                <span>Total paid</span>
                <span>GHS {parseFloat(order.total_amount).toFixed(2)}</span>
              </div>
            </div>
          </section>

          <div className="order-detail-side">
            {/* ── Delivery address ──────────────────────── */}
            <section className="order-section">
              <div className="order-section-head">
                <h2>Delivery Address</h2>
              </div>
              <div className="gold-divider" style={{ margin: '0 0 16px' }} />
              <p className="order-address">{order.shipping_address || '—'}{order.shipping_city ? `, ${order.shipping_city}` : ''}{order.shipping_region ? `, ${order.shipping_region}` : ''}</p>
              {order.phone && (
                <p className="order-phone">{order.phone}</p>
              )}
            </section>

            {/* ── Tracking info (shown only if delivery record exists) ── */}
            {delivery && (
              <section className="order-section">
                <div className="order-section-head">
                  <h2>Tracking</h2>
                </div>
                <div className="gold-divider" style={{ margin: '0 0 16px' }} />

                <div className="tracking-row">
                  <span className="tracking-label">Status</span>
                  <span className={`badge badge-${delivery.status}`}>{delivery.status}</span>
                </div>

                {delivery.delivery_partner && (
                  <div className="tracking-row">
                    <span className="tracking-label">Courier</span>
                    <span>{delivery.delivery_partner}</span>
                  </div>
                )}

                {delivery.tracking_number && (
                  <div className="tracking-row">
                    <span className="tracking-label">Tracking #</span>
                    <span className="tracking-value">{delivery.tracking_number}</span>
                  </div>
                )}

                {delivery.estimated_delivery && (
                  <div className="tracking-row">
                    <span className="tracking-label">Est. Delivery</span>
                    <span>
                      {new Date(delivery.estimated_delivery).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        <Link to="/orders" className="btn btn-outline" style={{ marginTop: '32px' }}>
          ← Back to Orders
        </Link>
      </div>
    </div>
  );
}
