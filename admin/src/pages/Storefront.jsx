import { useEffect, useState } from 'react';
import { settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import ImageInput from '../components/ImageInput';
import UnsavedChangesBar from '../components/UnsavedChangesBar';
import { resolveImageUrl } from '../utils/resolveImageUrl';

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'https://bodycreamgh-shop.vercel.app';

/*
 The Storefront Editor is the "non-developer magic" — it lets the store owner
 edit every piece of copy and imagery on the public home page without touching
 code. Values persist via a key/value `site_settings` table on the backend
 (endpoints: GET /api/settings, PUT /api/settings).

 If the backend endpoints aren't wired yet, this page falls back to localStorage
 so the editor still works end-to-end for demo/testing. Once the backend routes
 exist, nothing changes on this page — it already uses the real API.
*/

// Each section is one tab with its own fields.
const SECTIONS = [
  { id: 'announcement', label: 'Announcement bar' },
  { id: 'popup',        label: 'Promotional popup ✦' },
  { id: 'hero',         label: 'Hero banner' },
  { id: 'campaigns',    label: 'Campaign banners' },
  { id: 'newsletter',   label: 'Newsletter section' },
  { id: 'layout',       label: 'Layout & features' },
  { id: 'categories',   label: 'Category cards' },
  { id: 'testimonials', label: 'Testimonials' },
  { id: 'trust',        label: 'Trust promises' },
  { id: 'faq',          label: 'FAQs' },
  { id: 'seo',          label: 'SEO editorial' },
  { id: 'footer',       label: 'Footer' },
];

const DEFAULT_FAQS = [
  {
    q: 'How do I place an order on BodyCream GH?',
    a: 'Add your favourite products to cart and check out online as a guest or registered customer in under 2 minutes. You can also tap "Order via WhatsApp" on any product page.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept MTN Mobile Money, Telecel Cash, Visa, Mastercard, and bank transfers securely via Paystack (plus Pay on Delivery when enabled).',
  },
  {
    q: 'How long does delivery take, and is Store Pickup available?',
    a: 'Accra deliveries take 1–2 business days and nationwide deliveries take 3–5 business days. Free Store Pickup is available in Accra.',
  },
  {
    q: 'What is your return & refund policy?',
    a: 'We offer hassle-free 3-day returns on unopened items and prompt replacements for any damaged delivery.',
  },
  {
    q: 'Are your skincare products authentic and safe for melanin-rich skin?',
    a: 'Yes. Every batch is handcrafted in Ghana with 100% raw Northern Ghana shea butter and botanical oils, free from parabens, sulfates, and harsh bleaching agents.',
  },
];

const DEFAULTS = {
  announcement_enabled: true,
  announcement_text: 'Free delivery on orders over GHS 200 · Shop now',
  announcement_show_whatsapp: true,

  // Newsletter section & welcome voucher
  newsletter_enabled: true,
  newsletter_headline: 'Get 10% off your first order',
  newsletter_subtitle: 'Join our newsletter for exclusive offers, skincare tips, and new arrivals.',
  newsletter_discount_text: '10% off',
  newsletter_coupon_code: 'WELCOME10',

  hero_label:      'Handcrafted in Ghana',
  hero_headline:   'Reveal your natural glow.',
  hero_subtitle:   'Luxury body creams blended with shea butter, cocoa butter, and Africa\'s finest botanicals.',
  hero_cta_text:   'Shop the Collection',
  hero_cta_link:   '/shop',
  hero_image:      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1600&q=85',

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

  // Campaign Broadcast Banner (Black Friday / Mega Sale / Seasonal)
  campaign_banner_enabled: true,
  campaign_theme: 'black_friday',
  campaign_badge: '⚡ BLACK FRIDAY MEGA DEALS',
  campaign_headline: 'UP TO 50% OFF EVERYTHING',
  campaign_subtext: 'Exclusive Black Friday prices on authentic skincare, makeup & fragrances. Limited stock.',
  campaign_coupon_code: 'BF50',
  campaign_cta_text: 'Shop Black Friday',
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

  // Jumia-inspired mid-page graphic banner & story carousel
  mid_banner_enabled: true,
  mid_banner_autoplay: true,
  mid_banner_interval_sec: 7,
  mid_banner_flip_speed_sec: 1.4,
  mid_banner_height_px: 620,
  mid_banner_badge: 'PURE GHANAIAN BOTANICALS',
  mid_banner_title: 'Handcrafted in Small Batches.',
  mid_banner_highlight: 'Zero Harsh Bleaching Agents.',
  mid_banner_subtitle: 'Raw unrefined shea butter from Northern Ghana cooperatives, blended with botanical oils for rich, natural skin nutrition.',
  mid_banner_cta_text: 'Learn Our Story',
  mid_banner_cta_link: '/#our-story',
  mid_banner_image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80',
  mid_banner_slides: [
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
  ],

  // Jumia-inspired bottom SEO & regional editorial guide
  seo_editorial_enabled: true,
  seo_editorial_title: 'Handcrafted Luxury Skincare & Organic Body Creams in Ghana',
  seo_editorial_text: "Welcome to BodyCream GH, Ghana's premier destination for raw, unrefined shea butter creams, botanical radiance oils, and whipped moisturizing butters. Every formulation is handcrafted in Ghana using sustainably wildcrafted shea nuts harvested by women cooperatives across the Northern Region. Whether you are in Accra, Tema, Kumasi, Takoradi, Sunyani, or Tamale, we deliver glowing, deeply nourished skin directly to your doorstep with same-day express delivery in Accra and swift nationwide dispatch. Enjoy complete peace of mind with 100% secure Paystack checkout supporting MTN Mobile Money, Telecel Cash, Visa, and Mastercard, plus Pay on Delivery and free Store Pickup in Accra.",

  categories: [
    { label: 'Body Cream',  image: 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Butter', image: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Oil',    image: 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Scrub',  image: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=400&h=500&q=80' },
    { label: 'Body Mask',   image: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=400&h=500&q=80' },
  ],

  testimonials: [
    { name: 'Abena K.', location: 'Accra', text: 'The Shea Butter Cream completely transformed my skin.' },
    { name: 'Ama S.',   location: 'Kumasi', text: 'I love the Rose Gold Radiance Oil! The scent is divine.' },
    { name: 'Efua M.',  location: 'Takoradi', text: 'Fast delivery, beautiful packaging, and the products actually work!' },
  ],

  trust_items: [
    { icon: '🚚', label: 'Free delivery', sub: 'Over GHS 200' },
    { icon: '✦',  label: 'Handcrafted',   sub: 'In small batches' },
    { icon: '↩',  label: '3-day returns', sub: 'No questions asked' },
    { icon: '🔒', label: 'Secure checkout', sub: 'Paystack' },
  ],

  footer_tagline: 'Luxury body creams blended with shea butter, cocoa butter, and Africa\'s finest botanicals — handcrafted in Ghana.',
  footer_instagram: 'https://instagram.com',
  footer_facebook:  'https://facebook.com',
  footer_whatsapp:  'https://wa.me',
  footer_tiktok:    'https://tiktok.com',
};

const LOCAL_KEY = 'admin_storefront_draft';

export default function Storefront() {
  const toast = useToast();
  const [active, setActive] = useState('hero');
  const [data, setData]     = useState(DEFAULTS);
  const [initialData, setInitialData] = useState(DEFAULTS);
  const [dirty, setDirty]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);

  // Load from backend; fall back to localStorage so the editor is always usable.
  useEffect(() => {
    (async () => {
      try {
        const { data: remote } = await settingsAPI.getAll();
        // Backend returns { key1: value1, ... } — merge into defaults so new keys show up
        const merged = { ...DEFAULTS, ...remote };
        setData(merged);
        setInitialData(merged);
      } catch {
        toast.warning('Could not load storefront settings from server; showing locally cached values.');
        const cached = localStorage.getItem(LOCAL_KEY);
        if (cached) {
          try {
            const merged = { ...DEFAULTS, ...JSON.parse(cached) };
            setData(merged);
            setInitialData(merged);
          }
          catch { /* fall through to defaults */ }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = () => {
    setData(initialData);
    setDirty(false);
  };

  const update = (key, value) => {
    setData(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateArray = (key, index, field, value) => {
    setData(prev => ({
      ...prev,
      [key]: prev[key].map((item, i) => i === index ? { ...item, [field]: value } : item),
    }));
    setDirty(true);
  };

  const addToArray = (key, item) => {
    setData(prev => ({ ...prev, [key]: [...(prev[key] || []), item] }));
    setDirty(true);
  };

  const removeFromArray = (key, index) => {
    setData(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
    setDirty(true);
  };

  const midBannerSlides = (Array.isArray(data.mid_banner_slides) && data.mid_banner_slides.length > 0)
    ? data.mid_banner_slides
    : [
        {
          badge: data.mid_banner_badge || DEFAULTS.mid_banner_badge,
          title: data.mid_banner_title || DEFAULTS.mid_banner_title,
          highlight: data.mid_banner_highlight || DEFAULTS.mid_banner_highlight,
          subtitle: data.mid_banner_subtitle || DEFAULTS.mid_banner_subtitle,
          cta_text: data.mid_banner_cta_text || DEFAULTS.mid_banner_cta_text,
          cta_link: data.mid_banner_cta_link || DEFAULTS.mid_banner_cta_link,
          image: data.mid_banner_image || DEFAULTS.mid_banner_image,
        },
      ];

  const updateMidSlide = (index, field, value) => {
    const list = [...midBannerSlides];
    list[index] = { ...list[index], [field]: value };
    setData(prev => {
      const next = { ...prev, mid_banner_slides: list };
      if (index === 0) {
        if (field === 'badge') next.mid_banner_badge = value;
        if (field === 'title') next.mid_banner_title = value;
        if (field === 'highlight') next.mid_banner_highlight = value;
        if (field === 'subtitle') next.mid_banner_subtitle = value;
        if (field === 'cta_text') next.mid_banner_cta_text = value;
        if (field === 'cta_link') next.mid_banner_cta_link = value;
        if (field === 'image') next.mid_banner_image = value;
      }
      return next;
    });
    setDirty(true);
  };

  const addMidSlide = () => {
    const list = [
      ...midBannerSlides,
      {
        badge: 'NEW PROMOTION',
        title: 'Featured Botanical Care',
        highlight: 'Limited Time Offer',
        subtitle: 'Handcrafted luxury body care blended with Ghana botanicals.',
        cta_text: 'Shop Now',
        cta_link: '/shop',
        image: 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=700&q=80',
      },
    ];
    setData(prev => ({ ...prev, mid_banner_slides: list }));
    setDirty(true);
    setPreviewSlideIdx(list.length - 1);
  };

  const removeMidSlide = (index) => {
    if (midBannerSlides.length <= 1) return;
    const list = midBannerSlides.filter((_, i) => i !== index);
    setData(prev => {
      const next = { ...prev, mid_banner_slides: list };
      if (list[0]) {
        next.mid_banner_badge = list[0].badge;
        next.mid_banner_title = list[0].title;
        next.mid_banner_highlight = list[0].highlight;
        next.mid_banner_subtitle = list[0].subtitle;
        next.mid_banner_cta_text = list[0].cta_text;
        next.mid_banner_cta_link = list[0].cta_link;
        next.mid_banner_image = list[0].image;
      }
      return next;
    });
    setDirty(true);
    setPreviewSlideIdx(prev => Math.min(prev, list.length - 1));
  };

  const moveMidSlide = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= midBannerSlides.length) return;
    const list = [...midBannerSlides];
    const temp = list[index];
    list[index] = list[target];
    list[target] = temp;
    setData(prev => {
      const next = { ...prev, mid_banner_slides: list };
      if (list[0]) {
        next.mid_banner_badge = list[0].badge;
        next.mid_banner_title = list[0].title;
        next.mid_banner_highlight = list[0].highlight;
        next.mid_banner_subtitle = list[0].subtitle;
        next.mid_banner_cta_text = list[0].cta_text;
        next.mid_banner_cta_link = list[0].cta_link;
        next.mid_banner_image = list[0].image;
      }
      return next;
    });
    setDirty(true);
    setPreviewSlideIdx(target);
  };

  const applyCampaignPreset = (preset) => {
    if (preset === 'black_friday') {
      setData(prev => ({
        ...prev,
        campaign_banner_enabled: true,
        campaign_theme: 'black_friday',
        campaign_badge: '⚡ BLACK FRIDAY MEGA DEALS',
        campaign_headline: 'UP TO 50% OFF EVERYTHING',
        campaign_subtext: 'Ghana\'s biggest beauty event — authentic luxury skincare, makeup & fragrances at slashed prices.',
        campaign_coupon_code: 'BF50',
        campaign_cta_text: 'Shop Black Friday',
        campaign_cta_link: '/shop?on_sale=true',
        campaign_guarantee: '✓ 100% Authentic Brands',
        campaign_perk1: 'Free delivery over GHS 200',
        campaign_perk2: 'Accra same-day & 24h dispatch',
        campaign_perk3: 'Pay on Delivery available',
        campaign_stock_percentage: 84,
        campaign_stock_label: '84% claimed',
        campaign_stock_sub: 'Limited event stock',
        campaign_urgency_cta: 'Claim Black Friday Deals Now',
      }));
    } else if (preset === 'flash_sale') {
      setData(prev => ({
        ...prev,
        campaign_banner_enabled: true,
        campaign_theme: 'flash_sale',
        campaign_badge: '🔥 TODAY\'S FLASH DEALS',
        campaign_headline: 'FLASH SALE · LIMITED TIME',
        campaign_subtext: 'Prices drop today only. Claim your glow before limited stock runs out.',
        campaign_coupon_code: 'FLASH20',
        campaign_cta_text: 'Claim Flash Deals',
        campaign_cta_link: '/shop?on_sale=true',
        campaign_guarantee: '⚡ Lightning Express Drop',
        campaign_perk1: 'Free delivery over GHS 200',
        campaign_perk2: 'Dispatches within 2h in Accra',
        campaign_perk3: 'Pay on Delivery & MoMo accepted',
        campaign_stock_percentage: 92,
        campaign_stock_label: '92% sold out',
        campaign_stock_sub: 'Flash drop ends at midnight',
        campaign_urgency_cta: 'Claim Flash Deals Now',
      }));
    } else if (preset === 'holiday_glow') {
      setData(prev => ({
        ...prev,
        campaign_banner_enabled: true,
        campaign_theme: 'holiday_glow',
        campaign_badge: '✨ HOLIDAY GLOW CELEBRATION',
        campaign_headline: 'CELEBRATE WITH GOLDEN SKIN',
        campaign_subtext: 'Gift yourself or someone special authentic handcrafted beauty & luxury fragrances.',
        campaign_coupon_code: 'GLOW15',
        campaign_cta_text: 'Explore Holiday Gifts',
        campaign_cta_link: '/shop?on_sale=true',
        campaign_guarantee: '✨ Gift-Ready Sealed Packaging',
        campaign_perk1: 'Complimentary gift wrapping',
        campaign_perk2: 'Nationwide express holiday dispatch',
        campaign_perk3: 'Pay on Delivery & MoMo accepted',
        campaign_stock_percentage: 75,
        campaign_stock_label: '75% reserved',
        campaign_stock_sub: 'Holiday edition batch',
        campaign_urgency_cta: 'Claim Holiday Gifts Now',
      }));
    }
    setDirty(true);
    toast.success('Campaign preset applied! Click "Publish changes" to push live.');
  };

  const save = async () => {
    setSaving(true);
    const filteredData = Object.fromEntries(
      Object.entries(data).filter(([key]) => Object.prototype.hasOwnProperty.call(DEFAULTS, key))
    );
    try {
      // Try the bulk endpoint, falling back to localStorage if backend isn't ready.
      const entries = Object.entries(filteredData).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateMany(entries);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(filteredData));
      setInitialData(data);
      toast.success('Storefront updated');
      setDirty(false);
    } catch {
      // Backend endpoint may not exist yet — persist locally so the editor still demos.
      localStorage.setItem(LOCAL_KEY, JSON.stringify(filteredData));
      toast.error('Failed to save storefront settings to server. Changes kept locally.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Storefront Editor</h1>
          <p className="muted">Edit every piece of your home page — no code needed.</p>
        </div>
        <div className="page-actions">
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="btn btn-outline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
            Open storefront
          </a>
          <button className="btn btn-accent" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Publish changes' : 'All saved'}
          </button>
        </div>
      </div>

      {dirty && (
        <div className="alert alert-warning">
          You have unsaved changes. Click <strong>Publish changes</strong> to push them live.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }} className="sf-grid">

        {/* Section tabs (left rail) */}
        <div>
          <div className="card">
            <div style={{ padding: 6 }}>
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`sf-tab ${active === s.id ? 'active' : ''}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section editor + preview (right) */}
        <div>
          {active === 'announcement' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Announcement bar</h2></div>
              <div className="card-body">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!data.announcement_enabled}
                      onChange={e => update('announcement_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show the announcement bar above the navigation</span>
                  </label>
                </div>
                <div className="field">
                  <label>Announcement text</label>
                  <input
                    type="text"
                    value={data.announcement_text}
                    onChange={e => update('announcement_text', e.target.value)}
                    maxLength={100}
                  />
                  <div className="hint">Keep it short — customers scan, they don't read.</div>
                </div>
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.announcement_show_whatsapp !== false}
                      onChange={e => update('announcement_show_whatsapp', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show "Order on WhatsApp" link in the bar (when WhatsApp number is set in Settings)</span>
                  </label>
                </div>

                <div className="sf-preview" style={{ background: 'var(--ac-sidebar)', color: '#fff', textAlign: 'center', padding: '10px 20px', fontSize: '0.8rem', letterSpacing: '0.04em' }}>
                  {data.announcement_enabled ? (data.announcement_text || 'Your announcement here') : <em>Bar is hidden</em>}
                </div>
              </div>
            </div>
          )}

          {active === 'popup' && (
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 className="card-title">Promotional Popup (Jumia Brand Day Style)</h2>
                  <span className="badge" style={{
                    background: data.promo_popup_enabled ? 'var(--ac-success-light, #dcfce7)' : 'var(--ac-border, #e5e7eb)',
                    color: data.promo_popup_enabled ? 'var(--ac-success, #16a34a)' : 'var(--ac-text-muted, #64748b)',
                    fontWeight: 600,
                  }}>
                    {data.promo_popup_enabled ? '● Active' : '○ Disabled'}
                  </span>
                </div>
              </div>
              <div className="card-body">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!data.promo_popup_enabled}
                      onChange={e => update('promo_popup_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <strong>Enable Promotional Popup Modal on Storefront</strong>
                  </label>
                  <div className="hint">
                    Turn this on when running special sales, Brand Days, or flash promotions. It shows once per session to visitors after a brief delay.
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Eyebrow pill badge</label>
                    <input
                      type="text"
                      value={data.promo_popup_badge || ''}
                      onChange={e => update('promo_popup_badge', e.target.value)}
                      placeholder="● BRAND DAY · TODAY ONLY"
                    />
                  </div>
                  <div className="field">
                    <label>Floating discount badge pill</label>
                    <input
                      type="text"
                      value={data.promo_popup_discount || ''}
                      onChange={e => update('promo_popup_discount', e.target.value)}
                      placeholder="UP TO 50% OFF"
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Primary headline</label>
                    <input
                      type="text"
                      value={data.promo_popup_title || ''}
                      onChange={e => update('promo_popup_title', e.target.value)}
                      placeholder="Pure Shea Radiance."
                    />
                  </div>
                  <div className="field">
                    <label>Highlighted accent phrase</label>
                    <input
                      type="text"
                      value={data.promo_popup_highlight || ''}
                      onChange={e => update('promo_popup_highlight', e.target.value)}
                      placeholder="Slashed Prices"
                    />
                    <div className="hint">Styled in glowing flame/gold color to catch immediate attention.</div>
                  </div>
                </div>

                <div className="field">
                  <label>Subtitle / Terms &amp; disclaimer</label>
                  <textarea
                    rows={2}
                    value={data.promo_popup_subtext || ''}
                    onChange={e => update('promo_popup_subtext', e.target.value)}
                    placeholder="Limited quantity · Handcrafted in Ghana · T&Cs apply"
                  />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Action button label (CTA)</label>
                    <input
                      type="text"
                      value={data.promo_popup_cta_text || ''}
                      onChange={e => update('promo_popup_cta_text', e.target.value)}
                      placeholder="Claim Your Glow"
                    />
                  </div>
                  <div className="field">
                    <label>Action button link</label>
                    <input
                      type="text"
                      value={data.promo_popup_cta_link || ''}
                      onChange={e => update('promo_popup_cta_link', e.target.value)}
                      placeholder="/shop"
                    />
                  </div>
                  <div className="field" style={{ maxWidth: 120 }}>
                    <label>Delay (sec)</label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={data.promo_popup_delay_sec ?? 2}
                      onChange={e => update('promo_popup_delay_sec', Number(e.target.value))}
                    />
                  </div>
                </div>

                <ImageInput
                  label="Featured promotion image"
                  value={data.promo_popup_image || ''}
                  onChange={url => update('promo_popup_image', url)}
                  hint="Upload a promotion banner or paste an image link. Leave blank for default collection photography."
                />

                {/* Live Preview of Promotional Popup */}
                <div style={{ marginTop: 24 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ac-text-muted)' }}>
                    Live Modal Preview {data.promo_popup_enabled ? '' : '(Currently Disabled on Live Site)'}
                  </label>
                  <div className="sf-popup-preview-grid" style={{
                    marginTop: 8,
                    background: '#14110f',
                    border: '1px solid rgba(201, 165, 90, 0.3)',
                    borderRadius: 14,
                    padding: 20,
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 0.8fr',
                    gap: 16,
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                  }}>
                    {/* Simulated Close X */}
                    <div style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: '#fff',
                      color: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 'bold',
                      zIndex: 5,
                    }}>✕</div>

                    <div>
                      <div style={{
                        display: 'inline-block',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: '#e5c378',
                        background: 'rgba(201,165,90,0.15)',
                        border: '1px solid rgba(201,165,90,0.35)',
                        padding: '2px 8px',
                        borderRadius: 9999,
                        marginBottom: 8,
                      }}>
                        {data.promo_popup_badge || '● BRAND DAY · TODAY ONLY'}
                      </div>
                      <h3 style={{
                        color: '#fff',
                        fontSize: '1.25rem',
                        fontWeight: 700,
                        margin: '0 0 6px 0',
                        fontFamily: 'Cormorant Garamond, serif',
                        lineHeight: 1.2,
                      }}>
                        {data.promo_popup_title || 'Pure Shea Radiance.'}{' '}
                        <span style={{ color: '#f97316' }}>{data.promo_popup_highlight || 'Slashed Prices'}</span>
                      </h3>
                      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', margin: '0 0 14px 0', lineHeight: 1.4 }}>
                        {data.promo_popup_subtext || 'Limited quantity · Handcrafted in Ghana · T&Cs apply'}
                      </p>
                      <button type="button" className="btn btn-accent btn-sm" style={{ pointerEvents: 'none' }}>
                        {data.promo_popup_cta_text || 'Claim Your Glow'} →
                      </button>
                    </div>

                    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', minHeight: 120 }}>
                      <img
                        src={resolveImageUrl(data.promo_popup_image) || 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80'}
                        alt="Preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      {data.promo_popup_discount && (
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: 6,
                          transform: 'translateY(-50%) rotate(-8deg)',
                          background: 'linear-gradient(135deg, #4f46e5, #3730a3)',
                          color: '#fff',
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          fontSize: '0.58rem',
                          fontWeight: 800,
                          boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
                        }}>
                          {data.promo_popup_discount}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {active === 'campaigns' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Campaign Banners & Promotional Broadcasts</h2></div>
              <div className="card-body">

                {/* ══════════════════════════════════════════
                    0. TOP CAMPAIGN BROADCAST BANNER (Black Friday / Mega Sale)
                    ══════════════════════════════════════════ */}
                <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid var(--ac-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>⚡</span> Black Friday & Campaign Broadcast Takeover
                      </h3>
                      <p className="hint" style={{ marginTop: 4 }}>
                        High-impact promotional broadcast banner with countdown timer, 1-click coupon vouchers, and urgency badges (Jumia / Francophone African e-commerce style).
                      </p>
                    </div>

                    {/* Quick 1-Click Presets */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--ac-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        1-Click Presets:
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => applyCampaignPreset('black_friday')}
                        title="Load Black Friday 50% Off theme with BF50 coupon"
                      >
                        ⚡ Black Friday (50%)
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => applyCampaignPreset('flash_sale')}
                        title="Load Flash Sale theme with FLASH20 coupon"
                      >
                        🔥 Flash Sale (20%)
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => applyCampaignPreset('holiday_glow')}
                        title="Load Holiday Glow theme with GLOW15 coupon"
                      >
                        ✨ Holiday Glow (15%)
                      </button>
                    </div>
                  </div>

                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.campaign_banner_enabled !== false}
                        onChange={e => update('campaign_banner_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <strong>Enable Top Campaign Broadcast Banner on Storefront & Shop</strong>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
                    <div className="field">
                      <label>Campaign Theme</label>
                      <select
                        value={data.campaign_theme || 'black_friday'}
                        onChange={e => update('campaign_theme', e.target.value)}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 6, border: '1px solid var(--ac-border)' }}
                      >
                        <option value="black_friday">Black Friday (Obsidian Black & Luxury Gold)</option>
                        <option value="flash_sale">Flash Sale (Flame Crimson & Gold Urgency)</option>
                        <option value="holiday_glow">Holiday Glow (Emerald Green & Festive Gold)</option>
                      </select>
                      <div className="hint">Changes banner background gradients and accent colors.</div>
                    </div>

                    <div className="field">
                      <label>Urgent Badge Text</label>
                      <input
                        type="text"
                        value={data.campaign_badge || ''}
                        onChange={e => update('campaign_badge', e.target.value)}
                        placeholder="⚡ BLACK FRIDAY MEGA DEALS"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                    <div className="field">
                      <label>Main Headline</label>
                      <input
                        type="text"
                        value={data.campaign_headline || ''}
                        onChange={e => update('campaign_headline', e.target.value)}
                        placeholder="UP TO 50% OFF EVERYTHING"
                      />
                    </div>

                    <div className="field">
                      <label>Coupon Voucher Code (1-Click Copyable)</label>
                      <input
                        type="text"
                        value={data.campaign_coupon_code || ''}
                        onChange={e => update('campaign_coupon_code', e.target.value.toUpperCase())}
                        placeholder="BF50"
                      />
                      <div className="hint">Shoppers can tap this on the banner to copy and auto-apply at checkout.</div>
                    </div>
                  </div>

                  <div className="field" style={{ marginTop: 12 }}>
                    <label>Subtext / Persuasive Reason to Buy</label>
                    <input
                      type="text"
                      value={data.campaign_subtext || ''}
                      onChange={e => update('campaign_subtext', e.target.value)}
                      placeholder="Exclusive Black Friday prices on authentic skincare, makeup & fragrances. Limited stock."
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 12 }}>
                    <div className="field">
                      <label>Button Text</label>
                      <input
                        type="text"
                        value={data.campaign_cta_text || ''}
                        onChange={e => update('campaign_cta_text', e.target.value)}
                        placeholder="Shop Black Friday"
                      />
                    </div>

                    <div className="field">
                      <label>Button Link</label>
                      <input
                        type="text"
                        value={data.campaign_cta_link || ''}
                        onChange={e => update('campaign_cta_link', e.target.value)}
                        placeholder="/shop"
                      />
                    </div>

                    <div className="field">
                      <label>Campaign End Date / Time (Optional)</label>
                      <input
                        type="datetime-local"
                        value={data.campaign_ends_at ? new Date(data.campaign_ends_at).toISOString().slice(0, 16) : ''}
                        onChange={e => update('campaign_ends_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                      />
                      <div className="hint">Leave empty to use rolling midnight countdown.</div>
                    </div>
                  </div>

                  {/* Trust Perks & Stock Urgency Meter Controls */}
                  <div style={{ marginTop: 16, padding: 14, background: 'var(--ac-surface-2)', borderRadius: 8 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Trust Perks & Stock Urgency Meters</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div className="field">
                        <label>Top Guarantee Badge</label>
                        <input
                          type="text"
                          value={data.campaign_guarantee || ''}
                          onChange={e => update('campaign_guarantee', e.target.value)}
                          placeholder="✓ 100% Authentic Brands"
                        />
                      </div>
                      <div className="field">
                        <label>Countdown Card Action Text</label>
                        <input
                          type="text"
                          value={data.campaign_urgency_cta || ''}
                          onChange={e => update('campaign_urgency_cta', e.target.value)}
                          placeholder="Claim Black Friday Deals Now"
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 10 }}>
                      <div className="field">
                        <label>Trust Perk #1</label>
                        <input
                          type="text"
                          value={data.campaign_perk1 || ''}
                          onChange={e => update('campaign_perk1', e.target.value)}
                          placeholder="Free delivery over GHS 200"
                        />
                      </div>
                      <div className="field">
                        <label>Trust Perk #2</label>
                        <input
                          type="text"
                          value={data.campaign_perk2 || ''}
                          onChange={e => update('campaign_perk2', e.target.value)}
                          placeholder="Accra same-day & 24h dispatch"
                        />
                      </div>
                      <div className="field">
                        <label>Trust Perk #3</label>
                        <input
                          type="text"
                          value={data.campaign_perk3 || ''}
                          onChange={e => update('campaign_perk3', e.target.value)}
                          placeholder="Pay on Delivery available"
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 14, marginTop: 10 }}>
                      <div className="field">
                        <label>Claimed %</label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={data.campaign_stock_percentage || 84}
                          onChange={e => update('campaign_stock_percentage', Number(e.target.value))}
                        />
                      </div>
                      <div className="field">
                        <label>Stock Claim Label</label>
                        <input
                          type="text"
                          value={data.campaign_stock_label || ''}
                          onChange={e => update('campaign_stock_label', e.target.value)}
                          placeholder="84% claimed"
                        />
                      </div>
                      <div className="field">
                        <label>Stock Sub-label</label>
                        <input
                          type="text"
                          value={data.campaign_stock_sub || ''}
                          onChange={e => update('campaign_stock_sub', e.target.value)}
                          placeholder="Limited event stock"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 1. Dual Split Campaign Tiles */}
                <div style={{ marginBottom: 28 }}>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.campaign_tiles_enabled !== false}
                        onChange={e => update('campaign_tiles_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <strong>Show Dual Split Campaign Tiles on Home Page</strong>
                    </label>
                    <div className="hint">Two side-by-side promotional cards highlighting featured product lines.</div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                    {/* Tile 1 */}
                    <div style={{ padding: 14, background: 'var(--ac-surface-2)', borderRadius: 8 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Campaign Tile #1 (Left)</h4>
                      <div className="field">
                        <label>Badge</label>
                        <input
                          type="text"
                          value={data.tile1_badge || ''}
                          onChange={e => update('tile1_badge', e.target.value)}
                          placeholder="LIMITED BATCH"
                        />
                      </div>
                      <div className="field">
                        <label>Title</label>
                        <input
                          type="text"
                          value={data.tile1_title || ''}
                          onChange={e => update('tile1_title', e.target.value)}
                          placeholder="Whipped Shea Butters"
                        />
                      </div>
                      <div className="field">
                        <label>Subtitle</label>
                        <input
                          type="text"
                          value={data.tile1_subtitle || ''}
                          onChange={e => update('tile1_subtitle', e.target.value)}
                          placeholder="Deep 48-hour moisture..."
                        />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Button text</label>
                          <input
                            type="text"
                            value={data.tile1_cta_text || ''}
                            onChange={e => update('tile1_cta_text', e.target.value)}
                            placeholder="Shop Butters"
                          />
                        </div>
                        <div className="field">
                          <label>Link</label>
                          <input
                            type="text"
                            value={data.tile1_link || ''}
                            onChange={e => update('tile1_link', e.target.value)}
                            placeholder="/shop?category=Body+Butter"
                          />
                        </div>
                      </div>
                      <ImageInput
                        label="Campaign Tile #1 Image"
                        value={data.tile1_image || ''}
                        onChange={url => update('tile1_image', url)}
                      />
                    </div>

                    {/* Tile 2 */}
                    <div style={{ padding: 14, background: 'var(--ac-surface-2)', borderRadius: 8 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Campaign Tile #2 (Right)</h4>
                      <div className="field">
                        <label>Badge</label>
                        <input
                          type="text"
                          value={data.tile2_badge || ''}
                          onChange={e => update('tile2_badge', e.target.value)}
                          placeholder="HOT SELLER"
                        />
                      </div>
                      <div className="field">
                        <label>Title</label>
                        <input
                          type="text"
                          value={data.tile2_title || ''}
                          onChange={e => update('tile2_title', e.target.value)}
                          placeholder="Botanical Radiance Oils"
                        />
                      </div>
                      <div className="field">
                        <label>Subtitle</label>
                        <input
                          type="text"
                          value={data.tile2_subtitle || ''}
                          onChange={e => update('tile2_subtitle', e.target.value)}
                          placeholder="Fast-absorbing golden glow..."
                        />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Button text</label>
                          <input
                            type="text"
                            value={data.tile2_cta_text || ''}
                            onChange={e => update('tile2_cta_text', e.target.value)}
                            placeholder="Explore Oils"
                          />
                        </div>
                        <div className="field">
                          <label>Link</label>
                          <input
                            type="text"
                            value={data.tile2_link || ''}
                            onChange={e => update('tile2_link', e.target.value)}
                            placeholder="/shop?category=Body+Oil"
                          />
                        </div>
                      </div>
                      <ImageInput
                        label="Campaign Tile #2 Image"
                        value={data.tile2_image || ''}
                        onChange={url => update('tile2_image', url)}
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Mid-Page Graphic Trust Banner & Story Carousel */}
                <div style={{ borderTop: '1px solid var(--ac-border)', paddingTop: 20 }}>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.mid_banner_enabled !== false}
                        onChange={e => update('mid_banner_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <strong>Show Mid-Page Story Carousel &amp; Graphic Campaign Banner</strong>
                    </label>
                    <div className="hint">Full-width high-contrast banner &amp; auto-flipping product story carousel showcasing quality guarantees, botanical stories, and product collections.</div>
                  </div>

                  {/* Autoplay, Interval, Flip Speed & Height Controls */}
                  <div style={{ marginTop: 14, padding: 16, background: 'var(--ac-surface-2)', borderRadius: 8 }}>
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={data.mid_banner_autoplay !== false}
                          onChange={e => update('mid_banner_autoplay', e.target.checked)}
                          style={{ width: 'auto' }}
                        />
                        <strong>Enable Automatic Page Flipping (Auto-Play)</strong>
                      </label>
                      <div className="hint">Slides transition automatically like a digital lookbook; pauses gracefully when shoppers hover or touch.</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Reading Time (seconds)</label>
                        <input
                          type="number"
                          min="3"
                          max="30"
                          value={data.mid_banner_interval_sec || 7}
                          onChange={e => update('mid_banner_interval_sec', Math.max(3, parseInt(e.target.value) || 7))}
                        />
                        <div className="hint">How long each story displays (default 7s).</div>
                      </div>

                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Flip Animation Speed (seconds)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.4"
                          max="3.0"
                          value={data.mid_banner_flip_speed_sec ?? 1.4}
                          onChange={e => update('mid_banner_flip_speed_sec', Math.max(0.4, parseFloat(e.target.value) || 1.4))}
                        />
                        <div className="hint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>Gentle &amp; realistic turn (default 1.4s).</span>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                            onClick={() => update('mid_banner_flip_speed_sec', 1.4)}
                          >
                            Set 1.4s (Realistic)
                          </button>
                        </div>
                      </div>

                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Banner Height (px)</label>
                        <input
                          type="number"
                          step="10"
                          min="260"
                          max="900"
                          value={data.mid_banner_height_px ?? 620}
                          onChange={e => update('mid_banner_height_px', Math.max(260, parseInt(e.target.value) || 620))}
                        />
                        <div className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                            onClick={() => update('mid_banner_height_px', 620)}
                          >
                            620px (Default - Recommended)
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                            onClick={() => update('mid_banner_height_px', 520)}
                          >
                            520px (Tall)
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                            onClick={() => update('mid_banner_height_px', 420)}
                          >
                            420px (Medium)
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                            onClick={() => update('mid_banner_height_px', 340)}
                          >
                            340px (Slim)
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Slide Manager Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Carousel Story Slides ({midBannerSlides.length})</h4>
                      <p className="hint" style={{ margin: '2px 0 0 0' }}>Add multiple promotional stories or product highlights that shoppers can flip through.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => update('mid_banner_slides', DEFAULTS.mid_banner_slides)}
                        title="Load 3 default luxury beauty slides"
                      >
                        Reset Defaults
                      </button>
                      <button
                        type="button"
                        className="btn btn-accent btn-sm"
                        onClick={addMidSlide}
                      >
                        + Add Slide
                      </button>
                    </div>
                  </div>

                  {/* Slide Cards List */}
                  {midBannerSlides.map((slide, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 16,
                        background: 'var(--ac-surface-2)',
                        border: previewSlideIdx === idx ? '2px solid var(--ac-accent)' : '1px solid var(--ac-border)',
                        borderRadius: 8,
                        marginBottom: 14,
                        transition: 'border-color 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            background: previewSlideIdx === idx ? 'var(--ac-accent)' : 'var(--ac-border)',
                            color: previewSlideIdx === idx ? '#fff' : 'inherit',
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                          }}>
                            Slide #{idx + 1}
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{slide.title || 'Untitled Slide'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => moveMidSlide(idx, -1)}
                            disabled={idx === 0}
                            title="Move slide up in order"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => moveMidSlide(idx, 1)}
                            disabled={idx === midBannerSlides.length - 1}
                            title="Move slide down in order"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setPreviewSlideIdx(idx)}
                            style={{ fontSize: '0.8rem' }}
                          >
                            {previewSlideIdx === idx ? '● Previewing' : 'Preview'}
                          </button>
                          {midBannerSlides.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--ac-danger)' }}
                              onClick={() => removeMidSlide(idx)}
                              title="Delete this slide"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="field">
                        <label>Badge pill text</label>
                        <input
                          type="text"
                          value={slide.badge || ''}
                          onChange={e => updateMidSlide(idx, 'badge', e.target.value)}
                          placeholder="PURE GHANAIAN BOTANICALS"
                        />
                      </div>

                      <ImageInput
                        label="Product / Story Image"
                        value={slide.image || ''}
                        onChange={url => updateMidSlide(idx, 'image', url)}
                        hint="Upload a slide photo or paste an image link."
                      />

                      <div className="field-row">
                        <div className="field">
                          <label>Photo Fit / Framing</label>
                          <select
                            value={slide.image_fit || 'cover'}
                            onChange={e => updateMidSlide(idx, 'image_fit', e.target.value)}
                          >
                            <option value="cover">Fill &amp; Bleed (Cover — fills entire half page)</option>
                            <option value="contain">Fit Entire Product (Contain — zero cropping, fits photos of any height)</option>
                          </select>
                          <div className="hint">Choose "Contain" for tall bottles or packaging so the whole product fits perfectly.</div>
                        </div>
                        <div className="field">
                          <label>Photo Vertical Focus</label>
                          <select
                            value={slide.image_position || 'center'}
                            onChange={e => updateMidSlide(idx, 'image_position', e.target.value)}
                          >
                            <option value="center">Center (Default)</option>
                            <option value="top">Top (Keep bottle cap / pump visible)</option>
                            <option value="bottom">Bottom (Keep label / base visible)</option>
                          </select>
                        </div>
                      </div>

                      <div className="field-row">
                        <div className="field">
                          <label>Headline Title</label>
                          <input
                            type="text"
                            value={slide.title || ''}
                            onChange={e => updateMidSlide(idx, 'title', e.target.value)}
                            placeholder="Handcrafted in Small Batches."
                          />
                        </div>
                        <div className="field">
                          <label>Highlighted Accent Text</label>
                          <input
                            type="text"
                            value={slide.highlight || ''}
                            onChange={e => updateMidSlide(idx, 'highlight', e.target.value)}
                            placeholder="Zero Harsh Bleaching Agents."
                          />
                        </div>
                      </div>

                      <div className="field">
                        <label>Subtitle / Description</label>
                        <textarea
                          rows={2}
                          value={slide.subtitle || ''}
                          onChange={e => updateMidSlide(idx, 'subtitle', e.target.value)}
                          placeholder="Raw unrefined shea butter from Northern Ghana..."
                        />
                      </div>

                      <div className="field-row" style={{ marginBottom: 0 }}>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Button Text</label>
                          <input
                            type="text"
                            value={slide.cta_text || ''}
                            onChange={e => updateMidSlide(idx, 'cta_text', e.target.value)}
                            placeholder="Learn Our Story"
                          />
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Button Link</label>
                          <input
                            type="text"
                            value={slide.cta_link || ''}
                            onChange={e => updateMidSlide(idx, 'cta_link', e.target.value)}
                            placeholder="/#our-story or /shop?category=Body+Cream"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Live Visual Preview Card */}
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem' }}>Live Carousel Preview (Admin)</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setPreviewSlideIdx(prev => (prev - 1 + midBannerSlides.length) % midBannerSlides.length)}
                          disabled={midBannerSlides.length <= 1}
                        >
                          ‹
                        </button>
                        <span style={{ fontSize: '0.78rem', color: 'var(--ac-text-muted)' }}>
                          {previewSlideIdx + 1} / {midBannerSlides.length}
                        </span>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setPreviewSlideIdx(prev => (prev + 1) % midBannerSlides.length)}
                          disabled={midBannerSlides.length <= 1}
                        >
                          ›
                        </button>
                      </div>
                    </div>

                    {(() => {
                      const cur = midBannerSlides[previewSlideIdx] || midBannerSlides[0];
                      return (
                        <div
                          style={{
                            background: '#14110e',
                            borderRadius: 12,
                            padding: 20,
                            color: '#fff',
                            display: 'grid',
                            gridTemplateColumns: '1.4fr 1fr',
                            gap: 20,
                            alignItems: 'center',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                            overflow: 'hidden',
                            position: 'relative',
                          }}
                        >
                          <div>
                            {cur.badge && (
                              <span style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                background: 'rgba(217,119,6,0.18)',
                                border: '1px solid rgba(217,119,6,0.4)',
                                borderRadius: 10,
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                color: '#f59e0b',
                                marginBottom: 10,
                              }}>
                                {cur.badge}
                              </span>
                            )}
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', lineHeight: 1.25, color: '#f5f5f4' }}>
                              {cur.title}{' '}
                              {cur.highlight && (
                                <span style={{ color: '#d97706', fontStyle: 'italic', display: 'block' }}>
                                  {cur.highlight}
                                </span>
                              )}
                            </h3>
                            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', margin: '0 0 14px 0', lineHeight: 1.45 }}>
                              {cur.subtitle}
                            </p>
                            <button
                              type="button"
                              className="btn btn-accent btn-sm"
                              style={{ pointerEvents: 'none' }}
                            >
                              {cur.cta_text || 'Learn More'} →
                            </button>
                          </div>

                          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', height: 140 }}>
                            <img
                              src={resolveImageUrl(cur.image)}
                              alt={cur.title}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </div>

                          {/* Dots in preview */}
                          <div style={{
                            position: 'absolute',
                            bottom: 8,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            display: 'flex',
                            gap: 6,
                          }}>
                            {midBannerSlides.map((_, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setPreviewSlideIdx(i)}
                                style={{
                                  width: i === previewSlideIdx ? 18 : 6,
                                  height: 6,
                                  borderRadius: 3,
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  background: i === previewSlideIdx ? '#d97706' : 'rgba(255,255,255,0.3)',
                                  transition: 'all 0.2s ease',
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

              </div>
            </div>
          )}

          {active === 'layout' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Layout &amp; conversion features</h2></div>
              <div className="card-body">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.category_bar_enabled !== false}
                      onChange={e => update('category_bar_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show horizontal Category Quick-Bar below navigation</span>
                  </label>
                  <div className="hint">Displays scrollable category shortcuts, Deals, and Track Order directly under the header.</div>
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.quick_add_enabled !== false}
                      onChange={e => update('quick_add_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show one-tap "+" Quick-Add button on product cards</span>
                  </label>
                  <div className="hint">Lets mobile &amp; desktop shoppers add items to cart directly from product shelves.</div>
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.recently_viewed_enabled !== false}
                      onChange={e => update('recently_viewed_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show "Recently viewed" shelf on the home page</span>
                  </label>
                  <div className="hint">Automatically appears for returning visitors who have viewed products on this device.</div>
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.whatsapp_float_enabled !== false}
                      onChange={e => update('whatsapp_float_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show floating "Chat with us" WhatsApp button</span>
                  </label>
                  <div className="hint">Requires a WhatsApp number in Settings → Customer support. Automatically hidden on Cart and Checkout.</div>
                </div>

                <div style={{ borderTop: '1px solid var(--ac-border)', paddingTop: 14, marginTop: 14 }}>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.flash_sale_enabled !== false}
                        onChange={e => update('flash_sale_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <span>Show Flash Sale / Deals shelf on home page</span>
                    </label>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Flash sale badge</label>
                      <input
                        type="text"
                        value={data.flash_sale_badge || ''}
                        onChange={e => update('flash_sale_badge', e.target.value)}
                        placeholder="Flash Sale"
                      />
                    </div>
                    <div className="field">
                      <label>Flash sale heading</label>
                      <input
                        type="text"
                        value={data.flash_sale_title || ''}
                        onChange={e => update('flash_sale_title', e.target.value)}
                        placeholder="Today's Deals"
                      />
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--ac-border)', paddingTop: 14, marginTop: 14 }}>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.back_to_top_enabled !== false}
                        onChange={e => update('back_to_top_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <span>Show "Back to top ↑" bar above the footer</span>
                    </label>
                  </div>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.footer_payment_badges_enabled !== false}
                        onChange={e => update('footer_payment_badges_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <span>Show payment &amp; delivery method badges in footer</span>
                    </label>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={data.animations_enabled !== false}
                        onChange={e => update('animations_enabled', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <span>Enable storefront animations (scroll reveals, hero entrance &amp; micro-interactions)</span>
                    </label>
                    <div className="hint">Automatically respects visitors' OS "Reduce Motion" accessibility preference.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {active === 'hero' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Hero banner</h2></div>
              <div className="card-body">
                <div className="field">
                  <label>Eyebrow label</label>
                  <input
                    type="text"
                    value={data.hero_label}
                    onChange={e => update('hero_label', e.target.value)}
                    placeholder="Handcrafted in Ghana"
                  />
                </div>

                <div className="field">
                  <label>Headline</label>
                  <input
                    type="text"
                    value={data.hero_headline}
                    onChange={e => update('hero_headline', e.target.value)}
                    placeholder="Reveal your natural glow."
                  />
                  <div className="hint">The biggest text on your site. Make it a promise.</div>
                </div>

                <div className="field">
                  <label>Subtitle</label>
                  <textarea
                    rows={2}
                    value={data.hero_subtitle}
                    onChange={e => update('hero_subtitle', e.target.value)}
                  />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Button text</label>
                    <input
                      type="text"
                      value={data.hero_cta_text}
                      onChange={e => update('hero_cta_text', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Button link</label>
                    <input
                      type="text"
                      value={data.hero_cta_link}
                      onChange={e => update('hero_cta_link', e.target.value)}
                      placeholder="/shop"
                    />
                  </div>
                </div>

                <ImageInput
                  label="Hero banner image"
                  value={data.hero_image || ''}
                  onChange={url => update('hero_image', url)}
                  hint="Upload a wide high-resolution hero photo (16:9 or banner) or paste an image link."
                />

                <div className="sf-preview hero-preview" style={{
                  backgroundImage: data.hero_image ? `url(${resolveImageUrl(data.hero_image)})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  minHeight: 260, borderRadius: 10, overflow: 'hidden',
                  position: 'relative', color: '#fff',
                }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, rgba(28,20,16,0.7), transparent 60%)' }} />
                  <div style={{ position: 'relative', padding: '40px 32px', maxWidth: 480 }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                      {data.hero_label}
                    </div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.2rem', fontWeight: 500, lineHeight: 1.1, marginBottom: 10 }}>
                      {data.hero_headline}
                    </div>
                    <div style={{ fontSize: '0.88rem', marginBottom: 18, color: 'rgba(255,255,255,0.85)' }}>
                      {data.hero_subtitle}
                    </div>
                    <div style={{ display: 'inline-block', background: 'var(--ac-accent)', color: '#fff', padding: '9px 22px', borderRadius: 6, fontSize: '0.76rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      {data.hero_cta_text || 'Shop now'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {active === 'categories' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Category cards</h2>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => addToArray('categories', { label: 'New Category', image: '' })}
                >+ Add category</button>
              </div>
              <div className="card-body">
                <div className="hint" style={{ marginBottom: 14 }}>
                  These categories power both the homepage Category Cards grid and the horizontal Category Quick-Bar below the header.
                </div>
                {(data.categories || []).map((cat, i) => (
                  <div key={i} className="sf-row" style={{ padding: '14px 16px', background: 'var(--ac-surface-2)', borderRadius: 'var(--ac-radius)', marginBottom: 14, border: '1px solid var(--ac-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Category #{i + 1}: {cat.label || 'Untitled'}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--ac-danger)' }}
                        onClick={() => removeFromArray('categories', i)}
                      >Remove category</button>
                    </div>
                    <div className="field" style={{ marginBottom: 12 }}>
                      <label>Category name</label>
                      <input
                        type="text"
                        value={cat.label}
                        onChange={e => updateArray('categories', i, 'label', e.target.value)}
                        placeholder="e.g. Body Butter"
                      />
                    </div>
                    <ImageInput
                      label="Category image"
                      value={cat.image}
                      onChange={url => updateArray('categories', i, 'image', url)}
                      hint="Upload category photography or paste an image link."
                    />
                  </div>
                ))}
                {(data.categories || []).length === 0 && (
                  <div className="empty" style={{ padding: 30 }}>
                    <p>No categories yet. Click <strong>Add category</strong> to get started.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {active === 'testimonials' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Customer testimonials</h2>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => addToArray('testimonials', { name: '', location: '', text: '' })}
                >+ Add testimonial</button>
              </div>
              <div className="card-body">
                {(data.testimonials || []).map((t, i) => (
                  <div key={i} className="sf-testimonial" style={{ padding: 14, background: 'var(--ac-surface-2)', borderRadius: 8, marginBottom: 12 }}>
                    <div className="field-row">
                      <div className="field" style={{ marginBottom: 10 }}>
                        <label>Name</label>
                        <input value={t.name} onChange={e => updateArray('testimonials', i, 'name', e.target.value)} />
                      </div>
                      <div className="field" style={{ marginBottom: 10 }}>
                        <label>Location</label>
                        <input value={t.location} onChange={e => updateArray('testimonials', i, 'location', e.target.value)} placeholder="Accra" />
                      </div>
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Quote</label>
                      <textarea rows={2} value={t.text} onChange={e => updateArray('testimonials', i, 'text', e.target.value)} />
                    </div>
                    <div style={{ textAlign: 'right', marginTop: 6 }}>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--ac-danger)' }} onClick={() => removeFromArray('testimonials', i)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {active === 'trust' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Trust promises</h2>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => addToArray('trust_items', { icon: '✓', label: '', sub: '' })}
                >+ Add</button>
              </div>
              <div className="card-body">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={data.trust_strip_enabled !== false}
                    onChange={e => update('trust_strip_enabled', e.target.checked)}
                  />
                  Show Trust Promises strip on Storefront (Home & Shop)
                </label>
                {(data.trust_items || []).map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 2fr auto', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <input value={t.icon} onChange={e => updateArray('trust_items', i, 'icon', e.target.value)} maxLength={4} style={{ textAlign: 'center', fontSize: '1.1rem' }} />
                    <input value={t.label} onChange={e => updateArray('trust_items', i, 'label', e.target.value)} placeholder="Fast delivery" />
                    <input value={t.sub}   onChange={e => updateArray('trust_items', i, 'sub', e.target.value)} placeholder="Free over {free_delivery_over}" />
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--ac-danger)' }} onClick={() => removeFromArray('trust_items', i)}>×</button>
                  </div>
                ))}
                <div className="hint" style={{ marginTop: 8 }}>
                  Icons can be emoji (🚚) or single characters (✦, ↩). Use <code>{'{free_delivery_over}'}</code> in any subtitle to auto-sync with your live Shipping threshold in Settings (or type any custom text).
                </div>
              </div>
            </div>
          )}

          {active === 'faq' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Frequently asked questions</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => update('faq_items', DEFAULT_FAQS)}
                    title="Populate with editable starter questions"
                  >Load starter FAQs</button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => addToArray('faq_items', { q: '', a: '' })}
                  >+ Add question</button>
                </div>
              </div>
              <div className="card-body">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.faq_enabled !== false}
                      onChange={e => update('faq_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Show FAQ section on the home page (also emits FAQPage SEO schema)</span>
                  </label>
                </div>

                <div className="field">
                  <label>Section heading</label>
                  <input
                    type="text"
                    value={data.faq_heading || ''}
                    onChange={e => update('faq_heading', e.target.value)}
                    placeholder="Frequently asked questions"
                  />
                </div>

                {(!data.faq_items || data.faq_items.length === 0) ? (
                  <div className="empty" style={{ padding: 24, textAlign: 'left' }}>
                    <p style={{ marginBottom: 6 }}>
                      <strong>Using smart automatic FAQs.</strong>
                    </p>
                    <p className="muted text-sm" style={{ margin: 0 }}>
                      When left empty, the storefront automatically generates 5 Ghana-focused FAQs using your live Delivery, Store Pickup, and Pay on Delivery settings. Click <strong>Load starter FAQs</strong> or <strong>+ Add question</strong> to customize them manually.
                    </p>
                  </div>
                ) : (
                  (data.faq_items || []).map((item, i) => (
                    <div key={i} style={{ padding: 14, background: 'var(--ac-surface-2)', borderRadius: 8, marginBottom: 12 }}>
                      <div className="field" style={{ marginBottom: 10 }}>
                        <label>Question #{i + 1}</label>
                        <input
                          value={item.q || ''}
                          onChange={e => updateArray('faq_items', i, 'q', e.target.value)}
                          placeholder="e.g. How long does delivery take?"
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Answer</label>
                        <textarea
                          rows={2}
                          value={item.a || ''}
                          onChange={e => updateArray('faq_items', i, 'a', e.target.value)}
                          placeholder="Write a clear, concise answer..."
                        />
                      </div>
                      <div style={{ textAlign: 'right', marginTop: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--ac-danger)' }}
                          onClick={() => removeFromArray('faq_items', i)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {active === 'seo' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">SEO &amp; Regional Editorial Guide (Jumia Pattern)</h2></div>
              <div className="card-body">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={data.seo_editorial_enabled !== false}
                      onChange={e => update('seo_editorial_enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <strong>Show SEO &amp; Regional Shopping Guide on Home Page</strong>
                  </label>
                  <div className="hint">
                    Crawlable editorial block placed above the footer that helps Google rank your store for searches like "body cream in accra", "shea butter kumasi", and answers regional customer questions.
                  </div>
                </div>

                <div className="field">
                  <label>Section Heading</label>
                  <input
                    type="text"
                    value={data.seo_editorial_title || ''}
                    onChange={e => update('seo_editorial_title', e.target.value)}
                    placeholder="Handcrafted Luxury Skincare &amp; Organic Body Creams in Ghana"
                  />
                </div>

                <div className="field">
                  <label>Crawlable Editorial Copy</label>
                  <textarea
                    rows={6}
                    value={data.seo_editorial_text || ''}
                    onChange={e => update('seo_editorial_text', e.target.value)}
                    placeholder="Describe your delivery across Accra, Kumasi, Takoradi, payment methods via Mobile Money, and raw ingredients..."
                  />
                  <div className="hint">Mention your shipping timelines, Accra pickup location, Paystack / MoMo security, and raw Northern Shea sources.</div>
                </div>
              </div>
            </div>
          )}

          {active === 'newsletter' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Homepage Newsletter & Welcome Offer</h2>
                  <p className="card-subtitle" style={{ color: 'var(--ac-text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
                    Configure the email subscription banner on the homepage and the welcome voucher sent to new subscribers.
                  </p>
                </div>
              </div>
              <div className="card-body">
                <div className="field">
                  <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={data.newsletter_enabled !== false && data.newsletter_enabled !== 'false'}
                      onChange={e => update('newsletter_enabled', e.target.checked)}
                    />
                    <span style={{ fontWeight: 600 }}>Enable Newsletter Section on Homepage</span>
                  </label>
                  <p className="hint">When disabled, the newsletter banner will be hidden from the storefront.</p>
                </div>

                <div className="field">
                  <label>Section Headline</label>
                  <input
                    type="text"
                    value={data.newsletter_headline || ''}
                    onChange={e => update('newsletter_headline', e.target.value)}
                    placeholder="e.g. Get 10% off your first order"
                  />
                  <p className="hint">Primary heading displayed above the email input box on the storefront.</p>
                </div>

                <div className="field">
                  <label>Subtitle / Description</label>
                  <textarea
                    rows={2}
                    value={data.newsletter_subtitle || ''}
                    onChange={e => update('newsletter_subtitle', e.target.value)}
                    placeholder="e.g. Join our newsletter for exclusive offers, skincare tips, and new arrivals."
                  />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Discount Label in Welcome Email</label>
                    <input
                      type="text"
                      value={data.newsletter_discount_text || ''}
                      onChange={e => update('newsletter_discount_text', e.target.value)}
                      placeholder="e.g. 10% off or GHS 20 off"
                    />
                    <p className="hint">Used in the welcome email subject and copy (e.g. "Here's your 10% off coupon code").</p>
                  </div>

                  <div className="field">
                    <label>Welcome Coupon Code</label>
                    <input
                      type="text"
                      value={data.newsletter_coupon_code || ''}
                      onChange={e => update('newsletter_coupon_code', e.target.value.toUpperCase())}
                      placeholder="e.g. WELCOME10"
                    />
                    <p className="hint">This promo code is prominently framed inside the subscriber welcome email.</p>
                  </div>
                </div>

                {/* Live Preview Card */}
                <div style={{ marginTop: '24px', padding: '24px', background: '#1c1410', borderRadius: '12px', color: '#ffffff', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#c9a55a', fontWeight: 700 }}>Storefront Preview</span>
                  <h3 style={{ margin: '12px 0 6px', fontSize: '1.4rem', fontFamily: 'serif' }}>{data.newsletter_headline || 'Get 10% off your first order'}</h3>
                  <p style={{ margin: 0, fontSize: '0.88rem', opacity: 0.85, maxWidth: '480px', marginInline: 'auto' }}>
                    {data.newsletter_subtitle || 'Join our newsletter for exclusive offers, skincare tips, and new arrivals.'}
                  </p>
                  <div style={{ marginTop: '16px', display: 'inline-flex', maxWidth: '420px', width: '100%', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ flex: 1, background: '#ffffff', color: '#9ca3af', padding: '10px 14px', fontSize: '0.85rem', textAlign: 'left' }}>Enter your email address</div>
                    <div style={{ background: '#c9a55a', color: '#ffffff', padding: '10px 18px', fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase' }}>Subscribe</div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {active === 'footer' && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Footer</h2></div>
              <div className="card-body">
                <div className="field">
                  <label>Tagline</label>
                  <textarea rows={2} value={data.footer_tagline} onChange={e => update('footer_tagline', e.target.value)} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Instagram URL</label>
                    <input type="url" value={data.footer_instagram} onChange={e => update('footer_instagram', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Facebook URL</label>
                    <input type="url" value={data.footer_facebook} onChange={e => update('footer_facebook', e.target.value)} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>WhatsApp URL</label>
                    <input type="url" value={data.footer_whatsapp} onChange={e => update('footer_whatsapp', e.target.value)} placeholder="https://wa.me/233..." />
                  </div>
                  <div className="field">
                    <label>TikTok URL</label>
                    <input type="url" value={data.footer_tiktok} onChange={e => update('footer_tiktok', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .sf-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .sf-popup-preview-grid { grid-template-columns: 1fr !important; }
        }
        .sf-tab {
          width: 100%;
          padding: 10px 12px;
          background: none;
          border: none;
          border-radius: 6px;
          text-align: left;
          font-size: 0.88rem;
          color: var(--ac-text-muted);
          font-weight: 500;
          cursor: pointer;
          display: block;
          margin-bottom: 2px;
        }
        .sf-tab:hover { background: var(--ac-bg); color: var(--ac-text); }
        .sf-tab.active {
          background: var(--ac-accent-light);
          color: var(--ac-accent-dark);
        }
        .sf-preview {
          margin-top: 16px;
          padding: 12px 18px;
          border-radius: 8px;
        }
      `}</style>
      <UnsavedChangesBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={discard}
        saveLabel="Publish changes"
      />
    </div>
  );
}
