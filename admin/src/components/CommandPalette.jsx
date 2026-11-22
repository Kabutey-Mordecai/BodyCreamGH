import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './CommandPalette.css';

const DEFAULT_PAGES = [
  { label: 'Dashboard', path: '/', category: 'Navigation', icon: '✦' },
  { label: 'Orders', path: '/orders', category: 'Navigation', icon: '🛍️' },
  { label: 'Requests (Cancellations & Returns)', path: '/requests', category: 'Navigation', icon: '📥' },
  { label: 'Products', path: '/products', category: 'Navigation', icon: '📦' },
  { label: 'Inventory & Stock Logs', path: '/inventory', category: 'Navigation', icon: '📊' },
  { label: 'Customers', path: '/customers', category: 'Navigation', icon: '👥' },
  { label: 'Customer Reviews', path: '/reviews', category: 'Navigation', icon: '⭐' },
  { label: 'Discount Coupons', path: '/coupons', category: 'Navigation', icon: '🏷️' },
  { label: 'Flash Sales & Promotions', path: '/promotions', category: 'Navigation', icon: '⚡' },
  { label: 'Newsletter Campaigns', path: '/newsletter/compose', category: 'Navigation', icon: '✉️' },
  { label: 'Storefront CMS & Banners', path: '/storefront', category: 'Navigation', icon: '🎨' },
  { label: 'Theme & Brand Colors', path: '/theme', category: 'Navigation', icon: '🎭' },
  { label: 'Financials & P&L', path: '/financials', category: 'Navigation', icon: '💰' },
  { label: 'Store Analytics', path: '/analytics', category: 'Navigation', icon: '📈' },
  { label: 'Settings', path: '/settings', category: 'Navigation', icon: '⚙️' },
  { label: 'Admin Accounts', path: '/settings/admins', category: 'Navigation', icon: '🛡️' },
];

const QUICK_ACTIONS = [
  { label: 'Create New Product', path: '/products/new', category: 'Actions', icon: '➕' },
  { label: 'Compose Newsletter', path: '/newsletter/compose', category: 'Actions', icon: '✍️' },
  { label: 'Create Promo Coupon', path: '/coupons', category: 'Actions', icon: '🏷️' },
  { label: 'Visit Storefront (New Tab)', url: 'http://localhost:5173', external: true, category: 'Actions', icon: '↗️' },
];

export default function CommandPalette({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [liveResults, setLiveResults] = useState({ orders: [], products: [], customers: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setLiveResults({ orders: [], products: [], customers: [] });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Live search debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setLiveResults({ orders: [], products: [], customers: [] });
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      adminAPI.omnisearch(q)
        .then(({ data }) => {
          if (active && data) {
            setLiveResults({
              orders: Array.isArray(data.orders) ? data.orders : [],
              products: Array.isArray(data.products) ? data.products : [],
              customers: Array.isArray(data.customers) ? data.customers : [],
            });
          }
        })
        .catch(() => {
          if (active) setLiveResults({ orders: [], products: [], customers: [] });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Combine and filter matching items
  const flatItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = [];

    // If query has live results, prioritize those
    if (liveResults.products.length > 0) {
      liveResults.products.forEach(p => {
        items.push({
          id: `p-${p.id}`,
          category: 'Products',
          label: p.name,
          sub: `${p.category || 'Cosmetics'} · GHS ${Number(p.price || 0).toFixed(2)} · Stock: ${p.stock_quantity}`,
          image: p.image_url,
          action: () => navigate(`/products/${p.id}`),
        });
      });
    }

    if (liveResults.orders.length > 0) {
      liveResults.orders.forEach(o => {
        items.push({
          id: `o-${o.id}`,
          category: 'Orders',
          label: `Order ${o.order_number}`,
          sub: `${o.customer_name || o.customer_email || 'Customer'} · GHS ${Number(o.total_amount || 0).toFixed(2)} · ${o.status}`,
          icon: '🛍️',
          action: () => navigate(`/orders/${o.id}`),
        });
      });
    }

    if (liveResults.customers.length > 0) {
      liveResults.customers.forEach(c => {
        items.push({
          id: `c-${c.id}`,
          category: 'Customers',
          label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email,
          sub: `${c.email} · ${c.phone || 'No phone'}`,
          icon: '👤',
          action: () => navigate(`/customers/${c.id}`),
        });
      });
    }

    // Filter static pages & actions
    const matchedPages = DEFAULT_PAGES.filter(p => !q || p.label.toLowerCase().includes(q)).map(p => ({
      id: `nav-${p.path}`,
      category: 'Pages',
      label: p.label,
      icon: p.icon,
      action: () => navigate(p.path),
    }));

    const matchedActions = QUICK_ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q)).map(a => ({
      id: `act-${a.label}`,
      category: 'Quick Actions',
      label: a.label,
      icon: a.icon,
      action: () => {
        if (a.external) {
          window.open(a.url, '_blank', 'noreferrer');
        } else {
          navigate(a.path);
        }
      },
    }));

    return [...items, ...matchedActions, ...matchedPages];
  }, [query, liveResults, navigate]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [flatItems.length]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, flatItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev <= 0 ? flatItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) {
        item.action();
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command Menu">
      <div className="cmd-palette-dialog" onClick={e => e.stopPropagation()}>
        <div className="cmd-palette-search-wrap">
          <svg className="cmd-palette-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            id="admin-cmd-search-input"
            name="command_search"
            type="search"
            className="cmd-palette-input"
            placeholder="Type a command, page name, product, or order number…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck="false"
          />
          {loading ? (
            <span style={{ fontSize: '0.78rem', color: 'var(--ac-accent)' }}>Searching…</span>
          ) : (
            <kbd className="cmd-palette-kbd-shortcut">ESC</kbd>
          )}
        </div>

        <div className="cmd-palette-body">
          {flatItems.length === 0 ? (
            <div className="cmd-palette-empty">
              No matching pages, orders, or products found for &quot;{query}&quot;.
            </div>
          ) : (
            flatItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cmd-palette-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  {item.image ? (
                    <img
                      src={resolveImageUrl(item.image)}
                      alt=""
                      className="cmd-palette-item-thumb"
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <span className="cmd-palette-item-icon">{item.icon || '✦'}</span>
                  )}
                  <div className="cmd-palette-item-label">
                    <div>{item.label}</div>
                    {item.sub && <div className="cmd-palette-item-sub">{item.sub}</div>}
                  </div>
                  <span className="cmd-palette-item-sub" style={{ textTransform: 'uppercase', fontSize: '0.66rem' }}>
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="cmd-palette-footer">
          <div className="cmd-palette-hints">
            <span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span>
            <span><kbd>↵</kbd> Select</span>
            <span><kbd>Esc</kbd> Close</span>
          </div>
          <span>BodyCream GH Admin</span>
        </div>
      </div>
    </div>
  );
}
