import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'BodyCream GH';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Login() {
  const { login, completeOtpLogin } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || '/';

  // Step 1: credentials
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState(0);
  const timerRef = useRef(null);

  // Step 2: OTP
  const [mfaToken,  setMfaToken]  = useState(null); // non-null = OTP step active
  const [otpCode,   setOtpCode]   = useState('');
  const [otpError,  setOtpError]  = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const otpRef = useRef(null);

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

  // Auto-focus OTP input when the step becomes active
  useEffect(() => {
    if (mfaToken) otpRef.current?.focus();
  }, [mfaToken]);

  const submit = async (e) => {
    e.preventDefault();
    if (lockout > 0) return;
    setError('');
    setLoading(true);
    try {
      const result = await login(form.email, form.password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      if (err.response?.status === 429) {
        const wait = parseInt(
          err.response.headers?.['retry-after'] || err.response.data?.retryAfter || 60,
          10
        );
        setLockout(wait);
        setError(`Too many login attempts. Try again in ${formatCountdown(wait)}.`);
      } else {
        setError(err.response?.data?.error || err.message || 'Login failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    if (!otpCode.trim()) { setOtpError('Please enter the verification code.'); return; }
    setOtpError('');
    setOtpLoading(true);
    try {
      await completeOtpLogin(mfaToken, otpCode.trim());
      navigate(from, { replace: true });
    } catch (err) {
      if (err.response?.status === 429) {
        setOtpError('Too many incorrect attempts. Please log in again.');
        setMfaToken(null);
        setOtpCode('');
      } else {
        setOtpError(err.response?.data?.error || 'Verification failed. Please try again.');
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const isLocked = lockout > 0;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-mark">✦</span>
          <div>
            <div className="login-brand-name">{STORE_NAME}</div>
            <div className="login-brand-sub">Admin Console</div>
          </div>
        </div>

        {!mfaToken ? (
          <>
            <h1 style={{ marginBottom: 6 }}>Sign in</h1>
            <p className="muted text-sm" style={{ marginBottom: 22 }}>
              Enter your administrator credentials to continue.
            </p>

            {error && (
              <div className={`alert ${isLocked ? 'alert-warning' : 'alert-error'}`}>
                {isLocked
                  ? `Too many login attempts. Try again in ${formatCountdown(lockout)}.`
                  : error}
              </div>
            )}

            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  required
                  disabled={isLocked}
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  autoComplete="current-password"
                  required
                  disabled={isLocked}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={loading || isLocked}
              >
                {loading ? 'Signing in…' : isLocked ? `Try again in ${formatCountdown(lockout)}` : 'Sign in'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: 6 }}>Verify your identity</h1>
            <p className="muted text-sm" style={{ marginBottom: 22 }}>
              A 6-digit code was sent to your email address. Enter it below to continue.
            </p>

            {otpError && <div className="alert alert-error">{otpError}</div>}

            <form onSubmit={submitOtp}>
              <div className="field">
                <label htmlFor="otp">Verification code</label>
                <input
                  id="otp"
                  ref={otpRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                  required
                  style={{ letterSpacing: '0.3em', fontSize: '1.4rem', textAlign: 'center' }}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={otpLoading || otpCode.length < 6}
              >
                {otpLoading ? 'Verifying…' : 'Verify'}
              </button>

              <button
                type="button"
                className="btn btn-outline btn-full"
                style={{ marginTop: 10 }}
                onClick={() => { setMfaToken(null); setOtpCode(''); setOtpError(''); }}
              >
                Back to sign in
              </button>
            </form>

            <p className="muted text-xs" style={{ textAlign: 'center', marginTop: 16 }}>
              Didn't receive the code? Check your spam folder, or go back and try again.
            </p>
          </>
        )}

        {!mfaToken && (
          <p className="muted text-xs" style={{ textAlign: 'center', marginTop: 20 }}>
            Need access? Ask the store owner to create an admin account for you.
          </p>
        )}
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          background: var(--ac-sidebar);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background-image:
            radial-gradient(at 20% 20%, rgba(201, 165, 90, 0.12), transparent 40%),
            radial-gradient(at 80% 80%, rgba(201, 165, 90, 0.08), transparent 40%);
        }
        .login-card {
          background: #fff;
          border-radius: 14px;
          padding: 34px 36px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        }
        .login-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-bottom: 22px;
          margin-bottom: 22px;
          border-bottom: 1px solid var(--ac-border);
        }
        .login-mark {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.8rem;
          color: var(--ac-accent);
          line-height: 1;
        }
        .login-brand-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.3rem;
          font-weight: 600;
          line-height: 1.1;
        }
        .login-brand-sub {
          font-size: 0.68rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--ac-text-muted);
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}
