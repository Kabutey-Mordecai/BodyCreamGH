-- 039_null_guessed_delivered_at.sql
-- Clear delivered_at on any delivered orders that have no 'delivered' entry in order_status_log
-- (undoing any earlier updated_at guess so admin manual return override handles them explicitly).

UPDATE orders o
   SET delivered_at = NULL
 WHERE o.status = 'delivered'
   AND o.delivered_at IS NOT NULL
   AND NOT EXISTS (
         SELECT 1
           FROM order_status_log osl
          WHERE osl.order_id = o.id
            AND osl.to_status = 'delivered'
       );
