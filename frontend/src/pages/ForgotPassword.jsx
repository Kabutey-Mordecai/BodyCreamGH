import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../services/api';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function ForgotPassword() {
  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockout > 0) return;
    setError('');
    setLoading(true);
    try {
      await authAPI.forgotPassword(email);
      // Always show the success screen regardless of whether the email exists.
      // The server does the same — this prevents leaking which emails are registered.
      setSent(true);
    } catch (err) {
      if (err.response?.status === 429) {
        const wait = parseInt(
          err.response.headers?.['retry-after'] || err.response.data?.retryAfter || 60,
          10
        );
        setLockout(wait);
        setError(`Too many requests. Try again in ${formatCountdown(wait)}.`);
      } else {
        setError(err.response?.data?.error || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockout > 0;

  if (sent) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📧</div>
          <h1>Check your inbox</h1>
          <p>
            If an account exists for <strong>{email}</strong>, we've sent a
            password reset link. It expires in 1 hour.
          </p>
          <p className="auth-footer" style={{ marginTop: '24px' }}>
            <Link to="/login">Back to login</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Forgot password?</h1>
        <p>Enter your email and we'll send you a reset link.</p>

        {error && (
          <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>
            {isLocked
              ? `Too many requests. Try again in ${formatCountdown(lockout)}.`
              : error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={isLocked}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || isLocked}
          >
            {loading ? 'Sending…' : isLocked ? `Try again in ${formatCountdown(lockout)}` : 'Send Reset Link'}
          </button>
        </form>

        <p className="auth-footer">
          <Link to="/login">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
