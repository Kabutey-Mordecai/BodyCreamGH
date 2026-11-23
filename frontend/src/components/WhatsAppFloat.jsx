import { useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './WhatsAppFloat.css';

export default function WhatsAppFloat() {
  const { whatsapp_number, whatsapp_float_enabled, store_name } = useSettings();
  const { pathname } = useLocation();

  if (whatsapp_float_enabled === false || whatsapp_float_enabled === 'false') return null;
  if (
    pathname === '/checkout' ||
    pathname === '/cart' ||
    pathname.startsWith('/payment') ||
    pathname === '/login' ||
    pathname === '/register'
  ) {
    return null;
  }

  const digits = String(whatsapp_number || '').replace(/\D/g, '');
  if (!digits) return null;

  const waNumber = digits.length === 10 && digits.startsWith('0')
    ? `233${digits.slice(1)}`
    : digits;
  const greeting = `Hi ${store_name || 'GlowHaus Beauty'}, I have a question about your cosmetics.`;

  return (
    <a
      href={`https://wa.me/${waNumber}?text=${encodeURIComponent(greeting)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="whatsapp-float"
      aria-label={`Chat with ${store_name || 'GlowHaus Beauty'} on WhatsApp`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347" />
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.555 4.112 1.524 5.84L.057 23.27l5.565-1.455A11.93 11.93 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.802 9.802 0 01-5.002-1.371l-.36-.213-3.303.865.88-3.22-.233-.37A9.79 9.79 0 012.182 12C2.182 6.597 6.597 2.182 12 2.182S21.818 6.597 21.818 12 17.403 21.818 12 21.818z" />
      </svg>
      <span>Chat with us</span>
    </a>
  );
}
