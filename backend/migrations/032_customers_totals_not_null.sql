-- Create missing customers rows for customer-role users using registration defaults
INSERT INTO customers (user_id, phone, total_spent, total_orders)
SELECT u.id, u.phone, 0, 0
  FROM users u
  LEFT JOIN customers c ON c.user_id = u.id
 WHERE u.role = 'customer'
   AND c.id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Backfill any NULL lifetime totals before enforcing NOT NULL
UPDATE customers
   SET total_spent  = COALESCE(total_spent, 0),
       total_orders = COALESCE(total_orders, 0)
 WHERE total_spent IS NULL
    OR total_orders IS NULL;

-- Enforce DEFAULT 0 and NOT NULL on both columns
ALTER TABLE customers
  ALTER COLUMN total_spent  SET DEFAULT 0,
  ALTER COLUMN total_spent  SET NOT NULL,
  ALTER COLUMN total_orders SET DEFAULT 0,
  ALTER COLUMN total_orders SET NOT NULL;
