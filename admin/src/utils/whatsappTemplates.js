/**
 * WhatsApp deep-link builder and standardized customer messaging templates for BodyCream GH.
 * Automatically normalizes Ghanaian mobile numbers (e.g. "024 123 4567" -> "233241234567").
 */

export function normalizeGhanaPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('0')) {
    return `233${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `233${digits}`;
  }
  if (digits.startsWith('233')) {
    return digits;
  }
  return digits;
}

export function buildWhatsAppLink(phone, messageText = '') {
  const norm = normalizeGhanaPhone(phone);
  if (!norm) return null;
  const baseUrl = `https://wa.me/${norm}`;
  if (!messageText) return baseUrl;
  return `${baseUrl}?text=${encodeURIComponent(messageText)}`;
}

export const WA_TEMPLATES = {
  orderConfirmation: (order) => {
    const num = order.order_number || String(order.id || '').slice(0, 8);
    const name = order.first_name || order.customer_name || 'valued customer';
    const total = Number(order.total_amount || 0).toFixed(2);
    const method = order.payment_method === 'pay_on_delivery' ? 'Pay on Delivery (COD)' : 'Paid Online';
    return `Hello ${name}! ✨ Thank you for shopping with BodyCream GH.\n\nYour order #${num} (Total: GHS ${total} · ${method}) has been received and is being prepared for dispatch.\n\nThank you for choosing authentic skincare!`;
  },

  deliveryHandoffWithOtp: (order, delivery, otp) => {
    const num = order.order_number || String(order.id || '').slice(0, 8);
    const name = order.first_name || order.customer_name || 'valued customer';
    const rider = delivery?.delivery_partner || 'our dispatch rider';
    const phone = delivery?.driver_phone ? ` (${delivery.driver_phone})` : '';
    const tracking = delivery?.tracking_number ? `\nTracking #: ${delivery.tracking_number}` : '';
    const otpMsg = otp ? `\n\n🔒 Your 6-digit delivery inspection code is: *${otp}*.\nPlease inspect your parcel upon arrival and share this code with the rider only after you confirm your items.` : '';
    return `Hello ${name}! 🛵 Your BodyCream GH order #${num} is on the way with ${rider}${phone}.${tracking}${otpMsg}\n\nHave questions? Reply directly to this chat!`;
  },

  paymentReminderCod: (order) => {
    const num = order.order_number || String(order.id || '').slice(0, 8);
    const name = order.first_name || order.customer_name || 'valued customer';
    const total = Number(order.total_amount || 0).toFixed(2);
    return `Hello ${name}! 📦 A quick reminder regarding your BodyCream GH order #${num}.\n\nYour parcel is scheduled for delivery today. Amount due on delivery is *GHS ${total}* (Cash or MoMo accepted).\n\nPlease ensure someone is available at the delivery address. Thank you!`;
  },

  readyForPickup: (order, store = {}) => {
    const num = order.order_number || String(order.id || '').slice(0, 8);
    const name = order.first_name || order.customer_name || 'valued customer';
    const loc = store.pickup_location || 'East Legon Station (Accra)';
    const hours = store.pickup_hours || 'Mon–Sat, 9:00 AM – 6:00 PM';
    return `Hello ${name}! ✨ Your BodyCream GH order #${num} is packed and ready for pickup!\n\n📍 Location: ${loc}\n⏰ Hours: ${hours}\n\nPlease present this message or order #${num} when collecting your package.`;
  },

  abandonedCartReminder: (cart, discountCode = '') => {
    const name = cart.customer_name || cart.email?.split('@')[0] || 'there';
    const codeMsg = discountCode ? `\n\nUse code *${discountCode}* at checkout for an exclusive discount!` : '';
    return `Hi ${name}! ✨ We noticed you left some lovely skincare items in your BodyCream GH bag.${codeMsg}\n\nComplete your order here: https://bodycreamgh-shop.vercel.app/cart\n\nNeed help choosing the right cream? Reply here, we're happy to guide you!`;
  },
};
