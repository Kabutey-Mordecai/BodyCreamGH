import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import './CategoryBar.css';

const DEFAULT_CATS = ['Body Cream', 'Body Butter', 'Body Oil', 'Body Scrub', 'Body Mask'];

function CategoryIcon({ label }) {
  const key = label.toLowerCase();
  if (key.includes('oil')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 2.5C12 2.5 6 9.5 6 14a6 6 0 0012 0c0-4.5-6-11.5-6-11.5z" />
      </svg>
    );
  }
  if (key.includes('scrub') || key.includes('mask')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
        <path d="M18.5 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z" />
      </svg>
    );
  }
  if (key.includes('butter')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="4" y="8" width="16" height="11" rx="3" />
        <path d="M7 8V6a2 2 0 012-2h6a2 2 0 012 2v2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="5" y="9" width="14" height="11" rx="2.5" />
      <path d="M8 9V6.5A1.5 1.5 0 019.5 5h5A1.5 1.5 0 0116 6.5V9" />
    </svg>
  );
}

export default function CategoryBar() {
  const { categories, category_bar_enabled } = useSettings();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  if (category_bar_enabled === false || category_bar_enabled === 'false') {
    return null;
  }

  // Hide on auth/checkout distraction-free flows
  if (['/checkout', '/login', '/register', '/forgot-password', '/reset-password'].includes(pathname)) {
    return null;
  }

  const activeCategory = pathname === '/shop' ? (searchParams.get('category') || '') : '';
  const activeSort = pathname === '/shop' ? (searchParams.get('sort') || '') : '';

  const catLabels = Array.isArray(categories) && categories.length > 0
    ? categories.map(c => (typeof c === 'string' ? c : c.label)).filter(Boolean)
    : DEFAULT_CATS;

  return (
    <nav className="category-bar" aria-label="Product categories">
      <div className="container category-bar-inner">
        <Link
          to="/shop"
          className={`cat-bar-pill${pathname === '/shop' && !activeCategory && activeSort !== 'price_low' ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <span>All Products</span>
        </Link>

        {catLabels.map(label => (
          <Link
            key={label}
            to={`/shop?category=${encodeURIComponent(label)}`}
            className={`cat-bar-pill${activeCategory === label ? ' is-active' : ''}`}
          >
            <CategoryIcon label={label} />
            <span>{label}</span>
          </Link>
        ))}

        <Link
          to="/shop?sort=price_low"
          className={`cat-bar-pill cat-bar-pill--accent${pathname === '/shop' && activeSort === 'price_low' && !activeCategory ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 10-12h-7l0-8z" />
          </svg>
          <span>Deals</span>
        </Link>

        <Link
          to="/track"
          className={`cat-bar-pill${pathname === '/track' || pathname === '/track-order' ? ' is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M3 7h11v10H3z" />
            <path d="M14 10h4l3 3v4h-7v-7z" />
            <circle cx="7.5" cy="17.5" r="1.5" />
            <circle cx="17.5" cy="17.5" r="1.5" />
          </svg>
          <span>Track Order</span>
        </Link>
      </div>
    </nav>
  );
}
