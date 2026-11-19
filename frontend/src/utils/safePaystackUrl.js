export function isSafePaystackCheckoutUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://checkout.paystack.com';
  } catch {
    return false;
  }
}
