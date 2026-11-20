const pool = require('../config/database');

module.exports = {
  findByEmail: async (email) => {
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER(TRIM($1))', [email]);
    return rows[0] || null;
  },

  findById: async (id) => {
    const { rows } = await pool.query(
      'SELECT id, email, first_name, last_name, phone, role FROM users WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  findByIdWithHash: async (id) => {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  },

  create: async (id, { email, passwordHash, first_name, last_name, phone, role = 'customer' }) => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, String(email || '').trim().toLowerCase(), passwordHash, first_name, last_name, phone, role]
    );
  },

  updateProfile: async (id, { first_name, last_name, phone }) => {
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, phone=$3, updated_at=NOW() WHERE id=$4',
      [first_name, last_name, phone, id]
    );
  },

  updatePassword: async (id, passwordHash) => {
    await pool.query(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2',
      [passwordHash, id]
    );
  },
};
