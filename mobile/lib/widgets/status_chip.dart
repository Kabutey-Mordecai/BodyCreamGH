import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class StatusChip extends StatelessWidget {
  final String status;

  const StatusChip(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final (label, bg, fg) = _resolve(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  static (String, Color, Color) _resolve(String status) {
    switch (status.toLowerCase()) {
      case 'pending':
        return ('Pending', const Color(0xFFFEF3C7), const Color(0xFF92400E));
      case 'confirmed':
        return ('Confirmed', const Color(0xFFDBEAFE), const Color(0xFF1E40AF));
      case 'processing':
        return ('Processing', const Color(0xFFE0E7FF), const Color(0xFF3730A3));
      case 'shipped':
      case 'in_transit':
        return ('Shipped', const Color(0xFFF3E8FF), const Color(0xFF6B21A8));
      case 'out_for_delivery':
        return ('Out for Delivery', const Color(0xFFCCFBF1), const Color(0xFF115E59));
      case 'delivered':
      case 'paid':
      case 'success':
        return (
          status.toLowerCase() == 'paid' ? 'Paid' : 'Delivered',
          const Color(0xFFD1FAE5),
          const Color(0xFF065F46),
        );
      case 'unpaid':
        return ('Unpaid', const Color(0xFFFEF3C7), const Color(0xFF92400E));
      case 'payment_review':
        return ('Payment Review', const Color(0xFFFEF3C7), const Color(0xFF92400E));
      case 'cancel_requested':
        return ('Cancel Requested', const Color(0xFFFEE2E2), const Color(0xFF991B1B));
      case 'return_requested':
        return ('Return Requested', const Color(0xFFFEF3C7), const Color(0xFF92400E));
      case 'partially_refunded':
        return ('Partially Refunded', const Color(0xFFFEF3C7), const Color(0xFF92400E));
      case 'refund_pending':
        return ('Refund Pending', const Color(0xFFFEF3C7), const Color(0xFF92400E));
      case 'refund_failed':
        return ('Refund Failed', const Color(0xFFFEE2E2), const Color(0xFF991B1B));
      case 'rejected':
        return ('Rejected', const Color(0xFFFEE2E2), const Color(0xFF991B1B));
      case 'approved':
        return ('Approved', const Color(0xFFD1FAE5), const Color(0xFF065F46));
      case 'cancelled':
      case 'failed':
        return (
          status.toLowerCase() == 'failed' ? 'Failed' : 'Cancelled',
          const Color(0xFFFEE2E2),
          const Color(0xFF991B1B),
        );
      case 'refunded':
        return ('Refunded', AppColors.border, AppColors.primary);
      default:
        return (status, AppColors.border, AppColors.primary);
    }
  }
}
