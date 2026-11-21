'use strict';

const crypto = require('crypto');

// RFC 4648 Base32 alphabet (32 characters = 5 bits per character).
// 5 random bytes = 40 bits = exactly 8 base32 characters with zero modulo bias.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateOrderNumber() {
  const buf = crypto.randomBytes(5);
  // Read 40 bits as a BigInt to cleanly slice 8 x 5-bit indices
  let bits = 0n;
  for (let i = 0; i < 5; i++) {
    bits = (bits << 8n) | BigInt(buf[i]);
  }
  let code = '';
  for (let i = 7; i >= 0; i--) {
    const idx = Number((bits >> BigInt(i * 5)) & 31n);
    code += BASE32_ALPHABET[idx];
  }
  return `ORD-${code}`;
}

/**
 * Execute an order INSERT inside an active PostgreSQL transaction with
 * SAVEPOINT-guarded retry on order_number unique constraint (23505) collisions.
 *
 * @param {import('pg').PoolClient} client - Active PG client inside BEGIN
 * @param {(orderNumber: string) => Promise<void>} insertFn - Callback executing the INSERT
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=5]
 * @param {() => string} [opts.generator=generateOrderNumber]
 * @returns {Promise<string>} The unique order_number that was inserted
 */
async function insertOrderWithUniqueNumber(client, insertFn, opts = {}) {
  const maxAttempts = opts.maxAttempts || 5;
  const generator = opts.generator || generateOrderNumber;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const orderNumber = generator();
    await client.query('SAVEPOINT order_number_insert');
    try {
      await insertFn(orderNumber);
      await client.query('RELEASE SAVEPOINT order_number_insert');
      return orderNumber;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT order_number_insert');
      await client.query('RELEASE SAVEPOINT order_number_insert');
      const isOrderNumberCollision =
        err.code === '23505' &&
        (err.constraint === 'orders_order_number_key' ||
          String(err.detail || '').includes('(order_number)'));
      if (isOrderNumberCollision && attempt < maxAttempts) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to generate a unique order number');
}

module.exports = {
  BASE32_ALPHABET,
  generateOrderNumber,
  insertOrderWithUniqueNumber,
};
