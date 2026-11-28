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
  pickup_location: 'Store Pickup Station',
  pickup_hours: 'Mon–Sat, 9:00 AM – 6:00 PM',
  pay_on_delivery_enabled: false,
  pay_on_delivery_accra_only: true,
  guest_checkout_enabled: false,

  announcement_enabled: true,
  announcement_text: 'Free delivery on orders over GHS 200 · Shop now',
  announcement_show_whatsapp: true,

  category_bar_enabled: false,
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

  // Top campaign broadcast banner (Black Friday / Mega Sale)
  campaign_banner_enabled: true,
  campaign_theme: 'black_friday',
  campaign_badge: 'BLACK FRIDAY EVENT · LIMITED TIME DEALS',
  campaign_headline: 'Up to 50% Off Bestselling Beauty',
  campaign_subtext: 'Slashed prices on authentic, direct-sourced skincare, fragrances, and haircare. Sealed guarantee with fast nationwide delivery.',
  campaign_coupon_code: '',
  campaign_cta_text: 'Shop Black Friday Deals',
  campaign_cta_link: '/shop?on_sale=true',
  campaign_ends_at: '',
  campaign_guarantee: '✓ 100% Authentic Brands',
  campaign_perk1: 'Free delivery over GHS 200',
  campaign_perk2: 'Accra same-day & 24h dispatch',
  campaign_perk3: 'Pay on Delivery available',
  campaign_stock_percentage: 84,
  campaign_stock_label: '84% claimed',
  campaign_stock_sub: 'Limited event stock',
  campaign_urgency_cta: 'Claim Black Friday Deals Now',

  // Jumia-inspired promotional modal popup (100% admin controlled)
  promo_popup_enabled: false,
  promo_popup_badge: '● BEAUTY EDIT · TODAY ONLY',
  promo_popup_title: 'Top Beauty Brands.',
  promo_popup_highlight: 'Up to 40% Off',
  promo_popup_discount: 'UP TO 40% OFF',
  promo_popup_subtext: '100% Authentic · Skincare, Makeup & Fragrance · T&Cs apply',
  promo_popup_image: '',
  promo_popup_cta_text: 'Shop Deals',
  promo_popup_cta_link: '/shop',
  promo_popup_delay_sec: 2,

  // Jumia-inspired dual campaign split tiles
  campaign_tiles_enabled: false,
  tile1_badge: '',
  tile1_title: '',
  tile1_subtitle: '',
  tile1_cta_text: 'Shop Now',
  tile1_link: '/shop',
  tile1_image: '',
  tile2_badge: '',
  tile2_title: '',
  tile2_subtitle: '',
  tile2_cta_text: 'Explore',
  tile2_link: '/shop',
  tile2_image: '',

  // Jumia-inspired mid-page graphic banner & story carousel
  mid_banner_enabled: false,
  mid_banner_autoplay: true,
  mid_banner_interval_sec: 7,
  mid_banner_flip_speed_sec: 1.2,
  mid_banner_height_px: 620,
  mid_banner_badge: '',
  mid_banner_title: '',
  mid_banner_highlight: '',
  mid_banner_subtitle: '',
  mid_banner_cta_text: 'Explore Catalog',
  mid_banner_cta_link: '/shop',
  mid_banner_image: '',
  mid_banner_slides: [],

  // Brand story split section (image + text)
  brand_story_enabled: true,
  brand_story_image: '',
  brand_story_label: 'Why Shop With Us',
  brand_story_heading: 'Curated beauty, 100% authentic.',
  brand_story_body: 'Every product in our store is carefully selected from trusted global and local beauty brands — from daily skincare and serums to makeup, haircare, and signature fragrances.\n\nWe source directly from verified distributors, store every item in climate-controlled conditions, and deliver fast to your doorstep.',
  brand_story_cta_text: 'Browse All Brands',
  brand_story_cta_link: '/shop',

  // Jumia-inspired bottom SEO & regional editorial guide
  seo_editorial_enabled: true,
  seo_editorial_title: 'Authentic Cosmetics, Skincare, Makeup & Fragrances Online',
  seo_editorial_text: "Welcome to BodyCream GH, your trusted destination for authentic skincare, makeup, haircare, body care, and fragrances. Every product in our catalog is sourced from verified brand distributors and sealed for freshness. Whether you are shopping from Accra, Tema, Kumasi, Takoradi, or anywhere nationwide, enjoy fast dispatch, secure Paystack checkout (Mobile Money, Visa, Mastercard), Pay on Delivery options, and easy store pickup.",

  hero_label: 'Curated Beauty & Cosmetics',
  hero_headline: 'Every brand you love, in one place.',
  hero_subtitle: 'Shop 100% authentic skincare, makeup, haircare, body care, and fragrances — delivered fast.',
  hero_cta_text: 'Shop All Cosmetics',
  hero_cta_link: '/shop',
  hero_image: '',

  categories: [],

  testimonials: [],

  trust_items: [
    { icon: '🚚', label: 'Fast delivery',   sub: 'Free over GHS 200' },
    { icon: '✓',  label: '100% Authentic',  sub: 'Verified brands' },
    { icon: '↩',  label: '3-day returns',   sub: 'Easy exchanges' },
    { icon: '🔒', label: 'Secure checkout', sub: 'Paystack & MoMo' },
  ],

  footer_tagline: 'Your destination for 100% authentic skincare, makeup, haircare, body care, and fragrances.',
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

  const loadSettings = () => {
    settingsAPI.getAll()
      .then(({ data }) => {
        const merged = { ...DEFAULTS, ...data };
        if (!Array.isArray(data?.trust_items)) {
          const returnDays = Number(merged.return_window_days) || 3;
          merged.trust_items = DEFAULTS.trust_items.map(t =>
            t.icon === '↩' ? { ...t, label: `${returnDays}-day returns` } : t
          );
        }
        setSettings(merged);
        applyTheme(merged);
      })
      .catch(() => {
        // Backend unreachable — defaults are already applied
        applyTheme(DEFAULTS);
      });
  };

  useEffect(() => {
    loadSettings();

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        loadSettings();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
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
