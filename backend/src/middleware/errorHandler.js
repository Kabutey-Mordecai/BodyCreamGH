const logger = require('../utils/logger');

const errorHandler = (err, req, res, _next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack, path: req.path });
  const statusCode = err.status || 500;
  // Only forward the raw message for client errors; keep 500 responses generic
  // so internal details (DB messages, stack traces) are never sent to the browser.
  res.status(statusCode).json({
    error: statusCode < 500 ? (err.message || 'Bad request') : 'Internal server error',
  });
};

module.exports = errorHandler;
