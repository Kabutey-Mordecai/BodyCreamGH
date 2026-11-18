import { useState, useEffect, useRef, useCallback } from 'react';
import { PageFlip } from 'page-flip';
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
  {
    badge: 'WEEKEND LUXURY RITUAL',
    title: 'Botanical Exfoliating Polish.',
    highlight: 'Silky Smooth Finish.',
    subtitle: 'Natural Ghanaian cane sugar crystals and raw shea butter to gently buff away dry skin and reveal radiant softness.',
    cta_text: 'Shop Body Scrubs',
    cta_link: '/shop?category=Body+Scrub',
    image: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=700&q=80',
  },
];

export default function MidPageBanner() {
  const settings = useSettings();
  const bookMountRef = useRef(null);
  const templateRef = useRef(null);
  const pageFlipRef = useRef(null);
  const [currentSpread, setCurrentSpread] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const isEnabled = settings.mid_banner_enabled !== false && settings.mid_banner_enabled !== 'false';

  // Dynamic slides from Admin settings or fallback defaults
  let slides = Array.isArray(settings.mid_banner_slides) && settings.mid_banner_slides.length > 0
    ? settings.mid_banner_slides
    : null;

  if (!slides) {
    if (settings.mid_banner_title || settings.mid_banner_highlight) {
      slides = [
        {
          badge: settings.mid_banner_badge || DEFAULT_SLIDES[0].badge,
          title: settings.mid_banner_title || DEFAULT_SLIDES[0].title,
          highlight: settings.mid_banner_highlight || DEFAULT_SLIDES[0].highlight,
          subtitle: settings.mid_banner_subtitle || DEFAULT_SLIDES[0].subtitle,
          cta_text: settings.mid_banner_cta_text || DEFAULT_SLIDES[0].cta_text,
          cta_link: settings.mid_banner_cta_link || DEFAULT_SLIDES[0].cta_link,
          image: settings.mid_banner_image || DEFAULT_SLIDES[0].image,
        },
        DEFAULT_SLIDES[1],
        DEFAULT_SLIDES[2],
        DEFAULT_SLIDES[3],
      ];
    } else {
      slides = DEFAULT_SLIDES;
    }
  }

  const total = slides.length;
  const autoPlay = settings.mid_banner_autoplay !== false && settings.mid_banner_autoplay !== 'false';
  const intervalSec = Math.max(3, Number(settings.mid_banner_interval_sec) || 7);
  // Default 520px height for the tall spacious luxury card matching the user's second screenshot
  const heightPx = Math.max(380, Math.min(800, Number(settings.mid_banner_height_px) || 520));
  // Default 1.2s flip speed for a slow, gentle, realistic page curl transition
  const flipSpeedMs = Math.max(400, Math.min(3000, Math.round((Number(settings.mid_banner_flip_speed_sec) || 1.2) * 1000)));

  // Initialize StPageFlip on mounted container
  useEffect(() => {
    if (!bookMountRef.current || !templateRef.current || !isEnabled) return;

    // Safely destroy existing instance if active
    if (pageFlipRef.current) {
      try {
        if (pageFlipRef.current.ui) pageFlipRef.current.ui.destroy();
      } catch (e) {}
      pageFlipRef.current = null;
    }

    // Clear mount container
    bookMountRef.current.innerHTML = '';

    // Create a dedicated inner mount element so PageFlip's internal destroy()
    // does not remove bookMountRef.current from React's DOM tree
    const innerWrapper = document.createElement('div');
    innerWrapper.className = 'stf__inner-book-mount';
    innerWrapper.style.width = '100%';
    innerWrapper.style.height = `${heightPx}px`;
    bookMountRef.current.appendChild(innerWrapper);

    // Clone template page DOM nodes so React's virtual DOM remains pristine
    const templatePages = templateRef.current.querySelectorAll('.book-page');
    if (!templatePages || templatePages.length === 0) return;

    const clonedPages = Array.from(templatePages).map((el) => el.cloneNode(true));

    try {
      const pageFlip = new PageFlip(innerWrapper, {
        width: 580,
        height: heightPx,
        size: 'stretch',
        minWidth: 320,
        maxWidth: 720,
        minHeight: 380,
        maxHeight: 750,
        maxShadowOpacity: 0.55,
        showCover: false,
        mobileScrollSupport: true,
        flippingTime: flipSpeedMs,
        usePortrait: true,
        startPage: 0,
        drawShadow: true,
        autoSize: true,
        clickEventForward: true,
        useMouseEvents: true,
        showPageCorners: true,
        disableFlipByClick: false,
      });

      pageFlip.loadFromHTML(clonedPages);
      pageFlipRef.current = pageFlip;

      pageFlip.on('flip', (e) => {
        const pageIdx = typeof e.data === 'number' ? e.data : 0;
        setCurrentSpread(Math.floor(pageIdx / 2));
      });
    } catch (err) {
      console.warn('PageFlip init notice:', err);
    }

    return () => {
      if (pageFlipRef.current) {
        try {
          if (pageFlipRef.current.ui) pageFlipRef.current.ui.destroy();
        } catch (e) {}
        pageFlipRef.current = null;
      }
    };
  }, [slides, heightPx, flipSpeedMs, isEnabled]);

  const flipNext = useCallback(() => {
    if (pageFlipRef.current) {
      try {
        const cur = pageFlipRef.current.getCurrentPageIndex();
        const cnt = pageFlipRef.current.getPageCount();
        if (cur + 2 >= cnt) {
          pageFlipRef.current.turnToPage(0);
        } else {
          pageFlipRef.current.flipNext('bottom');
        }
      } catch (e) {}
    }
  }, []);

  const flipPrev = useCallback(() => {
    if (pageFlipRef.current) {
      try {
        const cur = pageFlipRef.current.getCurrentPageIndex();
        const cnt = pageFlipRef.current.getPageCount();
        if (cur <= 0) {
          pageFlipRef.current.turnToPage(Math.max(0, cnt - 2));
        } else {
          pageFlipRef.current.flipPrev('bottom');
        }
      } catch (e) {}
    }
  }, []);

  const turnToSpread = (idx) => {
    if (pageFlipRef.current) {
      try {
        pageFlipRef.current.turnToPage(idx * 2);
      } catch (e) {}
    }
  };

  // Auto-play timer with hover & touch pause
  useEffect(() => {
    if (!autoPlay || total <= 1 || isPaused) return;
    const timer = setInterval(() => {
      flipNext();
    }, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [autoPlay, total, isPaused, intervalSec, flipNext]);

  if (!isEnabled) return null;

  return (
    <section className="mid-banner-section" aria-label="Brand Stories and Product Highlights">
      <div className="container">
        <Reveal className="mid-banner-card-wrapper">
          <div
            className="mid-banner-book-frame"
            style={{
              '--mid-banner-height': `${heightPx}px`,
              '--mid-banner-flip-speed': `${flipSpeedMs / 1000}s`,
            }}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          >
            {/* The StPageFlip Interactive Mount Container */}
            <div
              className="mid-banner-book-container"
              ref={bookMountRef}
              style={{ height: `${heightPx}px`, minHeight: `${heightPx}px` }}
            />

            {/* Hidden React Template DOM for Cloned Pages */}
            <div ref={templateRef} style={{ display: 'none' }} aria-hidden="true">
              {slides.map((slide, idx) => (
                <div key={idx} className="book-spread-wrapper">
                  {/* Left Page: Editorial Story Content */}
                  <div className="book-page page-left" data-density="soft">
                    <div className="book-page-inner">
                      <div className="mid-banner-content">
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
                          {slide.cta_text && (
                            <a
                              href={slide.cta_link || '/shop'}
                              className="btn btn-accent mid-banner-btn"
                            >
                              {slide.cta_text} →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Page: Product Photography & Glow */}
                  <div className="book-page page-right" data-density="soft">
                    <div className="book-page-inner">
                      <div className="mid-banner-visual">
                        <img
                          src={slide.image}
                          alt={slide.title || 'Product Story'}
                          className="mid-banner-img"
                          loading="eager"
                        />
                        <div className="mid-banner-spine-shadow" />
                        <div className="mid-banner-shine" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Manual Navigation Arrows (Next / Prev) */}
            {total > 1 && (
              <>
                <button
                  type="button"
                  className="mid-banner-arrow mid-banner-arrow-prev"
                  onClick={flipPrev}
                  aria-label="Previous story page"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="mid-banner-arrow mid-banner-arrow-next"
                  onClick={flipNext}
                  aria-label="Next story page"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}

            {/* Bottom Progress Bar, Editorial Page Indicator & Spread Dots */}
            {total > 1 && (
              <div className="mid-banner-nav" role="tablist" aria-label="Story pages navigation">
                <span className="mid-banner-page-pill">
                  PAGE {Math.min(currentSpread + 1, total)} OF {total}
                </span>
                <div className="mid-banner-dots">
                  {slides.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`mid-banner-dot ${idx === currentSpread ? 'active' : ''}`}
                      onClick={() => turnToSpread(idx)}
                      role="tab"
                      aria-selected={idx === currentSpread}
                      aria-label={`Go to story ${idx + 1}`}
                    >
                      <span
                        className="dot-fill"
                        style={{
                          animationDuration: idx === currentSpread && !isPaused ? `${intervalSec}s` : '0s',
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
