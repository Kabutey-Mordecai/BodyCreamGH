'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { randomUUID: uuid } = require('crypto');
const pool         = require('../config/database');
const UserModel    = require('../models/user.model');
const CustomerModel = require('../models/customer.model');
const { sendWelcomeEmail, sendPasswordResetEmail, sendOtpEmail } = require('../services/email.service');
const logger = require('../utils/logger');

// ── Register ──────────────────────────────────────────────────────────────────

const register = async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone } = req.body;

    const existing = await UserModel.findByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuid();
    const customerId = uuid();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [userId, email, passwordHash, first_name, last_name, phone, 'customer']
      );
      await client.query(
        'INSERT INTO customers (id, user_id, phone) VALUES ($1, $2, $3)',
        [customerId, userId, phone]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    sendWelcomeEmail(email, first_name).catch(err => logger.error('sendWelcomeEmail error', { err: err.message }));

    res.status(201).json({ message: 'Account created successfully', userId });
  } catch (error) {
    logger.error('Register error', { err: error.message });
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ── Login / Token issuance ────────────────────────────────────────────────────

const ACCESS_EXPIRE = process.env.JWT_EXPIRE        || '15m';
const REFRESH_DAYS  = parseInt(process.env.REFRESH_TOKEN_DAYS || '7');

// Derive the SHA-256 hex digest of a refresh token.
// The raw token is handed to the client; the digest is what we store.
// SHA-256 is appropriate here because the raw token is already 320 bits of
// CSPRNG output — there is no brute-force risk that would require bcrypt.
function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getOtpHmacSecret() {
  if (process.env.OTP_HMAC_SECRET) return process.env.OTP_HMAC_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OTP_HMAC_SECRET must be configured in production');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('OTP_HMAC_SECRET (or JWT_SECRET in dev) must be set');
  }
  // Dev-only domain-separated fallback so local dev works without extra env setup
  return crypto.createHash('sha256').update(`dev-otp-hmac:${process.env.JWT_SECRET}`).digest('hex');
}

function hashOtp(otp) {
  return crypto.createHmac('sha256', getOtpHmacSecret()).update(String(otp)).digest('hex');
}

function verifyOtpHash(submittedOtp, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/i.test(storedHash)) {
    return false;
  }
  const submittedBuf = Buffer.from(hashOtp(submittedOtp), 'hex');
  const storedBuf    = Buffer.from(storedHash, 'hex');
  return submittedBuf.length === storedBuf.length && crypto.timingSafeEqual(submittedBuf, storedBuf);
}

async function issueTokenPair(user, req) {
  const jti = uuid();
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_EXPIRE }
  );

  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash       = hashRefreshToken(rawRefreshToken);
  const expiresAt       = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  // Store only the hash — the raw token is returned to the client and never persisted.
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), user.id, tokenHash, expiresAt, req.headers['user-agent'] || null]
  );

  return { accessToken, refreshToken: rawRefreshToken, expiresAt };
}

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await UserModel.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.is_active === false) {
      return res.status(401).json({ error: 'This account has been deactivated.' });
    }

    // Admin accounts require a second factor (Email OTP) before JWT is issued.
    if (user.role === 'admin') {
      const otp = crypto.randomInt(100000, 1000000).toString();
      const otpHash = hashOtp(otp);
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await pool.query(
        `UPDATE users SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE id = $3`,
        [otpHash, otpExpiresAt, user.id]
      );

      const mfaToken = jwt.sign(
        { sub: user.id, purpose: 'mfa_challenge' },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '10m' }
      );

      sendOtpEmail(user.email, { firstName: user.first_name, otp })
        .catch(err => logger.error('Failed to send OTP email', { recipient: user.email, err: err.message }));

      if (process.env.NODE_ENV === 'development') {
        logger.info(`Development Admin OTP: ${otp}`);
      }

      logger.info('Admin MFA challenge issued', { userId: user.id });
      return res.json({ mfa_required: true, mfa_token: mfaToken });
    }

    const { accessToken, refreshToken } = await issueTokenPair(user, req);
    pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => {});

    res.json({
      token:         accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    logger.error('Login error', { err: error.message });
    res.status(500).json({ error: 'Login failed' });
  }
};

// ── Verify OTP (admin MFA second factor) ─────────────────────────────────────

