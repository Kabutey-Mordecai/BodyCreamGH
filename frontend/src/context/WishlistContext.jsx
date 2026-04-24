import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { wishlistAPI } from '../services/api';
import { useAuth } from './AuthContext';

const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const { user } = useAuth();
  // Set of product UUIDs the current user has wishlisted
  const [savedIds, setSavedIds] = useState(new Set());

  const loadIds = useCallback(() => {
    if (!user) { setSavedIds(new Set()); return; }
    wishlistAPI.getIds()
      .then(({ data }) => setSavedIds(new Set(data)))
      .catch(() => {});
  }, [user]);

  useEffect(() => { loadIds(); }, [loadIds]);

  const toggle = async (productId) => {
    if (!user) return false; // caller should redirect to /login

    const isSaved = savedIds.has(productId);
    // Optimistic update
    setSavedIds(prev => {
      const next = new Set(prev);
      isSaved ? next.delete(productId) : next.add(productId);
      return next;
    });

    try {
      if (isSaved) {
        await wishlistAPI.remove(productId);
      } else {
        await wishlistAPI.add(productId);
      }
    } catch {
      // Revert on error
      setSavedIds(prev => {
        const next = new Set(prev);
        isSaved ? next.add(productId) : next.delete(productId);
        return next;
      });
    }

    return !isSaved; // new state
  };

  return (
    <WishlistContext.Provider value={{ savedIds, toggle, reload: loadIds }}>
      {children}
    </WishlistContext.Provider>
  );
}

export const useWishlist = () => useContext(WishlistContext);
