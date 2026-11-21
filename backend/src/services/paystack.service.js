const paystackAPI = require('../config/paystack');

async function createFullRefund({ transactionReference, amount, notes, currency = 'GHS', reference }) {
  const payload = {
    transaction: transactionReference,
    amount: Math.round(parseFloat(amount) * 100),
    currency,
  };

  if (reference) {
    payload.reference = reference;
  }

  if (notes) {
    payload.merchant_note = notes;
  }

  const response = await paystackAPI.post('/refund', payload);
  return response.data?.data || {};
}

// Fetch a specific Paystack refund by its numeric provider ID.
// Returns the refund object or null if not found.
async function fetchRefundById(refundId) {
  try {
    const { data } = await paystackAPI.get(`/refund/${refundId}`);
    return data?.data || null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// Fetch all Paystack refunds linked to a transaction reference.
// Paystack returns newest-first; callers take [0] for the latest refund.
async function fetchRefundsByTransaction(transactionReference) {
  try {
    const { data } = await paystackAPI.get('/refund', {
      params: { reference: transactionReference, perPage: 10 },
    });
    return data?.data || [];
  } catch (err) {
    if (err.response?.status === 404) return [];
    throw err;
  }
}

module.exports = {
  createFullRefund,
  createRefund: createFullRefund,
  fetchRefundById,
  fetchRefundsByTransaction,
};
