import { useState, useEffect, useMemo, useCallback } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI, adminAPI } from '../services/api';
import { filterNavGroupsByRole } from '../utils/rbac';
import CommandPalette from '../components/CommandPalette';
import './AdminLayout.css';

const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'BodyCream GH';
const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'https://bodycreamgh-shop.vercel.app';

// Sidebar navigation groups (static — badge counts are injected at render).
const NAV_GROUPS_DEF = [
  {
    label: 'Overview',
    items: [
      { to: '/',            label: 'Dashboard',  icon: IconGrid },
      { to: '/analytics',   label: 'Analytics',  icon: IconChart },
      { to: '/financials',  label: 'Financials', icon: IconDollar },
    ],
  },
  {
    label: 'Sell',
    items: [
      { to: '/orders',      label: 'Orders',          icon: IconBag,   badgeKey: 'pendingOrders' },
      { to: '/riders',      label: 'Riders & Fleet',  icon: IconTruck },
      { to: '/requests',    label: 'Requests',        icon: IconInbox, badgeKey: 'requests' },
      { to: '/products',    label: 'Products',   icon: IconBox },
      { to: '/inventory',   label: 'Inventory',  icon: IconStack },
      { to: '/customers',   label: 'Customers',  icon: IconUsers },
      { to: '/reviews',     label: 'Reviews',    icon: IconStar,  badgeKey: 'pendingReviews' },
      { to: '/coupons',     label: 'Coupons',    icon: IconTag },
      { to: '/promotions',  label: 'Promotions', icon: IconPercent },
    ],
  },
  {
    label: 'Newsletter',
    items: [
      { to: '/newsletter/compose',     label: 'Compose',     icon: IconSend },
      { to: '/newsletter/subscribers', label: 'Subscribers', icon: IconMail },
      { to: '/newsletter/history',     label: 'History',     icon: IconClock },
    ],
  },
  {
    label: 'Customize',
    items: [
      { to: '/storefront',       label: 'Storefront Editor', icon: IconLayout },
      { to: '/theme',            label: 'Theme & Colors',    icon: IconPalette },
      { to: '/settings',         label: 'Settings',          icon: IconCog },
      { to: '/settings/admins',  label: 'Admin Accounts',    icon: IconShield },
    ],
  },
];

