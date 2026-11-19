// Strict allowed forward transitions for order status.
// Any transition not listed here is rejected with a 400.
const TRANSITIONS = {
  pending:    ['confirmed', 'cancelled'],
  confirmed:  ['processing', 'shipped', 'delivered', 'cancelled'],
  processing: ['shipped', 'delivered', 'cancelled'],
  shipped:    ['delivered'],
  delivered:  ['refunded'],
  cancelled:  ['refunded'],
  refunded:   [],
};

function assertTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    const err = new Error(`Invalid order transition: ${from} → ${to}`);
    err.status = 400;
    throw err;
  }
}

module.exports = { assertTransition, TRANSITIONS };
