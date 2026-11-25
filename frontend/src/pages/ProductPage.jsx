import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { productsAPI, reviewsAPI } from '../services/api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWishlist } from '../context/WishlistContext';
import { useSettings } from '../context/SettingsContext';
import StarRating from '../components/StarRating';
import ProductCard from '../components/ProductCard';
import { useSeo } from '../utils/seo';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { toFiniteNumber } from '../utils/number';
import './ProductPage.css';

// TO CUSTOMIZE: Placeholder shown when the product has no image
const PLACEHOLDER_IMG = 'https://placehold.co/700x700?text=No+Image';

// TO CUSTOMIZE: Static sell points shown on every product page
const HIGHLIGHTS = [
  'Verified brand distributors',
  'Melanin-rich skin formulas',
  'Paraben & sulfate free',
  'Dermatologist tested',
];

const RECENTLY_VIEWED_KEY = 'bodycream_recently_viewed';
const RECENTLY_VIEWED_MAX = 8;

function saveToRecentlyViewed(product) {
  try {
    const snapshot = {
      id: product.id, name: product.name, price: product.price,
      image_url: product.image_url, category: product.category,
      stock_quantity: product.stock_quantity, avg_rating: product.avg_rating,
      review_count: product.review_count, created_at: product.created_at,
    };
    const existing = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
    const updated = [snapshot, ...existing.filter(p => p.id !== product.id)].slice(0, RECENTLY_VIEWED_MAX);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated));
  } catch { /* storage unavailable */ }
}

function loadRecentlyViewed(excludeId) {
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]').filter(p => p.id !== excludeId);
  } catch { return []; }
}

