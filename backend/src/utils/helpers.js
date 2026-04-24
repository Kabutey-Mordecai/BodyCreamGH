const formatCurrency = (amount) => `GHS ${parseFloat(amount || 0).toFixed(2)}`;

const paginate = (page = 1, limit = 20) => {
  const safePage = Math.max(1, parseInt(page));
  const safeLimit = Math.min(100, parseInt(limit));
  return { offset: (safePage - 1) * safeLimit, limit: safeLimit };
};

module.exports = { formatCurrency, paginate };
