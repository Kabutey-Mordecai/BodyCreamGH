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
  const [badgePop, setBadgePop]   = useState(false);
  const prevCartCount             = useRef(cartCount);
  const [barVisible, setBarVisible] = useState(
    () => !sessionStorage.getItem('bar_dismissed')
  );

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
    await logout();
    navigate('/');
  };

  const closeMenu = () => setMenuOpen(false);

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

          {/* Hamburger — mobile only */}
          <button
            className={`nav-hamburger ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen(prev => !prev)}
            aria-label="Toggle menu"
          >
            <span /><span /><span />
          </button>

          {/* Main nav links */}
          <ul className={`nav-links ${menuOpen ? 'open' : ''}`}>
            {/* Mobile search — appears at top of hamburger dropdown */}
            <li className="nav-search-mobile-wrap">
              <SearchBar variant="mobile" placeholder="Search products…" onNavigate={closeMenu} />
            </li>

            <li><NavLink to="/"     end onClick={closeMenu}>Home</NavLink></li>
            <li><NavLink to="/shop"     onClick={closeMenu}>Shop</NavLink></li>

            {/* Cart — always visible so guests can reach their localStorage cart */}
            <li>
              <NavLink to="/cart" className="nav-cart" onClick={closeMenu}>
                Cart
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
                    {savedIds.size > 0 && (
                      <span className="cart-badge" aria-label={`${savedIds.size} saved`}>
                        {savedIds.size}
                      </span>
                    )}
                  </NavLink>
                </li>
                <li><NavLink to="/orders"  onClick={closeMenu}>Orders</NavLink></li>
                <li><NavLink to="/account" onClick={closeMenu}>Account</NavLink></li>
                <li>
                  <button className="nav-logout-btn" onClick={handleLogout}>
                    Logout
                  </button>
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
