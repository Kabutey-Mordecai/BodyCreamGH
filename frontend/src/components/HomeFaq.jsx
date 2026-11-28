import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import Reveal from './Reveal';
import './HomeFaq.css';

export function buildFaqItems(settings = {}) {
  // If the store owner configured custom FAQs in Admin → Storefront Editor, use those.
  if (Array.isArray(settings.faq_items) && settings.faq_items.length > 0) {
    const valid = settings.faq_items.filter(item => item && item.q?.trim() && item.a?.trim());
    if (valid.length > 0) return valid;
  }

  const storeName = settings.store_name || 'BodyCream GH';
  const accraEst = settings.delivery_estimate_accra || '1–2 business days';
  const nationEst = settings.delivery_estimate_nationwide || '3–5 business days';
  const freeOver = Number(settings.free_delivery_over);
  const pickupEnabled = settings.pickup_enabled !== false && settings.pickup_enabled !== 'false';
  const pickupLoc = settings.pickup_location || 'our Store Pickup Station';
  const pickupHours = settings.pickup_hours || 'Mon–Sat, 9:00 AM – 6:00 PM';
  const podEnabled = settings.pay_on_delivery_enabled === true || settings.pay_on_delivery_enabled === 'true';
  const podAccraOnly = settings.pay_on_delivery_accra_only !== false && settings.pay_on_delivery_accra_only !== 'false';
  const returnDays = Number(settings.return_window_days) || 3;

  const paymentAnswer = podEnabled
    ? `We accept MTN Mobile Money, Telecel Cash, Visa, Mastercard, and bank transfers securely via Paystack. Pay on Delivery (Cash or Mobile Money on arrival) is also available${podAccraOnly ? ' for Greater Accra deliveries and Store Pickup' : ''}.`
    : 'We accept MTN Mobile Money, Telecel Cash, Visa, Mastercard, and bank transfers securely via Paystack.';

  const deliveryAnswer = [
    `Accra deliveries take ${accraEst} and nationwide deliveries across Ghana take ${nationEst}.`,
    Number.isFinite(freeOver) && freeOver > 0 ? `Orders over GHS ${freeOver} qualify for free delivery.` : '',
    pickupEnabled ? `You can also pick up for free at our Pickup Station: ${pickupLoc} (${pickupHours}).` : '',
  ].filter(Boolean).join(' ');

  return [
    {
      q: `How do I place an order on ${storeName}?`,
      a: `Add your favourite products to cart, sign in or create an account in seconds, and check out online in under 2 minutes with Paystack MoMo, Card, or Pay on Delivery.`,
    },
    {
      q: 'What payment methods do you accept?',
      a: paymentAnswer,
    },
    {
      q: 'How long does delivery take, and is Store Pickup available?',
      a: deliveryAnswer,
    },
    {
      q: 'What is your return & refund policy?',
      a: `We offer hassle-free ${returnDays}-day returns on unopened items and prompt replacements for any damaged delivery. Track your order status anytime on our Track Order page.`,
    },
    {
      q: 'Are all cosmetics and beauty products 100% authentic?',
      a: 'Yes. Every skincare, makeup, haircare, and fragrance item is sourced directly from verified brand distributors, factory-sealed, and stored in climate-controlled conditions.',
    },
  ];
}

export default function HomeFaq() {
  const settings = useSettings();
  if (settings.faq_enabled === false || settings.faq_enabled === 'false') return null;
  const items = buildFaqItems(settings);
  if (!items.length) return null;

  return (
    <section id="faq" className="page-section home-faq-section">
      <Reveal className="container home-faq-container">
        <div className="section-header" style={{ textAlign: 'center' }}>
          <span className="section-label">Questions &amp; Answers</span>
          <h2 className="page-title">{settings.faq_heading || 'Frequently asked questions'}</h2>
          <div className="gold-divider" style={{ margin: '0 auto 16px' }} />
          <p className="page-subtitle" style={{ marginBottom: '32px' }}>
            {settings.faq_subtitle || 'Everything you need to know about ordering, delivery, and returns.'}
          </p>
        </div>

        <div className="home-faq-list">
          {items.map((item, idx) => (
            <details key={item.q} className="home-faq-item" open={idx === 0}>
              <summary className="home-faq-q">
                <span>{item.q}</span>
                <span className="home-faq-chevron" aria-hidden="true">+</span>
              </summary>
              <div className="home-faq-a">
                <p>{item.a}</p>
              </div>
            </details>
          ))}
        </div>

        <div className="home-faq-cta">
          <span>Already placed an order?</span>
          <Link to="/track" className="home-faq-link">Track your order →</Link>
        </div>
      </Reveal>
    </section>
  );
}
