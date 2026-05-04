import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import PasswordStrength, { getPasswordStrength } from '../components/PasswordStrength';

export default function ResetPassword() {
  // The reset token comes in the URL query string: /reset-password?token=abc123
  const [searchParams] = useSearchParams();
  const token          = searchParams.get('token');
  const navigate       = useNavigate();

  const [valid, setValid]     = useState(null); // null = checking, true/false = result
  const [form, setForm]       = useState({ password: '', confirm: '' });
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // On mount, verify the token is still valid before showing the form.
  // Saves the user from filling in the form only to find the link is expired.
  useEffect(() => {
    if (!token) { setValid(false); return; }
    authAPI.verifyResetToken(token)
      .then(() => setValid(true))
      .catch(() => setValid(false));
  }, [token]);

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirm) {
      return setError('Passwords do not match.');
    }
    if (getPasswordStrength(form.password).score < 4) {
      return setError('Please meet all password requirements before continuing.');
    }

    setLoading(true);
    try {
      await authAPI.resetPassword({ token, new_password: form.password });
      setSuccess(true);
      // Redirect to login after 3 seconds so the user sees the success message
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  // Still checking the token
  if (valid === null) {
    return (
      <div className="auth-page">
        <div className="spinner" />
      </div>
    );
  }

  // Token is invalid or expired
  if (!valid) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>Link expired</h1>
          <p>This password reset link is invalid or has expired.</p>
          <Link to="/forgot-password" className="btn btn-primary" style={{ marginTop: '20px' }}>
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  // Password was changed successfully
  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>Password updated!</h1>
          <p>Your password has been changed. Redirecting you to login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Set new password</h1>
        <p>Choose a strong password for your account.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              required
              minLength={8}
              autoComplete="new-password"
            />
            {form.password.length > 0 && <PasswordStrength password={form.password} />}
          </div>

          <div className="form-group">
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              value={form.confirm}
              onChange={handleChange}
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
      </div>
    </div>
  );
}
