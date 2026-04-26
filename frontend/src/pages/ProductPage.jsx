import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { productsAPI, reviewsAPI } from '../services/api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import StarRating from '../components/StarRating';
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

// Resolve /uploads/... relative paths to the backend origin using VITE_API_URL.
// Legacy absolute URLs are returned unchanged.
const _apiUrl = import.meta.env.VITE_API_URL || '';
function resolveImageUrl(url) {
  if (!url || url.startsWith('http')) return url;
  if (_apiUrl.startsWith('http')) {
    try { return `${new URL(_apiUrl).origin}${url}`; } catch { /* fall through */ }
  }
  return url;
}

export default function ProductPage() {
  const { id }          = useParams();
  const { addItem }     = useCart();
  const { user }        = useAuth();

  const [product, setProduct]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [qty, setQty]           = useState(1);
  const [adding, setAdding]     = useState(false);
  const [addedMsg, setAddedMsg] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const touchStartX    = useRef(null);
  const lbTouchStartX  = useRef(null);

  const [lightbox, setLightbox] = useState(false);
  const [lbIdx,    setLbIdx]    = useState(0);

  const [reviews, setReviews]     = useState([]);
  const [reviewStats, setStats]   = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 0, title: '', body: '' });
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    productsAPI.getById(id)
      .then(({ data }) => {
        setProduct(data);
        // Default to the primary image; fall back to index 0
        const imgs = data.images ?? [];
        const primaryIdx = imgs.findIndex(img => img.is_primary);
        setSelectedIdx(primaryIdx >= 0 ? primaryIdx : 0);
      })
      .catch(() => setError('Product not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  const loadReviews = () =>
    reviewsAPI.getByProduct(id)
      .then(({ data }) => { setReviews(data.reviews || []); setStats(data.stats); })
      .catch(() => {});

  useEffect(() => { loadReviews(); }, [id]);

  const submitReview = async (e) => {
    e.preventDefault();
    if (!reviewForm.rating) return setSubmitMsg('Please select a star rating.');
    setSubmitting(true);
    setSubmitMsg('');
    try {
      await reviewsAPI.create(id, reviewForm);
      setSubmitMsg('Review submitted — thank you!');
      setReviewForm({ rating: 0, title: '', body: '' });
      loadReviews();
    } catch (err) {
      setSubmitMsg(err.response?.data?.error || 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToCart = async () => {
    setAdding(true);
    setAddedMsg('');
    try {
      await addItem(product.id, qty, product);
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

  const isOutOfStock  = product.stock_quantity === 0;
  const galleryImages = product.images?.length ? product.images : [];
  const isMulti       = galleryImages.length > 1;

  const prev = () => setSelectedIdx(i => Math.max(0, i - 1));
  const next = () => setSelectedIdx(i => Math.min(galleryImages.length - 1, i + 1));

  const handleTouchStart = e => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd   = e => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) diff > 0 ? next() : prev();
    touchStartX.current = null;
  };

  const openLightbox = (idx) => { setLbIdx(idx); setLightbox(true); };
  const closeLightbox = () => setLightbox(false);
  const lbPrev = () => setLbIdx(i => Math.max(0, i - 1));
  const lbNext = () => setLbIdx(i => Math.min(galleryImages.length - 1, i + 1));

  const handleLbTouchStart = e => { lbTouchStartX.current = e.touches[0].clientX; };
  const handleLbTouchEnd   = e => {
    if (lbTouchStartX.current === null) return;
    const diff = lbTouchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) diff > 0 ? lbNext() : lbPrev();
    lbTouchStartX.current = null;
  };

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
          {/* ── Left: image slider ──────────────────── */}
          {galleryImages.length > 0 ? (
            <div className="pdp-gallery">
              {/* Main slide area */}
              <div
                className="pdp-slider"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onKeyDown={e => {
                  if (!isMulti) return;
                  if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
                }}
                tabIndex={isMulti ? 0 : -1}
                role={isMulti ? 'region' : undefined}
                aria-label={isMulti ? 'Product image slider' : undefined}
              >
                <div
                  className="product-detail-img pdp-img--zoomable"
                  onClick={() => openLightbox(selectedIdx)}
                  title="Click to enlarge"
                >
                  <img
                    src={resolveImageUrl(galleryImages[selectedIdx]?.url)}
                    alt={product.name}
                    onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER_IMG; }}
                  />
                  <div className="pdp-zoom-hint" aria-hidden="true">&#128269;</div>
                </div>

                {isMulti && (
                  <>
                    <button
                      type="button"
                      className="pdp-arrow pdp-arrow--prev"
                      onClick={prev}
                      disabled={selectedIdx === 0}
                      aria-label="Previous image"
                    >
                      &#8249;
                    </button>
                    <button
                      type="button"
                      className="pdp-arrow pdp-arrow--next"
                      onClick={next}
                      disabled={selectedIdx === galleryImages.length - 1}
                      aria-label="Next image"
                    >
                      &#8250;
                    </button>
                    <div className="pdp-counter" aria-live="polite" aria-atomic="true">
                      {selectedIdx + 1} / {galleryImages.length}
                    </div>
                  </>
                )}
              </div>

              {/* Dot navigation */}
              {isMulti && (
                <div className="pdp-dots" role="tablist" aria-label="Select image">
                  {galleryImages.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      role="tab"
                      className={`pdp-dot${i === selectedIdx ? ' pdp-dot--active' : ''}`}
                      onClick={() => setSelectedIdx(i)}
                      aria-label={`Image ${i + 1}${img.is_primary ? ' (primary)' : ''}`}
                      aria-selected={i === selectedIdx}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              className="product-detail-img pdp-img--zoomable"
              onClick={() => product.image_url && openLightbox(-1)}
              title={product.image_url ? 'Click to enlarge' : undefined}
            >
              <img
                src={product.image_url || PLACEHOLDER_IMG}
                alt={product.name}
              />
              {product.image_url && <div className="pdp-zoom-hint" aria-hidden="true">&#128269;</div>}
            </div>
          )}

          {/* ── Right: info ─────────────────────────── */}
          <div className="product-detail-info">
            {product.category && (
              <span className="section-label">{product.category}</span>
            )}

            <h1 className="product-detail-name">{product.name}</h1>
            <div className="gold-divider" style={{ margin: '0 0 18px 0' }} />

            <div className="product-detail-rating">
              <StarRating value={parseFloat(product.avg_rating || 0)} size="md" />
              <span className="product-detail-rating-label">
                {product.review_count > 0
                  ? `${parseFloat(product.avg_rating).toFixed(1)} (${product.review_count} review${product.review_count !== 1 ? 's' : ''})`
                  : 'No reviews yet'}
              </span>
            </div>

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
            {!isOutOfStock && (
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

            <button
              className="btn btn-accent btn-full product-cta"
              onClick={handleAddToCart}
              disabled={isOutOfStock || adding}
            >
              {adding ? 'Adding…' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
            </button>

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

      {/* ── Reviews ──────────────────────────────────────────── */}
      <div className="container reviews-section">
        <h2 className="reviews-heading">Customer Reviews</h2>
        <div className="gold-divider" style={{ margin: '0 0 32px' }} />

        <div className="reviews-layout">
          {/* Summary */}
          {reviewStats && Number(reviewStats.review_count) > 0 && (
            <div className="reviews-summary">
              <div className="reviews-avg">{parseFloat(reviewStats.avg_rating).toFixed(1)}</div>
              <StarRating value={parseFloat(reviewStats.avg_rating)} size="lg" />
              <div className="reviews-count">{reviewStats.review_count} review{reviewStats.review_count !== 1 ? 's' : ''}</div>
            </div>
          )}

          {/* List */}
          <div className="reviews-list">
            {reviews.length === 0 && (
              <p className="reviews-empty">No reviews yet. Be the first to share your experience!</p>
            )}
            {reviews.map(r => (
              <div key={r.id} className="review-card">
                <div className="review-header">
                  <StarRating value={r.rating} size="sm" />
                  <span className="review-author">{r.first_name} {r.last_name?.charAt(0)}.</span>
                  <span className="review-date">{new Date(r.created_at).toLocaleDateString('en-GH', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
                {r.title && <div className="review-title">{r.title}</div>}
                {r.body  && <p  className="review-body">{r.body}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Submit form — only for logged-in users */}
        {user ? (
          <form className="review-form" onSubmit={submitReview}>
            <h3 className="review-form-heading">Write a Review</h3>
            <div className="field">
              <label>Your rating</label>
              <StarRating
                value={reviewForm.rating}
                interactive
                size="lg"
                onChange={v => setReviewForm(f => ({ ...f, rating: v }))}
              />
            </div>
            <div className="field">
              <label>Title <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input
                type="text"
                maxLength={150}
                placeholder="Summarise your experience"
                value={reviewForm.title}
                onChange={e => setReviewForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Review <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span></label>
              <textarea
                rows={4}
                placeholder="What did you think of the product?"
                value={reviewForm.body}
                onChange={e => setReviewForm(f => ({ ...f, body: e.target.value }))}
              />
            </div>
            {submitMsg && (
              <div className={`alert ${submitMsg.startsWith('Review submitted') ? 'alert-success' : 'alert-error'}`}>
                {submitMsg}
              </div>
            )}
            <button type="submit" className="btn btn-accent" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </form>
        ) : (
          <div className="review-login-prompt">
            <Link to="/login" className="btn btn-outline">Login to write a review</Link>
          </div>
        )}
      </div>

      {/* ── Lightbox ─────────────────────────────────────── */}
      {lightbox && (
        <div
          className="pdp-lb-backdrop"
          onClick={closeLightbox}
          onKeyDown={e => {
            if (e.key === 'Escape')     closeLightbox();
            if (e.key === 'ArrowLeft')  { e.stopPropagation(); lbPrev(); }
            if (e.key === 'ArrowRight') { e.stopPropagation(); lbNext(); }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          tabIndex={-1}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        >
          <div
            className="pdp-lb-inner"
            onClick={e => e.stopPropagation()}
            onTouchStart={handleLbTouchStart}
            onTouchEnd={handleLbTouchEnd}
          >
            <button
              type="button"
              className="pdp-lb-close"
              onClick={closeLightbox}
              aria-label="Close lightbox"
            >
              &#215;
            </button>

            <img
              className="pdp-lb-img"
              src={
                lbIdx === -1
                  ? (product.image_url || PLACEHOLDER_IMG)
                  : resolveImageUrl(galleryImages[lbIdx]?.url)
              }
              alt={product.name}
              onClick={closeLightbox}
              onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER_IMG; }}
            />

            {galleryImages.length > 1 && lbIdx >= 0 && (
              <>
                <button
                  type="button"
                  className="pdp-lb-arrow pdp-lb-arrow--prev"
                  onClick={e => { e.stopPropagation(); lbPrev(); }}
                  disabled={lbIdx === 0}
                  aria-label="Previous image"
                >
                  &#8249;
                </button>
                <button
                  type="button"
                  className="pdp-lb-arrow pdp-lb-arrow--next"
                  onClick={e => { e.stopPropagation(); lbNext(); }}
                  disabled={lbIdx === galleryImages.length - 1}
                  aria-label="Next image"
                >
                  &#8250;
                </button>
                <div className="pdp-lb-counter">
                  {lbIdx + 1} / {galleryImages.length}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
