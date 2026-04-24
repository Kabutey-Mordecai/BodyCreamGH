const pool = require('../config/database');

const getDashboard = async (req, res) => {
  try {
    const [revenue, orders, customers, products, recentOrders] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders WHERE payment_status = 'paid'`),
      pool.query('SELECT COUNT(*) FROM orders'),
      pool.query(`SELECT COUNT(*) FROM users WHERE role = 'customer'`),
      pool.query('SELECT COUNT(*) FROM products'),
      pool.query('SELECT id, order_number, total_amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 10'),
    ]);

    res.json({
      totalRevenue: revenue.rows[0].total_revenue,
      totalOrders: orders.rows[0].count,
      totalCustomers: customers.rows[0].count,
      totalProducts: products.rows[0].count,
      recentOrders: recentOrders.rows,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
      FROM orders WHERE payment_status = 'paid'
      GROUP BY DATE(created_at)
      ORDER BY date DESC LIMIT 30
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

const getTopProducts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.price, COUNT(oi.id) as times_sold, SUM(oi.quantity) as total_quantity
      FROM products p JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.id, p.name, p.price
      ORDER BY total_quantity DESC LIMIT 10
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top products' });
  }
};

const getInventoryOverview = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, sku, stock_quantity, price FROM products ORDER BY stock_quantity ASC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.created_at,
             c.total_spent, c.total_orders
      FROM users u LEFT JOIN customers c ON u.id = c.user_id
      WHERE u.role = 'customer'
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
};

module.exports = { getDashboard, getAnalytics, getTopProducts, getInventoryOverview, getAllCustomers };
