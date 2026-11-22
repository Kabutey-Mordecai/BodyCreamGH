import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isRouteAllowed } from '../utils/rbac';

// Gate every admin page behind a login and role permission check.
// While the AuthProvider restores session from localStorage we show a spinner —
// without this you'd see the login page flash for a split second on refresh.
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '100px' }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!isRouteAllowed(location.pathname, user?.role)) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '12px', color: '#b91c1c' }}>Access Denied</h2>
        <p style={{ opacity: 0.8, marginBottom: '24px' }}>
          Your role ({user?.role}) does not have permission to view {location.pathname}.
        </p>
        <a href="/" style={{ display: 'inline-block', padding: '10px 20px', background: '#1c1410', color: '#fff', borderRadius: '6px', textDecoration: 'none' }}>
          Return to Dashboard
        </a>
      </div>
    );
  }
  return children;
}
