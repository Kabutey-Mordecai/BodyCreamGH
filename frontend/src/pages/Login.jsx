import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();

  const from = location.state?.from?.pathname || '/';
  const isCheckoutRedirect = Boolean(location.state?.checkoutRedirect || from === '/checkout');

  const [form, setForm]       = useState({ email: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState(0); // seconds remaining in rate-limit lockout
  const timerRef = useRef(null);

  // Count down the lockout every second; clear when it reaches 0.
  useEffect(() => {
    if (lockout <= 0) return;
    timerRef.current = setInterval(() => {
      setLockout(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setError('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [lockout]);

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockout > 0) return;
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err.response?.status === 429) {
        // Prefer the header; fall back to the JSON body field the server also sends.
        const wait = parseInt(
          err.response.headers?.['retry-after'] || err.response.data?.retryAfter || 60,
          10
        );
        setLockout(wait);
        setError(`Too many login attempts. Try again in ${formatCountdown(wait)}.`);
      } else {
        setError(err.response?.data?.error || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockout > 0;

  return (
    <div className="auth-page">
      <div className="auth-card">
        {isCheckoutRedirect && (
          <div className="alert alert-info" style={{ marginBottom: '20px', background: 'rgba(201, 165, 90, 0.12)', border: '1px solid rgba(201, 165, 90, 0.35)', color: '#e5c378', fontSize: '0.9rem', borderRadius: '8px', padding: '12px 16px' }}>
            <strong>Sign in to complete your order</strong>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', opacity: 0.9 }}>
              Like Jumia &amp; Temu, your basket is safely saved and will be ready for checkout as soon as you sign in.
            </p>
          </div>
        )}
        <h1>{isCheckoutRedirect ? 'Sign in to Checkout' : 'Welcome back'}</h1>
        <p>{isCheckoutRedirect ? 'Sign in to access your saved addresses, track your order, and complete payment.' : 'Sign in to your account to continue shopping.'}</p>

        {error && (
          <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>
            {isLocked
              ? `Too many login attempts. Try again in ${formatCountdown(lockout)}.`
              : error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
              disabled={isLocked}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
              disabled={isLocked}
            />
          </div>

          <div style={{ textAlign: 'right', marginTop: '-8px' }}>
            <Link
              to="/forgot-password"
              style={{ fontSize: '0.88rem', color: 'var(--color-accent)' }}
            >
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || isLocked}
          >
            {loading ? 'Signing in…' : isLocked ? `Try again in ${formatCountdown(lockout)}` : 'Sign In'}
          </button>
        </form>

        <p className="auth-footer">
          Don't have an account?{' '}
          <Link to="/register" state={isCheckoutRedirect ? { from: { pathname: '/checkout' }, checkoutRedirect: true } : undefined}>Create one</Link>
        </p>
      </div>
    </div>
  );
}
