-- 038_backfill_delivered_at_from_log.sql
-- Backfill orders.delivered_at strictly from order_status_log (earliest transition to 'delivered').
-- Orders without a 'delivered' status-log row remain NULL (never guessed from updated_at).

UPDATE orders o
   SET delivered_at = (
         SELECT MIN(osl.created_at)
           FROM order_status_log osl
          WHERE osl.order_id = o.id
            AND osl.to_status = 'delivered'
       )
 WHERE o.status = 'delivered'
   AND EXISTS (
         SELECT 1
           FROM order_status_log osl
          WHERE osl.order_id = o.id
            AND osl.to_status = 'delivered'
       )
   AND (
         o.delivered_at IS NULL
         OR o.delivered_at > (
              SELECT MIN(osl.created_at)
                FROM order_status_log osl
               WHERE osl.order_id = o.id
                 AND osl.to_status = 'delivered'
            )
       );
