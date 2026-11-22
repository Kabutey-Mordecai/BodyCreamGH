import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './PolicyPage.css';

export default function PolicyPage({ type = 'privacy' }) {
  const settings = useSettings() || {};
  const storeName = settings.store_name || 'BodyCream GH';
  const email = settings.store_email || settings.contact_email || 'hello@bodycreamgh.com';
  const phone = settings.store_phone || settings.contact_phone || settings.whatsapp_number || '+233 24 585 2804';
  const address = settings.pickup_location || settings.store_address || 'East Legon, Accra, Ghana';
  const pickupHours = settings.pickup_hours || 'Mon–Sat, 9:00 AM – 6:00 PM';
  const returnDays = Number(settings.return_window_days) || 7;
  const freeThreshold = Number(settings.free_delivery_threshold || settings.free_delivery_over) || 200;
  const accraFee = Number(settings.delivery_fee_accra) || 10;
  const nationFee = Number(settings.delivery_fee_flat) || 15;
  const accraEta = settings.delivery_estimate_accra || '1–2 business days';
  const nationEta = settings.delivery_estimate_nationwide || '3–5 business days';

  const configs = {
    privacy: {
      title: 'Privacy Policy',
      subtitle: 'How we protect your personal information under the Ghana Data Protection Act, 2012 (Act 843).',
      sections: [
        {
          heading: '1. Information We Collect',
          body: `${storeName} collects only the details needed to process your orders and improve your shopping experience: your name, email address, phone number, delivery address (including optional GhanaPostGPS code and landmark), and order history. Card and Mobile Money details are processed securely by Paystack and never stored on our servers.`,
        },
        {
          heading: '2. How We Use Your Data',
          body: 'We use your contact and delivery information to fulfill orders, send transactional order and dispatch updates, respond to support requests, and prevent fraud. You may unsubscribe from promotional emails at any time via the unsubscribe link in any newsletter.',
        },
        {
          heading: '3. Data Sharing & Retention',
          body: 'We share delivery details only with vetted dispatch partners and payment verification details with Paystack. We do not sell or rent customer personal data to third parties.',
        },
        {
          heading: '4. Your Rights & Contact',
          body: `You may request access to, correction of, or deletion of your personal data at any time by contacting us at ${email} or ${phone}.`,
        },
      ],
    },
    terms: {
      title: 'Terms & Conditions',
      subtitle: `Terms governing purchases and use of ${storeName}.`,
      sections: [
        {
          heading: '1. Orders & Pricing',
          body: `All prices are displayed in Ghana Cedis (GHS) and are subject to availability. Orders paid online via Paystack must be completed within 30 minutes; unpaid pending orders may be automatically cancelled to release stock.`,
        },
        {
          heading: '2. Payments',
          body: 'We accept Mobile Money (MTN MoMo, Telecel Cash, AT Money), Visa/Mastercard via Paystack, and Pay on Delivery / Pay on Pickup where enabled at checkout.',
        },
        {
          heading: '3. Product Information & Skincare Disclaimer',
          body: 'Our body creams, butters, oils, and scrubs are formulated for external cosmetic use only. Always patch-test a small area before full application and discontinue use if irritation occurs.',
        },
        {
          heading: '4. Governing Law',
          body: 'These terms are governed by the laws of the Republic of Ghana.',
        },
      ],
    },
    refund: {
      title: 'Refund & Return Policy',
      subtitle: `${returnDays}-day return guarantee on eligible unopened skincare items.`,
      sections: [
        {
          heading: '1. Return Eligibility',
          body: `You may request a return within ${returnDays} days of delivery if you received a wrong, damaged, or defective item, or if the product remains unopened, unused, and in its original sealed packaging.`,
        },
        {
          heading: '2. Hygiene & Cosmetic Exemptions',
          body: 'For health and hygiene protection, opened, unsealed, or used skincare jars, bottles, and scrubs cannot be returned unless the item arrived damaged or defective.',
        },
        {
          heading: '3. Refund Processing',
          body: 'Once a return is approved and inspected, Paystack refunds are initiated to your original Mobile Money wallet or card (typically 3–7 business days depending on your provider). Pay-on-Delivery orders are refunded via Mobile Money.',
        },
      ],
    },
    shipping: {
      title: 'Shipping & Delivery Policy',
      subtitle: 'Fast doorstep delivery across Accra and nationwide across Ghana.',
      sections: [
        {
          heading: '1. Delivery Fees & Free Delivery',
          body: `Greater Accra delivery is GHS ${accraFee.toFixed(2)} and Nationwide delivery is GHS ${nationFee.toFixed(2)}. Orders over GHS ${freeThreshold.toFixed(2)} qualify for FREE standard Accra delivery.`,
        },
        {
          heading: '2. Estimated Delivery Windows',
          body: `Greater Accra orders typically arrive within ${accraEta}. Regional / Nationwide deliveries arrive within ${nationEta}. Providing a GhanaPostGPS code and clear landmark helps riders deliver faster.`,
        },
        {
          heading: '3. Store Pickup',
          body: `Free pickup is available at ${address} (${pickupHours}). Wait for your "Ready for Pickup" confirmation before visiting.`,
        },
      ],
    },
    contact: {
      title: 'Contact & Support',
      subtitle: `Reach the ${storeName} team for order help, skincare advice, or wholesale inquiries.`,
      sections: [
        {
          heading: 'Customer Care',
          body: `Phone / WhatsApp: ${phone}\nEmail: ${email}`,
        },
        {
          heading: 'Pickup Location & Hours',
          body: `${address}\nHours: ${pickupHours}`,
        },
        {
          heading: 'Order Tracking',
          body: 'Need to check an existing order status? Visit our Order Tracker with your order number and email.',
        },
      ],
    },
  };

  const page = configs[type] || configs.privacy;

  useEffect(() => {
    document.title = `${page.title} — ${storeName}`;
  }, [page.title, storeName]);

  return (
    <div className="policy-page container">

      <nav className="policy-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span>{page.title}</span>
      </nav>

      <header className="policy-header">
        <h1>{page.title}</h1>
        <p className="policy-subtitle">{page.subtitle}</p>
      </header>

      <div className="policy-card">
        {page.sections.map((sec) => (
          <section key={sec.heading} className="policy-section">
            <h2>{sec.heading}</h2>
            <p>{sec.body}</p>
          </section>
        ))}

        {type === 'contact' && (
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {phone && (
              <a href={`tel:${phone}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
                📞 Call {phone}
              </a>
            )}
            {phone && (
              <a
                href={`https://wa.me/${phone.replace(/\D/g, '')}?text=Hello%20${encodeURIComponent(storeName)},%20I%20have%20an%20inquiry.`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline"
                style={{ textDecoration: 'none', borderColor: '#25D366', color: '#128C7E' }}
              >
                💬 Chat on WhatsApp
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} className="btn btn-outline" style={{ textDecoration: 'none' }}>
                ✉️ Email Us
              </a>
            )}
          </div>
        )}

        <div className="policy-footer-links">
          <Link to="/shop" className="btn btn-primary">Shop Collection</Link>
          <Link to="/track" className="btn btn-outline">Track an Order</Link>
        </div>
      </div>
    </div>
  );
}
