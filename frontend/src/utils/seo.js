import { useEffect } from 'react';

function upsertMeta(attrName, attrValue, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attrName}="${attrValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href) {
  if (!href) return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function getCleanCanonical(customCanonical) {
  if (customCanonical) return customCanonical;
  if (typeof window === 'undefined') return '';
  const { origin, pathname, search } = window.location;
  if (pathname === '/shop') {
    const params = new URLSearchParams(search);
    const category = params.get('category');
    const brand = params.get('brand');
    const kept = new URLSearchParams();
    if (category) kept.set('category', category);
    if (brand) kept.set('brand', brand);
    const qs = kept.toString();
    return qs ? `${origin}/shop?${qs}` : `${origin}/shop`;
  }
  return `${origin}${pathname}`;
}

export function useSeo({ title, description, image, type = 'website', canonical = null, robots = null, jsonLd = null } = {}) {
  useEffect(() => {
    if (title) {
      document.title = title;
      upsertMeta('property', 'og:title', title);
      upsertMeta('name', 'twitter:title', title);
    }
    if (description) {
      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:description', description);
      upsertMeta('name', 'twitter:description', description);
    }
    if (type) upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:locale', 'en_GH');
    if (image) {
      upsertMeta('property', 'og:image', image);
      upsertMeta('name', 'twitter:image', image);
    }
    // Always reset robots so navigating away from a noindex page never leaves
    // public product/category pages stuck as noindex in SPA navigation.
    upsertMeta('name', 'robots', robots || 'index, follow');

    const cleanCanonical = getCleanCanonical(canonical);
    upsertCanonical(cleanCanonical);
    upsertMeta('property', 'og:url', cleanCanonical);

    const existing = document.getElementById('bc-jsonld');
    if (existing) existing.remove();

    if (jsonLd) {
      const script = document.createElement('script');
      script.id = 'bc-jsonld';
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      const tag = document.getElementById('bc-jsonld');
      if (tag) tag.remove();
    };
  }, [title, description, image, type, canonical, robots, jsonLd]);
}
