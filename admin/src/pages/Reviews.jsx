import { useEffect, useState, useRef, useCallback } from 'react';
import { adminAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import { resolveImageUrl } from '../utils/resolveImageUrl';

const TABS = [
  { key: 'all',         label: 'All Live Reviews' },
  { key: 'needs_reply', label: 'Needs Reply' },
  { key: 'low_rating',  label: '1★–3★ Needs Care' },
  { key: 'replied',     label: 'Replied' },
];

const POLICY_REASONS = [
  'Profanity / abusive language',
  'Spam or external promotional links',
  'Personal info / doxxing (phone number or home address)',
  'Hate speech or harassment',
  'Off-topic / unrelated content',
];

const Stars = ({ rating }) => (
  <span style={{ letterSpacing: 1 }}>
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} style={{ color: i <= rating ? '#c9a55a' : '#d4c5a0', fontSize: '0.88rem' }}>★</span>
    ))}
  </span>
);

const PLACEHOLDER = 'https://placehold.co/40x40?text=?';

export default function Reviews() {
  const toast = useToast();
  const [tab,     setTab]     = useState('all');
  const [search,  setSearch]  = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page,    setPage]    = useState(1);
  const [data,    setData]    = useState({
    reviews: [],
    total: 0,
    totalPages: 1,
    counts: { total: 0, needs_reply: 0, low_rating: 0, replied: 0 },
  });
  const [loading, setLoading] = useState(true);

  const [replyModal, setReplyModal] = useState(null); // review object | null
  const [replyText,  setReplyText]  = useState('');
  const [removeModal, setRemoveModal] = useState(null); // review object | null
  const [removeReason, setRemoveReason] = useState(POLICY_REASONS[0]);
  const [removeNote, setRemoveNote] = useState('');
  const [acting, setActing] = useState(null);

  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: res } = await adminAPI.getReviews({
        status: tab, page, limit: 20, search: debouncedSearch,
      });
      setData(res);
    } catch {
      if (!silent) toast.error('Failed to load reviews');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab, page, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const openReply = (review) => {
    setReplyModal(review);
    setReplyText(review.admin_reply || '');
  };

  const handleSaveReply = async () => {
    if (!replyModal) return;
    setActing(replyModal.id);
    try {
      await adminAPI.replyToReview(replyModal.id, replyText);
      toast.success(replyText.trim() ? 'Public store reply published' : 'Store reply cleared');
      setReplyModal(null);
      setReplyText('');
      load(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save public reply');
    } finally {
      setActing(null);
    }
  };

  const handlePolicyRemove = async () => {
    if (!removeModal) return;
    const fullReason = removeNote.trim()
      ? `${removeReason}: ${removeNote.trim()}`
      : removeReason;
    setActing(removeModal.id);
    try {
      await adminAPI.deleteReview(removeModal.id, fullReason);
      toast.success('Review removed & logged in audit trail');
      setRemoveModal(null);
      setRemoveNote('');
      load(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove review');
    } finally {
      setActing(null);
    }
  };

  const counts = data.counts || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Verified Reviews</h1>
          <p className="muted">
            All verified buyer reviews publish automatically — no silent hiding of negative feedback.
            Respond publicly to build customer trust.
          </p>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Live',       value: counts.total       || 0, color: '#1a7a34', bg: 'rgba(26,122,52,0.1)' },
          { label: 'Needs Reply',      value: counts.needs_reply || 0, color: '#b5700a', bg: 'rgba(181,112,10,0.1)' },
          { label: '1★–3★ Needs Care', value: counts.low_rating  || 0, color: '#b71c1c', bg: 'rgba(183,28,28,0.1)' },
          { label: 'Replied',          value: counts.replied     || 0, color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ background: s.bg, borderColor: s.color + '33' }}>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '0.8rem', color: s.color, opacity: 0.9 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: '12px 16px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--ac-bg)', borderRadius: 8, padding: 3, flexWrap: 'wrap' }}>
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 14px',
                  fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.15s',
                  background: tab === t.key ? 'var(--ac-surface)' : 'transparent',
                  color:      tab === t.key ? 'var(--ac-accent)' : 'var(--ac-text-muted)',
                  boxShadow:  tab === t.key ? 'var(--ac-shadow-sm)' : 'none',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <input
            ref={searchRef}
            type="search"
            placeholder="Search product, customer email, or review text…"
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
            No reviews found{search ? ` matching "${search}"` : ''}.
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ac-border)', background: 'var(--ac-bg)' }}>
                  {['Product', 'Customer', 'Rating', 'Review & Public Reply', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--ac-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.reviews.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--ac-border)' }}>
                    <td style={{ padding: '12px 14px', maxWidth: 170 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img
                          src={resolveImageUrl(r.image_url) || PLACEHOLDER}
                          alt=""
                          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                          onError={e => { e.currentTarget.src = PLACEHOLDER; }}
                        />
                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name}</span>
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 500 }}>{r.first_name} {r.last_name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--ac-text-muted)' }}>{r.email}</div>
                      {r.verified_purchase && (
                        <span style={{ fontSize: '0.7rem', color: '#1a7a34', fontWeight: 600 }}>✓ Verified Purchase</span>
                      )}
                    </td>

                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <Stars rating={r.rating} />
                      <span style={{ marginLeft: 4, color: 'var(--ac-text-muted)', fontSize: '0.78rem' }}>{r.rating}/5</span>
                    </td>

                    <td style={{ padding: '12px 14px', maxWidth: 320 }}>
                      {r.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.title}</div>}
                      {r.body ? (
                        <div style={{ color: 'var(--ac-text-muted)', fontSize: '0.82rem' }}>{r.body}</div>
                      ) : (
                        !r.title && <span style={{ color: 'var(--ac-text-muted)', fontStyle: 'italic' }}>Rating only</span>
                      )}
                      {r.admin_reply && (
                        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: 'var(--ac-bg)', borderLeft: '3px solid var(--ac-accent)', fontSize: '0.78rem' }}>
                          <strong>Your Public Reply:</strong> {r.admin_reply}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: 'var(--ac-text-muted)', fontSize: '0.8rem' }}>
                      {new Date(r.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>

                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={acting === r.id}
                          onClick={() => openReply(r)}
                        >
                          {r.admin_reply ? '✎ Edit Reply' : '💬 Reply Publicly'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-danger)' }}
                          disabled={acting === r.id}
                          onClick={() => {
                            setRemoveModal(r);
                            setRemoveReason(POLICY_REASONS[0]);
                            setRemoveNote('');
                          }}
                          title="Remove only for policy violations (audit-logged)"
                        >
                          ⚑ Policy Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ alignSelf: 'center', fontSize: '0.82rem', color: 'var(--ac-text-muted)' }}>
                Page {page} of {data.totalPages}
              </span>
              <button className="btn btn-outline btn-sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      {/* ── Public Reply Modal ── */}
      {replyModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
          }}
          onClick={() => setReplyModal(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 20, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>💬 Public Store Reply</h3>
            <p className="muted text-xs" style={{ marginTop: 0, marginBottom: 12 }}>
              This response appears publicly beneath <strong>{replyModal.first_name}&apos;s</strong> {replyModal.rating}★ review on <strong>{replyModal.product_name}</strong>.
            </p>
            <textarea
              rows={4}
              maxLength={1000}
              className="input"
              style={{ width: '100%', marginBottom: 12 }}
              placeholder="e.g. Thank you for your honest feedback! We've reached out to send a fresh replacement jar…"
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setReplyModal(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={acting === replyModal.id} onClick={handleSaveReply}>
                {acting === replyModal.id ? 'Saving…' : 'Publish Reply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Audit-Logged Policy Removal Modal ── */}
      {removeModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
          }}
          onClick={() => setRemoveModal(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 20, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, marginBottom: 6, color: 'var(--ac-danger)' }}>⚑ Remove Review (Policy Violation Only)</h3>
            <p className="muted text-xs" style={{ marginTop: 0, marginBottom: 12 }}>
              Honest negative reviews should be answered with a <strong>Public Reply</strong>, not deleted.
              Removals require a policy violation reason and are <strong>permanently recorded in the Admin Audit Log</strong>.
            </p>
            <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Violation Type *</label>
            <select
              className="input"
              style={{ width: '100%', marginBottom: 10 }}
              value={removeReason}
              onChange={e => setRemoveReason(e.target.value)}
            >
              {POLICY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className="text-xs" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Additional Audit Note (optional)</label>
            <input
              type="text"
              className="input"
              style={{ width: '100%', marginBottom: 14 }}
              placeholder="Explain what violated policy…"
              value={removeNote}
              onChange={e => setRemoveNote(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setRemoveModal(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: 'var(--ac-danger)', color: '#fff', border: 'none' }}
                disabled={acting === removeModal.id}
                onClick={handlePolicyRemove}
              >
                {acting === removeModal.id ? 'Removing…' : 'Confirm Audit-Logged Removal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
