import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Wraps any route that requires login.
// Shows nothing while we're still checking localStorage on first load
// (avoids a flash of the login page for users who are already logged in).
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  // Redirect to /login and remember where the user was trying to go
  // so we can send them back after a successful login.
  if (!user) return <Navigate to="/login" replace />;

  return children;
}
