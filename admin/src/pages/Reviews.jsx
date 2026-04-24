import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

const Star = ({ filled }) => (
  <span style={{ color: filled ? '#c9a55a' : '#d4c5a0', fontSize: '0.9rem' }}>★</span>
);

const Stars = ({ rating }) => (
  <span>
    {[1,2,3,4,5].map(i => <Star key={i} filled={i <= rating} />)}
  </span>
);

export default function Reviews() {
  const toast = useToast();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminAPI.getAllReviews()
      .then(({ data }) => setReviews(data))
      .catch(() => toast.error('Failed to load reviews'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (productId, reviewId) => {
    if (!window.confirm('Delete this review?')) return;
    try {
      await adminAPI.deleteReview(reviewId);
      toast.success('Review deleted');
      setReviews(r => r.filter(x => x.id !== reviewId));
    } catch {
      toast.error('Failed to delete');
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reviews</h1>
          <p className="muted">{reviews.length} total reviews across all products</p>
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--ac-text-muted)' }}>
            No reviews yet.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reviews.map(r => (
            <div key={r.id} className="card">
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <Stars rating={r.rating} />
                    {r.title && <strong style={{ fontSize: '0.9rem' }}>{r.title}</strong>}
                  </div>
                  {r.body && <p style={{ fontSize: '0.88rem', color: 'var(--ac-text)', margin: '0 0 8px', lineHeight: 1.6 }}>{r.body}</p>}
                  <div style={{ fontSize: '0.78rem', color: 'var(--ac-text-muted)', display: 'flex', gap: 14 }}>
                    <span>By <strong>{r.first_name} {r.last_name}</strong> ({r.email})</span>
                    <span>·</span>
                    <span>Product: <Link to={`/products/${r.product_id}`} style={{ color: 'var(--ac-accent)' }}>{r.product_name}</Link></span>
                    <span>·</span>
                    <span>{new Date(r.created_at).toLocaleDateString('en-GH')}</span>
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--ac-danger)', whiteSpace: 'nowrap' }}
                  onClick={() => remove(r.product_id, r.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
