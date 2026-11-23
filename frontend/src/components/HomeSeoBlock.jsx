import { useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import './HomeSeoBlock.css';

const DEFAULT_TITLE = 'Authentic Cosmetics, Skincare, Makeup & Fragrances Online';
const DEFAULT_TEXT = `Welcome to GlowHaus Beauty, your trusted destination for authentic skincare, makeup, haircare, body care, and fragrances. Every product in our catalog is sourced from verified brand distributors and sealed for freshness. Whether you are shopping from Accra, Tema, Kumasi, Takoradi, or anywhere nationwide, enjoy fast dispatch, secure Paystack checkout (Mobile Money, Visa, Mastercard), Pay on Delivery options, and easy store pickup.`;

export default function HomeSeoBlock() {
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);

  const isEnabled = settings.seo_editorial_enabled !== false && settings.seo_editorial_enabled !== 'false';
  if (!isEnabled) return null;

  const title = settings.seo_editorial_title || DEFAULT_TITLE;
  const text = settings.seo_editorial_text || DEFAULT_TEXT;
  const storeName = settings.store_name || 'GlowHaus Beauty';

  return (
    <section className="home-seo-section" aria-label={`About Shopping with ${storeName}`}>
      <div className="container">
        <div className="home-seo-card">
          <h3 className="home-seo-title">{title}</h3>
          <div className={`home-seo-body ${expanded ? 'is-expanded' : ''}`}>
            <p className="home-seo-paragraph">{text}</p>
          </div>
          <button
            type="button"
            className="home-seo-toggle"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? 'Read Less ↑' : 'Read More About Delivery & Ingredients ↓'}
          </button>
        </div>
      </div>
    </section>
  );
}
