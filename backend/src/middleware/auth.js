'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../config/database');

function isValidAccessPayload(decoded) {
  return Boolean(decoded && decoded.id && decoded.purpose !== 'mfa_challenge');
}

async function isBlacklisted(jti) {
  if (!jti) return false;
  const { rows } = await pool.query(
    'SELECT jti FROM token_blacklist WHERE jti = $1',
    [jti]
  );
  return rows.length > 0;
}

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    if (!isValidAccessPayload(decoded)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // If this token was explicitly logged out, reject it even though it hasn't expired
    if (await isBlacklisted(decoded.jti)) {
      return res.status(401).json({ error: 'Session has been ended. Please log in again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'fulfillment', 'support', 'marketing']);
const isAdminRole = (role) => ADMIN_ROLES.has(role);

const requireAdmin = async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: 'This account has been deactivated.' });
    }
    if (!ADMIN_ROLES.has(user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.userRole = user.role;
    req.userEmail = user.email;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Authorization check failed' });
  }
};

const requireRoles = (...allowed) => (req, res, next) => {
  if (!req.userRole || !allowed.includes(req.userRole)) {
    return res.status(403).json({ error: 'Insufficient role permissions' });
  }
  next();
};

// Like verifyToken but never rejects — just attaches req.user if a valid,
// non-blacklisted access token is present. Any failure treats the request as anonymous.
const optionalToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!isValidAccessPayload(decoded)) return next();
    if (await isBlacklisted(decoded.jti)) return next();
    req.user = decoded;
  } catch { /* treat invalid/blacklisted/errored token as anonymous */ }
  next();
};

module.exports = { verifyToken, requireAdmin, requireRoles, ADMIN_ROLES, isAdminRole, optionalToken };
