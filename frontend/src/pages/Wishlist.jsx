import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { wishlistAPI } from '../services/api';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import StarRating from '../components/StarRating';
import { resolveImageUrl } from '../utils/resolveImageUrl';

const PLACEHOLDER_IMG = 'https://placehold.co/400x400?text=No+Image';

export default function Wishlist() {
  const { savedIds, toggle } = useWishlist();
  const { addItem } = useCart();

  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(null);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    wishlistAPI.getAll()
      .then(({ data }) => setItems(data))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load your wishlist. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  // Keep local list in sync as user toggles hearts
  useEffect(() => {
    setItems(prev => prev.filter(p => savedIds.has(p.product_id)));
  }, [savedIds]);

  const handleRemove = async (productId, e) => {
    e.preventDefault();
    await toggle(productId);
  };

  const handleAddToCart = async (productId, e) => {
    e.preventDefault();
    const item = items.find(i => i.product_id === productId);
    setAdding(productId);
    setError('');
    try {
      await addItem(productId, 1, item ? { id: item.product_id, name: item.name, price: item.price, image_url: item.image_url, stock_quantity: item.stock_quantity } : null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not add item to cart. Please try again.');
    } finally {
      setAdding(null);
    }
  };

  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;

  return (
    <div className="page-section">
      <div className="container">
        <h1 className="section-title" style={{ textAlign: 'left', marginBottom: 8 }}>My Wishlist</h1>
        <div className="gold-divider" style={{ margin: '0 0 32px' }} />

        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 20 }}>
            {error}
          </div>
        )}

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <p style={{ color: 'var(--color-muted)', marginBottom: 24 }}>
              You haven't saved any products yet.
            </p>
            <Link to="/shop" className="btn btn-accent">Browse Products</Link>
          </div>
        ) : (
          <div className="products-grid">
            {items.map(item => (
              <div key={item.product_id} style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <Link to={`/products/${item.product_id}`} style={{ display: 'block', position: 'relative' }}>
                  <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: 'var(--color-blush)' }}>
                    <img
                      src={resolveImageUrl(item.image_url) || PLACEHOLDER_IMG}
                      alt={item.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  <button
                    onClick={(e) => handleRemove(item.product_id, e)}
                    style={{
                      position: 'absolute', top: 10, right: 10,
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.9)', border: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    aria-label="Remove from wishlist"
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="var(--color-accent)" stroke="var(--color-accent)" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                    </svg>
                  </button>
                </Link>

                <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <Link to={`/products/${item.product_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 500, margin: 0, lineHeight: 1.3 }}>
                      {item.name}
                    </h3>
                  </Link>

                  {Number(item.review_count) > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <StarRating value={parseFloat(item.avg_rating)} size="sm" />
                      <span style={{ fontSize: '0.73rem', color: 'var(--color-muted)' }}>({item.review_count})</span>
                    </div>
                  )}

                  <p style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-accent-dark)', margin: 0 }}>
                    GHS {parseFloat(item.price).toFixed(2)}
                  </p>

                  {item.stock_quantity === 0 ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Out of stock</span>
                  ) : (
                    <button
                      className="btn btn-accent"
                      style={{ marginTop: 'auto', fontSize: '0.8rem', padding: '10px 0' }}
                      onClick={(e) => handleAddToCart(item.product_id, e)}
                      disabled={adding === item.product_id}
                    >
                      {adding === item.product_id ? 'Adding…' : 'Add to Cart'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
