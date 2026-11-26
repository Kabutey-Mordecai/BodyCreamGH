import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { productsAPI, newsletterAPI, reviewsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useSeo } from '../utils/seo';
import ProductShelf from '../components/ProductShelf';
import ProductCard from '../components/ProductCard';
import StarRating from '../components/StarRating';
import HomeFaq, { buildFaqItems } from '../components/HomeFaq';
import Reveal from '../components/Reveal';
import CampaignBroadcastBanner from '../components/CampaignBroadcastBanner';
import CampaignTiles from '../components/CampaignTiles';
import FeaturedSpotlight from '../components/FeaturedSpotlight';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './Home.css';

// Protected lazy-load to prevent adblockers from halting storefront render
const SpecialOfferModal = lazy(() =>
  import('../components/SpecialOfferModal').catch(() => ({ default: () => null }))
);

const RECENTLY_VIEWED_KEY = 'bodycream_recently_viewed';

function loadRecentlyViewed() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(p => p && p.id && p.name) : [];
  } catch {
    return [];
  }
}

// Default fallback countdown — ends at 11:59 PM today when no promotion ends_at is set
const DEFAULT_SALE_END_TIME = (() => {
  const d = new Date();
  d.setHours(23, 59, 59, 0);
  return d.getTime();
})();

