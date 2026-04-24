import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

// Tokens/users are namespaced with an `admin_` prefix in localStorage so they
// don't collide with the storefront app when both run on the same origin in dev.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const stored = localStorage.getItem('admin_user');
    if (token && stored) {
      try { setUser(JSON.parse(stored)); }
      catch { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); }
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const { data } = await authAPI.login({ email, password });
    // Hard block: only admin-role accounts may enter the admin app.
    if (data.user?.role !== 'admin') {
      throw new Error('This account does not have admin access.');
    }
    localStorage.setItem('admin_token', data.token);
    localStorage.setItem('admin_user',  JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch { /* server blacklist failure is non-fatal */ }
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
