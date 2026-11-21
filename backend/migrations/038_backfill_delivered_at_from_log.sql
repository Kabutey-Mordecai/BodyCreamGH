-- 038_backfill_delivered_at_from_log.sql
-- Backfill orders.delivered_at from order_status_log (earliest transition to 'delivered')
-- for already-delivered orders, falling back to orders.updated_at.

UPDATE orders o
   SET delivered_at = COALESCE(
         (SELECT MIN(osl.created_at)
            FROM order_status_log osl
           WHERE osl.order_id = o.id
             AND osl.to_status = 'delivered'),
         o.updated_at
       )
 WHERE o.status = 'delivered'
   AND (
     o.delivered_at IS NULL
     OR EXISTS (
       SELECT 1
         FROM order_status_log osl
        WHERE osl.order_id = o.id
          AND osl.to_status = 'delivered'
          AND osl.created_at < o.delivered_at
     )
   );