function getTimeLeft(endTime) {
  const total = Math.max(0, endTime - Date.now());
  return {
    total,
    hours:   Math.floor(total / (1000 * 60 * 60)),
    minutes: Math.floor((total % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((total % (1000 * 60)) / 1000),
  };
}

// Isolated timer component so the 1-second tick does NOT re-render the full Home page.
function FlashSaleTimer({ endTime = DEFAULT_SALE_END_TIME }) {
  const targetTime = endTime && endTime > Date.now() ? endTime : DEFAULT_SALE_END_TIME;
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(targetTime));
  useEffect(() => {
    setTimeLeft(getTimeLeft(targetTime));
    const id = setInterval(() => setTimeLeft(getTimeLeft(targetTime)), 1000);
    return () => clearInterval(id);
  }, [targetTime]);
  return (
    <div className="flash-sale-timer">
      <span className="timer-label">Ends in</span>
      <div className="countdown">
        <div className="countdown-block">
          <span className="countdown-value">{String(timeLeft.hours).padStart(2, '0')}</span>
          <span className="countdown-label">HRS</span>
        </div>
        <span className="countdown-sep">:</span>
        <div className="countdown-block">
          <span className="countdown-value">{String(timeLeft.minutes).padStart(2, '0')}</span>
          <span className="countdown-label">MIN</span>
        </div>
        <span className="countdown-sep">:</span>
        <div className="countdown-block">
          <span className="countdown-value">{String(timeLeft.seconds).padStart(2, '0')}</span>
          <span className="countdown-label">SEC</span>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_HERO_IMG = 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1600&q=85';

export default function Home() {
  const { user } = useAuth();
  const settings = useSettings();
  const {
    store_name, hero_label, hero_headline, hero_subtitle, hero_cta_text, hero_cta_link, hero_image, hero_video,
    categories, testimonials,
  } = settings;
  const [videoFailed, setVideoFailed]       = useState(false);
  const [featured, setFeatured]             = useState([]);
  const [brands, setBrands]                 = useState([]);
  const [customerReviews, setCustomerReviews] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [saleProducts, setSaleProducts]     = useState([]);
  const [flashEndTime, setFlashEndTime]     = useState(DEFAULT_SALE_END_TIME);
  const [recentlyViewed, setRecentlyViewed] = useState(() => loadRecentlyViewed());
  const [nlEmail, setNlEmail]               = useState('');
  const [nlState, setNlState]               = useState('idle'); // idle | loading | success | error
  const [nlError, setNlError]               = useState('');
  const [nlCouponCode, setNlCouponCode]     = useState('');
  const [hideNewsletterBar, setHideNewsletterBar] = useState(() => {
    try {
      return localStorage.getItem('bc_newsletter_subscribed') === 'true' ||
        localStorage.getItem('bc_first_order_done') === 'true';
    } catch {
      return false;
    }
  });
  const [activeCategoryTab, setActiveCategoryTab] = useState('All');

  const filteredFeatured = useMemo(() => {
    if (activeCategoryTab === 'All') return featured;
    return featured.filter(p => p.category && p.category.toLowerCase() === activeCategoryTab.toLowerCase());
  }, [featured, activeCategoryTab]);

  const heroSrcSet = useMemo(() => {
    const base = hero_image || DEFAULT_HERO_IMG;
    if (!base || !base.includes('images.unsplash.com')) return undefined;
    const clean = base.split('?')[0];
    return `${clean}?auto=format&fit=crop&w=640&q=80 640w, ${clean}?auto=format&fit=crop&w=1024&q=80 1024w, ${clean}?auto=format&fit=crop&w=1600&q=85 1600w`;
  }, [hero_image]);

  const clearRecentlyViewed = () => {
    try { localStorage.removeItem(RECENTLY_VIEWED_KEY); } catch { /* ignore */ }
    setRecentlyViewed([]);
  };

  const homeJsonLd = useMemo(() => {
    const faqEnabled = settings.faq_enabled !== false && settings.faq_enabled !== 'false';
    const faqItems = faqEnabled ? buildFaqItems(settings) : [];
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: store_name || 'BodyCream GH',
          url: window.location.origin,
        },
        {
          '@type': 'WebSite',
          name: store_name || 'BodyCream GH',
          url: window.location.origin,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${window.location.origin}/shop?search={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        },
        ...(faqItems.length > 0 ? [{
          '@type': 'FAQPage',
          mainEntity: faqItems.map(item => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.a,
            },
          })),
        }] : []),
      ],
    };
  }, [settings, store_name]);

  useSeo({
    title: `${store_name || 'BodyCream GH'} — Authentic Cosmetics, Skincare & Makeup`,
    description: hero_subtitle || 'Shop 100% authentic skincare, makeup, haircare, body care, and fragrances.',
    image: hero_image || DEFAULT_HERO_IMG,
    jsonLd: homeJsonLd,
  });

  const fetchDealsAndProducts = () => {
    productsAPI.getAll({ limit: 24, sort: 'top_rated' })
      .then(({ data }) => setFeatured(data.products || data))
      .catch(console.error)
      .finally(() => setLoading(false));

    productsAPI.getAll({ on_sale: 'true', limit: 16 })
      .then(({ data }) => {
        const list = data.products || (Array.isArray(data) ? data : []);
        const realDeals = list.filter(p =>
          (p.active_promotion && parseFloat(p.active_promotion.discounted_price) < parseFloat(p.price)) ||
          (p.compare_at_price && parseFloat(p.compare_at_price) > parseFloat(p.price))
        );
        // Only display products that are genuinely on promotion or discounted.
        // If all promotions have been removed in the admin panel, cleanly empty the list.
        setSaleProducts(realDeals.slice(0, 12));

        const promoEnds = realDeals
          .map(p => p.active_promotion?.ends_at ? new Date(p.active_promotion.ends_at).getTime() : null)
          .filter(t => Number.isFinite(t) && t > Date.now())
          .sort((a, b) => a - b);
        if (promoEnds.length > 0) {
          setFlashEndTime(promoEnds[0]);
        } else {
          setFlashEndTime(null);
        }
      })
      .catch(() => {});

    reviewsAPI.getFeatured({ limit: 8 })
      .then(({ data }) => setCustomerReviews(data.reviews || []))
      .catch(() => {});

    productsAPI.getBrands()
      .then(({ data }) => setBrands(Array.isArray(data?.details) ? data.details : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchDealsAndProducts();

    // Re-fetch immediately when the tab regains focus or visibility
    // (e.g. store owner switching from Admin tab back to Storefront)
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchDealsAndProducts();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, []);

  useEffect(() => {
    let savedEmail = '';
    try { savedEmail = localStorage.getItem('bc_newsletter_email') || ''; } catch {}
    if (!user && !savedEmail) return;

    newsletterAPI.status(user?.email || savedEmail)
      .then(({ data }) => {
        if (data?.shouldHideBar) {
          setHideNewsletterBar(true);
        }
        try {
          if (data?.hasPlacedOrder) {
            localStorage.setItem('bc_first_order_done', 'true');
            localStorage.removeItem('bc_welcome_coupon');
          } else if (data?.eligibleForWelcomeDiscount && data?.couponCode) {
            localStorage.setItem('bc_welcome_coupon', data.couponCode);
          }
        } catch {}
      })
      .catch(() => {});
  }, [user]);

  const handleNewsletterSubmit = async (e) => {
    e.preventDefault();
    if (nlState === 'loading') return;
    setNlState('loading');
    setNlError('');
    try {
      const cleanEmail = nlEmail.trim();
      const { data } = await newsletterAPI.subscribe(cleanEmail);
      setNlState('success');
      setNlEmail('');
      try {
        localStorage.setItem('bc_newsletter_subscribed', 'true');
        localStorage.setItem('bc_newsletter_email', cleanEmail);
        if (data?.isFirstOrderEligible && data?.couponCode) {
          localStorage.setItem('bc_welcome_coupon', data.couponCode);
          setNlCouponCode(data.couponCode);
        } else {
          localStorage.removeItem('bc_welcome_coupon');
          localStorage.setItem('bc_first_order_done', 'true');
        }
      } catch {}
    } catch (err) {
      setNlState('error');
      setNlError(err.response?.data?.error || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div>
      {/* ══════════════════════════════════════════
          PROMOTIONAL POPUP MODAL (Admin controlled)
          ══════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <SpecialOfferModal />
      </Suspense>

      {/* ══════════════════════════════════════════
          CAMPAIGN BROADCAST BANNER (Jumia / Mega Sale Style)
          ══════════════════════════════════════════ */}
      <CampaignBroadcastBanner />

      {/* ══════════════════════════════════════════
          HERO — full-viewport, high-priority LCP img
          ══════════════════════════════════════════ */}
      <section className="hero">
        {hero_video && !videoFailed ? (
          <video
            src={resolveImageUrl(hero_video)}
            poster={resolveImageUrl(hero_image || DEFAULT_HERO_IMG)}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
            className="hero-bg-video"
            onError={() => setVideoFailed(true)}
          />
        ) : (
          <img
            src={resolveImageUrl(hero_image || DEFAULT_HERO_IMG)}
            srcSet={heroSrcSet}
            sizes="100vw"
            alt=""
            aria-hidden="true"
            className="hero-bg-img hero-ken-burns"
            fetchpriority="high"
            decoding="sync"
          />
        )}
        <div className="hero-overlay" />
        <div className="hero-orb hero-orb--one" aria-hidden="true" />
        <div className="hero-orb hero-orb--two" aria-hidden="true" />
        <div className="container hero-grid hero-grid--minimal">
          <div className="hero-content">
            <span className="hero-label">
              <span className="hero-live-dot" aria-hidden="true" />
              {hero_label}
            </span>
            <h1>{hero_headline}</h1>
            <p>{hero_subtitle}</p>
            <div className="hero-actions">
              <Link to={hero_cta_link || '/shop'} className="btn btn-accent hero-cta">
                {hero_cta_text} →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          CAMPAIGN TILES — 2-up category promotional cards
          ══════════════════════════════════════════ */}
      <CampaignTiles />

      {/* ══════════════════════════════════════════
          FLASH SALE — countdown timer + deals shelf
          ══════════════════════════════════════════ */}
      {settings.flash_sale_enabled !== false && settings.flash_sale_enabled !== 'false' && saleProducts.length > 0 && (
        <section className="flash-sale-section" aria-labelledby="flash-sale-heading">
          <Reveal className="container">
            <div className="flash-sale-header">
              <div className="flash-sale-title">
                <span className="flash-badge">{settings.flash_sale_badge || 'Flash Sale'}</span>
                <h2 id="flash-sale-heading">{settings.flash_sale_title || "Today's Deals"}</h2>
              </div>
              <FlashSaleTimer endTime={flashEndTime} />
            </div>
            <ProductShelf products={saleProducts} ariaLabel={settings.flash_sale_title || "Today's Deals"} dark />
            <div style={{ textAlign: 'center', marginTop: '28px' }}>
              <Link to="/shop?on_sale=true" className="btn btn-outline-gold">
                See All Deals ({saleProducts.length}) →
              </Link>
            </div>
          </Reveal>
        </section>
      )}

      {/* ══════════════════════════════════════════
          FEATURED PRODUCTS — buyable right below Hero/Deals
          ══════════════════════════════════════════ */}
      <section className="page-section featured-section">
        <Reveal className="container">
          <div className="section-header">
            <span className="section-label">Bestsellers</span>
            <h2 className="page-title">Loved by thousands</h2>
            <div className="gold-divider" style={{ margin: '0 0 16px' }} />
            <p className="page-subtitle">
              Our most-reordered creams — made for melanin-rich skin and Ghana's climate.
            </p>

            {/* Category Filter Tabs */}
            <div className="home-category-tabs" role="tablist" aria-label="Filter products by category">
              <button
                type="button"
                className={`home-cat-tab ${activeCategoryTab === 'All' ? 'active' : ''}`}
                onClick={() => setActiveCategoryTab('All')}
                role="tab"
                aria-selected={activeCategoryTab === 'All'}
              >
                All
              </button>
              {(categories || []).map(cat => (
                <button
                  key={cat.label}
                  type="button"
                  className={`home-cat-tab ${activeCategoryTab.toLowerCase() === cat.label.toLowerCase() ? 'active' : ''}`}
                  onClick={() => setActiveCategoryTab(cat.label)}
                  role="tab"
                  aria-selected={activeCategoryTab.toLowerCase() === cat.label.toLowerCase()}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="spinner" />
          ) : filteredFeatured.length > 0 ? (
            <>
              {/* Desktop Horizontal Shelf */}
              <div className="home-desktop-shelf">
                <ProductShelf
                  products={filteredFeatured}
                  ariaLabel={activeCategoryTab === 'All' ? 'Bestsellers' : `${activeCategoryTab} products`}
                />
              </div>

              {/* Mobile 2-Column Balanced Catalog Grid */}
              <div className="home-mobile-product-grid" role="region" aria-label="Bestsellers grid">
                {filteredFeatured.slice(0, 6).map(p => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>

              <div className="view-all-wrap">
                <Link
                  to={activeCategoryTab === 'All' ? '/shop' : `/shop?category=${encodeURIComponent(activeCategoryTab)}`}
                  className="btn btn-outline"
                >
                  View All {activeCategoryTab === 'All' ? 'Collection' : activeCategoryTab} ({filteredFeatured.length}) →
                </Link>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--color-muted)' }}>
              <p style={{ fontSize: '1rem', marginBottom: '18px' }}>
                No featured products in <strong>{activeCategoryTab}</strong> at the moment.
              </p>
              <Link
                to={`/shop?category=${encodeURIComponent(activeCategoryTab)}`}
                className="btn btn-outline"
              >
                Browse all {activeCategoryTab} in Shop →
              </Link>
            </div>
          )}
        </Reveal>
      </section>

      {/* ══════════════════════════════════════════
          COMPACT CATEGORY & BRAND STRIP
          ══════════════════════════════════════════ */}
      <section className="home-cat-strip-section">
        <Reveal className="container">
          <div className="home-cat-strip-head">
            <span className="section-label" style={{ marginBottom: 0 }}>Browse by category</span>
            <Link to="/shop" style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--color-accent-dark)', textDecoration: 'none' }}>
              {brands.length > 0 ? `Shop all ${brands.length} brands →` : 'Explore full catalog →'}
            </Link>
          </div>
          <div className="home-cat-strip">
            {(categories || []).map(cat => (
              <Link
                key={cat.label}
                to={`/shop?category=${encodeURIComponent(cat.label)}`}
                className="home-cat-pill"
              >
                {cat.label}
              </Link>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ══════════════════════════════════════════
          RECENTLY VIEWED — personalized localStorage shelf
          ══════════════════════════════════════════ */}
      {settings.recently_viewed_enabled !== false && settings.recently_viewed_enabled !== 'false' && recentlyViewed.length > 0 && (
        <section className="page-section recently-viewed-section">
          <Reveal className="container">
            <div className="shelf-section-head">
              <div>
                <span className="section-label">Picked up where you left off</span>
                <h2 className="page-title" style={{ marginBottom: 0 }}>Recently viewed</h2>
              </div>
              <button
                type="button"
                className="shelf-clear-btn"
                onClick={clearRecentlyViewed}
              >
                Clear history
              </button>
            </div>
            <div className="gold-divider" style={{ margin: '12px 0 28px' }} />
            <ProductShelf products={recentlyViewed} ariaLabel="Recently viewed products" />
          </Reveal>
        </section>
      )}

      {/* ══════════════════════════════════════════
          FEATURED SPOTLIGHT LOOKBOOK CAROUSEL
          ══════════════════════════════════════════ */}
      <FeaturedSpotlight />

      {/* ══════════════════════════════════════════
          BRAND STORY — split image + text
          TO CUSTOMIZE: Swap the image URL and edit the story text
          ══════════════════════════════════════════ */}
      <section id="our-story" className="brand-story">
        <div className="container brand-story-inner">
          <Reveal direction="left" className="brand-story-img">
            <img
              src="https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=700&q=80"
              alt="Our story — handcrafting body creams"
              width="700"
              height="500"
              loading="lazy"
            />
          </Reveal>
          <Reveal direction="right" delay={100} className="brand-story-text">
            <span className="section-label">Why Shop With Us</span>
            <h2>Curated beauty,<br />100% authentic.</h2>
            <div className="gold-divider" style={{ margin: '12px 0 20px' }} />
            <p>
              Every product in our store is carefully selected from trusted global
              and local beauty brands — from daily skincare and serums to makeup,
              haircare, and signature fragrances.
            </p>
            <p style={{ marginTop: '14px' }}>
              We source directly from verified distributors, store every item in
              climate-controlled conditions, and deliver fast to your doorstep.
            </p>
            <Link
              to="/shop"
              className="btn btn-outline"
              style={{ marginTop: '28px', width: 'fit-content' }}
            >
              Browse All Brands
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          VERIFIED CUSTOMER REVIEWS
          ══════════════════════════════════════════ */}
      <section className="page-section testimonials-section">
        <div className="container">
          <Reveal className="section-header">
            <span className="section-label">Verified Buyer Reviews</span>
            <h2 className="page-title">What our buyers say</h2>
            <div className="gold-divider" style={{ margin: '0 0 40px' }} />
          </Reveal>
          <div className="testimonials-grid">
            {customerReviews.length > 0 ? (
              customerReviews.slice(0, 3).map((r, i) => (
                <Reveal key={r.id || i} delay={i * 80} className="testimonial-card card">
                  <div className="testimonial-rating-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <StarRating value={r.rating} size="sm" />
                    <span className="verified-badge-pill" style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-accent-dark)', background: 'var(--color-accent-light)', padding: '2px 8px', borderRadius: 999 }}>
                      ✓ Verified Buyer
                    </span>
                  </div>
                  {r.product_name && (
                    <Link to={`/products/${r.product_id}`} style={{ fontSize: '0.78rem', color: 'var(--color-muted)', textDecoration: 'none', display: 'block', marginBottom: 8 }}>
                      Purchased: <strong style={{ color: 'var(--color-accent-dark)' }}>{r.product_name}</strong>
                    </Link>
                  )}
                  {r.title && <strong style={{ display: 'block', fontSize: '0.96rem', marginBottom: 6, color: 'var(--color-primary)' }}>{r.title}</strong>}
                  <p className="testimonial-text">"{r.body || r.title || 'Authentic beauty products and fast delivery!'}"</p>
                  <div className="testimonial-author" style={{ marginTop: 14 }}>
                    <div>
                      <strong>{r.first_name ? `${r.first_name} ${r.last_initial || ''}.` : 'Verified Buyer'}</strong>
                      <span>{r.location || 'Accra, Ghana'}</span>
                    </div>
                  </div>
                </Reveal>
              ))
            ) : (
              (testimonials || []).map((t, i) => (
                <Reveal key={i} delay={i * 90} className="testimonial-card card">
                  <div className="testimonial-rating-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <StarRating value={5} size="sm" />
                    <span className="verified-badge-pill" style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-accent-dark)', background: 'var(--color-accent-light)', padding: '2px 8px', borderRadius: 999 }}>
                      ✓ Verified Buyer
                    </span>
                  </div>
                  <p className="testimonial-text">"{t.text}"</p>
                  <div className="testimonial-author" style={{ marginTop: 14 }}>
                    {t.avatar && <img src={t.avatar} alt={t.name} width="48" height="48" loading="lazy" className="testimonial-avatar" />}
                    <div>
                      <strong>{t.name}</strong>
                      <span>{t.location}</span>
                    </div>
                  </div>
                </Reveal>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FREQUENTLY ASKED QUESTIONS (with FAQPage JSON-LD)
          ══════════════════════════════════════════ */}
      <Reveal>
        <HomeFaq />
      </Reveal>

      {/* ══════════════════════════════════════════
          NEWSLETTER CTA (hidden automatically once subscribed or after first purchase)
          ══════════════════════════════════════════ */}
      {!hideNewsletterBar && settings.newsletter_enabled !== false && settings.newsletter_enabled !== 'false' && (
        <section className="newsletter-section">
          <Reveal className="container newsletter-inner">
            <h2>{settings.newsletter_headline || 'Get 10% off your first order'}</h2>
            <p>{settings.newsletter_subtitle || 'Join our newsletter for exclusive offers, skincare tips, and new arrivals.'}</p>

            {nlState === 'success' ? (
              <p style={{ marginTop: '16px', color: '#22c55e', fontWeight: 600 }}>
                {nlCouponCode
                  ? `You're in! Your first-order code ${nlCouponCode} will be applied automatically at checkout.`
                  : "You're in! Check your inbox for updates and exclusive offers."}
              </p>
            ) : (
              <form className="newsletter-form" onSubmit={handleNewsletterSubmit}>
                <input
                  id="home-newsletter-email"
                  name="email"
                  type="email"
                  placeholder="Enter your email address"
                  required
                  value={nlEmail}
                  onChange={e => setNlEmail(e.target.value)}
                  disabled={nlState === 'loading'}
                  autoComplete="email"
                />
                <button type="submit" className="btn btn-accent" disabled={nlState === 'loading'}>
                  {nlState === 'loading' ? 'Subscribing…' : 'Subscribe'}
                </button>
              </form>
            )}

            {nlState === 'error' && (
              <p style={{ marginTop: '8px', color: '#ef4444', fontSize: '0.85rem' }}>{nlError}</p>
            )}
          </Reveal>
        </section>
      )}

    </div>
  );
}
