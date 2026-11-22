import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

// Tokens/users are namespaced with an `admin_` prefix in localStorage so they
// don't collide with the storefront app when both run on the same origin in dev.
const AuthContext = createContext(null);

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'fulfillment', 'support', 'marketing']);

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

  // Step 1: password check.
  // Returns { mfaRequired: true, mfaToken } when admin MFA is needed,
  // or sets user state directly for non-admin accounts (not expected in this app).
  const login = async (email, password) => {
    const { data } = await authAPI.login({ email, password });

    if (data.mfa_required) {
      return { mfaRequired: true, mfaToken: data.mfa_token };
    }

    if (!ADMIN_ROLES.has(data.user?.role)) {
      throw new Error('This account does not have admin access.');
    }
    localStorage.setItem('admin_token', data.token);
    if (data.refresh_token) localStorage.setItem('admin_refresh_token', data.refresh_token);
    localStorage.setItem('admin_user', JSON.stringify(data.user));
    setUser(data.user);
    return { mfaRequired: false };
  };

  // Step 2: OTP verification. Called after login() returns mfaRequired: true.
  const completeOtpLogin = async (mfaToken, otpCode) => {
    const { data } = await authAPI.verifyOtp({ mfa_token: mfaToken, otp_code: otpCode });
    if (!ADMIN_ROLES.has(data.user?.role)) {
      throw new Error('This account does not have admin access.');
    }
    localStorage.setItem('admin_token', data.token);
    if (data.refresh_token) localStorage.setItem('admin_refresh_token', data.refresh_token);
    localStorage.setItem('admin_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      const refresh_token = localStorage.getItem('admin_refresh_token');
      await authAPI.logout({ refresh_token });
    } catch { /* server blacklist failure is non-fatal */ }
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_refresh_token');
    localStorage.removeItem('admin_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, completeOtpLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
