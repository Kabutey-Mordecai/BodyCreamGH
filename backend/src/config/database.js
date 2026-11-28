const { Pool } = require('pg');
const logger = require('../utils/logger');

const maxPoolSize = Math.max(2, parseInt(process.env.DB_POOL_MAX, 10) || 10);

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString:        process.env.DATABASE_URL,
      max:                     maxPoolSize,
      idleTimeoutMillis:       30000,
      connectionTimeoutMillis: 2000,
    }
  : {
      host:                    process.env.DB_HOST,
      port:                    process.env.DB_PORT,
      database:                process.env.DB_NAME,
      user:                    process.env.DB_USER,
      password:                process.env.DB_PASSWORD,
      max:                     maxPoolSize,
      idleTimeoutMillis:       30000,
      connectionTimeoutMillis: 2000,
    };

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  logger.info('Connected to PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle DB client — pool will automatically discard and reconnect', { err: err.message });
});

let readPool = null;

function getReadPool() {
  const readUrl = process.env.DATABASE_READ_URL || process.env.DATABASE_REPLICA_URL;
  if (!readUrl) {
    return pool;
  }
  if (!readPool) {
    readPool = new Pool({
      connectionString:        readUrl,
      max:                     maxPoolSize,
      idleTimeoutMillis:       30000,
      connectionTimeoutMillis: 2000,
    });
    readPool.on('connect', () => {
      logger.info('Connected to PostgreSQL Read Replica');
    });
    readPool.on('error', (err) => {
      logger.error('Unexpected error on idle read-replica DB client', { err: err.message });
    });
  }
  return readPool;
}

module.exports = pool;
module.exports.pool = pool;
module.exports.getReadPool = getReadPool;
