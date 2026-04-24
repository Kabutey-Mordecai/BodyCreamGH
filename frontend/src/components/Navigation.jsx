import { useState, useCallback } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import AnnouncementBar from './AnnouncementBar';
import './Navigation.css';

// TO CUSTOMIZE: Change the store name here or pull it from the env variable.
const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'BodyCream GH';

export default function Navigation() {
  const { user, logout }  = useAuth();
  const { cartCount }     = useCart();
  const navigate          = useNavigate();
  const [menuOpen, setMenuOpen]   = useState(false);
  const [barVisible, setBarVisible] = useState(
    () => !sessionStorage.getItem('bar_dismissed')
  );

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
          {/* Logo */}
          <Link to="/" className="nav-logo" onClick={closeMenu}>
            {STORE_NAME}
          </Link>

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
