import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    try {
      const apiBase = import.meta.env.VITE_API_URL || '/api';
      const payload = JSON.stringify({
        source: 'admin',
        message: String(error?.message || 'Unknown admin error').slice(0, 500),
        route: window.location.pathname,
        componentStack: String(info?.componentStack || '').slice(0, 1000),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `${apiBase.replace(/\/$/, '')}/telemetry/client-error`,
          new Blob([payload], { type: 'application/json' })
        );
      }
    } catch { /* ignore */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '64px 24px', textAlign: 'center', maxWidth: '520px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '10px' }}>Admin view error</h2>
          <p style={{ opacity: 0.75, marginBottom: '20px' }}>
            An unexpected error occurred in this panel. Reloading usually resolves it.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
