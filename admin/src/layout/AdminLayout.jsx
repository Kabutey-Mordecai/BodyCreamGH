import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI, adminAPI } from '../services/api';
import { filterNavGroupsByRole } from '../utils/rbac';
import './AdminLayout.css';

const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'BodyCream GH';
const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'http://localhost:5173';

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
      { to: '/orders',      label: 'Orders',     icon: IconBag,   badgeKey: 'pendingOrders' },
      { to: '/requests',    label: 'Requests',   icon: IconInbox, badgeKey: 'requests' },
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

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [counts, setCounts] = useState({ cancel: 0, return: 0, pendingOrders: 0, pendingReviews: 0 });

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

  const badges = {
    requests:       (counts.cancel || 0) + (counts.return || 0),
    pendingOrders:  counts.pendingOrders  || 0,
    pendingReviews: counts.pendingReviews || 0,
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="admin-shell">
      {/* ── SIDEBAR ────────────────────────────────────────────── */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <Link to="/" className="sidebar-brand" onClick={() => setSidebarOpen(false)}>
          <span className="sidebar-brand-mark">✦</span>
          <span className="sidebar-brand-name">{STORE_NAME}</span>
          <span className="sidebar-brand-sub">admin</span>
        </Link>

        <nav className="sidebar-nav">
          {filterNavGroupsByRole(NAV_GROUPS_DEF, user?.role).map(group => (
            <div key={group.label} className="sidebar-group">
              <div className="sidebar-group-label">{group.label}</div>
              {group.items.map(item => {
                const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {badgeCount > 0 && (
                      <span className="sidebar-badge">{badgeCount}</span>
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
          >
            <IconExternal />
            <span>Visit storefront</span>
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

          <div className="topbar-spacer" />

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
                <button className="topbar-menu-item" onClick={handleLogout}>
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

// ── Inline icons (no icon library dependency) ──────────────────────
function IconGrid()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>; }
function IconChart()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>; }
function IconBag()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 11a2 2 0 01-2 2H9a2 2 0 01-2-2L6 8z"/><path d="M9 8V6a3 3 0 116 0v2"/></svg>; }
function IconBox()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>; }
function IconStack()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3L2 8l10 5 10-5-10-5z"/><path d="M2 14l10 5 10-5"/></svg>; }
function IconUsers()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>; }
function IconLayout() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>; }
function IconPalette(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22a10 10 0 110-20 8 8 0 018 8 4 4 0 01-4 4h-2a2 2 0 00-2 2 2 2 0 01-2 2 2 2 0 01-2-2 4 4 0 014-4"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5"  r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></svg>; }
function IconCog()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>; }
function IconExternal(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>; }
function IconMenu()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>; }
function IconChevron(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>; }
function IconLogout() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>; }
function IconStar()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function IconTag()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }
function IconDollar() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>; }
function IconInbox()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>; }
function IconShield() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IconSend()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconMail()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>; }
function IconClock()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconPercent(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>; }
