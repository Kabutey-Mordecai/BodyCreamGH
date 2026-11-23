import { Component } from 'react';
import { isChunkLoadError, triggerSingleChunkReload } from '../utils/lazyWithRetry';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isReloading: false };
  }

  static getDerivedStateFromError(error) {
    if (isChunkLoadError(error)) {
      return { hasError: true, isReloading: true };
    }
    return { hasError: true, isReloading: false };
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, isReloading: false });
    }
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error) && triggerSingleChunkReload()) {
      return;
    }
    console.error('[ErrorBoundary caught error]:', error?.message, error?.stack, info?.componentStack);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '/api';
      const payload = JSON.stringify({
        source: 'storefront',
        message: String(error?.message || 'Unknown render error').slice(0, 500),
        route: window.location.pathname,
        componentStack: String(info?.componentStack || '').slice(0, 1000),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `${apiBase.replace(/\/$/, '')}/telemetry/client-error`,
          new Blob([payload], { type: 'application/json' })
        );
      }
    } catch { /* never throw inside error boundary */ }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isReloading) {
        return (
          <div className="container" style={{ padding: '72px 24px', textAlign: 'center', color: 'var(--color-muted)' }}>
            Refreshing to latest version…
          </div>
        );
      }
      return (
        <div className="container" style={{ padding: '72px 24px', textAlign: 'center', maxWidth: '540px' }}>
          <h2 style={{ marginBottom: '12px' }}>Something went wrong</h2>
          <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>
            We hit an unexpected issue loading this view. Please reload the page or return to the homepage.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload Page
            </button>
            <a href="/" className="btn">Go Home</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
