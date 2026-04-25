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
  const [mergeError, setMergeError] = useState('');

  // Derive which cart to expose based on auth state
  const cart = user ? serverCart : guestCart;

  // ── Server cart ─────────────────────────────────────────────────────────────
  const fetchCart = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await cartAPI.getCart();
      setServerCart(data);
    } catch (err) {
      console.error('[CartContext] fetchCart failed:', err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // When the user logs in, merge guest cart → server cart then clear guest cart.
  // Uses Promise.allSettled so a single failed item does not abort the rest.
  // Failed items are preserved in localStorage and exposed via mergeError.
  useEffect(() => {
    if (user) {
      const pending = readGuestCart();
      if (pending.length > 0) {
        Promise.allSettled(
          pending.map(item => cartAPI.addItem(item.product_id, item.quantity))
        ).then(results => {
          const failed = pending.filter((_, i) => results[i].status === 'rejected');
          if (failed.length) {
            writeGuestCart(failed);
            setGuestCart(failed);
            setMergeError(
              `${failed.length} item(s) could not be added to your cart and have been kept for you.`
            );
          } else {
            writeGuestCart([]);
            setGuestCart([]);
            setMergeError('');
          }
          fetchCart();
        });
      } else {
        setMergeError('');
        fetchCart();
      }
    } else {
      setServerCart([]);
      setMergeError('');
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh server cart whenever the window regains focus — keeps two-tab sessions in sync
  useEffect(() => {
    if (!user) return;
    const onFocus = () => fetchCart();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, fetchCart]);

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
          id:             product.id,
          product_id:     product.id,
          name:           product.name,
          price:          product.price,
          image_url:      product.image_url,
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
      if (!productSnapshot) return;
      guestAddItem(productSnapshot, quantity);
      return;
    }
    const { data } = await cartAPI.addItem(productId, quantity);
    setServerCart(data.cart);
  };

  const updateItem = async (cartItemId, quantity) => {
    if (!user) {
      guestUpdateItem(cartItemId, quantity);
      return;
    }
    const { data } = await cartAPI.updateItem(cartItemId, quantity);
    setServerCart(data.cart);
  };

  const removeItem = async (cartItemId) => {
    if (!user) {
      guestRemoveItem(cartItemId);
      return;
    }
    // No optimistic delete — wait for server confirmation before updating UI
    const { data } = await cartAPI.removeItem(cartItemId);
    setServerCart(data.cart);
  };

  const clearLocalCart = async () => {
    if (!user) {
      writeGuestCart([]);
      setGuestCart([]);
      return;
    }
    // Optimistic clear is correct here: createOrder already deleted the server cart
    // inside its transaction before this is ever called. cartAPI.clear() is cleanup only.
    setServerCart([]);
    try {
      await cartAPI.clear();
    } catch (err) {
      // Non-fatal — server cart is already empty after order creation.
      // Log for observability; do not rethrow so the caller can proceed to payment.
      console.error('[CartContext] clearLocalCart API call failed:', err?.message);
    }
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);

  return (
    <CartContext.Provider value={{
      cart, loading, cartCount, cartTotal, isGuest: !user,
      mergeError,
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
