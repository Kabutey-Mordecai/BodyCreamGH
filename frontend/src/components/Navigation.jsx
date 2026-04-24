import { useState, useCallback } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import AnnouncementBar from './AnnouncementBar';
import './Navigation.css';

export default function Navigation() {
  const { user, logout }  = useAuth();
  const { cartCount }     = useCart();
  const { store_name }    = useSettings();
  const navigate          = useNavigate();
  const [menuOpen, setMenuOpen]   = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [barVisible, setBarVisible] = useState(
    () => !sessionStorage.getItem('bar_dismissed')
  );

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const closeMenu = () => setMenuOpen(false);

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    navigate(`/shop?search=${encodeURIComponent(q)}`);
    setSearchQuery('');
    closeMenu();
  };

  const handleBarVisibility = useCallback((visible) => {
    setBarVisible(visible);
  }, []);

  return (
    <>
      <AnnouncementBar onVisibilityChange={handleBarVisibility} />

      <nav className={`nav ${barVisible ? 'nav--with-bar' : ''}`}>
        <div className="nav-inner container">
          {/* Logo */}
          <Link to="/" className="nav-logo" onClick={closeMenu}>
            {store_name}
          </Link>

          {/* Search bar — desktop (hidden on mobile via CSS) */}
          <form className="nav-search" onSubmit={handleSearch}>
            <svg className="nav-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="search"
              placeholder="Search products…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="nav-search-input"
              aria-label="Search products"
            />
            <button type="submit" className="nav-search-btn">Search</button>
          </form>

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
              <form className="nav-search nav-search--mobile" onSubmit={handleSearch}>
                <svg className="nav-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                  type="search"
                  placeholder="Search products…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="nav-search-input"
                  aria-label="Search products"
                />
                <button type="submit" className="nav-search-btn">Search</button>
              </form>
            </li>

            <li><NavLink to="/"     end onClick={closeMenu}>Home</NavLink></li>
            <li><NavLink to="/shop"     onClick={closeMenu}>Shop</NavLink></li>

            {user ? (
              <>
                <li>
                  <NavLink to="/cart" className="nav-cart" onClick={closeMenu}>
                    Cart
                    {cartCount > 0 && (
                      <span className="cart-badge" aria-label={`${cartCount} items`}>
                        {cartCount}
                      </span>
                    )}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/wishlist" onClick={closeMenu} aria-label="Wishlist" className="nav-wishlist">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}>
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                    </svg>
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
