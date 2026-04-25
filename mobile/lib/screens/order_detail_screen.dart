import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../config.dart';
import '../models/order.dart';
import '../services/api_service.dart';
import '../widgets/status_chip.dart';

class OrderDetailScreen extends StatefulWidget {
  final int orderId;
  final bool justPaid;

  const OrderDetailScreen({
    super.key,
    required this.orderId,
    this.justPaid = false,
  });

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  Order? _order;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    if (widget.justPaid) {
      // Show a brief success banner after returning from payment WebView
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Payment successful! Your order is being confirmed.'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 4),
            ),
          );
        }
      });
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await ApiService.instance.getOrder(widget.orderId);
      if (mounted) setState(() {
        _order = Order.fromJson(data);
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('MMM d, yyyy – HH:mm');

    return Scaffold(
      appBar: AppBar(
        title: Text(_order != null ? '#${_order!.orderNumber}' : 'Order Detail'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _order == null
              ? const Center(child: Text('Order not found'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Status section
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text('Order Status: ',
                                      style: Theme.of(context).textTheme.titleSmall),
                                  StatusChip(_order!.status),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Text('Payment: ',
                                      style: Theme.of(context).textTheme.titleSmall),
                                  StatusChip(_order!.paymentStatus),
                                ],
                              ),
                              if (_order!.deliveryStatus != null) ...[
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Text('Delivery: ',
                                        style: Theme.of(context).textTheme.titleSmall),
                                    StatusChip(_order!.deliveryStatus!),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Delivery address
                      if (_order!.deliveryAddress != null)
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.location_on_outlined),
                            title: const Text('Delivery Address'),
                            subtitle: Text(_order!.deliveryAddress!),
                          ),
                        ),
                      const SizedBox(height: 12),

                      // Items
                      Text('Items', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      ..._order!.items.map((item) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Row(
                              children: [
                                Expanded(
                                    child: Text('${item.name} × ${item.quantity}')),
                                Text(
                                  '${AppConfig.currencySymbol}${(item.priceAtPurchase * item.quantity).toStringAsFixed(2)}',
                                ),
                              ],
                            ),
                          )),
                      const Divider(),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Total',
                              style: Theme.of(context).textTheme.titleMedium),
                          Text(
                            '${AppConfig.currencySymbol}${_order!.totalAmount.toStringAsFixed(2)}',
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                  color: Theme.of(context).colorScheme.primary),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      Text(
                        'Placed on ${fmt.format(_order!.createdAt.toLocal())}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
    );
  }
}
