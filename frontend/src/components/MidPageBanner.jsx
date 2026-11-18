import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import Reveal from './Reveal';
import './MidPageBanner.css';

export default function MidPageBanner() {
  const settings = useSettings();

  const isEnabled = settings.mid_banner_enabled !== false && settings.mid_banner_enabled !== 'false';
  if (!isEnabled) return null;

  const badge = settings.mid_banner_badge || 'PURE GHANAIAN BOTANICALS';
  const title = settings.mid_banner_title || 'Handcrafted in Small Batches.';
  const highlight = settings.mid_banner_highlight || 'Zero Harsh Bleaching Agents.';
  const subtitle = settings.mid_banner_subtitle || 'Raw unrefined shea butter from Northern Ghana cooperatives, blended with botanical oils for rich, natural skin nutrition.';
  const ctaText = settings.mid_banner_cta_text || 'Learn Our Story';
  const ctaLink = settings.mid_banner_cta_link || '/#our-story';
  const image = settings.mid_banner_image || 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80';

  return (
    <section className="mid-banner-section" aria-label="Authenticity and Quality Guarantee">
      <div className="container">
        <Reveal className="mid-banner-card">
          <div className="mid-banner-content">
            {badge && (
              <span className="mid-banner-badge">
                <span className="dot" /> {badge}
              </span>
            )}
            <h2 className="mid-banner-title">
              {title}{' '}
              {highlight && <span className="mid-banner-highlight">{highlight}</span>}
            </h2>
            <p className="mid-banner-sub">{subtitle}</p>
            <div className="mid-banner-actions">
              <Link to={ctaLink} className="btn btn-accent mid-banner-btn">
                {ctaText} →
              </Link>
            </div>
          </div>
          <div className="mid-banner-visual">
            <img
              src={image}
              alt="Authentic Ghanaian Skincare"
              className="mid-banner-img"
              loading="lazy"
            />
            <div className="mid-banner-shine" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