export default function ProductPage() {
  const { id }          = useParams();
  const { addItem }     = useCart();
  const { user }        = useAuth();
  const { showToast }   = useToast();
  const navigate        = useNavigate();
  const { savedIds, toggle } = useWishlist();
  const settings        = useSettings();
  const freeDeliveryOver = toFiniteNumber(settings?.free_delivery_over, 200);

  const [product, setProduct]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [qty, setQty]           = useState(1);
  const [adding, setAdding]     = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mainImgLoaded, setMainImgLoaded] = useState(false);

  const touchStartX    = useRef(null);
  const lbTouchStartX  = useRef(null);

  const [lightbox, setLightbox] = useState(false);
  const [lbIdx,    setLbIdx]    = useState(0);

  const [related, setRelated]         = useState([]);
  const [recentlyViewed, setRecentlyViewed] = useState([]);

  const [reviews, setReviews]       = useState([]);
  const [reviewMeta, setReviewMeta] = useState({ total: 0, totalPages: 1, summary: null });
  const [reviewForm, setReviewForm] = useState({ rating: 0, title: '', body: '', images: [] });
  const [reviewPhotoModal, setReviewPhotoModal] = useState(null); // { url, alt }
  const [reviewUploading, setReviewUploading]   = useState(false);
  const reviewDialogRef                         = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewSort, setReviewSort] = useState('recent');
  const [reviewPage, setReviewPage] = useState(1);
  const [canReviewData, setCanReviewData] = useState(null); // { can_review, already_reviewed }
  const [expandedReviews, setExpandedReviews] = useState({});
  const [helpfulSent, setHelpfulSent]         = useState({});
  const [countdown, setCountdown] = useState('');

  // Variant data: option_types + variants fetched separately
  const [variantData, setVariantData] = useState(null);
  // Selected option value ID per option type: { [optionTypeId]: optionValueId }
  const [selectedOptions, setSelectedOptions] = useState({});

  useEffect(() => {
    setLoading(true);
    setError('');
    productsAPI.getById(id)
      .then(({ data }) => {
        setProduct(data);
        const imgs = data.images ?? [];
        const primaryIdx = imgs.findIndex(img => img.is_primary);
        setSelectedIdx(primaryIdx >= 0 ? primaryIdx : 0);
        saveToRecentlyViewed(data);
        setRecentlyViewed(loadRecentlyViewed(data.id));
      })
      .catch(() => setError('Could not load product. Please try again.'))
      .finally(() => setLoading(false));
  }, [id, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRelated([]);
    productsAPI.getRelated(id)
      .then(({ data }) => setRelated(data))
      .catch(() => {});
  }, [id]);

  // Fetch variants when product has_variants
  useEffect(() => {
    setVariantData(null);
    setSelectedOptions({});
    if (!product?.has_variants) return;
    productsAPI.getVariants(id)
      .then(({ data }) => {
        setVariantData(data);
        // Pre-select first available in-stock value for each option type
        const init = {};
        data.option_types.forEach(t => {
          const firstAvailable =
            (t.values || []).find(v =>
              data.variants.some(vr =>
                vr.is_active &&
                vr.stock_quantity > 0 &&
                vr.option_values.some(ov => ov.option_value_id === v.id)
              )
            ) ||
            (t.values || []).find(v =>
              data.variants.some(vr =>
                vr.is_active &&
                vr.option_values.some(ov => ov.option_value_id === v.id)
              )
            );
          if (firstAvailable) init[t.id] = firstAvailable.id;
        });
        setSelectedOptions(init);
      })
      .catch(() => {});
  }, [id, product?.has_variants]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReviews = (page = 1, sort = 'recent') =>
    reviewsAPI.getByProduct(id, { page, limit: 10, sort })
      .then(({ data }) => {
        setReviews(prev => page === 1 ? (data.reviews || []) : [...prev, ...(data.reviews || [])]);
        setReviewMeta({ total: data.total, totalPages: data.totalPages, summary: data.summary });
      })
      .catch(() => {});

  useEffect(() => {
    setReviews([]);
    setReviewPage(1);
    setReviewMeta({ total: 0, totalPages: 1, summary: null });
    loadReviews(1, reviewSort);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) { setCanReviewData(null); return; }
    reviewsAPI.canReview(id)
      .then(({ data }) => setCanReviewData(data))
      .catch(() => {});
  }, [id, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live countdown for promotions expiring within 24 hours
  useEffect(() => {
    const endsAt = product?.active_promotion?.ends_at;
    if (!endsAt) { setCountdown(''); return; }
    const msLeft = new Date(endsAt) - Date.now();
    if (msLeft <= 0 || msLeft >= 24 * 60 * 60 * 1000) { setCountdown(''); return; }

    const tick = () => {
      const ms = new Date(endsAt) - Date.now();
      if (ms <= 0) { setCountdown(''); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setCountdown(`Ends in ${h}h ${m}m ${s}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [product]);

  useEffect(() => {
    const dialog = reviewDialogRef.current;
    if (!dialog) return;
    if (reviewPhotoModal) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [reviewPhotoModal]);

  const handleReviewPhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if ((reviewForm.images?.length || 0) + files.length > 3) {
      return showToast('Maximum 3 photos per review.', 'error');
    }
    setReviewUploading(true);
    try {
      const newUrls = [];
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          showToast(`File ${file.name} exceeds 5MB limit.`, 'error');
          continue;
        }
        const fd = new FormData();
        fd.append('media', file);
        const res = await reviewsAPI.uploadPhoto(fd);
        if (res.data?.url) newUrls.push(res.data.url);
      }
      if (newUrls.length > 0) {
        setReviewForm(f => ({ ...f, images: [...(f.images || []), ...newUrls] }));
        showToast('Photo uploaded!', 'success');
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to upload photo.', 'error');
    } finally {
      setReviewUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveReviewPhoto = (index) => {
    setReviewForm(f => ({
      ...f,
      images: (f.images || []).filter((_, i) => i !== index),
    }));
  };

  const submitReview = async (e) => {
    e.preventDefault();
    if (!reviewForm.rating) return showToast('Please select a star rating.', 'error');
    setSubmitting(true);
    try {
      await reviewsAPI.create(id, {
        ...reviewForm,
        images: reviewForm.images || [],
      });
      showToast('Review submitted and awaiting approval.', 'success');
      setReviewForm({ rating: 0, title: '', body: '', images: [] });
      setCanReviewData({ can_review: false, already_reviewed: true });
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to submit review.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleHelpful = async (reviewId) => {
    if (helpfulSent[reviewId]) return;
    setHelpfulSent(prev => ({ ...prev, [reviewId]: true }));
    try {
      await reviewsAPI.markHelpful(id, reviewId);
      setReviews(prev => prev.map(r =>
        r.id === reviewId ? { ...r, helpful_count: (r.helpful_count || 0) + 1 } : r
      ));
    } catch {
      setHelpfulSent(prev => ({ ...prev, [reviewId]: false }));
    }
  };

  const handleSortChange = (newSort) => {
    setReviewSort(newSort);
    setReviewPage(1);
    setReviews([]);
    loadReviews(1, newSort);
  };

  const handleLoadMore = () => {
    const nextPage = reviewPage + 1;
    setReviewPage(nextPage);
    loadReviews(nextPage, reviewSort);
  };

  const handleWishlist = async () => {
    if (!user) { navigate('/login'); return; }
    const nowSaved = await toggle(product.id);
    showToast(nowSaved ? 'Added to wishlist!' : 'Removed from wishlist', 'info');
  };

  // Resolve which variant matches the current option selections
  const selectedVariant = useMemo(() => {
    if (!variantData || !product?.has_variants) return null;
    const typeIds = (variantData.option_types || []).map(t => t.id);
    if (typeIds.length === 0) return null;
    const allSelected = typeIds.every(tid => selectedOptions[tid]);
    if (!allSelected) return null;
    return variantData.variants.find(v =>
      v.option_values.length === typeIds.length &&
      v.option_values.every(ov => selectedOptions[ov.option_type_id] === ov.option_value_id)
    ) || null;
  }, [variantData, selectedOptions, product?.has_variants]);

  const seoConfig = useMemo(() => {
    if (!product) {
      return {
        title: `${settings.store_name || 'BodyCream GH'}`,
        description: settings.hero_subtitle || 'Handcrafted luxury skincare from Ghana.',
      };
    }
    const storeName = settings.store_name || 'BodyCream GH';
    const priceNum = selectedVariant ? parseFloat(selectedVariant.price) : parseFloat(product.price);
    const stockNum = selectedVariant ? selectedVariant.stock_quantity : product.stock_quantity;
    const primaryImg = (product.images || []).find(i => i.is_primary)?.url || product.image_url || '';
    const resolvedImg = resolveImageUrl(primaryImg);
    const absImage = resolvedImg && resolvedImg.startsWith('http')
      ? resolvedImg
      : resolvedImg
        ? `${window.location.origin}${resolvedImg.startsWith('/') ? '' : '/'}${resolvedImg}`
        : undefined;
    const desc = (product.description || `${product.name} — handcrafted in Ghana by ${storeName}.`).slice(0, 160);
    const reviewCount = parseInt(product.review_count || reviewMeta.summary?.review_count || 0, 10);
    const avgRating = parseFloat(product.avg_rating || reviewMeta.summary?.avg_rating || 0);

    const returnDays = Number(settings.return_window_days) || 3;
    const accraFee = Number(settings.delivery_fee_accra) || 25;
    const origin = window.location.origin;

    const jsonLd = [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: desc,
        sku: selectedVariant?.sku || product.sku || String(product.id),
        ...(absImage ? { image: [absImage] } : {}),
        brand: { '@type': 'Brand', name: product.brand || storeName },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'GHS',
          price: Number.isFinite(priceNum) ? priceNum.toFixed(2) : '0.00',
          itemCondition: 'https://schema.org/NewCondition',
          availability: stockNum > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: window.location.href.split('#')[0],
          hasMerchantReturnPolicy: {
            '@type': 'MerchantReturnPolicy',
            applicableCountry: 'GH',
            returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
            merchantReturnDays: returnDays,
            returnMethod: 'https://schema.org/ReturnByMail',
          },
          shippingDetails: {
            '@type': 'OfferShippingDetails',
            shippingRate: {
              '@type': 'MonetaryAmount',
              value: accraFee.toFixed(2),
              currency: 'GHS',
            },
            shippingDestination: {
              '@type': 'DefinedRegion',
              addressCountry: 'GH',
            },
          },
        },
        ...(reviewCount > 0 && avgRating > 0 ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: avgRating.toFixed(1),
            reviewCount,
          },
        } : {}),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: 'Shop', item: `${origin}/shop` },
          ...(product.category
            ? [{ '@type': 'ListItem', position: 3, name: product.category, item: `${origin}/shop?category=${encodeURIComponent(product.category)}` }]
            : []),
          { '@type': 'ListItem', position: product.category ? 4 : 3, name: product.name, item: window.location.href.split('#')[0] },
        ],
      },
    ];

    return {
      title: `${product.name} — ${storeName}`,
      description: desc,
      image: absImage,
      type: 'product',
      jsonLd,
    };
  }, [product, selectedVariant, settings.store_name, settings.hero_subtitle, reviewMeta.summary]);

  useSeo(seoConfig);

  const handleAddToCart = async () => {
    if (product.has_variants && !selectedVariant) {
      showToast('Please select all options before adding to cart.', 'error');
      return;
    }
    setAdding(true);
    try {
      const variantId    = selectedVariant?.id || null;
      const variantLabel = selectedVariant
        ? selectedVariant.option_values.map(ov => ov.value).join(' / ')
        : null;
      const snapshot = {
        ...product,
        variant_price: selectedVariant ? parseFloat(selectedVariant.price) : undefined,
        variant_stock: selectedVariant ? selectedVariant.stock_quantity : undefined,
      };
      await addItem(product.id, qty, snapshot, variantId, variantLabel);
      showToast('Added to cart!', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add item.', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <div className="spinner" style={{ marginTop: '80px' }} />;

  if (error || !product) {
    return (
      <div className="page-section">
        <div className="container" style={{ textAlign: 'center', padding: '60px 0' }}>
          <p style={{ marginBottom: '20px', color: 'var(--color-muted)' }}>
            {error || 'Product not found.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {error && (
              <button
                className="btn btn-accent"
                onClick={() => setRetryCount(c => c + 1)}
              >
                Try Again
              </button>
            )}
            <Link to="/shop" className="btn btn-outline">
              Back to Shop
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const threshold = Number(settings.low_stock_threshold) || 5;
  const isSaved   = savedIds.has(product.id);

  // When a variant is selected, use its price and stock; otherwise use product base values
  const effectivePrice = selectedVariant
    ? parseFloat(selectedVariant.price)
    : parseFloat(product.price);
  const effectiveStock = selectedVariant
    ? selectedVariant.stock_quantity
    : product.stock_quantity;
  const effectiveCompareAt = selectedVariant?.compare_at_price
    ? parseFloat(selectedVariant.compare_at_price)
    : (product.compare_at_price ? parseFloat(product.compare_at_price) : null);

  const isOutOfStock = effectiveStock === 0;
  const isLowStock   = !isOutOfStock && effectiveStock < threshold;

  // Sale / promotion resolution — promotion takes precedence over compare_at_price.
  // When a variant is selected, use the variant's compare_at_price instead.
  const promo = !selectedVariant ? product.active_promotion : null;
  const isSaleByPromo   = promo && parseFloat(promo.discounted_price) < parseFloat(product.price);
  const isSaleByCompare = !isSaleByPromo
    && effectiveCompareAt
    && effectiveCompareAt > effectivePrice;
  const isOnSale = isSaleByPromo || isSaleByCompare;

  let pdpEffectivePrice, pdpOriginalPrice, pdpDiscountPct, pdpSaleBadge;
  if (isSaleByPromo) {
    pdpEffectivePrice = parseFloat(promo.discounted_price);
    pdpOriginalPrice  = parseFloat(product.price);
    pdpDiscountPct    = Math.round((1 - pdpEffectivePrice / pdpOriginalPrice) * 100);
    pdpSaleBadge      = promo.name;
  } else if (isSaleByCompare) {
    pdpEffectivePrice = effectivePrice;
    pdpOriginalPrice  = effectiveCompareAt;
    pdpDiscountPct    = Math.round((1 - pdpEffectivePrice / pdpOriginalPrice) * 100);
    pdpSaleBadge      = 'SALE';
  }
  const galleryImages = product.images?.length ? product.images : [];
  const isMulti       = galleryImages.length > 1;
  const activeUnitPrice = isOnSale ? pdpEffectivePrice : effectivePrice;
  const lineTotalPrice  = activeUnitPrice * qty;
  const unlocksFreeDelivery = freeDeliveryOver > 0 && lineTotalPrice >= freeDeliveryOver;
  const returnDays = Number(settings.return_window_days) || 3;

  const waDigits = String(settings.whatsapp_number || '').replace(/\D/g, '');
  const waFormatted = waDigits.length === 10 && waDigits.startsWith('0')
    ? `233${waDigits.slice(1)}`
    : waDigits;
  const waHref = waFormatted
    ? `https://wa.me/${waFormatted}?text=${encodeURIComponent(
        `Hi ${settings.store_name || 'BodyCream GH'}, I'd like to ask about "${product.name}"${
          selectedVariant ? ` (${selectedVariant.option_values.map(ov => ov.value).join(' / ')})` : ''
        }.`
      )}`
    : null;

  const activeMainImgUrl = selectedVariant?.image_url
    ? resolveImageUrl(selectedVariant.image_url)
    : galleryImages.length > 0
      ? resolveImageUrl(galleryImages[selectedIdx]?.url)
      : (resolveImageUrl(product.image_url) || PLACEHOLDER_IMG);

  const prev = () => { setMainImgLoaded(false); setSelectedIdx(i => Math.max(0, i - 1)); };
  const next = () => { setMainImgLoaded(false); setSelectedIdx(i => Math.min(galleryImages.length - 1, i + 1)); };

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
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/shop">Shop</Link>
          {product.category && (
            <>
              <span>/</span>
              <Link to={`/shop?category=${encodeURIComponent(product.category)}`}>
                {product.category}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="breadcrumb-current">{product.name}</span>
        </nav>

        <div className="product-detail">
          {/* ── Left: Sticky Studio Gallery ──────────────────── */}
          <div className="pdp-media-col">
            {galleryImages.length > 0 ? (
              <div className={`pdp-gallery${isMulti ? ' pdp-gallery--with-thumbs' : ''}`}>
                {/* Thumbnail rail (left on desktop, bottom strip on mobile) */}
                {isMulti && (
                  <div className="pdp-thumbs" role="tablist" aria-label="Select product image">
                    {galleryImages.map((img, i) => (
                      <button
                        key={img.id ?? i}
                        type="button"
                        role="tab"
                        className={`pdp-thumb${i === selectedIdx ? ' pdp-thumb--active' : ''}`}
                        onClick={() => { if (i !== selectedIdx) setMainImgLoaded(false); setSelectedIdx(i); }}
                        aria-label={`Image ${i + 1}${img.is_primary ? ' (primary)' : ''}`}
                        aria-selected={i === selectedIdx}
                      >
                        <img
                          src={resolveImageUrl(img.url)}
                          alt=""
                          onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER_IMG; }}
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* Main studio stage */}
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
                  {isOnSale && (
                    <span className="pdp-stage-badge pdp-stage-badge--sale">
                      {pdpDiscountPct}% OFF
                    </span>
                  )}

                  <button
                    type="button"
                    className={`pdp-stage-wishlist${isSaved ? ' is-saved' : ''}`}
                    onClick={handleWishlist}
                    aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
                    title={isSaved ? 'Saved to wishlist' : 'Save to wishlist'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                    </svg>
                  </button>

                  <div
                    className={`product-detail-img pdp-img--zoomable ${!mainImgLoaded ? 'img-placeholder-shimmer' : ''}`}
                    onClick={() => openLightbox(selectedIdx)}
                    title="Click to enlarge"
                  >
                    <img
                      src={activeMainImgUrl}
                      alt={product.name}
                      fetchpriority="high"
                      className={`img-fade-in ${mainImgLoaded ? 'is-loaded' : ''}`}
                      onLoad={() => setMainImgLoaded(true)}
                      onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER_IMG; setMainImgLoaded(true); }}
                    />
                    <div className="pdp-zoom-pill" aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
                      </svg>
                      <span>Zoom</span>
                    </div>
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
              </div>
            ) : (
              <div className="pdp-slider">
                {isOnSale && (
                  <span className="pdp-stage-badge pdp-stage-badge--sale">
                    {pdpDiscountPct}% OFF
                  </span>
                )}
                <button
                  type="button"
                  className={`pdp-stage-wishlist${isSaved ? ' is-saved' : ''}`}
                  onClick={handleWishlist}
                  aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
                  title={isSaved ? 'Saved to wishlist' : 'Save to wishlist'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                  </svg>
                </button>
                <div
                  className="product-detail-img pdp-img--zoomable"
                  onClick={() => product.image_url && openLightbox(-1)}
                  title={product.image_url ? 'Click to enlarge' : undefined}
                >
                  <img
                    src={activeMainImgUrl}
                    alt={product.name}
                    onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER_IMG; }}
                  />
                  {product.image_url && (
                    <div className="pdp-zoom-pill" aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
                      </svg>
                      <span>Zoom</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Luxury Buy Box ─────────────────────────── */}
          <div className="product-detail-info">
            <div className="pdp-eyebrow-row">
              {product.brand && (
                <Link
                  to={`/shop?brand=${encodeURIComponent(product.brand)}`}
                  className="pdp-brand-pill"
                >
                  {product.brand}
                </Link>
              )}
              {product.category && (
                <Link
                  to={`/shop?category=${encodeURIComponent(product.category)}`}
                  className="pdp-category-tag"
                >
                  {product.category}
                </Link>
              )}
              <span className="pdp-authentic-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                100% Authentic
              </span>
            </div>

            <h1 className="product-detail-name">{product.name}</h1>

            {/* Rating + Live Stock Pill on one clean row */}
            <div className="pdp-meta-row">
              {product.review_count > 0 ? (
                <a href="#customer-reviews" className="product-detail-rating">
                  <StarRating value={parseFloat(product.avg_rating || 0)} size="sm" />
                  <span className="product-detail-rating-label">
                    <strong>{parseFloat(product.avg_rating).toFixed(1)}</strong> ({product.review_count} review{product.review_count !== 1 ? 's' : ''})
                  </span>
                </a>
              ) : (
                <a href="#customer-reviews" className="pdp-first-review-link">
                  ★ Be the first to review
                </a>
              )}

              {isOutOfStock ? (
                <span className="pdp-stock-pill pdp-stock-pill--oos">Out of Stock</span>
              ) : isLowStock ? (
                <span className="pdp-stock-pill pdp-stock-pill--low">
                  <span className="stock-dot stock-dot--low" /> Only {effectiveStock} left
                </span>
              ) : (
                <span className="pdp-stock-pill pdp-stock-pill--in">
                  <span className="stock-dot" /> In Stock · {effectiveStock} ready
                </span>
              )}
            </div>

            {/* Price Block */}
            <div className="pdp-price-block">
              {isOnSale ? (
                <div className="pdp-price-sale">
                  <span className="pdp-price-badge">{pdpSaleBadge}</span>
                  <div className="pdp-price-row">
                    <span className="pdp-price-current">GHS {pdpEffectivePrice.toFixed(2)}</span>
                    <span className="pdp-price-was">GHS {pdpOriginalPrice.toFixed(2)}</span>
                    <span className="pdp-price-off">Save {pdpDiscountPct}%</span>
                  </div>
                  {countdown && !selectedVariant && (
                    <div className="pdp-countdown">{countdown}</div>
                  )}
                </div>
              ) : (
                <div className="pdp-price-standard">
                  {(() => {
                    const activePrices = (variantData?.variants || [])
                      .filter(v => v.is_active !== false)
                      .map(v => parseFloat(v.price))
                      .filter(n => !Number.isNaN(n));
                    const minP = activePrices.length > 0
                      ? Math.min(...activePrices)
                      : (product.min_price != null ? parseFloat(product.min_price) : parseFloat(product.price));
                    const maxP = activePrices.length > 0
                      ? Math.max(...activePrices)
                      : (product.max_price != null ? parseFloat(product.max_price) : minP);
                    const hasRange = product.has_variants && maxP > minP;

                    if (product.has_variants && !selectedVariant) {
                      return (
                        <span className="product-detail-price">
                          {hasRange ? `GHS ${minP.toFixed(2)} – GHS ${maxP.toFixed(2)}` : `GHS ${minP.toFixed(2)}`}
                        </span>
                      );
                    }
                    return (
                      <div className="pdp-price-inline">
                        <span className="product-detail-price">GHS {effectivePrice.toFixed(2)}</span>
                        {hasRange && (
                          <span className="pdp-price-range-chip">
                            Sizes from GHS {minP.toFixed(0)} – {maxP.toFixed(0)}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {product.description && (
              <p className="product-detail-desc">{product.description}</p>
            )}

            {/* ── Variant selector (with per-option price preview when 1 option type) ── */}
            {variantData && (variantData.option_types || []).length > 0 && (
              <div className="pdp-variant-selector">
                {variantData.option_types.map(optType => {
                  const singleOptionGroup = variantData.option_types.length === 1;
                  const selectedValLabel = (optType.values || []).find(v => v.id === selectedOptions[optType.id])?.value;
                  return (
                    <div key={optType.id} className="pdp-variant-group">
                      <div className="pdp-variant-label">
                        <span>
                          Select {optType.name}:
                          {selectedValLabel && (
                            <strong className="pdp-variant-selected-val"> {selectedValLabel}</strong>
                          )}
                        </span>
                      </div>
                      <div className="pdp-variant-options">
                        {(optType.values || []).map(val => {
                          const isSelected = selectedOptions[optType.id] === val.id;
                          const matchingVariant = singleOptionGroup
                            ? variantData.variants.find(v =>
                                v.is_active &&
                                v.option_values.some(ov => ov.option_value_id === val.id)
                              )
                            : null;
                          const hasStock = variantData.variants.some(v =>
                            v.is_active &&
                            v.stock_quantity > 0 &&
                            v.option_values.some(ov => ov.option_value_id === val.id)
                          );
                          return (
                            <button
                              key={val.id}
                              type="button"
                              disabled={!hasStock}
                              className={`pdp-variant-btn${isSelected ? ' pdp-variant-btn--selected' : ''}${!hasStock ? ' pdp-variant-btn--oos' : ''}`}
                              onClick={() => {
                                setSelectedOptions(prevOpts => ({ ...prevOpts, [optType.id]: val.id }));
                                setQty(1);
                              }}
                            >
                              <span className="pdp-variant-btn-name">{val.value}</span>
                              {matchingVariant && (
                                <span className="pdp-variant-btn-price">
                                  GHS {parseFloat(matchingVariant.price).toFixed(0)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {product.has_variants && !selectedVariant && (
                  <p className="pdp-variant-prompt">Please select an option above to add to cart.</p>
                )}
              </div>
            )}

            {/* ── Unified Purchase Action Row: [ − 1 + ] [ Add to Cart · GHS X ] [ ♡ ] ── */}
            <div className="pdp-purchase-box">
              <div className="pdp-purchase-row">
                {!isOutOfStock && (!product.has_variants || selectedVariant) && (
                  <div className="qty-control" role="group" aria-label="Quantity">
                    <button
                      type="button"
                      onClick={() => setQty(q => Math.max(1, q - 1))}
                      disabled={qty <= 1}
                      aria-label="Decrease quantity"
                    >−</button>
                    <input
                      id="qty"
                      name="quantity"
                      type="number"
                      aria-label="Quantity"
                      min={1}
                      max={effectiveStock}
                      value={qty}
                      onChange={e =>
                        setQty(Math.min(
                          effectiveStock,
                          Math.max(1, parseInt(e.target.value) || 1)
                        ))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setQty(q => Math.min(effectiveStock, q + 1))}
                      disabled={qty >= effectiveStock}
                      aria-label="Increase quantity"
                    >+</button>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-accent pdp-add-btn"
                  onClick={handleAddToCart}
                  disabled={isOutOfStock || adding || (product.has_variants && !selectedVariant)}
                >
                  {adding ? (
                    'Adding…'
                  ) : isOutOfStock ? (
                    'Out of Stock'
                  ) : product.has_variants && !selectedVariant ? (
                    'Select Options'
                  ) : (
                    <>
                      <span>Add to Cart</span>
                      <span className="pdp-add-btn-sep">·</span>
                      <span>GHS {lineTotalPrice.toFixed(2)}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className={`pdp-wishlist-icon-btn${isSaved ? ' pdp-wishlist-icon-btn--saved' : ''}`}
                  onClick={handleWishlist}
                  aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
                  title={isSaved ? 'Saved to Wishlist' : 'Add to Wishlist'}
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                  </svg>
                </button>
              </div>

              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pdp-wa-assist-link"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.52 3.48A11.86 11.86 0 0012.06 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.15 1.6 5.95L0 24l6.32-1.66a11.9 11.9 0 005.74 1.46h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.17-3.44-8.42z"/>
                  </svg>
                  <span>Questions or quick order? Chat with a beauty advisor on WhatsApp →</span>
                </a>
              )}
            </div>

            {/* ── Fulfilment, MoMo/COD Payment & Return Assurance Card ── */}
            <div className="pdp-assurance-card">
              <div className="pdp-assurance-row">
                <span className="pdp-assurance-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                  </svg>
                </span>
                <div className="pdp-assurance-text">
                  <strong>
                    {settings.delivery_estimate_accra
                      ? `Accra ${settings.delivery_estimate_accra} · Nationwide ${settings.delivery_estimate_nationwide}`
                      : 'Accra 1–2 business days · Nationwide 3–5 business days'}
                  </strong>
                  <span>
                    {freeDeliveryOver > 0
                      ? unlocksFreeDelivery
                        ? '✓ Qualifies for FREE Delivery!'
                        : `Free delivery on orders over GHS ${freeDeliveryOver}`
                      : 'Fast tracked rider dispatch across Ghana'}
                  </span>
                </div>
              </div>

              <div className="pdp-assurance-row">
                <span className="pdp-assurance-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
                  </svg>
                </span>
                <div className="pdp-assurance-text">
                  <strong>Flexible Ghana Checkout</strong>
                  <div className="pdp-payment-pills">
                    <span>MTN MoMo</span>
                    <span>Telecel Cash</span>
                    <span>Visa / Card</span>
                    <span>Pay on Delivery</span>
                  </div>
                </div>
              </div>

              <div className="pdp-assurance-row">
                <span className="pdp-assurance-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>
                  </svg>
                </span>
                <div className="pdp-assurance-text">
                  <strong>{returnDays}-Day Hassle-Free Returns &amp; Verified Authentic</strong>
                  <span>Sealed authentic stock sourced from authorized brand distributors</span>
                </div>
              </div>
            </div>

            {/* Compact 2x2 Highlights Grid */}
            <ul className="product-highlights-grid">
              {HIGHLIGHTS.map(h => (
                <li key={h}>
                  <span className="pdp-highlight-check" aria-hidden="true">✦</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            {/* ── Structured Beauty D2C Accordions (searchable native <details>) ── */}
            <section className="pdp-accordions" aria-label="Product details and care">
              <details className="pdp-accordion-item" open>
                <summary>Key Botanicals &amp; Ingredients</summary>
                <div className="pdp-accordion-body">
                  <p>
                    {product.ingredients_inci ||
                      'Formulated with quality cosmetic ingredients and sourced directly from verified brand distributors.'}
                  </p>
                </div>
              </details>
              <details className="pdp-accordion-item">
                <summary>How to Use / Daily Ritual</summary>
                <div className="pdp-accordion-body">
                  <p>
                    {product.how_to_use ||
                      'Warm a small amount between palms and massage onto clean skin as part of your daily morning or evening routine.'}
                  </p>
                </div>
              </details>
              <details className="pdp-accordion-item">
                <summary>Safety &amp; Skin Compatibility</summary>
                <div className="pdp-accordion-body">
                  <p>
                    {product.safety_notes ||
                      'For external cosmetic use only. Patch-test on a small area before full application. Store in a cool, dry place away from direct sunlight.'}
                  </p>
                </div>
              </details>
            </section>
          </div>
        </div>
      </div>

      {/* ── Related products ─────────────────────────────────── */}
      {related.length > 0 && (
        <section className="container pdp-strip-section" aria-label="Related products">
          <div className="pdp-section-head">
            <div>
              <span className="section-label">Complete Your Ritual</span>
              <h2 className="pdp-strip-heading">You may also like</h2>
            </div>
            <Link to={product.category ? `/shop?category=${encodeURIComponent(product.category)}` : '/shop'} className="pdp-section-link">
              View more →
            </Link>
          </div>
          <div className="pdp-card-grid">
            {related.slice(0, 4).map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* ── Reviews ──────────────────────────────────────────── */}
      <section id="customer-reviews" className="container reviews-section" aria-label="Customer reviews">
        <div className="pdp-section-head">
          <div>
            <span className="section-label">Verified Feedback</span>
            <h2 className="reviews-heading">Customer Reviews</h2>
          </div>
        </div>

        {reviews.length === 0 && reviewMeta.total === 0 ? (
          <div className="reviews-empty-banner">
            <div className="reviews-empty-copy">
              <div className="reviews-empty-stars" aria-hidden="true">★★★★★</div>
              <h3>Be the first to review {product.name}</h3>
              <p>
                Have you tried this formula? Verified customers can share honest ratings, skin-type notes, and swatch photos.
              </p>
            </div>
            <div className="reviews-empty-cta">
              {!user ? (
                <Link to="/login" className="btn btn-outline">
                  Sign In to Write a Review
                </Link>
              ) : canReviewData?.already_reviewed ? (
                <div className="review-already-done">
                  <span>✓</span> Your review has been submitted and is awaiting approval.
                </div>
              ) : canReviewData?.can_review ? (
                <span className="pdp-authentic-pill">Share your review below ↓</span>
              ) : (
                <span className="reviews-verified-note">✓ Verified purchasers can post reviews after delivery</span>
              )}
            </div>
          </div>
        ) : (
          <div className="reviews-layout">
            {/* ── Summary + distribution ── */}
            {reviewMeta.summary && reviewMeta.summary.review_count > 0 && (
              <div className="reviews-summary">
                <div className="reviews-avg">{parseFloat(reviewMeta.summary.avg_rating).toFixed(1)}</div>
                <StarRating value={parseFloat(reviewMeta.summary.avg_rating)} size="lg" />
                <div className="reviews-count">
                  Based on {reviewMeta.summary.review_count} review{reviewMeta.summary.review_count !== 1 ? 's' : ''}
                </div>

                {/* Distribution bars */}
                <div className="reviews-distribution">
                  {[5,4,3,2,1].map(star => {
                    const count = reviewMeta.summary.distribution[star] || 0;
                    const pct   = reviewMeta.summary.review_count > 0
                      ? Math.round((count / reviewMeta.summary.review_count) * 100) : 0;
                    return (
                      <div key={star} className="reviews-dist-row">
                        <span className="reviews-dist-label">{star} ★</span>
                        <div className="reviews-dist-bar-wrap">
                          <div className="reviews-dist-bar" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="reviews-dist-pct">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Review list ── */}
            <div className="reviews-list">
              {reviews.length > 0 && (
                <div className="reviews-sort">
                  <span className="reviews-sort-label">Sort:</span>
                  {[
                    { key: 'recent',  label: 'Most Recent' },
                    { key: 'helpful', label: 'Most Helpful' },
                    { key: 'highest', label: 'Highest Rated' },
                    { key: 'lowest',  label: 'Lowest Rated' },
                  ].map(s => (
                    <button
                      key={s.key}
                      className={`reviews-sort-btn${reviewSort === s.key ? ' reviews-sort-btn--active' : ''}`}
                      onClick={() => handleSortChange(s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              {reviews.map(r => {
                const isLong    = r.body && r.body.length > 200;
                const expanded  = expandedReviews[r.id];
                const bodyText  = isLong && !expanded ? r.body.slice(0, 200) + '…' : r.body;
                const relDate   = (() => {
                  const diff = Date.now() - new Date(r.created_at).getTime();
                  const days = Math.floor(diff / 86400000);
                  if (days < 1)   return 'Today';
                  if (days < 7)   return `${days} day${days !== 1 ? 's' : ''} ago`;
                  if (days < 30)  return `${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''} ago`;
                  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) !== 1 ? 's' : ''} ago`;
                  return `${Math.floor(days / 365)} year${Math.floor(days / 365) !== 1 ? 's' : ''} ago`;
                })();

                return (
                  <div key={r.id} className="review-card">
                    <div className="review-header">
                      <StarRating value={r.rating} size="sm" />
                      <span className="review-verified">✓ Verified Purchase</span>
                    </div>
                    <div className="review-meta">
                      <span className="review-author">{r.first_name} {r.last_initial}.</span>
                      <span className="review-date">{relDate}</span>
                    </div>
                    {r.title && <div className="review-title">{r.title}</div>}
                    {r.body && (
                      <p className="review-body">
                        {bodyText}
                        {isLong && (
                          <button
                            className="review-expand-btn"
                            onClick={() => setExpandedReviews(prev => ({ ...prev, [r.id]: !expanded }))}
                          >
                            {expanded ? ' Show less' : ' Read more'}
                          </button>
                        )}
                      </p>
                    )}
                    {Array.isArray(r.images) && r.images.length > 0 && (
                      <div className="review-images-row" role="group" aria-label="Customer review photos">
                        {r.images.map((imgUrl, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="review-thumb-btn"
                            onClick={() => setReviewPhotoModal({ url: resolveImageUrl(imgUrl), alt: `${r.title || 'Review'} photo ${idx + 1}` })}
                            aria-label={`View photo ${idx + 1} full screen`}
                          >
                            <img src={resolveImageUrl(imgUrl)} alt="" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    )}
                    {r.admin_reply && (
                      <div
                        style={{
                          marginTop: 10,
                          marginBottom: 10,
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: 'var(--color-bg-subtle, #f8f5ef)',
                          borderLeft: '3px solid var(--color-accent, #c9a55a)',
                          fontSize: '0.86rem',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-accent-dark, #9a7428)', marginBottom: 4 }}>
                          Response from {settings.store_name || 'BodyCream GH'}
                          {r.admin_reply_at ? ` · ${new Date(r.admin_reply_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                        </div>
                        <div style={{ color: 'var(--color-ink, #1f1b16)', lineHeight: 1.5 }}>{r.admin_reply}</div>
                      </div>
                    )}
                    <button
                      className={`review-helpful-btn${helpfulSent[r.id] ? ' review-helpful-btn--sent' : ''}`}
                      onClick={() => handleHelpful(r.id)}
                      disabled={helpfulSent[r.id]}
                    >
                      {helpfulSent[r.id] ? '✓ Marked helpful' : `Helpful? Yes (${r.helpful_count || 0})`}
                    </button>
                  </div>
                );
              })}

              {reviewPage < reviewMeta.totalPages && (
                <button className="reviews-load-more" onClick={handleLoadMore}>
                  Load more reviews
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Write a review (shown below existing reviews, or inline if eligible buyer on 0-review product) ── */}
        {(reviews.length > 0 || reviewMeta.total > 0 || canReviewData?.can_review) && (
          <div className="reviews-write-section">
            {!user ? (
              <div className="review-login-prompt">
                <p>Want to share your experience?</p>
                <Link to="/login" className="btn btn-outline">Log in to leave a review</Link>
              </div>
            ) : canReviewData === null ? null : canReviewData.already_reviewed ? (
              <div className="review-already-done">
                <span>✓</span> Your review has been submitted and is awaiting approval.
              </div>
            ) : canReviewData.can_review ? (
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
                  <label htmlFor="review-title">Title <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span></label>
                  <input
                    id="review-title"
                    name="title"
                    type="text"
                    maxLength={120}
                    placeholder="Summarise your experience"
                    value={reviewForm.title}
                    onChange={e => setReviewForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="review-body">Review <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span></label>
                  <textarea
                    id="review-body"
                    name="body"
                    rows={4}
                    placeholder="What did you think of the product?"
                    value={reviewForm.body}
                    onChange={e => setReviewForm(f => ({ ...f, body: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Photos / Swatches <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional, up to 3)</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
                      {reviewUploading ? 'Uploading…' : '+ Add Photo'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        disabled={reviewUploading || (reviewForm.images?.length || 0) >= 3}
                        onChange={handleReviewPhotoUpload}
                      />
                    </label>
                    <span className="muted text-xs">JPG, PNG, or WebP up to 5MB</span>
                  </div>
                  {Array.isArray(reviewForm.images) && reviewForm.images.length > 0 && (
                    <div className="review-upload-previews">
                      {reviewForm.images.map((url, i) => (
                        <div key={i} className="review-upload-thumb">
                          <img src={resolveImageUrl(url)} alt={`Upload preview ${i + 1}`} />
                          <button
                            type="button"
                            className="review-upload-remove"
                            onClick={() => handleRemoveReviewPhoto(i)}
                            aria-label="Remove photo"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="submit" className="btn btn-accent" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Review'}
                </button>
              </form>
            ) : (
              <div className="review-not-purchased">
                Purchase this product to leave a review.
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Recently viewed ──────────────────────────────────── */}
      {recentlyViewed.length > 0 && (
        <section className="container pdp-strip-section pdp-strip-section--last" aria-label="Recently viewed products">
          <div className="pdp-section-head">
            <div>
              <span className="section-label">Your History</span>
              <h2 className="pdp-strip-heading">Recently Viewed</h2>
            </div>
          </div>
          <div className="pdp-card-grid">
            {recentlyViewed.slice(0, 4).map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* ── Sticky Mobile Add-to-Cart Bar ───────────────── */}
      <div className="pdp-sticky-mobile-bar" role="region" aria-label="Quick add to cart">
        <div className="pdp-sticky-mobile-info">
          <span className="pdp-sticky-mobile-name">{product.name}</span>
          <span className="pdp-sticky-mobile-price">
            {qty > 1 ? `${qty} × ` : ''}GHS {lineTotalPrice.toFixed(2)}
            {selectedVariant
              ? ` · ${selectedVariant.option_values.map(ov => ov.value).join(' / ')}`
              : ''}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-accent pdp-sticky-mobile-btn"
          onClick={handleAddToCart}
          disabled={isOutOfStock || adding || (product.has_variants && !selectedVariant)}
        >
          {adding ? 'Adding…'
            : isOutOfStock ? 'Out of Stock'
            : product.has_variants && !selectedVariant ? 'Select Size'
            : 'Add to Cart'}
        </button>
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
                  ? (resolveImageUrl(product.image_url) || PLACEHOLDER_IMG)
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

      {/* ── Accessible Review Photo Lightbox Modal ──────── */}
      <dialog
        ref={reviewDialogRef}
        className="review-lightbox-dialog"
        closedby="any"
        aria-label="Customer review photo preview"
        onClick={e => {
          if (e.target === reviewDialogRef.current) setReviewPhotoModal(null);
        }}
        onClose={() => setReviewPhotoModal(null)}
      >
        {reviewPhotoModal && (
          <div className="review-lightbox-inner">
            <button
              type="button"
              className="review-lightbox-close"
              onClick={() => setReviewPhotoModal(null)}
              aria-label="Close photo preview"
            >
              ✕
            </button>
            <img
              src={reviewPhotoModal.url}
              alt={reviewPhotoModal.alt || 'Review photo'}
              className="review-lightbox-img"
            />
          </div>
        )}
      </dialog>
    </div>
  );
}
