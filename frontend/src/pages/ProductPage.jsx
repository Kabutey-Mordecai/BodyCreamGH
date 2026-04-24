import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { productsAPI } from '../services/api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import './ProductPage.css';

// TO CUSTOMIZE: Placeholder shown when the product has no image
const PLACEHOLDER_IMG = 'https://placehold.co/700x700?text=No+Image';

// TO CUSTOMIZE: Trust row under the Add to Cart button
const TRUST_ROW = [
  { icon: '🚚', label: 'Free delivery',  sub: 'Over GHS 200' },
  { icon: '✦',  label: 'Handcrafted',    sub: 'In small batches' },
  { icon: '↩',  label: '7-day returns',  sub: 'No questions asked' },
];

// TO CUSTOMIZE: Static sell points shown on every product page
const HIGHLIGHTS = [
  'Made with 100% raw Ghanaian shea butter',
  'Formulated for melanin-rich skin',
  'Free from parabens, sulfates & artificial dyes',
  'Cruelty-free & dermatologist tested',
];

export default function ProductPage() {
  const { id }          = useParams();
  const { addItem }     = useCart();
  const { user }        = useAuth();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [qty, setQty]         = useState(1);
  const [adding, setAdding]   = useState(false);
  const [addedMsg, setAddedMsg] = useState('');

  useEffect(() => {
    setLoading(true);
    productsAPI.getById(id)
      .then(({ data }) => setProduct(data))
      .catch(() => setError('Product not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAddToCart = async () => {
    setAdding(true);
    setAddedMsg('');
    try {
      await addItem(product.id, qty);
      // Brief feedback message instead of a toast library to keep dependencies light
      setAddedMsg('Added to cart!');
      setTimeout(() => setAddedMsg(''), 3000);
    } catch (err) {
      setAddedMsg(err.response?.data?.error || 'Failed to add item.');
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  if (error || !product) {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center' }}>
          <p>{error || 'Product not found.'}</p>
          <Link to="/shop" className="btn btn-outline" style={{ marginTop: '16px' }}>
            Back to Shop
          </Link>
        </div>
      </div>
    );
  }

  const isOutOfStock = product.stock_quantity === 0;

  return (
    <div className="page-section product-page">
      <div className="container">
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/shop">Shop</Link>
          <span>/</span>
          <span>{product.name}</span>
        </nav>

        <div className="product-detail">
          {/* ── Left: image ─────────────────────────── */}
          <div className="product-detail-img">
            <img
              src={product.image_url || PLACEHOLDER_IMG}
              alt={product.name}
            />
          </div>

          {/* ── Right: info ─────────────────────────── */}
          <div className="product-detail-info">
            {product.category && (
              <span className="section-label">{product.category}</span>
            )}

            <h1 className="product-detail-name">{product.name}</h1>
            <div className="gold-divider" style={{ margin: '0 0 18px 0' }} />

            <p className="product-detail-price">
              GHS {parseFloat(product.price).toFixed(2)}
            </p>

            {isOutOfStock ? (
              <span className="badge badge-cancelled">Out of Stock</span>
            ) : (
              <span className="stock-hint">
                <span className="stock-dot" /> In stock — {product.stock_quantity} available
              </span>
            )}

            {product.description && (
              <p className="product-detail-desc">{product.description}</p>
            )}

            {/* Sell points — always shown, even if description is short */}
            <ul className="product-highlights">
              {HIGHLIGHTS.map(h => (
                <li key={h}>{h}</li>
              ))}
            </ul>

            {/* Quantity selector — capped at available stock */}
            {!isOutOfStock && user && (
              <div className="qty-selector">
                <label htmlFor="qty">Quantity</label>
                <div className="qty-control">
                  <button
                    onClick={() => setQty(q => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    aria-label="Decrease quantity"
                  >−</button>
                  <input
                    id="qty"
                    type="number"
                    min={1}
                    max={product.stock_quantity}
                    value={qty}
                    onChange={e =>
                      setQty(Math.min(
                        product.stock_quantity,
                        Math.max(1, parseInt(e.target.value) || 1)
                      ))
                    }
                  />
                  <button
                    onClick={() => setQty(q => Math.min(product.stock_quantity, q + 1))}
                    disabled={qty >= product.stock_quantity}
                    aria-label="Increase quantity"
                  >+</button>
                </div>
              </div>
            )}

            {addedMsg && (
              <div className={`alert ${addedMsg === 'Added to cart!' ? 'alert-success' : 'alert-error'}`}>
                {addedMsg}
              </div>
            )}

            {user ? (
              <button
                className="btn btn-accent btn-full product-cta"
                onClick={handleAddToCart}
                disabled={isOutOfStock || adding}
              >
                {adding ? 'Adding…' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
              </button>
            ) : (
              <Link
                to="/login"
                className="btn btn-primary btn-full product-cta"
              >
                Login to Buy
              </Link>
            )}

            {/* Trust row under the CTA */}
            <div className="product-trust-row">
              {TRUST_ROW.map(t => (
                <div key={t.label} className="product-trust-item">
                  <span className="product-trust-icon">{t.icon}</span>
                  <div>
                    <strong>{t.label}</strong>
                    <span>{t.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
