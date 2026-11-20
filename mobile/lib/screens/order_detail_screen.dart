import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../config.dart';
import '../models/order.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';
import '../widgets/status_chip.dart';

const List<String> _timelineSteps = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
];

class OrderDetailScreen extends StatefulWidget {
  final String orderId;
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
  bool _paying = false;

  @override
  void initState() {
    super.initState();
    _load();
    if (widget.justPaid) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content:
                  Text('Payment successful! Your order is being confirmed.'),
              backgroundColor: AppColors.success,
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
      if (mounted) {
        setState(() {
          _order = Order.fromJson(data);
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _canPayNow =>
      _order != null &&
      (_order!.paymentStatus == 'unpaid' ||
          _order!.paymentStatus == 'pending') &&
      (_order!.status == 'pending' || _order!.status == 'confirmed');

  bool get _canRequestCancel =>
      _order != null &&
      (_order!.status == 'pending' ||
          _order!.status == 'confirmed' ||
          _order!.status == 'processing');

  bool get _canRequestReturn =>
      _order != null && _order!.status == 'delivered';

  Future<void> _payNow() async {
    if (_order == null) return;
    setState(() => _paying = true);
    try {
      final payment = await ApiService.instance.initializePayment(_order!.id);
      final authUrl = payment['authorization_url'];
      if (authUrl is! String || !isSafePaystackCheckoutUrl(authUrl)) {
        throw Exception('Received an invalid payment link.');
      }
      if (!mounted) return;
      context.push('/payment', extra: {'url': authUrl, 'order_id': _order!.id});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString()
                .replaceFirst(RegExp(r'ApiException\(\d+\): '), '')
                .replaceFirst('Exception: ', ''),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _promptAction({required bool isReturn}) async {
    final reasonCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isReturn ? 'Request Return' : 'Request Cancellation'),
        content: TextField(
          controller: reasonCtrl,
          maxLines: 3,
          decoration: InputDecoration(
            labelText: 'Reason *',
            hintText: isReturn
                ? 'Tell us why you would like to return this order...'
                : 'Tell us why you would like to cancel this order...',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Close'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Submit Request'),
          ),
        ],
      ),
    );
    if (confirmed != true || reasonCtrl.text.trim().isEmpty || _order == null) {
      return;
    }
    try {
      if (isReturn) {
        await ApiService.instance
            .requestOrderReturn(_order!.id, reasonCtrl.text);
      } else {
        await ApiService.instance
            .requestOrderCancel(_order!.id, reasonCtrl.text);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isReturn
                ? 'Return request submitted.'
                : 'Cancellation request submitted.',
          ),
        ),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), ''),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('MMM d, yyyy · HH:mm');
    final stepIdx =
        _order != null ? _timelineSteps.indexOf(_order!.status) : -1;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/orders'),
        ),
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
                  color: AppColors.accent,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Visual 5-Step Progress Timeline (matches web OrderDetail)
                      if (stepIdx >= 0) ...[
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'ORDER PROGRESS',
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 1.5,
                                    color: AppColors.accentDark,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  children: List.generate(
                                    _timelineSteps.length,
                                    (i) {
                                      final done = i <= stepIdx;
                                      final label = _timelineSteps[i];
                                      return Expanded(
                                        child: Column(
                                          children: [
                                            CircleAvatar(
                                              radius: 13,
                                              backgroundColor: done
                                                  ? AppColors.primary
                                                  : AppColors.border,
                                              child: Icon(
                                                done
                                                    ? Icons.check
                                                    : Icons.circle_outlined,
                                                size: 14,
                                                color: done
                                                    ? AppColors.accent
                                                    : AppColors.muted,
                                              ),
                                            ),
                                            const SizedBox(height: 6),
                                            Text(
                                              label[0].toUpperCase() +
                                                  label.substring(1),
                                              style: TextStyle(
                                                fontSize: 10,
                                                fontWeight: done
                                                    ? FontWeight.w700
                                                    : FontWeight.w400,
                                                color: done
                                                    ? AppColors.primary
                                                    : AppColors.muted,
                                              ),
                                            ),
                                          ],
                                        ),
                                      );
                                    },
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Status & Pay Now card
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Placed ${fmt.format(_order!.createdAt.toLocal())}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  const Text('Order Status: ',
                                      style: TextStyle(
                                          fontWeight: FontWeight.w600)),
                                  StatusChip(_order!.status),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  const Text('Payment: ',
                                      style: TextStyle(
                                          fontWeight: FontWeight.w600)),
                                  StatusChip(_order!.paymentStatus),
                                ],
                              ),
                              if (_order!.deliveryStatus != null) ...[
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    const Text('Delivery: ',
                                        style: TextStyle(
                                            fontWeight: FontWeight.w600)),
                                    StatusChip(_order!.deliveryStatus!),
                                  ],
                                ),
                              ],
                              if (_canPayNow) ...[
                                const SizedBox(height: 16),
                                SizedBox(
                                  width: double.infinity,
                                  child: FilledButton.icon(
                                    onPressed: _paying ? null : _payNow,
                                    style: FilledButton.styleFrom(
                                      backgroundColor: AppColors.accent,
                                      foregroundColor: AppColors.primary,
                                    ),
                                    icon: const Icon(Icons.lock_outline,
                                        size: 18),
                                    label: Text(
                                      _paying
                                          ? 'Opening Paystack...'
                                          : 'Pay ${AppConfig.currencySymbol}${_order!.totalAmount.toStringAsFixed(2)} with Paystack',
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Delivery address
                      if (_order!.deliveryAddress != null) ...[
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.location_on_outlined,
                                color: AppColors.accentDark),
                            title: const Text('Delivery Address'),
                            subtitle: Text(_order!.deliveryAddress!),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Items card
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Order Items',
                                  style:
                                      Theme.of(context).textTheme.titleLarge),
                              const SizedBox(height: 12),
                              ..._order!.items.map(
                                (item) => Padding(
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 6),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: GestureDetector(
                                          onTap: item.productId.isNotEmpty
                                              ? () => context.push(
                                                  '/product/${item.productId}')
                                              : null,
                                          child: Text(
                                            '${item.name} × ${item.quantity}',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w500),
                                          ),
                                        ),
                                      ),
                                      Text(
                                        '${AppConfig.currencySymbol}${(item.priceAtPurchase * item.quantity).toStringAsFixed(2)}',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w600),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const Padding(
                                padding: EdgeInsets.symmetric(vertical: 10),
                                child: Divider(),
                              ),
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text('Total',
                                      style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w700)),
                                  Text(
                                    '${AppConfig.currencySymbol}${_order!.totalAmount.toStringAsFixed(2)}',
                                    style: const TextStyle(
                                      fontSize: 17,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),

                      // Cancel / Return Actions (matches web OrderDetail actions)
                      if (_canRequestCancel || _canRequestReturn) ...[
                        const SizedBox(height: 16),
                        if (_canRequestCancel)
                          OutlinedButton.icon(
                            onPressed: () => _promptAction(isReturn: false),
                            icon: const Icon(Icons.cancel_outlined, size: 18),
                            label: const Text('Request Order Cancellation'),
                          ),
                        if (_canRequestReturn)
                          OutlinedButton.icon(
                            onPressed: () => _promptAction(isReturn: true),
                            icon: const Icon(Icons.assignment_return_outlined,
                                size: 18),
                            label: const Text('Request Return / Refund'),
                          ),
                      ],
                    ],
                  ),
                ),
    );
  }
}
