import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { productsAPI, newsletterAPI } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useSeo } from '../utils/seo';
import ProductCard from '../components/ProductCard';
import TrustStrip from '../components/TrustStrip';
import SearchBar from '../components/SearchBar';
import './Home.css';

// Sale resets each time the page loads — ends at 11:59 PM today
const SALE_END_TIME = (() => {
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
function FlashSaleTimer() {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(SALE_END_TIME));
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(getTimeLeft(SALE_END_TIME)), 1000);
    return () => clearInterval(id);
  }, []);
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

const GALLERY = [
  'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=400&h=400&q=80',
];

export default function Home() {
  const {
    store_name, hero_label, hero_headline, hero_subtitle, hero_cta_text, hero_cta_link, hero_image,
    categories, testimonials,
  } = useSettings();
  const [featured, setFeatured]             = useState([]);
  const [loading, setLoading]               = useState(true);
  const [saleProducts, setSaleProducts]     = useState([]);
  const [nlEmail, setNlEmail]               = useState('');
  const [nlState, setNlState]               = useState('idle'); // idle | loading | success | error
  const [nlError, setNlError]               = useState('');

  const homeJsonLd = useMemo(() => ({
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
    ],
  }), [store_name]);

  useSeo({
    title: `${store_name || 'BodyCream GH'} — Luxury Handcrafted Skincare in Ghana`,
    description: hero_subtitle || 'Shop handcrafted body creams, butters, oils, and scrubs in Ghana.',
    image: hero_image || DEFAULT_HERO_IMG,
    jsonLd: homeJsonLd,
  });

  useEffect(() => {
    productsAPI.getAll({ limit: 4 })
      .then(({ data }) => setFeatured(data.products || data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Fetch 3 products for the flash sale (cheapest first so deals look good)
  useEffect(() => {
    productsAPI.getAll({ limit: 3, sort: 'price_low' })
      .then(({ data }) => setSaleProducts(data.products || data))
      .catch(() => {});
  }, []);

  const handleNewsletterSubmit = async (e) => {
    e.preventDefault();
    if (nlState === 'loading') return;
    setNlState('loading');
    setNlError('');
    try {
      await newsletterAPI.subscribe(nlEmail);
      setNlState('success');
      setNlEmail('');
    } catch (err) {
      setNlState('error');
      setNlError(err.response?.data?.error || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div>

      {/* ══════════════════════════════════════════
          HERO — full-viewport, high-priority LCP img
          ══════════════════════════════════════════ */}
      <section className="hero">
        <img
          src={hero_image || DEFAULT_HERO_IMG}
          alt=""
          aria-hidden="true"
          className="hero-bg-img"
          fetchPriority="high"
          decoding="async"
        />
        <div className="hero-overlay" />
        <div className="container hero-content">
          <span className="hero-label">{hero_label}</span>
          <h1>{hero_headline}</h1>
          <p>{hero_subtitle}</p>

          <SearchBar
            variant="hero"
            placeholder="Search for body creams, oils, scrubs…"
          />

          <div className="hero-actions">
            <Link to={hero_cta_link || '/shop'} className="btn btn-accent hero-cta">
              {hero_cta_text}
            </Link>
            <Link to="/shop" className="btn hero-ghost">
              Explore All
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TRUST STRIP — 4 brand promises
          ══════════════════════════════════════════ */}
      <TrustStrip />

      {/* ══════════════════════════════════════════
          FLASH SALE — countdown timer + deals
          ══════════════════════════════════════════ */}
      {saleProducts.length > 0 && (
        <section className="flash-sale-section">
          <div className="container">
            <div className="flash-sale-header">
              <div className="flash-sale-title">
                <span className="flash-badge">Flash Sale</span>
                <h2>Today's Deals</h2>
              </div>
              <FlashSaleTimer />
            </div>
            <div className="products-grid">
              {saleProducts.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <Link to="/shop" className="btn btn-outline-gold">View All Products</Link>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════
          CATEGORIES — quick navigation grid
          ══════════════════════════════════════════ */}
      <section className="categories-section">
        <div className="container">
          <div className="section-header">
            <span className="section-label">Browse by category</span>
            <h2 className="page-title">Shop the range</h2>
            <div className="gold-divider" style={{ margin: '0 0 40px' }} />
          </div>
          <div className="categories-grid">
            {(categories || []).map(cat => (
              <Link
                key={cat.label}
                to={`/shop?category=${encodeURIComponent(cat.label)}`}
                className="cat-card"
              >
                <img src={cat.image} alt={cat.label} loading="lazy" />
                <div className="cat-card-overlay" />
                <span className="cat-card-label">{cat.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FEATURED PRODUCTS
          ══════════════════════════════════════════ */}
      <section className="page-section featured-section">
        <div className="container">
          <div className="section-header">
            <span className="section-label">Bestsellers</span>
            <h2 className="page-title">Loved by thousands</h2>
            <div className="gold-divider" style={{ margin: '0 0 16px' }} />
            <p className="page-subtitle">
              Our most-reordered creams — made for melanin-rich skin and Ghana's climate.
            </p>
          </div>

          {loading ? (
            <div className="spinner" />
          ) : (
            <>
              <div className="products-grid">
                {featured.map(p => <ProductCard key={p.id} product={p} />)}
              </div>
              <div className="view-all-wrap">
                <Link to="/shop" className="btn btn-outline">
                  View Full Collection
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          BRAND STORY — split image + text
          TO CUSTOMIZE: Swap the image URL and edit the story text
          ══════════════════════════════════════════ */}
      <section className="brand-story">
        <div className="container brand-story-inner">
          <div className="brand-story-img">
            <img
              src="https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=700&q=80"
              alt="Our story — handcrafting body creams"
              loading="lazy"
            />
          </div>
          <div className="brand-story-text">
            <span className="section-label">Our Story</span>
            <h2>Born in Ghana,<br />made for her.</h2>
            <div className="gold-divider" style={{ margin: '12px 0 20px' }} />
            <p>
              Every product begins with a simple belief: Ghanaian women deserve
              skincare that was made <em>for them</em> — not adapted from formulas
              designed for other climates and skin tones.
            </p>
            <p style={{ marginTop: '14px' }}>
              We source raw shea butter directly from women cooperatives in the
              Northern Region, blend it with locally grown botanical oils, and
              bottle it with love right here in Accra.
            </p>
            <Link
              to="/shop"
              className="btn btn-outline"
              style={{ marginTop: '28px', width: 'fit-content' }}
            >
              Discover the Range
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TESTIMONIALS
          ══════════════════════════════════════════ */}
      <section className="page-section testimonials-section">
        <div className="container">
          <div className="section-header">
            <span className="section-label">Reviews</span>
            <h2 className="page-title">What our customers say</h2>
            <div className="gold-divider" style={{ margin: '0 0 48px' }} />
          </div>
          <div className="testimonials-grid">
            {(testimonials || []).map((t, i) => (
              <div key={i} className="testimonial-card card">
                <p className="testimonial-text">"{t.text}"</p>
                <div className="testimonial-author">
                  {t.avatar && <img src={t.avatar} alt={t.name} className="testimonial-avatar" />}
                  <div>
                    <strong>{t.name}</strong>
                    <span>{t.location}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          PHOTO GALLERY STRIP — lifestyle imagery
          TO CUSTOMIZE: Replace with real Instagram or product photos
          ══════════════════════════════════════════ */}
      <section className="gallery-strip">
        {GALLERY.map((src, i) => (
          <div key={i} className="gallery-item">
            <img src={src} alt="Luxury skincare lifestyle" loading="lazy" />
          </div>
        ))}
      </section>

      {/* ══════════════════════════════════════════
          NEWSLETTER CTA
          ══════════════════════════════════════════ */}
      <section className="newsletter-section">
        <div className="container newsletter-inner">
          <h2>Get 1% off your first order</h2>
          <p>Join our newsletter for exclusive offers, skincare tips, and new arrivals.</p>

          {nlState === 'success' ? (
            <p style={{ marginTop: '16px', color: '#22c55e', fontWeight: 600 }}>
              You're in! Check your inbox for your discount.
            </p>
          ) : (
            <form className="newsletter-form" onSubmit={handleNewsletterSubmit}>
              <input
                type="email"
                placeholder="Enter your email address"
                required
                value={nlEmail}
                onChange={e => setNlEmail(e.target.value)}
                disabled={nlState === 'loading'}
              />
              <button type="submit" className="btn btn-accent" disabled={nlState === 'loading'}>
                {nlState === 'loading' ? 'Subscribing…' : 'Subscribe'}
              </button>
            </form>
          )}

          {nlState === 'error' && (
            <p style={{ marginTop: '8px', color: '#ef4444', fontSize: '0.85rem' }}>{nlError}</p>
          )}
        </div>
      </section>

    </div>
  );
}
