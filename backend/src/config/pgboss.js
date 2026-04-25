const { PgBoss } = require('pg-boss');
const logger = require('../utils/logger');

const boss = new PgBoss({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'cosmetics_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 5, // dedicated pool for pg-boss (separate from main app pool)
});

boss.on('error', err => logger.error('PgBoss error', { err: err.message }));

module.exports = boss;
