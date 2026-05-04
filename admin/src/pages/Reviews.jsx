import { useEffect, useState, useRef, useCallback } from 'react';
import { adminAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

const TABS = [
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All' },
];

const STATUS_COLORS = {
  pending:  { bg: '#fff8e6', color: '#b5700a' },
  approved: { bg: '#e6f4ea', color: '#1a7a34' },
  rejected: { bg: '#fdecea', color: '#b71c1c' },
};

const Stars = ({ rating }) => (
  <span style={{ letterSpacing: 1 }}>
    {[1,2,3,4,5].map(i => (
      <span key={i} style={{ color: i <= rating ? '#c9a55a' : '#d4c5a0', fontSize: '0.85rem' }}>★</span>
    ))}
  </span>
);

const StatusBadge = ({ r }) => {
  const key = r.is_approved ? 'approved' : r.is_rejected ? 'rejected' : 'pending';
  const { bg, color } = STATUS_COLORS[key];
  return (
    <span style={{
      background: bg, color, borderRadius: 9999,
      padding: '2px 10px', fontSize: '0.75rem', fontWeight: 600,
    }}>
      {key.charAt(0).toUpperCase() + key.slice(1)}
    </span>
  );
};

const PLACEHOLDER = 'https://placehold.co/40x40?text=?';

export default function Reviews() {
  const toast = useToast();
  const [tab,     setTab]     = useState('pending');
  const [search,  setSearch]  = useState('');
  const [page,    setPage]    = useState(1);
  const [data,    setData]    = useState({ reviews: [], total: 0, totalPages: 1, counts: { pending: 0, approved: 0, rejected: 0 } });
  const [loading, setLoading] = useState(true);

  const [rejectModal, setRejectModal] = useState(null); // { id } | null
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(null); // reviewId being acted on

  const searchRef   = useRef(null);
  const autoRefRef  = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: res } = await adminAPI.getReviews({
        status: tab, page, limit: 20, search,
      });
      setData(res);
    } catch {
      if (!silent) toast.error('Failed to load reviews');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab, page, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 60 s on the Pending tab
  useEffect(() => {
    clearInterval(autoRefRef.current);
    if (tab === 'pending') {
      autoRefRef.current = setInterval(() => load(true), 60_000);
    }
    return () => clearInterval(autoRefRef.current);
  }, [tab, load]);

  const act = async (fn, successMsg) => {
    try {
      await fn();
      toast.success(successMsg);
      load();
    } catch {
      toast.error('Action failed');
    }
  };

  const handleApprove = async (id) => {
    setActing(id);
    await act(() => adminAPI.approveReview(id), 'Review approved');
    setActing(null);
  };

  const handleRejectSubmit = async () => {
    if (!rejectModal) return;
    setActing(rejectModal.id);
    await act(() => adminAPI.rejectReview(rejectModal.id, rejectReason), 'Review rejected');
    setActing(null);
    setRejectModal(null);
    setRejectReason('');
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Permanently delete this review?')) return;
    setActing(id);
    await act(() => adminAPI.deleteReview(id), 'Review deleted');
    setActing(null);
  };

  const counts = data.counts || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reviews</h1>
          <p className="muted">Approve customer reviews before they appear on the storefront</p>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Pending',  value: counts.pending  || 0, color: '#b5700a', bg: '#fff8e6' },
          { label: 'Approved', value: counts.approved || 0, color: '#1a7a34', bg: '#e6f4ea' },
          { label: 'Rejected', value: counts.rejected || 0, color: '#b71c1c', bg: '#fdecea' },
        ].map(s => (
          <div key={s.label} className="card" style={{ background: s.bg, borderColor: s.color + '33' }}>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '0.8rem', color: s.color, opacity: 0.85 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: '12px 16px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--ac-bg)', borderRadius: 8, padding: 3 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 14px',
                  fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.15s',
                  background:  tab === t.key ? 'var(--ac-surface)' : 'transparent',
                  color:       tab === t.key ? 'var(--ac-accent)' : 'var(--ac-text-muted)',
                  boxShadow:   tab === t.key ? 'var(--ac-shadow-sm)' : 'none',
                }}
              >
                {t.label}
                {t.key === 'pending' && counts.pending > 0 && (
                  <span style={{
                    marginLeft: 6, background: '#c9a55a', color: '#fff',
                    borderRadius: 9999, padding: '1px 7px', fontSize: '0.7rem',
                  }}>{counts.pending}</span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            ref={searchRef}
            type="search"
            placeholder="Search product or customer email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 200, padding: '6px 10px',
              border: '1px solid var(--ac-border)', borderRadius: 6,
              fontSize: '0.85rem', background: 'var(--ac-bg)', color: 'var(--ac-text)',
            }}
          />
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="spinner" />
      ) : data.reviews.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--ac-text-muted)' }}>
            No {tab === 'all' ? '' : tab} reviews{search ? ` matching "${search}"` : ''}.
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ac-border)', background: 'var(--ac-bg)' }}>
                  {['Product', 'Customer', 'Rating', 'Review', 'Date', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--ac-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.reviews.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--ac-border)' }}>
                    {/* Product */}
                    <td style={{ padding: '12px 14px', maxWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img
                          src={r.image_url || PLACEHOLDER}
                          alt=""
                          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                          onError={e => { e.currentTarget.src = PLACEHOLDER; }}
                        />
                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name}</span>
                      </div>
                    </td>

                    {/* Customer */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 500 }}>{r.first_name} {r.last_name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--ac-text-muted)' }}>{r.email}</div>
                      <span style={{ fontSize: '0.7rem', color: '#1a7a34', fontWeight: 600 }}>✓ Verified Purchase</span>
                    </td>

                    {/* Rating */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <Stars rating={r.rating} />
                      <span style={{ marginLeft: 4, color: 'var(--ac-text-muted)', fontSize: '0.78rem' }}>{r.rating}/5</span>
                    </td>

                    {/* Review */}
                    <td style={{ padding: '12px 14px', maxWidth: 240 }}>
                      {r.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.title}</div>}
                      {r.body && (
                        <div style={{ color: 'var(--ac-text-muted)', fontSize: '0.82rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {r.body}
                        </div>
                      )}
                      {!r.title && !r.body && <span style={{ color: 'var(--ac-text-muted)', fontStyle: 'italic' }}>Rating only</span>}
                    </td>

                    {/* Date */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: 'var(--ac-text-muted)' }}>
                      {new Date(r.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '12px 14px' }}>
                      <StatusBadge r={r} />
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!r.is_approved && (
                          <button
                            className="btn btn-sm"
                            style={{ background: '#e6f4ea', color: '#1a7a34', border: 'none', cursor: 'pointer' }}
                            disabled={acting === r.id}
                            onClick={() => handleApprove(r.id)}
                          >
                            Approve
                          </button>
                        )}
                        {!r.is_rejected && (
                          <button
                            className="btn btn-sm"
                            style={{ background: '#fff8e6', color: '#b5700a', border: 'none', cursor: 'pointer' }}
                            disabled={acting === r.id}
                            onClick={() => { setRejectModal({ id: r.id }); setRejectReason(''); }}
                          >
                            Reject
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--ac-danger)', cursor: 'pointer' }}
                          disabled={acting === r.id}
                          onClick={() => handleDelete(r.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {data.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-sm btn-ghost"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >← Prev</button>
              <span style={{ padding: '4px 12px', fontSize: '0.85rem', color: 'var(--ac-text-muted)' }}>
                Page {page} of {data.totalPages}
              </span>
              <button
                className="btn btn-sm btn-ghost"
                disabled={page === data.totalPages}
                onClick={() => setPage(p => p + 1)}
              >Next →</button>
            </div>
          )}
        </>
      )}

      {/* ── Reject modal ── */}
      {rejectModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setRejectModal(null)}
        >
          <div
            className="card"
            style={{ width: 440, padding: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="card-body" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 16px' }}>Reject Review</h3>
              <div className="field" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 600 }}>
                  Reason <span style={{ color: 'var(--ac-text-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="e.g. Violates community guidelines, inappropriate language…"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    border: '1px solid var(--ac-border)', fontSize: '0.85rem',
                    background: 'var(--ac-bg)', color: 'var(--ac-text)', resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setRejectModal(null)}>Cancel</button>
                <button
                  className="btn"
                  style={{ background: '#b71c1c', color: '#fff', border: 'none' }}
                  disabled={acting === rejectModal.id}
                  onClick={handleRejectSubmit}
                >
                  {acting === rejectModal.id ? 'Rejecting…' : 'Reject Review'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
