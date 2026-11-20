import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../config.dart';
import '../models/order.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';
import '../widgets/status_chip.dart';

class TrackOrderScreen extends StatefulWidget {
  const TrackOrderScreen({super.key});

  @override
  State<TrackOrderScreen> createState() => _TrackOrderScreenState();
}

class _TrackOrderScreenState extends State<TrackOrderScreen> {
  final _formKey = GlobalKey<FormState>();
  final _orderNumCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();

  bool _loading = false;
  bool _paying = false;
  String? _error;
  Order? _order;

  @override
  void dispose() {
    _orderNumCtrl.dispose();
    _emailCtrl.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
      _order = null;
    });
    try {
      final data = await ApiService.instance.trackOrder(
        _orderNumCtrl.text.trim(),
        _emailCtrl.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _order = Order.fromJson(data);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
        _loading = false;
      });
    }
  }

  Future<void> _payNow(Order order) async {
    setState(() => _paying = true);
    try {
      final payment = await ApiService.instance.initializeGuestPayment(
        order.id,
        _emailCtrl.text.trim(),
      );
      final authUrl = payment['authorization_url'];
      if (authUrl is! String || !isSafePaystackCheckoutUrl(authUrl)) {
        throw Exception('Received an invalid payment link.');
      }
      if (!mounted) return;
      context.push('/payment', extra: {'url': authUrl, 'order_id': order.id});
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

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('MMM d, yyyy · HH:mm');
    return Scaffold(
      appBar: AppBar(title: const Text('Track Your Order')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'ORDER LOOKUP',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.8,
                color: AppColors.accentDark,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Track any guest or account order',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 6),
            const Text(
              'Enter your order number (from your confirmation email) and the email address used at checkout.',
              style: TextStyle(color: AppColors.muted, fontSize: 13.5),
            ),
            const SizedBox(height: 20),

            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextFormField(
                        controller: _orderNumCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Order Number *',
                          hintText: 'e.g. BC-1A2B3C',
                          prefixIcon: Icon(Icons.tag),
                        ),
                        textCapitalization: TextCapitalization.characters,
                        validator: (v) => v == null || v.trim().isEmpty
                            ? 'Enter your order number'
                            : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _emailCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Checkout Email *',
                          hintText: 'you@example.com',
                          prefixIcon: Icon(Icons.email_outlined),
                        ),
                        keyboardType: TextInputType.emailAddress,
                        validator: (v) => v == null || !v.contains('@')
                            ? 'Enter a valid email'
                            : null,
                      ),
                      const SizedBox(height: 18),
                      FilledButton.icon(
                        onPressed: _loading ? null : _lookup,
                        icon: _loading
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.search, size: 18),
                        label: Text(_loading ? 'Searching...' : 'Track Order'),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.error, fontSize: 13.5),
                ),
              ),
            ],

            if (_order != null) ...[
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '#${_order!.orderNumber}',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          StatusChip(_order!.status),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Placed ${fmt.format(_order!.createdAt.toLocal())}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          const Text(
                            'Payment Status: ',
                            style: TextStyle(fontSize: 13, color: AppColors.muted),
                          ),
                          StatusChip(_order!.paymentStatus),
                        ],
                      ),
                      if (_order!.deliveryAddress != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          'Delivery: ${_order!.deliveryAddress!}',
                          style: const TextStyle(fontSize: 13.5),
                        ),
                      ],
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 14),
                        child: Divider(),
                      ),
                      ..._order!.items.map(
                        (item) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text('${item.name} × ${item.quantity}'),
                              ),
                              Text(
                                '${AppConfig.currencySymbol}${(item.priceAtPurchase * item.quantity).toStringAsFixed(2)}',
                                style: const TextStyle(fontWeight: FontWeight.w600),
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
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Total',
                            style: TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '${AppConfig.currencySymbol}${_order!.totalAmount.toStringAsFixed(2)}',
                            style: const TextStyle(
                                fontSize: 16, fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                      if ((_order!.paymentStatus == 'unpaid' ||
                              _order!.paymentStatus == 'pending') &&
                          (_order!.status == 'pending' ||
                              _order!.status == 'confirmed') &&
                          _order!.id.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: _paying ? null : () => _payNow(_order!),
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.accent,
                              foregroundColor: AppColors.primary,
                            ),
                            icon: const Icon(Icons.lock_outline, size: 18),
                            label: Text(
                              _paying
                                  ? 'Opening Paystack...'
                                  : 'Complete Payment (${AppConfig.currencySymbol}${_order!.totalAmount.toStringAsFixed(2)})',
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
