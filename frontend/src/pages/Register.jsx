import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PasswordStrength, { getPasswordStrength } from '../components/PasswordStrength';
import TurnstileWidget from '../components/TurnstileWidget';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Register() {
  const { register } = useAuth();
  const settings     = useSettings();
  const storeName    = settings?.store_name || 'GlowHaus Beauty';
  const navigate     = useNavigate();
  const location     = useLocation();

  const from = location.state?.from?.pathname || '/shop';
  const isCheckoutRedirect = Boolean(location.state?.checkoutRedirect || from === '/checkout');

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm: '',
    phone: '',
  });
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [lockout, setLockout]           = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [website, setWebsite]           = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);
  const timerRef = useRef(null);

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

    if (form.password !== form.confirm) {
      return setError('Passwords do not match.');
    }
    const { score } = getPasswordStrength(form.password);
    if (score < 4) {
      return setError('Please meet all password requirements before continuing.');
    }

    setLoading(true);
    try {
      await register({
        first_name: form.first_name,
        last_name:  form.last_name,
        email:      form.email,
        password:   form.password,
        phone:      form.phone,
        ...(website ? { website } : {}),
        ...(turnstileToken ? { cf_turnstile_response: turnstileToken } : {}),
      });
      navigate(from, { replace: true });
    } catch (err) {
      if (err.response?.status === 429) {
        const wait = parseInt(
          err.response.headers?.['retry-after'] || err.response.data?.retryAfter || 60,
          10
        );
        setLockout(wait);
        setError(`Too many registration attempts. Try again in ${formatCountdown(wait)}.`);
      } else {
        setError(err.response?.data?.error || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockout > 0;

  const passwordsMismatch = form.confirm.length > 0 && form.password !== form.confirm;

  const EyeIcon = ({ open }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        {isCheckoutRedirect && (
          <div className="auth-checkout-banner" role="status">
            <strong>Create an account to checkout</strong>
            <p>
              Your basket will be transferred to your new account automatically so you can finish your order right away.
            </p>
          </div>
        )}
        <span className="auth-eyebrow">{storeName}</span>
        <h1>{isCheckoutRedirect ? 'Create Account & Checkout' : 'Create account'}</h1>
        <p className="auth-subtitle">
          {isCheckoutRedirect
            ? 'Quick signup to save your address, track your shipment, and order.'
            : `Join ${storeName} to discover curated skincare, makeup, and fragrance.`}
        </p>

        {error && (
          <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>
            {isLocked
              ? `Too many registration attempts. Try again in ${formatCountdown(lockout)}.`
              : error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-name-row">
            <div className="form-group">
              <label htmlFor="first_name">First name</label>
              <input
                id="first_name"
                name="first_name"
                type="text"
                value={form.first_name}
                onChange={handleChange}
                placeholder="Ama"
                required
                autoComplete="given-name"
                disabled={isLocked}
              />
            </div>
            <div className="form-group">
              <label htmlFor="last_name">Last name</label>
              <input
                id="last_name"
                name="last_name"
                type="text"
                value={form.last_name}
                onChange={handleChange}
                placeholder="Mensah"
                required
                autoComplete="family-name"
                disabled={isLocked}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              autoComplete="email"
              disabled={isLocked}
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">
              Phone number <span className="form-optional">(optional)</span>
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              autoComplete="tel"
              placeholder="+233 XX XXX XXXX"
              disabled={isLocked}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="auth-password-wrap">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder="At least 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
                disabled={isLocked}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                disabled={isLocked}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            {form.password.length > 0 && <PasswordStrength password={form.password} />}
          </div>

          <div className="form-group">
            <label htmlFor="confirm">Confirm password</label>
            <div className="auth-password-wrap">
              <input
                id="confirm"
                name="confirm"
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm}
                onChange={handleChange}
                placeholder="Re-enter your password"
                required
                autoComplete="new-password"
                disabled={isLocked}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                aria-pressed={showConfirm}
                disabled={isLocked}
              >
                <EyeIcon open={showConfirm} />
              </button>
            </div>
            {passwordsMismatch && (
              <span className="auth-field-hint" role="alert">Passwords do not match</span>
            )}
          </div>

          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
          />

          <TurnstileWidget
            resetKey={turnstileReset}
            onToken={setTurnstileToken}
            onExpire={() => { setTurnstileToken(''); setTurnstileReset(k => k + 1); }}
          />

          <button
            type="submit"
            className="btn btn-primary btn-full auth-submit-btn"
            disabled={loading || isLocked}
          >
            {loading ? 'Creating account…' : isLocked ? `Try again in ${formatCountdown(lockout)}` : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" state={isCheckoutRedirect ? { from: { pathname: '/checkout' }, checkoutRedirect: true } : undefined}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
