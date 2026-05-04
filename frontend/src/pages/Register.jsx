import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordStrength, { getPasswordStrength } from '../components/PasswordStrength';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Register() {
  const { register } = useAuth();
  const navigate     = useNavigate();

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm: '',
    phone: '',
  });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState(0);
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
      });
      navigate('/shop');
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Create account</h1>
        <p>Join us and start shopping for premium body creams.</p>

        {error && (
          <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>
            {isLocked
              ? `Too many registration attempts. Try again in ${formatCountdown(lockout)}.`
              : error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="form-group">
              <label htmlFor="first_name">First name</label>
              <input
                id="first_name"
                name="first_name"
                type="text"
                value={form.first_name}
                onChange={handleChange}
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
              required
              autoComplete="email"
              disabled={isLocked}
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">Phone number (optional)</label>
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
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLocked}
            />
            {form.password.length > 0 && <PasswordStrength password={form.password} />}
          </div>

          <div className="form-group">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              value={form.confirm}
              onChange={handleChange}
              required
              autoComplete="new-password"
              disabled={isLocked}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || isLocked}
          >
            {loading ? 'Creating account…' : isLocked ? `Try again in ${formatCountdown(lockout)}` : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
