import { useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import './HomeSeoBlock.css';

const DEFAULT_TITLE = 'Handcrafted Luxury Skincare & Organic Body Creams in Ghana';
const DEFAULT_TEXT = `Welcome to BodyCream GH, Ghana's premier destination for raw, unrefined shea butter creams, botanical radiance oils, and whipped moisturizing butters. Every formulation is handcrafted in Ghana using sustainably wildcrafted shea nuts harvested by women cooperatives across the Northern Region. Whether you are in Accra, Tema, Kumasi, Takoradi, Sunyani, or Tamale, we deliver glowing, deeply nourished skin directly to your doorstep with same-day express delivery in Accra and swift nationwide dispatch. Enjoy complete peace of mind with 100% secure Paystack checkout supporting MTN Mobile Money, Telecel Cash, Visa, and Mastercard, plus Pay on Delivery and free Store Pickup in Accra.`;

export default function HomeSeoBlock() {
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);

  const isEnabled = settings.seo_editorial_enabled !== false && settings.seo_editorial_enabled !== 'false';
  if (!isEnabled) return null;

  const title = settings.seo_editorial_title || DEFAULT_TITLE;
  const text = settings.seo_editorial_text || DEFAULT_TEXT;

  return (
    <section className="home-seo-section" aria-label="About Shopping with BodyCream GH">
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
