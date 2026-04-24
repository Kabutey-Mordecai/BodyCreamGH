import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

// We use Context API rather than Redux/Zustand because our shared state is simple:
// just who is logged in. Two or three pieces of state don't justify a state library.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  // loading=true while we check localStorage on first render.
  // Without this flag, ProtectedRoute would flash the login page for a split second
  // before it realizes the user is already logged in.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore the previous session from localStorage on page load.
    // This is why the user doesn't have to log in every time they refresh.
    const token      = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        // JSON.parse can throw if localStorage was corrupted — clear and start fresh
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const { data } = await authAPI.login({ email, password });
    // Store both token and user object so we can restore the session on refresh
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const register = async (formData) => {
    await authAPI.register(formData);
    // Auto-login after registration — avoids making the user fill in credentials twice
    return login(formData.email, formData.password);
  };

  const logout = async () => {
    try {
      // Call the server to blacklist the token so it can't be reused even
      // if someone has a copy of it (e.g. from browser history or a shared computer)
      await authAPI.logout();
    } catch {
      // Server-side logout failing (e.g. network error) shouldn't block client-side logout
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook — consumers call useAuth() instead of useContext(AuthContext).
// This gives a cleaner API and throws a helpful error if used outside the provider.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
