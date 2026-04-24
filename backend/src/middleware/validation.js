const validateRegister = (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  next();
};

const validateProduct = (req, res, next) => {
  const { name, price } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Product name and price are required' });
  }
  if (isNaN(price) || price <= 0) {
    return res.status(400).json({ error: 'Price must be a positive number' });
  }
  next();
};

module.exports = { validateRegister, validateProduct };
