import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { newsletterAPI } from '../services/api';

export default function Unsubscribe() {
  const [searchParams]     = useSearchParams();
  const token              = searchParams.get('token');
  const [status, setStatus] = useState('loading'); // loading | success | error

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    newsletterAPI.unsubscribe(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        {status === 'loading' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 20px' }} />
            <p>Processing your request…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <h1>You've been unsubscribed.</h1>
            <p>Sorry to see you go. You won't receive any more newsletters from us.</p>
            <Link
              to="/"
              className="btn btn-primary"
              style={{ marginTop: '24px', display: 'inline-block' }}
            >
              Back to home
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <h1>Invalid link</h1>
            <p>This unsubscribe link is invalid or has already been used.</p>
            <Link
              to="/"
              className="btn btn-outline"
              style={{ marginTop: '24px', display: 'inline-block' }}
            >
              Back to home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
