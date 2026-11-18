// Netlify Edge Function: injects server-side Open Graph tags for /products/:id
// so WhatsApp, Instagram, Facebook, Telegram, and Twitter link previews show
// the real product photo, title, and GHS price (social scrapers don't run React).

const CRAWLER_RE = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|Instagram|Pinterest|Applebot/i;
const UUID_RE    = /^\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default async function handler(request, context) {
  const ua = request.headers.get('user-agent') || '';
  if (!CRAWLER_RE.test(ua)) {
    return context.next();
  }

  const url = new URL(request.url);
  const match = url.pathname.match(UUID_RE);
  if (!match) return context.next();

  const productId = match[1];
  const apiBase = (globalThis.Netlify?.env?.get('VITE_API_URL') || '').replace(/\/$/, '');
  if (!apiBase) return context.next();

  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  try {
    const prodRes = await fetch(`${apiBase}/products/${encodeURIComponent(productId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!prodRes.ok) return response;
    const product = await prodRes.json();

    const apiOrigin = new URL(apiBase).origin;
    const rawImg = product.image_url || '';
    const imageUrl = rawImg.startsWith('http') ? rawImg : (rawImg ? `${apiOrigin}${rawImg}` : '');
    const price = Number.isFinite(Number(product.price)) ? `GHS ${Number(product.price).toFixed(2)}` : '';
    const title = `${product.name}${price ? ` — ${price}` : ''} | BodyCream GH`;
    const desc  = (product.description || `Shop ${product.name} at BodyCream GH.`).slice(0, 180);

    const ogTags = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(desc)}" />`,
      `<meta property="og:type" content="product" />`,
      `<meta property="og:url" content="${escapeHtml(url.href)}" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(desc)}" />`,
      imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : '',
      price ? `<meta property="product:price:amount" content="${escapeHtml(Number(product.price).toFixed(2))}" />` : '',
      price ? `<meta property="product:price:currency" content="GHS" />` : '',
      `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />`,
    ].filter(Boolean).join('\n    ');

    const html = await response.text();
    const updated = html
      .replace(/<title>[\s\S]*?<\/title>/i, '')
      .replace(/<meta[^>]+property="og:(title|description|type|image)"[^>]*>/gi, '')
      .replace('</head>', `    ${ogTags}\n  </head>`);

    return new Response(updated, {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    return response;
  }
}
