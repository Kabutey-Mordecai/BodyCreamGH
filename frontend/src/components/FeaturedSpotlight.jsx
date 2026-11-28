import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { renderCleanNumerals } from '../utils/cleanNumerals';
import Reveal from './Reveal';
import './FeaturedSpotlight.css';

const DEFAULT_SLIDES = [];

export default function FeaturedSpotlight() {
  const settings = useSettings();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartXRef = useRef(null);

  const isEnabled = settings.mid_banner_enabled !== false && settings.mid_banner_enabled !== 'false';

  // Dynamic slides from Admin settings or fallback defaults
  let slides = Array.isArray(settings.mid_banner_slides) && settings.mid_banner_slides.length > 0
    ? settings.mid_banner_slides
    : null;

  if (!slides) {
    if (settings.mid_banner_title || settings.mid_banner_highlight) {
      slides = [
        {
          badge: settings.mid_banner_badge || '',
          title: settings.mid_banner_title || '',
          highlight: settings.mid_banner_highlight || '',
          subtitle: settings.mid_banner_subtitle || '',
          cta_text: settings.mid_banner_cta_text || 'Explore',
          cta_link: settings.mid_banner_cta_link || '/shop',
          image: settings.mid_banner_image || '',
        },
      ];
    } else {
      slides = DEFAULT_SLIDES;
    }
  }

  const total = slides.length;
  const autoPlay = settings.mid_banner_autoplay !== false && settings.mid_banner_autoplay !== 'false';
  const intervalSec = Math.max(3, Number(settings.mid_banner_interval_sec) || 7);

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % total);
  }, [total]);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev - 1 + total) % total);
  }, [total]);

  const goToSlide = (idx) => {
    setCurrentSlide(idx);
  };

  // Auto-play timer with hover & touch pause
  useEffect(() => {
    if (!autoPlay || total <= 1 || isPaused) return;
    const timer = setInterval(() => {
      nextSlide();
    }, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [autoPlay, total, isPaused, intervalSec, nextSlide]);

  // Touch swipe handling
  const handleTouchStart = (e) => {
    if (e.touches && e.touches.length > 0) {
      touchStartXRef.current = e.touches[0].clientX;
    }
  };

  const handleTouchEnd = (e) => {
    if (touchStartXRef.current === null) return;
    const touchEndX = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientX : null;
    if (touchEndX !== null) {
      const diff = touchStartXRef.current - touchEndX;
      if (diff > 45) {
        nextSlide();
      } else if (diff < -45) {
        prevSlide();
      }
    }
    touchStartXRef.current = null;
  };

  if (!isEnabled || total === 0) return null;

  const activeSlide = slides[currentSlide] || slides[0];

  return (
    <section className="mid-banner-section" aria-label="Brand Stories and Product Highlights">
      <div className="container">
        <Reveal className="mid-banner-card-wrapper">
          <div
            className="editorial-showcase-frame"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Split Editorial Layout: Visual + Narrative */}
            <div className="editorial-showcase-grid">

              {/* Editorial Copy Panel */}
              <div className="editorial-content-panel">
                <div className="editorial-content-inner" key={currentSlide}>
                  {activeSlide.badge && (
                    <span className="editorial-badge">
                      <span className="dot" /> {activeSlide.badge}
                    </span>
                  )}

                  <h2 className="editorial-title">
                    {renderCleanNumerals(activeSlide.title)}{' '}
                    {activeSlide.highlight && (
                      <span className="editorial-highlight">{renderCleanNumerals(activeSlide.highlight)}</span>
                    )}
                  </h2>

                  <p className="editorial-sub">{activeSlide.subtitle}</p>

                  <div className="editorial-actions">
                    {activeSlide.cta_text && (
                      <a
                        href={activeSlide.cta_link || '/shop'}
                        className="btn btn-accent editorial-btn"
                      >
                        {activeSlide.cta_text} →
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* High-Resolution Visual Panel */}
              <div className="editorial-visual-panel">
                <div className="editorial-visual-viewport">
                  {slides.map((slide, idx) => (
                    <div
                      key={idx}
                      className={`editorial-slide-img-wrap ${idx === currentSlide ? 'active' : ''}`}
                      aria-hidden={idx !== currentSlide}
                    >
                      {slide.image_fit === 'contain' && (
                        <div
                          className="editorial-visual-ambient"
                          style={{ backgroundImage: `url(${resolveImageUrl(slide.image)})` }}
                          aria-hidden="true"
                        />
                      )}
                      <img
                        src={resolveImageUrl(slide.image)}
                        alt={slide.title || 'Product Story'}
                        width="700"
                        height="540"
                        className={`editorial-img ${slide.image_fit === 'contain' ? 'fit-contain' : ''}`}
                        style={{
                          objectFit: slide.image_fit || 'cover',
                          objectPosition: slide.image_position || 'center',
                        }}
                        loading="eager"
                      />
                    </div>
                  ))}
                  <div className="editorial-visual-overlay" />
                </div>
              </div>

            </div>

            {/* Manual Navigation Arrows (Desktop) */}
            {total > 1 && (
              <>
                <button
                  type="button"
                  className="editorial-arrow editorial-arrow-prev"
                  onClick={prevSlide}
                  aria-label="Previous story"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="editorial-arrow editorial-arrow-next"
                  onClick={nextSlide}
                  aria-label="Next story"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}

            {/* Bottom Navigation & Indicator Bar */}
            {total > 1 && (
              <div className="editorial-nav" role="tablist" aria-label="Story navigation">
                <span className="editorial-page-pill">
                  STORY {currentSlide + 1} OF {total}
                </span>
                <div className="editorial-dots">
                  {slides.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`editorial-dot ${idx === currentSlide ? 'active' : ''}`}
                      onClick={() => goToSlide(idx)}
                      role="tab"
                      aria-selected={idx === currentSlide}
                      aria-label={`Go to story ${idx + 1}`}
                    >
                      <span
                        className="dot-fill"
                        style={{
                          animationDuration: idx === currentSlide && !isPaused ? `${intervalSec}s` : '0s',
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        </Reveal>
      </div>
    </section>
  );
}
