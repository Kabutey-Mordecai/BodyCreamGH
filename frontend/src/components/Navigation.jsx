import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import { useWishlist } from '../context/WishlistContext';
import AnnouncementBar from './AnnouncementBar';
import SearchBar from './SearchBar';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import './Navigation.css';

export default function Navigation() {
  const { user, logout }            = useAuth();
  const { cartCount }               = useCart();
  const { store_name, logo_url }    = useSettings();
  const { savedIds }      = useWishlist() || { savedIds: new Set() };
  const navigate          = useNavigate();
  const [menuOpen, setMenuOpen]   = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [badgePop, setBadgePop]   = useState(false);
  const prevCartCount             = useRef(cartCount);
  const accountDropdownRef        = useRef(null);
  const [barVisible, setBarVisible] = useState(
    () => !sessionStorage.getItem('bar_dismissed')
  );

  useEffect(() => {
    function handleClickOutside(e) {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    }
    if (accountMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (cartCount > prevCartCount.current) {
      setBadgePop(true);
      const t = setTimeout(() => setBadgePop(false), 450);
      prevCartCount.current = cartCount;
      return () => clearTimeout(t);
    }
    prevCartCount.current = cartCount;
  }, [cartCount]);

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    await logout();
    navigate('/');
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setAccountMenuOpen(false);
  };

  const handleBarVisibility = useCallback((visible) => {
    setBarVisible(visible);
  }, []);

  return (
    <>
      <AnnouncementBar onVisibilityChange={handleBarVisibility} />

      <nav className={`nav ${barVisible ? 'nav--with-bar' : ''}`}>
        <div className="nav-inner container">
          {/* Logo — image when settings.logo_url is set, else the store name */}
          <Link
            to="/"
            className={`nav-logo${logo_url ? ' nav-logo--image' : ''}`}
            onClick={closeMenu}
            aria-label={store_name}
          >
            {logo_url ? (
              <img
                src={resolveImageUrl(logo_url)}
                alt={store_name}
                width="160"
                height="48"
                className="nav-logo-img"
                onError={e => {
                  // If the logo fails to load, swap to the text fallback so the
                  // brand never disappears entirely.
                  e.currentTarget.onerror = null;
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement?.classList.remove('nav-logo--image');
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.textContent = store_name;
                  }
                }}
              />
            ) : (
              store_name
            )}
          </Link>

          {/* Search bar — desktop (hidden on mobile via CSS) */}
          <SearchBar variant="nav" placeholder="Search products…" onNavigate={closeMenu} />

          {/* Mobile quick actions — always visible in top bar on phones/tablets */}
          <div className="nav-mobile-quick">
            <Link to="/shop" className="nav-mobile-shop-pill" onClick={closeMenu}>
              Shop
            </Link>
            <Link to="/cart" className="nav-mobile-cart-icon" onClick={closeMenu} aria-label="Cart">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </Link>
          </div>

          {/* Hamburger — mobile only */}
          <button
            type="button"
            className={`nav-hamburger ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen(prev => !prev)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <span /><span /><span />
          </button>

          {/* Main nav links */}
          <ul className={`nav-links ${menuOpen ? 'open' : ''}`}>
            {/* Mobile search — appears at top of hamburger dropdown */}
            <li className="nav-search-mobile-wrap">
              <SearchBar variant="mobile" placeholder="Search brands, skincare, makeup…" onNavigate={closeMenu} />
            </li>

            <li><NavLink to="/" end onClick={closeMenu}>Home</NavLink></li>
            <li><NavLink to="/shop" onClick={closeMenu}>Shop</NavLink></li>
            <li><NavLink to="/track" onClick={closeMenu}>Track Order</NavLink></li>

            {/* Cart — always visible so guests can reach their localStorage cart */}
            <li>
              <NavLink to="/cart" className="nav-cart" onClick={closeMenu} aria-label="Cart" title="Cart">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                  <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                </svg>
                <span className="nav-mobile-label">Cart</span>
                {cartCount > 0 && (
                  <span
                    className={`cart-badge${badgePop ? ' cart-badge--pop' : ''}`}
                    aria-label={`${cartCount} items`}
                  >
                    {cartCount}
                  </span>
                )}
              </NavLink>
            </li>

            {user ? (
              <>
                <li>
                  <NavLink to="/wishlist" onClick={closeMenu} aria-label="Wishlist" className="nav-wishlist">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}>
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                    </svg>
                    <span className="nav-mobile-label">Wishlist</span>
                    {savedIds.size > 0 && (
                      <span className="cart-badge" aria-label={`${savedIds.size} saved`}>
                        {savedIds.size}
                      </span>
                    )}
                  </NavLink>
                </li>

                <li className="nav-account-dropdown-wrap" ref={accountDropdownRef}>
                  <button
                    type="button"
                    className={`nav-account-trigger ${accountMenuOpen ? 'open' : ''}`}
                    onClick={() => setAccountMenuOpen(prev => !prev)}
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="true"
                    aria-label="Account menu"
                  >
                    <span className="nav-avatar-circle">
                      {(user.first_name || user.email || 'A')[0].toUpperCase()}
                    </span>
                    <span className="nav-account-name">
                      {user.first_name || 'Account'}
                    </span>
                    <svg
                      className={`nav-chevron ${accountMenuOpen ? 'nav-chevron--open' : ''}`}
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {accountMenuOpen && (
                    <div className="nav-account-menu" role="menu">
                      <div className="nav-account-header">
                        <div className="nav-account-user-name">
                          {user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Account'}
                        </div>
                        <div className="nav-account-user-email">{user.email}</div>
                        {user.role === 'admin' && (
                          <span className="nav-account-badge">Store Admin</span>
                        )}
                      </div>

                      <div className="nav-account-divider" />

                      <Link
                        to="/account"
                        className="nav-account-item"
                        onClick={closeMenu}
                        role="menuitem"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span>Profile &amp; Details</span>
                      </Link>

                      <Link
                        to="/orders"
                        className="nav-account-item"
                        onClick={closeMenu}
                        role="menuitem"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
                        </svg>
                        <span>My Orders</span>
                      </Link>

                      {user.role === 'admin' && (
                        <a
                          href="/admin"
                          className="nav-account-item"
                          onClick={closeMenu}
                          role="menuitem"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                          </svg>
                          <span>Admin Console</span>
                        </a>
                      )}

                      <button
                        type="button"
                        className="nav-account-item"
                        onClick={async () => {
                          closeMenu();
                          if (window.__bcPwaPrompt) {
                            try {
                              await window.__bcPwaPrompt.prompt();
                            } catch (_) {}
                          } else {
                            alert('To install BodyCream GH, tap your browser menu and select "Install app" or "Add to Home screen".');
                          }
                        }}
                        role="menuitem"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                        </svg>
                        <span>Install App</span>
                      </button>

                      <div className="nav-account-divider" />

                      <button
                        type="button"
                        className="nav-account-item nav-account-item--logout"
                        onClick={() => {
                          closeMenu();
                          handleLogout();
                        }}
                        role="menuitem"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                        <span>Logout</span>
                      </button>
                    </div>
                  )}
                </li>
              </>
            ) : (
              <>
                <li><NavLink to="/login"    onClick={closeMenu}>Login</NavLink></li>
                <li>
                  <NavLink to="/register" className="nav-cta" onClick={closeMenu}>
                    Sign Up
                  </NavLink>
                </li>
              </>
            )}
          </ul>
        </div>
      </nav>
    </>
  );
}
