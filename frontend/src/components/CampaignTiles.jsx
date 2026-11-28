import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import Reveal from './Reveal';
import './CampaignTiles.css';

function isExternalUrl(url) {
  return /^(https?:\/\/|mailto:|tel:|wa\.me)/i.test(url);
}

function TileLink({ to, children, className }) {
  if (isExternalUrl(to)) {
    return (
      <a href={to} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

export default function CampaignTiles() {
  const settings = useSettings();

  const isEnabled = settings.campaign_tiles_enabled !== false && settings.campaign_tiles_enabled !== 'false';
  if (!isEnabled) return null;

  const resolveTileLink = (rawLink, fallback) => {
    const link = rawLink || fallback;
    if (link.includes('category=Body+Butter') || link.includes('category=Body%20Butter')) {
      return '/shop?search=Shea';
    }
    if (link.includes('category=Body+Oil') || link.includes('category=Body%20Oil')) {
      return '/shop?search=Oil';
    }
    return link;
  };

  if (!settings.tile1_title && !settings.tile2_title) return null;

  const tile1 = {
    badge: settings.tile1_badge || '',
    title: settings.tile1_title || '',
    subtitle: settings.tile1_subtitle || '',
    cta: settings.tile1_cta_text || 'Shop Now',
    link: resolveTileLink(settings.tile1_link, '/shop'),
    image: settings.tile1_image || '',
  };

  const tile2 = {
    badge: settings.tile2_badge || '',
    title: settings.tile2_title || '',
    subtitle: settings.tile2_subtitle || '',
    cta: settings.tile2_cta_text || 'Explore',
    link: resolveTileLink(settings.tile2_link, '/shop'),
    image: settings.tile2_image || '',
  };

  return (
    <section className="campaign-tiles-section" aria-label="Featured Campaigns">
      <div className="container">
        <div className="campaign-tiles-grid">
          {/* Tile 1 */}
          <Reveal direction="left" className="campaign-tile-card">
            <TileLink to={tile1.link} className="campaign-tile-inner">
              <img
                src={resolveImageUrl(tile1.image)}
                alt={tile1.title}
                width="700"
                height="400"
                className="campaign-tile-bg"
                loading="lazy"
              />
              <div className="campaign-tile-overlay" />
              <div className="campaign-tile-content">
                {tile1.badge && <span className="campaign-tile-badge">{tile1.badge}</span>}
                <h3 className="campaign-tile-title">{tile1.title}</h3>
                <p className="campaign-tile-sub">{tile1.subtitle}</p>
                <span className="campaign-tile-cta">
                  {tile1.cta} <span className="arrow">→</span>
                </span>
              </div>
            </TileLink>
          </Reveal>

          {/* Tile 2 */}
          <Reveal direction="right" delay={80} className="campaign-tile-card">
            <TileLink to={tile2.link} className="campaign-tile-inner">
              <img
                src={resolveImageUrl(tile2.image)}
                alt={tile2.title}
                width="700"
                height="400"
                className="campaign-tile-bg"
                loading="lazy"
              />
              <div className="campaign-tile-overlay" />
              <div className="campaign-tile-content">
                {tile2.badge && <span className="campaign-tile-badge">{tile2.badge}</span>}
                <h3 className="campaign-tile-title">{tile2.title}</h3>
                <p className="campaign-tile-sub">{tile2.subtitle}</p>
                <span className="campaign-tile-cta">
                  {tile2.cta} <span className="arrow">→</span>
                </span>
              </div>
            </TileLink>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
