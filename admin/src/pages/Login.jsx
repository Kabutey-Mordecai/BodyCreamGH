import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'BodyCream GH';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || '/';

  const [form,   setForm]   = useState({ email: '', password: '' });
  const [error,  setError]  = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

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

        <h1 style={{ marginBottom: 6 }}>Sign in</h1>
        <p className="muted text-sm" style={{ marginBottom: 22 }}>
          Enter your administrator credentials to continue.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

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
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="muted text-xs" style={{ textAlign: 'center', marginTop: 20 }}>
          Need access? Ask the store owner to create an admin account for you.
        </p>
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
