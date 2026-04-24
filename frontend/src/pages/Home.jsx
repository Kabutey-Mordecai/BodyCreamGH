import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { productsAPI } from '../services/api';
import ProductCard from '../components/ProductCard';
import TrustStrip from '../components/TrustStrip';
import './Home.css';

// Real customer testimonials — TO CUSTOMIZE: replace with your actual reviews
const TESTIMONIALS = [
  {
    name: 'Abena K.',
    location: 'Accra',
    text: 'The Shea Butter Cream completely transformed my skin. Ive tried so many brands but nothing compares to this. My skin has never felt so soft.',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=80&h=80&q=80',
  },
  {
    name: 'Ama S.',
    location: 'Kumasi',
    text: 'I love the Rose Gold Radiance Oil! The scent is divine and my skin glows all day. Worth every pesewa and Ive already ordered three more bottles.',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=80&h=80&q=80',
  },
  {
    name: 'Efua M.',
    location: 'Takoradi',
    text: 'Fast delivery, beautiful packaging, and the products actually work! I gifted the Vanilla Scrub to my sister and shes obsessed. 10/10.',
    avatar: 'https://images.unsplash.com/photo-1546961342-ea5f60b194b8?auto=format&fit=crop&w=80&h=80&q=80',
  },
];

// Gallery strip images — luxury skincare lifestyle shots
// TO CUSTOMIZE: Replace with photos of real customers or products
const GALLERY = [
  'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=400&h=400&q=80',
];

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    productsAPI.getAll({ limit: 4 })
      .then(({ data }) => setFeatured(data.products || data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>

      {/* ══════════════════════════════════════════
          HERO — full-viewport, image background
          TO CUSTOMIZE: Change the background-image URL in Home.css (.hero)
          ══════════════════════════════════════════ */}
      <section className="hero">
        <div className="hero-overlay" />
        <div className="container hero-content">
          <span className="hero-label">Handcrafted in Ghana</span>
          <h1>
            Reveal your<br />
            <em>natural glow.</em>
          </h1>
          <p>
            Luxury body creams blended with shea butter, cocoa butter,
            and Africa's finest botanicals — for the woman who deserves the best.
          </p>
          <div className="hero-actions">
            <Link to="/shop" className="btn btn-accent hero-cta">
              Shop the Collection
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
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="testimonial-card card">
                <p className="testimonial-text">"{t.text}"</p>
                <div className="testimonial-author">
                  <img src={t.avatar} alt={t.name} className="testimonial-avatar" />
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
          TO CUSTOMIZE: Wire this up to Mailchimp or your email service
          ══════════════════════════════════════════ */}
      <section className="newsletter-section">
        <div className="container newsletter-inner">
          <h2>Get 10% off your first order</h2>
          <p>Join our newsletter for exclusive offers, skincare tips, and new arrivals.</p>
          <form
            className="newsletter-form"
            onSubmit={e => { e.preventDefault(); alert('Thank you! We will be in touch.'); }}
          >
            <input type="email" placeholder="Enter your email address" required />
            <button type="submit" className="btn btn-accent">Subscribe</button>
          </form>
        </div>
      </section>

    </div>
  );
}
