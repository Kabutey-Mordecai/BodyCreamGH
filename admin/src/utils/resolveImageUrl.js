// Resolve a relative /uploads/... URL to an absolute URL using the API origin.
// In dev, VITE_API_URL is something like 'http://localhost:3000/api'.
// In production, it is 'https://api.yourdomain.com/api'.
// Extracting .origin gives us the server root where /uploads is served.
const _apiUrl = import.meta.env.VITE_API_URL || '';

export function resolveImageUrl(url) {
  if (!url || typeof url !== 'string' || url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  if (_apiUrl.startsWith('http')) {
    try {
      return `${new URL(_apiUrl).origin}${url.startsWith('/') ? '' : '/'}${url}`;
    } catch {
      /* fall through */
    }
  }
  return url; // relative — works with Vite /uploads proxy in dev
}

export default resolveImageUrl;