const ROUTE_LABELS = {
  '': 'Dashboard',
  'orders': 'Orders',
  'riders': 'Riders & Fleet',
  'requests': 'Requests',
  'products': 'Products',
  'inventory': 'Inventory',
  'customers': 'Customers',
  'reviews': 'Reviews',
  'coupons': 'Coupons',
  'promotions': 'Promotions',
  'newsletter': 'Newsletter',
  'compose': 'Compose',
  'subscribers': 'Subscribers',
  'history': 'History',
  'storefront': 'Storefront Editor',
  'theme': 'Theme & Colors',
  'settings': 'Settings',
  'admins': 'Admin Accounts',
  'financials': 'Financials',
  'analytics': 'Analytics',
  'new': 'New Product',
};

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed]     = useState(() => {
    try {
      return localStorage.getItem('bc_admin_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [menuOpen, setMenuOpen]       = useState(false);
  const [cmdOpen, setCmdOpen]         = useState(false);
  const [theme, setTheme]             = useState(() => {
    try {
      return localStorage.getItem('bc_admin_theme') || 'system';
    } catch {
      return 'system';
    }
  });
  const [counts, setCounts]           = useState({ cancel: 0, return: 0, pendingOrders: 0, pendingReviews: 0 });

  // Sync theme with DOM
  useEffect(() => {
    const applyCurrentTheme = () => {
      let resolved = theme;
      if (theme === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolved);
    };

    applyCurrentTheme();
    try {
      localStorage.setItem('bc_admin_theme', theme);
    } catch {}

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'system') applyCurrentTheme();
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Fetch pending badge counts
  useEffect(() => {
    const fetchCounts = () => {
      Promise.allSettled([
        ordersAPI.getRequestCounts(),
        adminAPI.getReviewCounts(),
      ]).then(([ordersRes, reviewsRes]) => {
        const o = ordersRes.status === 'fulfilled' ? (ordersRes.value.data || {}) : {};
        const r = reviewsRes.status === 'fulfilled' ? (reviewsRes.value.data || {}) : {};
        setCounts(prev => ({
          ...prev,
          cancel:         o.cancel         ?? prev.cancel,
          return:         o.return         ?? prev.return,
          pendingOrders:  o.pendingOrders  ?? prev.pendingOrders,
          pendingReviews: r.pending        ?? prev.pendingReviews,
        }));
      });
    };
    fetchCounts();
    const timer = setInterval(fetchCounts, 60000);
    return () => clearInterval(timer);
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('bc_admin_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const cycleTheme = () => {
    setTheme(prev => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  };

  const badges = {
    requests:       (counts.cancel || 0) + (counts.return || 0),
    pendingOrders:  counts.pendingOrders  || 0,
    pendingReviews: counts.pendingReviews || 0,
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Generate dynamic breadcrumbs trail
  const breadcrumbs = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return [{ label: 'Dashboard', to: '/' }];
    }
    const crumbs = [{ label: 'Dashboard', to: '/' }];
    let accPath = '';
    segments.forEach((seg, i) => {
      accPath += `/${seg}`;
      const isLast = i === segments.length - 1;
      let label = ROUTE_LABELS[seg.toLowerCase()];
      if (!label) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(seg)) {
          label = `ID: ${seg.slice(0, 8)}…`;
        } else if (seg.startsWith('ORD-')) {
          label = `#${seg}`;
        } else {
          label = seg.replace(/[-_]/g, ' ');
          label = label.charAt(0).toUpperCase() + label.slice(1);
        }
      }
      crumbs.push({ label, to: isLast ? null : accPath });
    });
    return crumbs;
  }, [location.pathname]);

  return (
    <div className={`admin-shell ${collapsed ? 'admin-shell--collapsed' : ''}`}>
      {/* ── COMMAND PALETTE MODAL ─────────────────────────────── */}
      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* ── SIDEBAR ────────────────────────────────────────────── */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`}>
        <div className="sidebar-brand-row">
          <Link to="/" className="sidebar-brand" onClick={() => setSidebarOpen(false)}>
            <span className="sidebar-brand-mark">✦</span>
            {!collapsed && <span className="sidebar-brand-name">{STORE_NAME}</span>}
            {!collapsed && <span className="sidebar-brand-sub">admin</span>}
          </Link>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleSidebarCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <IconCollapse collapsed={collapsed} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {filterNavGroupsByRole(NAV_GROUPS_DEF, user?.role).map(group => (
            <div key={group.label} className="sidebar-group">
              {!collapsed && <div className="sidebar-group-label">{group.label}</div>}
              {collapsed && <div className="sidebar-group-divider" />}
              {group.items.map(item => {
                const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon />
                    {!collapsed && <span>{item.label}</span>}
                    {badgeCount > 0 && (
                      <span className={`sidebar-badge ${collapsed ? 'sidebar-badge--dot' : ''}`}>
                        {collapsed ? '' : badgeCount}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <a
            href={STOREFRONT_URL}
            target="_blank"
            rel="noreferrer"
            className="sidebar-visit"
            title={collapsed ? 'Visit storefront' : undefined}
          >
            <IconExternal />
            {!collapsed && <span>Visit storefront</span>}
          </a>
        </div>
      </aside>

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* ── MAIN ───────────────────────────────────────────────── */}
      <div className="admin-main">
        <header className="topbar">
          <button
            className="topbar-burger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <IconMenu />
          </button>

          {/* Breadcrumb Navigation Trail */}
          <nav className="topbar-breadcrumbs" aria-label="Breadcrumb">
            <ol className="breadcrumbs-list">
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <li key={idx} className="breadcrumb-item">
                    {idx > 0 && <span className="breadcrumb-sep" aria-hidden="true">/</span>}
                    {crumb.to && !isLast ? (
                      <Link to={crumb.to} className="breadcrumb-link">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="breadcrumb-current" aria-current="page">
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="topbar-spacer" />

          {/* Global Search / Command Palette Trigger */}
          <button
            type="button"
            className="topbar-cmd-btn"
            onClick={() => setCmdOpen(true)}
            aria-label="Open command palette"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="topbar-cmd-placeholder">Search or jump to…</span>
            <span className="topbar-cmd-badge">
              <kbd>Ctrl</kbd> <kbd>K</kbd>
            </span>
          </button>

          {/* Theme Toggle Button (Light / Dark / System) */}
          <button
            type="button"
            className="topbar-theme-btn"
            onClick={cycleTheme}
            aria-label={`Toggle theme (currently ${theme})`}
            title={`Theme: ${theme.toUpperCase()} (Click to toggle)`}
          >
            {theme === 'dark' ? (
              <IconMoon />
            ) : theme === 'light' ? (
              <IconSun />
            ) : (
              <IconSystem />
            )}
          </button>

          {/* User Profile & Menu */}
          <div className="topbar-user" onClick={() => setMenuOpen(v => !v)}>
            <div className="avatar">
              {(user?.first_name?.[0] || user?.email?.[0] || 'A').toUpperCase()}
            </div>
            <div className="topbar-user-meta">
              <div className="topbar-user-name">{user?.first_name || 'Admin'}</div>
              <div className="topbar-user-role">{user?.role}</div>
            </div>
            <IconChevron />
            {menuOpen && (
              <div className="topbar-menu" onClick={e => e.stopPropagation()}>
                <div className="topbar-menu-header">
                  <div style={{ fontWeight: 600 }}>{user?.first_name} {user?.last_name}</div>
                  <div className="muted text-xs">{user?.email}</div>
                </div>
                <button
                  type="button"
                  className="topbar-menu-item"
                  onClick={() => { setMenuOpen(false); setCmdOpen(true); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Command Palette
                </button>
                <button
                  type="button"
                  className="topbar-menu-item"
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                >
                  <IconCog /> Settings
                </button>
                <button type="button" className="topbar-menu-item" onClick={handleLogout}>
                  <IconLogout /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────
function IconGrid()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>; }
function IconChart()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>; }
function IconBag()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 11a2 2 0 01-2 2H9a2 2 0 01-2-2L6 8z"/><path d="M9 8V6a3 3 0 116 0v2"/></svg>; }
function IconTruck()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="4" width="14" height="12" rx="1.5"/><path d="M15 8h4l4 4v4h-8V8z"/><circle cx="5.5" cy="18.5" r="2.2"/><circle cx="18.5" cy="18.5" r="2.2"/></svg>; }
function IconBox()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>; }
function IconStack()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3L2 8l10 5 10-5-10-5z"/><path d="M2 14l10 5 10-5"/></svg>; }
function IconUsers()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>; }
function IconLayout()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>; }
function IconPalette() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22a10 10 0 110-20 8 8 0 018 8 4 4 0 01-4 4h-2a2 2 0 00-2 2 2 2 0 01-2 2 2 2 0 01-2-2 4 4 0 014-4"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5"  r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></svg>; }
function IconCog()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>; }
function IconExternal(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>; }
function IconMenu()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>; }
function IconChevron() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>; }
function IconLogout()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>; }
function IconStar()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function IconTag()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }
function IconDollar()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>; }
function IconInbox()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>; }
function IconShield()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IconSend()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconMail()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>; }
function IconClock()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconPercent() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>; }

function IconCollapse({ collapsed }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {collapsed ? (
        <>
          <polyline points="13 17 18 12 13 7" />
          <polyline points="6 17 11 12 6 7" />
        </>
      ) : (
        <>
          <polyline points="11 17 6 12 11 7" />
          <polyline points="18 17 13 12 18 7" />
        </>
      )}
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function IconSystem() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
