import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import StatCard from '../components/StatCard';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './Reviews.css';

const STOREFRONT_URL = (import.meta.env.VITE_STOREFRONT_URL || 'https://bodycreamgh-shop.vercel.app').replace(/\/$/, '');

const TABS = [
  { key: 'all',         label: 'All live',    countKey: 'total' },
  { key: 'needs_reply', label: 'Needs reply', countKey: 'needs_reply' },
  { key: 'low_rating',  label: '1–3 stars',   countKey: 'low_rating' },
  { key: 'with_photos', label: 'With photos', countKey: 'with_photos' },
  { key: 'replied',     label: 'Replied',     countKey: 'replied' },
];

const POLICY_REASONS = [
  'Profanity / abusive language',
  'Spam or external promotional links',
  'Personal info / doxxing (phone number or home address)',
  'Hate speech or harassment',
  'Off-topic / unrelated content',
];

const QUICK_REPLY_TEMPLATES = [
  {
    label: 'Thank 5-star buyer',
    build: (r) => `Thank you so much for your kind review, ${r.first_name || 'dear'}! We're thrilled you're loving your ${r.product_name}. Thank you for shopping authentic skincare with BodyCream GH!`,
  },
  {
    label: 'Care & support follow-up',
    build: (r) => `Thank you for your honest feedback, ${r.first_name || 'valued customer'}. Your experience matters deeply to us — our support team has noted your order${r.order_number ? ` (#${r.order_number})` : ''} and is reaching out directly to make this right.`,
  },
  {
    label: 'Skincare usage tip',
    build: (r) => `Thank you for sharing your experience with ${r.product_name}! For best absorption and glow, apply on slightly damp skin right after cleansing and pair with daily SPF during the day.`,
  },
];

function Stars({ rating }) {
  return (
    <span className="rv-stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={i <= rating ? 'rv-star-filled' : 'rv-star-empty'}>★</span>
      ))}
    </span>
  );
}

