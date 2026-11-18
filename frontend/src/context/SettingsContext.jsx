import { createContext, useContext, useEffect, useState } from 'react';
import { settingsAPI } from '../services/api';

const DEFAULTS = {
  store_name: 'BodyCream GH',
  low_stock_threshold: 5,
  delivery_estimate_accra: '1–2 business days',
  delivery_estimate_nationwide: '3–5 business days',
  logo_url: '',          // optional brand mark — when set, shown in nav/footer instead of text
  whatsapp_number: '',
  free_delivery_over: 200,
  delivery_fee_accra: 10,
  delivery_fee_flat: 15,
  pickup_enabled: true,
  pickup_location: 'East Legon, Accra (Call upon arrival)',
  pickup_hours: 'Mon–Sat, 9:00 AM – 6:00 PM',
  pay_on_delivery_enabled: false,
  pay_on_delivery_accra_only: true,

  announcement_enabled: true,
  announcement_text: 'Free delivery on orders over GHS 200 · Shop now',
  announcement_show_whatsapp: true,

  category_bar_enabled: true,
  quick_add_enabled: true,
  recently_viewed_enabled: true,
  flash_sale_enabled: true,
  flash_sale_badge: 'Flash Sale',
  flash_sale_title: "Today's Deals",
  whatsapp_float_enabled: true,
  back_to_top_enabled: true,
  footer_payment_badges_enabled: true,
  animations_enabled: true,
  faq_enabled: true,
  faq_heading: 'Frequently asked questions',
  faq_items: [],

  // Jumia-inspired promotional modal popup (100% admin controlled)
  promo_popup_enabled: false,
  promo_popup_badge: '● BRAND DAY · TODAY ONLY',
  promo_popup_title: 'Pure Shea Radiance.',
  promo_popup_highlight: 'Slashed Prices',
  promo_popup_discount: 'UP TO 50% OFF',
  promo_popup_subtext: 'Limited quantity · Handcrafted in Ghana · T&Cs apply',
  promo_popup_image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80',
  promo_popup_cta_text: 'Claim Your Glow',
  promo_popup_cta_link: '/shop',
  promo_popup_delay_sec: 2,

  // Jumia-inspired dual campaign split tiles
  campaign_tiles_enabled: true,
  tile1_badge: 'LIMITED BATCH',
  tile1_title: 'Whipped Shea Butters',
  tile1_subtitle: 'Deep 48-hour moisture crafted with raw Northern Ghana shea.',
  tile1_cta_text: 'Shop Butters',
  tile1_link: '/shop?category=Body+Butter',
  tile1_image: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=700&q=80',
  tile2_badge: 'HOT SELLER',
  tile2_title: 'Botanical Radiance Oils',
  tile2_subtitle: 'Fast-absorbing golden glow with hibiscus and baobab oils.',
  tile2_cta_text: 'Explore Oils',
  tile2_link: '/shop?category=Body+Oil',
  tile2_image: 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=700&q=80',

  // Jumia-inspired mid-page graphic banner
  mid_banner_enabled: true,
  mid_banner_badge: 'PURE GHANAIAN BOTANICALS',
  mid_banner_title: 'Handcrafted in Small Batches.',
  mid_banner_highlight: 'Zero Harsh Bleaching Agents.',
  mid_banner_subtitle: 'Raw unrefined shea butter from Northern Ghana cooperatives, blended with botanical oils for rich, natural skin nutrition.',
  mid_banner_cta_text: 'Learn Our Story',
  mid_banner_cta_link: '/#our-story',
  mid_banner_image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80',

  // Jumia-inspired bottom SEO & regional editorial guide
  seo_editorial_enabled: true,
  seo_editorial_title: 'Handcrafted Luxury Skincare & Organic Body Creams in Ghana',
  seo_editorial_text: "Welcome to BodyCream GH, Ghana's premier destination for raw, unrefined shea butter creams, botanical radiance oils, and whipped moisturizing butters. Every formulation is handcrafted in Ghana using sustainably wildcrafted shea nuts harvested by women cooperatives across the Northern Region. Whether you are in Accra, Tema, Kumasi, Takoradi, Sunyani, or Tamale, we deliver glowing, deeply nourished skin directly to your doorstep with same-day express delivery in Accra and swift nationwide dispatch. Enjoy complete peace of mind with 100% secure Paystack checkout supporting MTN Mobile Money, Telecel Cash, Visa, and Mastercard, plus Pay on Delivery and free Store Pickup in Accra.",

  hero_label: 'Handcrafted in Ghana',
  hero_headline: 'Reveal your natural glow.',
  hero_subtitle: "Luxury body creams blended with shea butter, cocoa butter, and Africa's finest botanicals.",
  hero_cta_text: 'Shop the Collection',
  hero_cta_link: '/shop',
  hero_image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1600&q=85',

  categories: [
    { label: 'Body Cream',  image: 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Butter', image: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Oil',    image: 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Scrub',  image: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Mask',   image: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=400&h=500&q=80' },
  ],

  testimonials: [
    { name: 'Abena K.', location: 'Accra',    text: "The Shea Butter Cream completely transformed my skin. I've tried so many brands but nothing compares to this." },
    { name: 'Ama S.',   location: 'Kumasi',   text: "I love the Rose Gold Radiance Oil! The scent is divine and my skin glows all day." },
    { name: 'Efua M.',  location: 'Takoradi', text: "Fast delivery, beautiful packaging, and the products actually work! 10/10." },
  ],

  trust_items: [
    { icon: '🚚', label: 'Free delivery',   sub: 'Over GHS 200' },
    { icon: '✦',  label: 'Handcrafted',     sub: 'In small batches' },
    { icon: '↩',  label: '7-day returns',   sub: 'No questions asked' },
    { icon: '🔒', label: 'Secure checkout', sub: 'Paystack' },
  ],

  footer_tagline: "Luxury body creams blended with shea butter, cocoa butter, and Africa's finest botanicals — handcrafted in Ghana.",
  footer_instagram: 'https://instagram.com',
  footer_facebook:  'https://facebook.com',
  footer_whatsapp:  'https://wa.me',
  footer_tiktok:    'https://tiktok.com',

  theme_color_primary:     '#1c1410',
  theme_color_accent:      '#c9a55a',
  theme_color_accent_dark: '#a8863d',
  theme_color_bg:          '#faf7f4',
  theme_color_blush:       '#fdf4f0',
  theme_font_display:      'Cormorant Garamond',
  theme_font_body:         'Inter',
};

const SettingsContext = createContext(DEFAULTS);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    settingsAPI.getAll()
      .then(({ data }) => {
        const merged = { ...DEFAULTS, ...data };
        setSettings(merged);
        applyTheme(merged);
      })
      .catch(() => {
        // Backend unreachable — defaults are already applied
        applyTheme(DEFAULTS);
      });
  }, []);

  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

function applyTheme(s) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary',     s.theme_color_primary);
  root.style.setProperty('--color-accent',      s.theme_color_accent);
  root.style.setProperty('--color-accent-dark', s.theme_color_accent_dark);
  root.style.setProperty('--color-bg',          s.theme_color_bg);
  root.style.setProperty('--color-blush',       s.theme_color_blush);
  root.style.setProperty('--font-display',      `"${s.theme_font_display}", serif`);
  root.style.setProperty('--font-body',         `"${s.theme_font_body}", sans-serif`);
  const animOff = s.animations_enabled === false || s.animations_enabled === 'false';
  root.classList.toggle('no-animations', animOff);
}

export const useSettings = () => useContext(SettingsContext);
