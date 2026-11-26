import { useRef } from 'react';
import ProductCard from './ProductCard';
import './ProductShelf.css';

export default function ProductShelf({ products = [], ariaLabel = 'Products carousel', dark = false }) {
  const trackRef = useRef(null);

  if (!products.length) return null;

  const scrollByCard = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    const step = Math.max(260, Math.floor(el.clientWidth * 0.78));
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <div className={`product-shelf${dark ? ' product-shelf--dark' : ''}`} role="region" aria-label={ariaLabel}>
      <button
        type="button"
        className="shelf-nav-btn shelf-nav-btn--prev"
        onClick={() => scrollByCard(-1)}
        aria-label={`Scroll ${ariaLabel} left`}
      >
        ‹
      </button>

      <div className="product-shelf-track" ref={trackRef}>
        {products.map(p => (
          <div key={p.id} className="product-shelf-item">
            <ProductCard product={p} />
          </div>
        ))}
      </div>

      <button
        type="button"
        className="shelf-nav-btn shelf-nav-btn--next"
        onClick={() => scrollByCard(1)}
        aria-label={`Scroll ${ariaLabel} right`}
      >
        ›
      </button>
    </div>
  );
}
