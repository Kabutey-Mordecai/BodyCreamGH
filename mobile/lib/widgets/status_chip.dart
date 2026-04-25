import 'package:flutter/material.dart';

class StatusChip extends StatelessWidget {
  final String status;

  const StatusChip(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _resolve(status);
    return Chip(
      label: Text(label, style: const TextStyle(color: Colors.white, fontSize: 12)),
      backgroundColor: color,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }

  static (String, Color) _resolve(String status) {
    switch (status) {
      case 'pending':
        return ('Pending', Colors.orange);
      case 'confirmed':
        return ('Confirmed', Colors.blue);
      case 'processing':
        return ('Processing', Colors.indigo);
      case 'shipped':
        return ('Shipped', Colors.purple);
      case 'delivered':
        return ('Delivered', Colors.green);
      case 'cancelled':
        return ('Cancelled', Colors.red);
      case 'paid':
        return ('Paid', Colors.green);
      case 'unpaid':
        return ('Unpaid', Colors.orange);
      case 'in_transit':
        return ('In Transit', Colors.purple);
      case 'out_for_delivery':
        return ('Out for Delivery', Colors.teal);
      default:
        return (status, Colors.grey);
    }
  }
}
