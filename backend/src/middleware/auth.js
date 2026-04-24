const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // If this token was explicitly logged out, reject it even though it hasn't expired
    if (decoded.jti) {
      const { rows } = await pool.query(
        'SELECT jti FROM token_blacklist WHERE jti = $1',
        [decoded.jti]
      );
      if (rows.length > 0) {
        return res.status(401).json({ error: 'Session has been ended. Please log in again.' });
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { verifyToken, requireAdmin };
