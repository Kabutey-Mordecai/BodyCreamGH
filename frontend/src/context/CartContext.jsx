import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { cartAPI } from '../services/api';
import { useAuth } from './AuthContext';

const GUEST_CART_KEY = 'guest_cart';

const CartContext = createContext(null);

// ─────────────────────────────────────────────────────────────────────────────
// Guest cart helpers (localStorage)
// ─────────────────────────────────────────────────────────────────────────────
function readGuestCart() {
  try { return JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]'); }
  catch { return []; }
}
function writeGuestCart(items) {
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
}

export function CartProvider({ children }) {
  const { user } = useAuth();

  const [serverCart, setServerCart] = useState([]);
  const [guestCart, setGuestCart]   = useState(() => readGuestCart());
  const [loading, setLoading]       = useState(false);

  // Derive which cart to expose based on auth state
  const cart = user ? serverCart : guestCart;

  // ── Server cart ─────────────────────────────────────────────────────────────
  const fetchCart = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await cartAPI.getCart();
      setServerCart(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // When the user logs in, merge guest cart → server cart, then clear guest cart
  useEffect(() => {
    if (user) {
      const pending = readGuestCart();
      if (pending.length > 0) {
        Promise.all(pending.map(item => cartAPI.addItem(item.product_id, item.quantity)))
          .finally(() => {
            writeGuestCart([]);
            setGuestCart([]);
            fetchCart();
          });
      } else {
        fetchCart();
      }
    } else {
      setServerCart([]);
    }
  }, [user]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guest cart ──────────────────────────────────────────────────────────────
  const guestAddItem = (product, quantity = 1) => {
    setGuestCart(prev => {
      const existing = prev.find(i => i.product_id === product.id);
      let next;
      if (existing) {
        next = prev.map(i =>
          i.product_id === product.id
            ? { ...i, quantity: Math.min(product.stock_quantity || 999, i.quantity + quantity) }
            : i
        );
      } else {
        next = [...prev, {
          id:           product.id,    // used as key / cart-item id for guests
          product_id:   product.id,
          name:         product.name,
          price:        product.price,
          image_url:    product.image_url,
          stock_quantity: product.stock_quantity,
          quantity,
        }];
      }
      writeGuestCart(next);
      return next;
    });
  };

  const guestUpdateItem = (productId, quantity) => {
    setGuestCart(prev => {
      const next = quantity <= 0
        ? prev.filter(i => i.product_id !== productId)
        : prev.map(i => i.product_id === productId ? { ...i, quantity } : i);
      writeGuestCart(next);
      return next;
    });
  };

  const guestRemoveItem = (productId) => {
    setGuestCart(prev => {
      const next = prev.filter(i => i.product_id !== productId && i.id !== productId);
      writeGuestCart(next);
      return next;
    });
  };

  // ── Unified API ─────────────────────────────────────────────────────────────
  // productSnapshot = { id, name, price, image_url, stock_quantity }
  // Required for guests so the local cart has display data; ignored for auth'd users.
  const addItem = async (productId, quantity = 1, productSnapshot = null) => {
    if (!user) {
      if (!productSnapshot) return; // can't add without display data for guest
      guestAddItem(productSnapshot, quantity);
      return;
    }
    await cartAPI.addItem(productId, quantity);
    await fetchCart();
  };

  const updateItem = async (cartItemId, quantity) => {
    if (!user) {
      guestUpdateItem(cartItemId, quantity);
      return;
    }
    await cartAPI.updateItem(cartItemId, quantity);
    await fetchCart();
  };

  const removeItem = async (cartItemId) => {
    if (!user) {
      guestRemoveItem(cartItemId);
      return;
    }
    setServerCart(prev => prev.filter(i => i.id !== cartItemId));
    await cartAPI.removeItem(cartItemId);
  };

  const clearLocalCart = () => {
    if (!user) {
      writeGuestCart([]);
      setGuestCart([]);
    } else {
      setServerCart([]);
    }
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);

  return (
    <CartContext.Provider value={{
      cart, loading, cartCount, cartTotal, isGuest: !user,
      addItem, updateItem, removeItem, clearLocalCart, fetchCart,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
