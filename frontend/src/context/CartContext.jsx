import { createContext, useContext, useState, useEffect } from 'react';
import { cartAPI } from '../services/api';
import { useAuth } from './AuthContext';

// Cart lives on the server (not just localStorage) for two reasons:
// 1. It persists across devices — user adds items on phone, checks out on laptop
// 2. Stock validation happens server-side, so we always have accurate quantities
const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { user }              = useAuth();
  const [cart, setCart]       = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch the cart from the server whenever the user logs in.
  // When they log out, clear local cart state so it doesn't show stale items.
  useEffect(() => {
    if (user) {
      fetchCart();
    } else {
      setCart([]);
    }
  }, [user]);

  const fetchCart = async () => {
    try {
      setLoading(true);
      const { data } = await cartAPI.getCart();
      setCart(data);
    } catch (err) {
      console.error('Failed to load cart:', err);
    } finally {
      setLoading(false);
    }
  };

  const addItem = async (productId, quantity = 1) => {
    await cartAPI.addItem(productId, quantity);
    // Re-fetch from server so the cart reflects real stock levels
    await fetchCart();
  };

  const updateItem = async (cartItemId, quantity) => {
    await cartAPI.updateItem(cartItemId, quantity);
    await fetchCart();
  };

  const removeItem = async (cartItemId) => {
    // Optimistic update: remove from UI immediately so it feels instant,
    // then sync with the server. If the server call fails the user sees
    // the item come back on next fetch — acceptable trade-off for UX.
    setCart(prev => prev.filter(i => i.id !== cartItemId));
    await cartAPI.removeItem(cartItemId);
  };

  // Called after a successful checkout — the backend already cleared the cart
  const clearLocalCart = () => setCart([]);

  // Derived values — computed here once so every component doesn't repeat the math
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);

  return (
    <CartContext.Provider value={{
      cart, loading, cartCount, cartTotal,
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
