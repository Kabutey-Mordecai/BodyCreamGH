import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import PasswordStrength, { getPasswordStrength } from '../components/PasswordStrength';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep]               = useState('email'); // 'email' | 'pin' | 'password' | 'done'
  const [email, setEmail]             = useState('');
  const [pin, setPin]                 = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError]             = useState('');
  const [info, setInfo]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [lockout, setLockout]         = useState(0);
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

  const handleRateLimitOrError = (err, fallback) => {
    if (err.response?.status === 429) {
      const wait = parseInt(
        err.response.headers?.['retry-after'] || err.response.data?.retryAfter || 60,
        10
      );
      setLockout(wait);
      setError(`Too many requests. Try again in ${formatCountdown(wait)}.`);
    } else {
      setError(err.response?.data?.error || fallback);
    }
  };

  const handleSendCode = async (e) => {
    if (e) e.preventDefault();
    if (lockout > 0) return;
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await authAPI.forgotPassword(email.trim());
      setStep('pin');
      setInfo(`If an account exists for ${email.trim()}, a 6-digit code has been sent.`);
    } catch (err) {
      handleRateLimitOrError(err, 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    const cleanPin = pin.trim();
    if (!/^\d{6}$/.test(cleanPin)) {
      return setError('Please enter the 6-digit verification code from your email.');
    }
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await authAPI.verifyResetToken(cleanPin, email.trim() || undefined);
      setStep('password');
    } catch (err) {
      handleRateLimitOrError(err, 'This code is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPass) {
      return setError('Passwords do not match.');
    }
    if (getPasswordStrength(newPassword).score < 4) {
      return setError('Please meet all 4 password requirements.');
    }
    setError('');
    setLoading(true);
    try {
      await authAPI.resetPassword({
        token: pin.trim(),
        new_password: newPassword,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      setStep('done');
    } catch (err) {
      handleRateLimitOrError(err, 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockout > 0;

  if (step === 'done') {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.8rem', marginBottom: '12px' }}>✓</div>
          <h1>Password updated!</h1>
          <p>Your password has been reset. You can now sign in with your new password.</p>
          <button
            type="button"
            className="btn btn-primary btn-full"
            style={{ marginTop: 20 }}
            onClick={() => navigate('/login')}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {step === 'email' && (
          <>
            <h1>Forgot password?</h1>
            <p>Enter your email and we'll send you a 6-digit verification code.</p>

            {error && (
              <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>
                {isLocked ? `Too many requests. Try again in ${formatCountdown(lockout)}.` : error}
              </div>
            )}

            <form className="auth-form" onSubmit={handleSendCode}>
              <div className="form-group">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
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
                {loading ? 'Sending…' : isLocked ? `Try again in ${formatCountdown(lockout)}` : 'Send 6-Digit Code'}
              </button>
            </form>

            <p className="auth-footer" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={() => { setError(''); setStep('pin'); }}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent-dark, #a8863d)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}
              >
                Already have a 6-digit code?
              </button>
              <Link to="/login">Back to login</Link>
            </p>
          </>
        )}

        {step === 'pin' && (
          <>
            <h1>Enter 6-digit code</h1>
            <p>
              {email.trim()
                ? <>Enter the 6-digit code sent to <strong>{email.trim()}</strong>.</>
                : 'Enter the 6-digit verification code sent to your email.'}
            </p>

            {info && !error && <div className="alert" style={{ background: '#faf7f4', border: '1px solid var(--color-border)' }}>{info}</div>}
            {error && <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>{error}</div>}

            <form className="auth-form" onSubmit={handleVerifyPin}>
              <div className="form-group">
                <label htmlFor="pin">6-Digit Code</label>
                <input
                  id="pin"
                  name="pin"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  placeholder="000000"
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.45em', fontWeight: 700 }}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading || pin.length < 6}
              >
                {loading ? 'Verifying…' : 'Verify Code'}
              </button>
            </form>

            <p className="auth-footer" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              {email.trim() ? (
                <button
                  type="button"
                  disabled={loading || isLocked}
                  onClick={() => handleSendCode()}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent-dark, #a8863d)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}
                >
                  Resend code
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setError(''); setStep('email'); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent-dark, #a8863d)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}
                >
                  Change email
                </button>
              )}
              <Link to="/login">Back to login</Link>
            </p>
          </>
        )}

        {step === 'password' && (
          <>
            <h1>Set new password</h1>
            <p>Code verified! Choose a strong new password for your account.</p>

            {error && <div className="alert alert-error">{error}</div>}

            <form className="auth-form" onSubmit={handleUpdatePassword}>
              <div className="form-group">
                <label htmlFor="new_password">New Password</label>
                <input
                  id="new_password"
                  name="new_password"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                <PasswordStrength password={newPassword} />
              </div>

              <div className="form-group">
                <label htmlFor="confirm_password">Confirm New Password</label>
                <input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading}
              >
                {loading ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
