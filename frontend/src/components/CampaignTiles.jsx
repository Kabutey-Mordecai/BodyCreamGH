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

  const tile1 = {
    badge: settings.tile1_badge || 'LIMITED BATCH',
    title: settings.tile1_title || 'Whipped Shea Butters',
    subtitle: settings.tile1_subtitle || 'Deep 48-hour moisture crafted with raw Northern Ghana shea.',
    cta: settings.tile1_cta_text || 'Shop Butters',
    link: settings.tile1_link || '/shop?category=Body+Butter',
    image: settings.tile1_image || 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=700&q=80',
  };

  const tile2 = {
    badge: settings.tile2_badge || 'HOT SELLER',
    title: settings.tile2_title || 'Botanical Radiance Oils',
    subtitle: settings.tile2_subtitle || 'Fast-absorbing golden glow with hibiscus and baobab oils.',
    cta: settings.tile2_cta_text || 'Explore Oils',
    link: settings.tile2_link || '/shop?category=Body+Oil',
    image: settings.tile2_image || 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=700&q=80',
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