export default function Reviews() {
  const { user } = useAuth();
  const toast = useToast();
  const canDeletePolicy = ['super_admin', 'admin', 'support'].includes(user?.role);

  const [tab, setTab] = useState('all');
  const [starFilter, setStarFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState({
    reviews: [],
    total: 0,
    totalPages: 1,
    counts: { total: 0, needs_reply: 0, low_rating: 0, replied: 0, with_photos: 0, avg_rating: 0 },
  });
  const [loading, setLoading] = useState(true);

  const [replyModal, setReplyModal] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [removeModal, setRemoveModal] = useState(null);
  const [removeReason, setRemoveReason] = useState(POLICY_REASONS[0]);
  const [removeNote, setRemoveNote] = useState('');
  const [photoLightbox, setPhotoLightbox] = useState(null);
  const [acting, setActing] = useState(null);

  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: res } = await adminAPI.getReviews({
        status: tab,
        rating: starFilter || undefined,
        page,
        limit: 20,
        search: debouncedSearch || undefined,
      });
      setData(res);
    } catch (err) {
      if (!silent) toast.error(err.response?.data?.error || 'Failed to load reviews');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab, starFilter, page, debouncedSearch, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const notifyBadgeSync = () => {
    window.dispatchEvent(new Event('bc:counts-changed'));
  };

  const openReply = (review) => {
    setReplyModal(review);
    setReplyText(review.admin_reply || '');
  };

  const handleSaveReply = async (customText = undefined) => {
    if (!replyModal) return;
    const finalReply = customText !== undefined ? customText : replyText;
    setActing(replyModal.id);
    try {
      await adminAPI.replyToReview(replyModal.id, finalReply);
      toast.success(finalReply.trim() ? 'Public reply published' : 'Public reply cleared');
      setReplyModal(null);
      setReplyText('');
      load(true);
      notifyBadgeSync();
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
      toast.success('Review removed & audit-logged');
      setRemoveModal(null);
      setRemoveNote('');
      load(true);
      notifyBadgeSync();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove review');
    } finally {
      setActing(null);
    }
  };

  const counts = data.counts || {};
  const totalLive = Number(counts.total || 0);
  const repliedCount = Number(counts.replied || 0);
  const replyRate = totalLive > 0 ? Math.round((repliedCount / totalLive) * 100) : 100;
  const avgRating = Number(counts.avg_rating || 0);

  return (
    <div>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1>Reviews</h1>
          <p className="muted">
            Verified buyer reviews publish automatically across Storefront &amp; Mobile App.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={() => load()}>
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI Strip ────────────────────────────────────────────────── */}
      <div className="stats-grid">
        <StatCard
          label="Average Rating"
          value={totalLive > 0 ? `${avgRating.toFixed(2)} / 5` : '—'}
          sub={`${totalLive} live verified review${totalLive === 1 ? '' : 's'}`}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }
        />
        <StatCard
          label="Needs Reply"
          value={counts.needs_reply || 0}
          sub="Awaiting store response"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          }
        />
        <StatCard
          label="1–3 Stars"
          value={counts.low_rating || 0}
          sub="Priority customer care"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          }
        />
        <StatCard
          label="Reply Rate"
          value={`${replyRate}%`}
          sub={`${repliedCount} replied · ${counts.with_photos || 0} with photos`}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          }
        />
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────────── */}
      <div className="rv-toolbar">
        <div className="rv-toolbar-top">
          <div className="rv-seg-tabs" role="tablist">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`rv-seg-tab${tab === t.key ? ' is-active' : ''}`}
                onClick={() => { setTab(t.key); setPage(1); }}
              >
                <span>{t.label}</span>
                <span className="rv-seg-count">{counts[t.countKey] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rv-toolbar-bottom">
          <div className="rv-star-chips" role="group" aria-label="Filter by star rating">
            <button
              type="button"
              className={`rv-star-chip${starFilter === null ? ' is-active' : ''}`}
              onClick={() => { setStarFilter(null); setPage(1); }}
            >
              All ratings
            </button>
            {[5, 4, 3, 2, 1].map(star => (
              <button
                key={star}
                type="button"
                className={`rv-star-chip${starFilter === star ? ' is-active' : ''}`}
                onClick={() => { setStarFilter(prev => (prev === star ? null : star)); setPage(1); }}
              >
                {star}★
              </button>
            ))}
          </div>

          <div style={{ minWidth: 260 }}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search product, customer, or review…"
            />
          </div>
        </div>
      </div>

      {/* ── Reviews List ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <span className="muted">Loading reviews…</span>
        </div>
      ) : data.reviews.length === 0 ? (
        <div className="card" style={{ padding: '52px 24px', textAlign: 'center' }}>
          <h3 style={{ marginBottom: 6 }}>No reviews match this view</h3>
          <p className="muted" style={{ maxWidth: 420, margin: '0 auto 14px', fontSize: '0.86rem' }}>
            {search || starFilter || tab !== 'all'
              ? 'Try clearing your rating filter, search query, or switching tabs.'
              : 'Verified customer reviews will appear here automatically after delivery.'}
          </p>
          {(search || starFilter || tab !== 'all') && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => { setTab('all'); setStarFilter(null); setSearch(''); setPage(1); }}
            >
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="rv-list">
            {data.reviews.map(r => {
              const photos = Array.isArray(r.images) ? r.images.filter(Boolean) : [];
              const isLowUnreplied = r.rating <= 3 && !r.admin_reply;

              return (
                <article key={r.id} className={`rv-item-card${isLowUnreplied ? ' is-low-unreplied' : ''}`}>
                  <div className="rv-product-col">
                    <div className="rv-product-box">
                      {r.image_url ? (
                        <img
                          src={resolveImageUrl(r.image_url)}
                          alt={r.product_name}
                          className="rv-product-thumb"
                          onError={e => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="rv-product-thumb" />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/products/${r.product_id}`} className="rv-product-name" title={r.product_name}>
                          {r.product_name}
                        </Link>
                        <a
                          href={`${STOREFRONT_URL}/products/${r.product_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="muted text-xs"
                          style={{ display: 'inline-block', marginTop: 2 }}
                        >
                          Storefront ↗
                        </a>
                      </div>
                    </div>

                    <div className="rv-customer-box">
                      <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>
                        {r.user_id ? (
                          <Link to={`/customers/${r.user_id}`}>
                            {r.first_name} {r.last_name}
                          </Link>
                        ) : (
                          <span>{r.first_name} {r.last_name}</span>
                        )}
                      </div>
                      <div className="muted text-xs" style={{ wordBreak: 'break-all' }}>{r.email}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                        {r.verified_purchase && (
                          <span className="rv-verified-tag">Verified buyer</span>
                        )}
                        {r.order_id && (
                          <Link
                            to={`/orders/${r.order_id}`}
                            className="text-xs"
                            style={{ color: 'var(--ac-accent)', fontWeight: 600 }}
                          >
                            {r.order_number ? `#${r.order_number}` : 'Order'}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rv-main-col">
                    <div className="rv-rating-row">
                      <Stars rating={r.rating} />
                      <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{r.rating}.0</span>
                      <span className="muted text-xs">
                        · {new Date(r.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      {Number(r.helpful_count) > 0 && (
                        <span className="badge badge-neutral" style={{ fontSize: '0.68rem' }}>
                          {r.helpful_count} helpful
                        </span>
                      )}
                      {isLowUnreplied && (
                        <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>
                          Needs care
                        </span>
                      )}
                    </div>

                    {r.title && <h3 className="rv-headline">{r.title}</h3>}
                    {r.body ? (
                      <p className="rv-body">{r.body}</p>
                    ) : (
                      !r.title && <p className="muted text-xs" style={{ fontStyle: 'italic' }}>Rating submitted without comment.</p>
                    )}

                    {photos.length > 0 && (
                      <div className="rv-photos-row">
                        {photos.map((imgUrl, idx) => {
                          const fullUrl = resolveImageUrl(imgUrl);
                          return (
                            <button
                              key={idx}
                              type="button"
                              className="rv-photo-btn"
                              onClick={() => setPhotoLightbox({ url: fullUrl, product: r.product_name, author: r.first_name })}
                            >
                              <img src={fullUrl} alt={`Review photo ${idx + 1}`} loading="lazy" />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {r.admin_reply && (
                      <div className="rv-reply-box">
                        <div className="rv-reply-head">
                          <span>Store Reply</span>
                          {r.admin_reply_at && (
                            <span style={{ fontWeight: 400, textTransform: 'none' }}>
                              {new Date(r.admin_reply_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                        <div className="rv-reply-text">{r.admin_reply}</div>
                      </div>
                    )}
                  </div>

                  <div className="rv-actions-col">
                    <button
                      type="button"
                      className={`btn btn-sm ${r.admin_reply ? 'btn-outline' : 'btn-primary'}`}
                      disabled={acting === r.id}
                      onClick={() => openReply(r)}
                    >
                      {r.admin_reply ? 'Edit reply' : 'Reply'}
                    </button>

                    {canDeletePolicy && (
                      <button
                        type="button"
                        className="rf-icon-danger"
                        title="Remove for policy violation"
                        aria-label="Remove for policy violation"
                        disabled={acting === r.id}
                        onClick={() => {
                          setRemoveModal(r);
                          setRemoveReason(POLICY_REASONS[0]);
                          setRemoveNote('');
                        }}
                        style={{
                          width: 30,
                          height: 30,
                          padding: 0,
                          borderRadius: 'var(--ac-radius)',
                          border: '1px solid var(--ac-border)',
                          background: 'transparent',
                          color: 'var(--ac-text-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {data.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 18 }}>
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                ← Prev
              </button>
              <span className="muted text-xs">
                Page {page} of {data.totalPages}
              </span>
              <button className="btn btn-outline btn-sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Public Reply Modal ───────────────────────────────────────── */}
      <Modal
        open={Boolean(replyModal)}
        onClose={() => setReplyModal(null)}
        title="Public store reply"
        size="md"
        footer={
          <>
            {replyModal?.admin_reply && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ marginRight: 'auto', color: 'var(--ac-danger)' }}
                disabled={acting === replyModal?.id}
                onClick={() => handleSaveReply('')}
              >
                Clear reply
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => setReplyModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!replyModal || acting === replyModal.id || !replyText.trim()}
              onClick={() => handleSaveReply()}
            >
              {acting === replyModal?.id ? 'Saving…' : 'Publish reply'}
            </button>
          </>
        }
      >
        {replyModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '10px 12px', borderRadius: 'var(--ac-radius)', background: 'var(--ac-surface-2)', border: '1px solid var(--ac-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <Stars rating={replyModal.rating} />
                <strong className="text-xs">{replyModal.title || replyModal.product_name}</strong>
              </div>
              <div className="muted text-xs">{replyModal.body || 'Star rating only.'}</div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Quick templates</label>
              <div className="rv-template-chips">
                {QUICK_REPLY_TEMPLATES.map(tpl => (
                  <button
                    key={tpl.label}
                    type="button"
                    className="rv-template-chip"
                    onClick={() => setReplyText(tpl.build(replyModal))}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rv-reply-textarea">Response</label>
              <textarea
                id="rv-reply-textarea"
                rows={4}
                maxLength={1000}
                placeholder="Write a public response from BodyCream GH…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
              />
              <div className="muted text-xs" style={{ textAlign: 'right' }}>
                {replyText.length} / 1000
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Policy Violation Removal Modal ───────────────────────────── */}
      <Modal
        open={Boolean(removeModal)}
        onClose={() => setRemoveModal(null)}
        title="Remove review (policy violation)"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setRemoveModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!removeModal || acting === removeModal.id}
              onClick={handlePolicyRemove}
            >
              {acting === removeModal?.id ? 'Removing…' : 'Confirm removal'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="muted text-xs">
            Honest negative feedback should receive a public reply. Removals recalculate product ratings and are permanently logged in the audit trail.
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rv-violation-type">Violation category</label>
            <select
              id="rv-violation-type"
              value={removeReason}
              onChange={e => setRemoveReason(e.target.value)}
            >
              {POLICY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rv-violation-note">Audit note (optional)</label>
            <input
              id="rv-violation-note"
              type="text"
              placeholder="Details recorded in audit log…"
              value={removeNote}
              onChange={e => setRemoveNote(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* ── Photo Lightbox ───────────────────────────────────────────── */}
      {photoLightbox && (
        <div className="rv-lightbox" onClick={() => setPhotoLightbox(null)}>
          <div style={{ maxWidth: '90vw', maxHeight: '88vh', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <img
              src={photoLightbox.url}
              alt={`${photoLightbox.product} review`}
              style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 10 }}
            />
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span style={{ color: '#fff', fontSize: '0.84rem' }}>
                {photoLightbox.product} · {photoLightbox.author}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPhotoLightbox(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
