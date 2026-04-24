const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const UserModel = require('../models/user.model');
const CustomerModel = require('../models/customer.model');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../services/email.service');

// ─── Register ────────────────────────────────────────────────────────────────

const register = async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone } = req.body;

    const existing = await UserModel.findByEmail(email);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuid();

    await UserModel.create(userId, { email, passwordHash, first_name, last_name, phone });
    await CustomerModel.create(userId, phone);

    sendWelcomeEmail(email, first_name).catch(console.error);

    res.status(201).json({ message: 'Account created successfully', userId });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ─── Login ───────────────────────────────────────────────────────────────────

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await UserModel.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // jti (JWT ID) lets us blacklist this specific token on logout
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, jti: uuid() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// ─── Get current user ────────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// ─── Logout ──────────────────────────────────────────────────────────────────
// Adds the token's jti to the blacklist so it cannot be reused even before it expires.

const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.jti && decoded?.exp) {
        await pool.query(
          `INSERT INTO token_blacklist (jti, expires_at)
           VALUES ($1, to_timestamp($2))
           ON CONFLICT (jti) DO NOTHING`,
          [decoded.jti, decoded.exp]
        );
      }
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    // Logout should always succeed from the user's perspective
    res.json({ message: 'Logged out successfully' });
  }
};

// ─── Forgot password ─────────────────────────────────────────────────────────
// Always returns the same message whether the email exists or not (prevents
// attackers from discovering which emails are registered).

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await UserModel.findByEmail(email);

    if (user) {
      // Invalidate any existing unused tokens for this user
      await pool.query(
        `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
        [user.id]
      );

      // Generate a secure random 64-char hex token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [uuid(), user.id, token, expiresAt]
      );

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=${token}`;
      sendPasswordResetEmail(user.email, resetUrl).catch(console.error);
    }

    // Same response regardless of whether email exists
    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
};

// ─── Verify reset token ──────────────────────────────────────────────────────
// Frontend calls this first to decide whether to show the reset form.

const verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;
    const { rows } = await pool.query(
      `SELECT id FROM password_reset_tokens
       WHERE token = $1 AND used = false AND expires_at > NOW()`,
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ valid: false, error: 'This link is invalid or has expired.' });
    }
    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify token' });
  }
};

// ─── Reset password ──────────────────────────────────────────────────────────

const resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE token = $1 AND used = false AND expires_at > NOW()`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'This link is invalid or has expired.' });
    }

    const resetToken = rows[0];
    const passwordHash = await bcrypt.hash(new_password, 10);

    // Update password and mark token as used in one go
    await Promise.all([
      UserModel.updatePassword(resetToken.user_id, passwordHash),
      pool.query(
        `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
        [resetToken.id]
      ),
    ]);

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

module.exports = { register, login, getMe, logout, forgotPassword, verifyResetToken, resetPassword };
