const EventEmitter = require('events');

// Singleton event bus used across the entire application.
// Keeping it as a module-level singleton means every require() gets the same instance.
const eventBus = new EventEmitter();
eventBus.setMaxListeners(20); // accommodate multiple handlers per event

// Without this, an unhandled 'error' event throws and can crash the Node process.
eventBus.on('error', (err) => {
  console.error('[eventBus] Unhandled error event:', err);
});

module.exports = eventBus;