const verifyOtp = async (req, res) => {
  try {
    const { mfa_token, otp_code } = req.body;
    if (!mfa_token || !otp_code) {
      return res.status(400).json({ error: 'mfa_token and otp_code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(mfa_token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired MFA session. Please log in again.' });
    }
    if (decoded.purpose !== 'mfa_challenge') {
      return res.status(401).json({ error: 'Invalid token purpose' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, role, first_name, is_active, otp_code, otp_expires_at, otp_attempts
         FROM users WHERE id = $1`,
      [decoded.sub]
    );
    const user = rows[0];
    if (!user || user.role !== 'admin' || user.is_active === false) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if ((user.otp_attempts || 0) >= 5) {
      await pool.query(
        `UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = $1`,
        [user.id]
      );
      return res.status(429).json({ error: 'Too many incorrect attempts. Please log in again to get a new code.' });
    }

    if (!user.otp_code || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired. Please log in again.' });
    }

    if (!verifyOtpHash(String(otp_code), user.otp_code)) {
      const { rows: attemptRows } = await pool.query(
        `UPDATE users
            SET otp_attempts = COALESCE(otp_attempts, 0) + 1,
                otp_code = CASE WHEN COALESCE(otp_attempts, 0) + 1 >= 5 THEN NULL ELSE otp_code END,
                otp_expires_at = CASE WHEN COALESCE(otp_attempts, 0) + 1 >= 5 THEN NULL ELSE otp_expires_at END
          WHERE id = $1
          RETURNING otp_attempts`,
        [user.id]
      );
      if ((attemptRows[0]?.otp_attempts || 0) >= 5) {
        return res.status(429).json({ error: 'Too many incorrect attempts. Please log in again to get a new code.' });
      }
      return res.status(401).json({ error: 'Incorrect verification code.' });
    }

    // Clear OTP fields and record last login — code is single-use.
    await pool.query(
      `UPDATE users SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0, last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    const { accessToken, refreshToken } = await issueTokenPair(user, req);
    logger.info('Admin MFA verified, session issued', { userId: user.id });

    res.json({
      token:         accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    logger.error('verifyOtp error', { err: error.message });
    res.status(500).json({ error: 'Verification failed' });
  }
};

// ── Refresh access token ──────────────────────────────────────────────────────

const refresh = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });

    const tokenHash = hashRefreshToken(refresh_token);

    const { rows } = await pool.query(
      `SELECT rt.*, u.id AS uid, u.email, u.role, u.is_active
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1 AND rt.revoked = false AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const record = rows[0];

    // Rotate / revoke the old token immediately.
    await pool.query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [record.id]);

    if (record.is_active === false) {
      return res.status(401).json({ error: 'This account has been deactivated.' });
    }

    const user = { id: record.uid, email: record.email, role: record.role };
    const { accessToken, refreshToken } = await issueTokenPair(user, req);

    res.json({ token: accessToken, refresh_token: refreshToken });
  } catch (error) {
    logger.error('Refresh error', { err: error.message });
    res.status(500).json({ error: 'Failed to refresh token' });
  }
};

// ── Get current user ──────────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// ── Logout ────────────────────────────────────────────────────────────────────
// Adds the access token's jti to the blacklist and revokes the refresh token.

const logout = async (req, res) => {
  try {
    // Cryptographically verify the access token (allowing expired tokens so
    // their jti/userId can still be processed safely). Never trust unverified JWTs
    // or MFA challenge tokens.
    let userId = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ['HS256'],
          ignoreExpiration: true,
        });
        if (decoded && decoded.purpose !== 'mfa_challenge' && decoded.id) {
          if (decoded.jti && decoded.exp) {
            await pool.query(
              `INSERT INTO token_blacklist (jti, expires_at)
               VALUES ($1, to_timestamp($2))
               ON CONFLICT (jti) DO NOTHING`,
              [decoded.jti, decoded.exp]
            );
          }
          userId = decoded.id;
        }
      } catch {
        // Forged or malformed token — ignore cleanly (no blacklist write, no userId).
      }
    }

    // Revoke the submitted refresh token by its hash ONLY if it is still active.
    const { refresh_token } = req.body || {};
    if (refresh_token && typeof refresh_token === 'string') {
      const tokenHash = hashRefreshToken(refresh_token);
      const { rows } = await pool.query(
        `UPDATE refresh_tokens
            SET revoked = true
          WHERE token_hash = $1
            AND revoked = false
            AND expires_at > NOW()
          RETURNING user_id`,
        [tokenHash]
      );
      if (!userId && rows[0]?.user_id) userId = rows[0].user_id;
    }

    // Revoke ALL refresh tokens for this user (full logout all devices) only when
    // userId was proven via a verified access token or active refresh token.
    if (req.query.all === 'true' && userId) {
      await pool.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
        [userId]
      );
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.json({ message: 'Logged out successfully' });
  }
};

// ── Forgot password ───────────────────────────────────────────────────────────
// Always returns the same message whether the email exists or not (prevents
// attackers from discovering which emails are registered).

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await UserModel.findByEmail(email);

    if (user) {
      // Invalidate any existing unused reset tokens for this user.
      await pool.query(
        `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
        [user.id]
      );

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [uuid(), user.id, token, expiresAt]
      );

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=${token}`;
      sendPasswordResetEmail(user.email, resetUrl).catch(err =>
        // Log the failure with the recipient address so SMTP issues are
        // diagnosable in production logs. Never log the token or the reset URL.
        logger.error('Password reset email failed to send', {
          recipient: user.email,
          err:       err.message,
        })
      );
    }

    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (error) {
    logger.error('Forgot password error', { err: error.message });
    res.status(500).json({ error: 'Failed to process request' });
  }
};

// ── Verify reset token ────────────────────────────────────────────────────────
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

// ── Reset password ────────────────────────────────────────────────────────────

const resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Compute the bcrypt hash BEFORE opening a transaction. bcrypt is intentionally
    // slow (~100ms) — holding a database row lock during that time is wrong.
    const passwordHash = await bcrypt.hash(new_password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // FOR UPDATE locks the reset token row for the duration of this transaction.
      // A concurrent request with the same token blocks here until we commit
      // (used = true → their query returns 0 rows) or roll back (they proceed).
      const { rows } = await client.query(
        `SELECT * FROM password_reset_tokens
         WHERE token = $1 AND used = false AND expires_at > NOW()
         FOR UPDATE`,
        [token]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This link is invalid or has expired.' });
      }

      const resetRecord = rows[0];

      // Update the password.
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, resetRecord.user_id]
      );

      // Mark the reset token as used so it cannot be replayed.
      await client.query(
        'UPDATE password_reset_tokens SET used = true WHERE id = $1',
        [resetRecord.id]
      );

      // Revoke all refresh tokens — a password change must end all existing sessions.
      await client.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
        [resetRecord.user_id]
      );

      await client.query('COMMIT');
      res.json({ message: 'Password reset successfully. You can now log in.' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Reset password error', { err: error.message });
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

module.exports = { register, login, verifyOtp, refresh, getMe, logout, forgotPassword, verifyResetToken, resetPassword };
