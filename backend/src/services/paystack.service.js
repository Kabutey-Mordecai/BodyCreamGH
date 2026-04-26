const paystackAPI = require('../config/paystack');

async function createFullRefund({ transactionReference, amount, notes }) {
  const payload = {
    transaction: transactionReference,
    amount: Math.round(parseFloat(amount) * 100),
  };

  if (notes) {
    payload.merchant_note = notes;
  }

  const response = await paystackAPI.post('/refund', payload);
  return response.data?.data || {};
}

module.exports = { createFullRefund };
