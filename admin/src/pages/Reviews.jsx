import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './Reviews.css';

const STOREFRONT_URL = (import.meta.env.VITE_STOREFRONT_URL || 'https://bodycreamgh-shop.vercel.app').replace(/\/$/, '');

const TABS = [
  { key: 'all',         label: 'All Live Reviews', countKey: 'total' },
  { key: 'needs_reply', label: 'Needs Reply',      countKey: 'needs_reply' },
  { key: 'low_rating',  label: '1★–3★ Needs Care', countKey: 'low_rating' },
  { key: 'with_photos', label: '📸 With Photos',   countKey: 'with_photos' },
  { key: 'replied',     label: 'Replied',          countKey: 'replied' },
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
    label: '✨ Thank 5★ Buyer',
    build: (r) => `Thank you so much for your kind review, ${r.first_name || 'dear'}! We're thrilled you're loving your ${r.product_name}. Thank you for shopping authentic skincare with BodyCream GH!`,
  },
  {
    label: '💛 Care & Support Follow-up',
    build: (r) => `Thank you for your honest feedback, ${r.first_name || 'valued customer'}. Your experience matters deeply to us — our support team has noted your order${r.order_number ? ` (#${r.order_number})` : ''} and is reaching out directly to make this right.`,
  },
  {
    label: '🧴 Skincare Usage Tip',
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
  const [starFilter, setStarFilter] = useState(null); // null | 1..5
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
      toast.success(finalReply.trim() ? 'Public store reply published across Storefront & Mobile App' : 'Public store reply cleared');
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
      toast.success('Review removed, product rating recalculated & audit-logged');
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
    <div className="page">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Verified Customer Reviews</h1>
          <p className="muted text-sm" style={{ marginTop: 4 }}>
            Verified buyer reviews publish automatically across Storefront &amp; Mobile App. Reply publicly to build shopper confidence.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-outline" onClick={() => load()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── 4-Card Reputation KPI Strip ──────────────────────────────── */}
      <div className="rv-kpi-grid">
        <div className="rv-kpi-card">
          <div className="rv-kpi-top">
            <span className="rv-kpi-label">Store Rating</span>
            <span className="rv-kpi-icon">★</span>
          </div>
          <div className="rv-kpi-value">
            {totalLive > 0 ? avgRating.toFixed(2) : '—'}
            <span className="muted" style={{ fontSize: '0.92rem', fontWeight: 500 }}> / 5.0</span>
          </div>
          <div className="rv-kpi-sub">{totalLive} live verified review{totalLive === 1 ? '' : 's'}</div>
        </div>

        <div className="rv-kpi-card">
          <div className="rv-kpi-top">
            <span className="rv-kpi-label">Needs Public Reply</span>
            <span className="rv-kpi-icon">💬</span>
          </div>
          <div className="rv-kpi-value">{counts.needs_reply || 0}</div>
          <div className="rv-kpi-sub">Synced with sidebar badge</div>
        </div>

        <div className="rv-kpi-card">
          <div className="rv-kpi-top">
            <span className="rv-kpi-label">1★–3★ Priority Care</span>
            <span className="rv-kpi-icon">⚠️</span>
          </div>
          <div className="rv-kpi-value">{counts.low_rating || 0}</div>
          <div className="rv-kpi-sub">Critical feedback to address</div>
        </div>

        <div className="rv-kpi-card">
          <div className="rv-kpi-top">
            <span className="rv-kpi-label">Reply Rate &amp; Photos</span>
            <span className="rv-kpi-icon">📸</span>
          </div>
          <div className="rv-kpi-value">{replyRate}%</div>
          <div className="rv-kpi-sub">{repliedCount} replied · {counts.with_photos || 0} with buyer photos</div>
        </div>
      </div>

      {/* ── Filter Tabs, Star Chips & Search ─────────────────────────── */}
      <div className="rv-filter-card">
        <div className="rv-tabs-row">
          <div className="rv-tabs" role="tablist">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`rv-tab${tab === t.key ? ' is-active' : ''}`}
                onClick={() => { setTab(t.key); setPage(1); }}
              >
                <span>{t.label}</span>
                <span className="rv-tab-pill">{counts[t.countKey] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rv-controls-row">
          <div className="rv-star-chips" role="group" aria-label="Filter by star rating">
            <button
              type="button"
              className={`rv-star-chip${starFilter === null ? ' is-active' : ''}`}
              onClick={() => { setStarFilter(null); setPage(1); }}
            >
              All Stars
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

          <div className="rv-search-wrap">
            <span className="rv-search-icon">🔍</span>
            <input
              type="search"
              placeholder="Search product, customer name/email, headline, review…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Reviews Stream ───────────────────────────────────────────── */}
      {loading ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <span className="muted">Loading verified customer reviews…</span>
        </div>
      ) : data.reviews.length === 0 ? (
        <div className="card" style={{ padding: '52px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.1rem', marginBottom: 10 }}>⭐</div>
          <h3 style={{ margin: '0 0 6px' }}>No Reviews Match This View</h3>
          <p className="muted text-sm" style={{ maxWidth: 440, margin: '0 auto 14px' }}>
            {search || starFilter || tab !== 'all'
              ? 'Try clearing your star filter, search text, or switching queue tabs.'
              : 'Once customers receive delivered orders and submit ratings or photos, they will appear here automatically.'}
          </p>
          {(search || starFilter || tab !== 'all') && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => { setTab('all'); setStarFilter(null); setSearch(''); setPage(1); }}
            >
              Reset Filters
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
                  {/* Col 1: Product & Verified Buyer Context */}
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
                        <div className="rv-product-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>
                          🧴
                        </div>
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
                          style={{ textDecoration: 'none', display: 'inline-block', marginTop: 3 }}
                        >
                          ↗ View on Storefront
                        </a>
                      </div>
                    </div>

                    <div className="rv-customer-box">
                      <div style={{ fontWeight: 700, fontSize: '0.83rem' }}>
                        {r.user_id ? (
                          <Link to={`/customers/${r.user_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {r.first_name} {r.last_name}
                          </Link>
                        ) : (
                          <span>{r.first_name} {r.last_name}</span>
                        )}
                      </div>
                      <div className="muted text-xs" style={{ wordBreak: 'break-all' }}>{r.email}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {r.verified_purchase && (
                          <span className="rv-verified-pill">✓ Verified Buyer</span>
                        )}
                        {r.order_id && (
                          <Link
                            to={`/orders/${r.order_id}`}
                            className="text-xs"
                            style={{ color: 'var(--ac-accent)', fontWeight: 700, textDecoration: 'none', marginTop: 3 }}
                          >
                            {r.order_number ? `#${r.order_number}` : 'View Order →'}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Col 2: Rating, Content, Buyer Photos, Store Reply */}
                  <div className="rv-main-col">
                    <div className="rv-rating-row">
                      <Stars rating={r.rating} />
                      <span style={{ fontWeight: 800, fontSize: '0.82rem' }}>{r.rating}.0</span>
                      <span className="muted text-xs">
                        · {new Date(r.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      {Number(r.helpful_count) > 0 && (
                        <span className="badge badge-neutral" style={{ fontSize: '0.68rem' }}>
                          👍 {r.helpful_count} found helpful
                        </span>
                      )}
                      {isLowUnreplied && (
                        <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>
                          Needs Care
                        </span>
                      )}
                    </div>

                    {r.title && <h3 className="rv-headline">{r.title}</h3>}
                    {r.body ? (
                      <p className="rv-body">{r.body}</p>
                    ) : (
                      !r.title && <p className="muted text-xs" style={{ fontStyle: 'italic', margin: 0 }}>Star rating submitted without written comment.</p>
                    )}

                    {photos.length > 0 && (
                      <div className="rv-photos-row" aria-label="Customer uploaded review photos">
                        {photos.map((imgUrl, idx) => {
                          const fullUrl = resolveImageUrl(imgUrl);
                          return (
                            <button
                              key={idx}
                              type="button"
                              className="rv-photo-btn"
                              onClick={() => setPhotoLightbox({ url: fullUrl, product: r.product_name, author: r.first_name })}
                              title="Click to inspect full-resolution photo"
                            >
                              <img src={fullUrl} alt={`Customer photo ${idx + 1}`} loading="lazy" />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {r.admin_reply && (
                      <div className="rv-reply-box">
                        <div className="rv-reply-head">
                          <span>✦ Public Store Reply · BodyCream GH</span>
                          {r.admin_reply_at && (
                            <span style={{ fontWeight: 500, textTransform: 'none' }}>
                              {new Date(r.admin_reply_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                        <div className="rv-reply-text">{r.admin_reply}</div>
                      </div>
                    )}
                  </div>

                  {/* Col 3: Moderation & Response Actions */}
                  <div className="rv-actions-col">
                    <button
                      type="button"
                      className={`btn btn-sm ${r.admin_reply ? 'btn-outline' : 'btn-accent'}`}
                      disabled={acting === r.id}
                      onClick={() => openReply(r)}
                    >
                      {r.admin_reply ? '✎ Edit Reply' : '💬 Reply Publicly'}
                    </button>

                    {canDeletePolicy && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.35)' }}
                        disabled={acting === r.id}
                        onClick={() => {
                          setRemoveModal(r);
                          setRemoveReason(POLICY_REASONS[0]);
                          setRemoveNote('');
                        }}
                        title="Remove only for documented policy violations (audit-logged)"
                      >
                        ⚑ Policy Remove
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
                Page {page} of {data.totalPages} ({data.total} total)
              </span>
              <button className="btn btn-outline btn-sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Public Reply Modal (with Quick Templates) ────────────────── */}
      {replyModal && (
        <div
          className="rv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Publish Public Store Reply"
          onClick={() => setReplyModal(null)}
        >
          <div className="rv-modal" onClick={e => e.stopPropagation()}>
            <div className="rv-modal-head">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.08rem' }}>💬 Public Store Reply</h3>
                <p className="muted text-xs" style={{ marginTop: 3 }}>
                  Visible immediately under <strong>{replyModal.first_name}&apos;s</strong> {replyModal.rating}★ review on <strong>{replyModal.product_name}</strong> (Web &amp; Mobile App).
                </p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setReplyModal(null)}>✕</button>
            </div>

            <div className="rv-modal-body">
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--ac-surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--ac-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Stars rating={replyModal.rating} />
                  <strong className="text-xs">{replyModal.title || 'Customer Review'}</strong>
                </div>
                <div className="muted text-xs" style={{ lineHeight: 1.45 }}>
                  {replyModal.body || 'Star rating only.'}
                </div>
              </div>

              <div>
                <label className="text-xs" style={{ fontWeight: 700, marginBottom: 6, display: 'block' }}>
                  Quick Response Templates
                </label>
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

              <div>
                <label htmlFor="rv-reply-textarea">Your Public Response</label>
                <textarea
                  id="rv-reply-textarea"
                  rows={4}
                  maxLength={1000}
                  placeholder="Write a warm, helpful response from BodyCream GH…"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  autoFocus
                />
                <div className="muted text-xs" style={{ textAlign: 'right', marginTop: 4 }}>
                  {replyText.length} / 1000
                </div>
              </div>
            </div>

            <div className="rv-modal-foot">
              {replyModal.admin_reply && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ marginRight: 'auto', color: '#f87171' }}
                  disabled={acting === replyModal.id}
                  onClick={() => handleSaveReply('')}
                >
                  Clear Existing Reply
                </button>
              )}
              <button type="button" className="btn btn-outline" onClick={() => setReplyModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-accent"
                disabled={acting === replyModal.id || !replyText.trim()}
                onClick={() => handleSaveReply()}
              >
                {acting === replyModal.id ? 'Publishing…' : 'Publish Public Reply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Audit-Logged Policy Violation Removal Modal ──────────────── */}
      {removeModal && (
        <div
          className="rv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Remove Policy-Violating Review"
          onClick={() => setRemoveModal(null)}
        >
          <div className="rv-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="rv-modal-head">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f87171' }}>
                  ⚑ Remove Review (Policy Violation Only)
                </h3>
                <p className="muted text-xs" style={{ marginTop: 3 }}>
                  Honest critical feedback should receive a <strong>Public Reply</strong>. Policy removals recalculate product ratings and are permanently recorded in the Audit Log.
                </p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setRemoveModal(null)}>✕</button>
            </div>

            <div className="rv-modal-body">
              <div>
                <label htmlFor="rv-violation-type">Policy Violation Category *</label>
                <select
                  id="rv-violation-type"
                  value={removeReason}
                  onChange={e => setRemoveReason(e.target.value)}
                >
                  {POLICY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="rv-violation-note">Audit Note (Optional)</label>
                <input
                  id="rv-violation-note"
                  type="text"
                  placeholder="Specific detail recorded in admin_audit_logs…"
                  value={removeNote}
                  onChange={e => setRemoveNote(e.target.value)}
                />
              </div>
            </div>

            <div className="rv-modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setRemoveModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
                disabled={acting === removeModal.id}
                onClick={handlePolicyRemove}
              >
                {acting === removeModal.id ? 'Removing…' : 'Confirm Audit-Logged Removal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Customer Review Photo Lightbox ───────────────────────────── */}
      {photoLightbox && (
        <div
          className="rv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Customer Review Photo Preview"
          onClick={() => setPhotoLightbox(null)}
        >
          <div style={{ maxWidth: '90vw', maxHeight: '88vh', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <img
              src={photoLightbox.url}
              alt={`${photoLightbox.product} review`}
              style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}
            />
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>
                {photoLightbox.product} · Photo by {photoLightbox.author}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPhotoLightbox(null)}>
                Close ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
