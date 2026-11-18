import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import Reveal from './Reveal';
import './MidPageBanner.css';

const DEFAULT_SLIDES = [
  {
    badge: 'PURE GHANAIAN BOTANICALS',
    title: 'Handcrafted in Small Batches.',
    highlight: 'Zero Harsh Bleaching Agents.',
    subtitle: 'Raw unrefined shea butter from Northern Ghana cooperatives, blended with botanical oils for rich, natural skin nutrition.',
    cta_text: 'Learn Our Story',
    cta_link: '/#our-story',
    image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80',
  },
  {
    badge: 'CLINICALLY PROVEN HYDRATION',
    title: '48-Hour Deep Moisture Lock.',
    highlight: 'Melanin-Rich Formula.',
    subtitle: 'Enriched with cold-pressed baobab and virgin coconut oil to soothe eczema, stretch marks, and dry harmattan skin.',
    cta_text: 'Shop Body Creams',
    cta_link: '/shop?category=Body+Cream',
    image: 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=700&q=80',
  },
  {
    badge: 'BESTSELLER RADIANCE',
    title: 'Rose Gold Botanical Glow.',
    highlight: 'Non-Greasy Velvet Finish.',
    subtitle: 'Infused with golden mica particles and wild rosehip seed oil for an instant sun-kissed Ghanaian summer glow.',
    cta_text: 'Discover Glow Oils',
    cta_link: '/shop?category=Body+Oil',
    image: 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=700&q=80',
  },
];

function isExternalUrl(url) {
  return /^(https?:\/\/|mailto:|tel:|wa\.me)/i.test(url);
}

function SlideCta({ to, text }) {
  if (!text) return null;
  if (isExternalUrl(to)) {
    return (
      <a
        href={to}
        className="btn btn-accent mid-banner-btn"
        target="_blank"
        rel="noopener noreferrer"
      >
        {text} →
      </a>
    );
  }
  return (
    <Link to={to || '/shop'} className="btn btn-accent mid-banner-btn">
      {text} →
    </Link>
  );
}

export default function MidPageBanner() {
  const settings = useSettings();
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const isEnabled = settings.mid_banner_enabled !== false && settings.mid_banner_enabled !== 'false';
  if (!isEnabled) return null;

  // Resolve slides from settings or fallback to defaults
  let slides = Array.isArray(settings.mid_banner_slides) && settings.mid_banner_slides.length > 0
    ? settings.mid_banner_slides
    : null;

  // If no slides array but single banner fields exist
  if (!slides) {
    if (settings.mid_banner_title || settings.mid_banner_highlight) {
      slides = [
        {
          badge: settings.mid_banner_badge || 'PURE GHANAIAN BOTANICALS',
          title: settings.mid_banner_title || 'Handcrafted in Small Batches.',
          highlight: settings.mid_banner_highlight || 'Zero Harsh Bleaching Agents.',
          subtitle: settings.mid_banner_subtitle || 'Raw unrefined shea butter from Northern Ghana cooperatives.',
          cta_text: settings.mid_banner_cta_text || 'Learn Our Story',
          cta_link: settings.mid_banner_cta_link || '/#our-story',
          image: settings.mid_banner_image || DEFAULT_SLIDES[0].image,
        },
        DEFAULT_SLIDES[1],
        DEFAULT_SLIDES[2],
      ];
    } else {
      slides = DEFAULT_SLIDES;
    }
  }

  const total = slides.length;
  const autoPlay = settings.mid_banner_autoplay !== false && settings.mid_banner_autoplay !== 'false';
  const intervalSec = Math.max(3, Number(settings.mid_banner_interval_sec) || 5);

  const nextSlide = useCallback(() => {
    setCurrent(prev => (prev + 1) % total);
  }, [total]);

  const prevSlide = useCallback(() => {
    setCurrent(prev => (prev - 1 + total) % total);
  }, [total]);

  // Auto-play timer
  useEffect(() => {
    if (!autoPlay || total <= 1 || isPaused) return;
    const timer = setInterval(nextSlide, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [autoPlay, total, isPaused, intervalSec, nextSlide]);

  // Touch swipe handling
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 40) {
      if (diff > 0) nextSlide(); // Swipe left -> next
      else prevSlide();          // Swipe right -> prev
    }
  };

  const slide = slides[current] || slides[0];

  return (
    <section className="mid-banner-section" aria-label="Brand Stories and Product Highlights">
      <div className="container">
        <Reveal className="mid-banner-card-wrapper">
          <div
            className="mid-banner-card"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Slide Content Column */}
            <div className="mid-banner-content" key={`content-${current}`}>
              {slide.badge && (
                <span className="mid-banner-badge">
                  <span className="dot" /> {slide.badge}
                </span>
              )}

              <h2 className="mid-banner-title">
                {slide.title}{' '}
                {slide.highlight && (
                  <span className="mid-banner-highlight">{slide.highlight}</span>
                )}
              </h2>

              <p className="mid-banner-sub">{slide.subtitle}</p>

              <div className="mid-banner-actions">
                <SlideCta to={slide.cta_link} text={slide.cta_text} />
              </div>
            </div>

            {/* Slide Visual / Image Column */}
            <div className="mid-banner-visual" key={`visual-${current}`}>
              <img
                src={slide.image}
                alt={slide.title || 'Product Story'}
                className="mid-banner-img"
                loading="eager"
              />
              <div className="mid-banner-shine" />
            </div>

            {/* Manual Navigation Arrows (Next / Prev) */}
            {total > 1 && (
              <>
                <button
                  type="button"
                  className="mid-banner-arrow mid-banner-arrow-prev"
                  onClick={prevSlide}
                  aria-label="Previous story slide"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="mid-banner-arrow mid-banner-arrow-next"
                  onClick={nextSlide}
                  aria-label="Next story slide"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}

            {/* Bottom Progress Bar & Dot Navigation */}
            {total > 1 && (
              <div className="mid-banner-nav" role="tablist" aria-label="Story slides navigation">
                {slides.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`mid-banner-dot ${idx === current ? 'active' : ''}`}
                    onClick={() => setCurrent(idx)}
                    role="tab"
                    aria-selected={idx === current}
                    aria-label={`Go to slide ${idx + 1}`}
                  >
                    <span className="dot-fill" style={{
                      animationDuration: idx === current && !isPaused ? `${intervalSec}s` : '0s'
                    }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
