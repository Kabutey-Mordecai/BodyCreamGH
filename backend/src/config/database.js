const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host:                   process.env.DB_HOST,
  port:                   process.env.DB_PORT,
  database:               process.env.DB_NAME,
  user:                   process.env.DB_USER,
  password:               process.env.DB_PASSWORD,
  max:                    10,
  idleTimeoutMillis:      30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  logger.info('Connected to PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle DB client', { err: err.message });
  process.exit(-1);
});

module.exports = pool;
