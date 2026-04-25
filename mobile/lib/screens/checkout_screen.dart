import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  final _addressCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _couponCtrl = TextEditingController();

  bool _placing = false;
  String? _couponError;
  Map<String, dynamic>? _appliedCoupon;
  double _discount = 0;

  @override
  void dispose() {
    _addressCtrl.dispose();
    _phoneCtrl.dispose();
    _couponCtrl.dispose();
    super.dispose();
  }

  double get _total {
    final cart = context.read<CartProvider>();
    return cart.total - _discount;
  }

  Future<void> _validateCoupon() async {
    final code = _couponCtrl.text.trim();
    if (code.isEmpty) return;

    final cart = context.read<CartProvider>();
    setState(() => _couponError = null);
    try {
      final data = await ApiService.instance.validateCoupon(code, cart.subtotal);
      setState(() {
        _appliedCoupon = data;
        _discount = double.parse(data['discount_amount'].toString());
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Coupon applied: ${AppConfig.currencySymbol}${_discount.toStringAsFixed(2)} off')),
        );
      }
    } catch (e) {
      setState(() => _couponError = e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), ''));
    }
  }

  Future<void> _placeOrder() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _placing = true);

    final cart = context.read<CartProvider>();
    try {
      final payload = cart.toOrderPayload(
        deliveryAddress: _addressCtrl.text.trim(),
        phone: _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
        couponCode: _appliedCoupon != null ? _couponCtrl.text.trim() : null,
      );
      final order = await ApiService.instance.createOrder(payload);
      final orderId = order['id'] as int;

      // Initialize payment and navigate to payment WebView
      final payment = await ApiService.instance.initializePayment(orderId);
      final authUrl = payment['authorization_url'] as String;

      if (!mounted) return;
      cart.clear();
      context.go('/payment', extra: {'url': authUrl, 'order_id': orderId});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), ''))),
      );
      setState(() => _placing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Delivery Details', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),

            TextFormField(
              controller: _addressCtrl,
              decoration: const InputDecoration(
                labelText: 'Delivery Address *',
                prefixIcon: Icon(Icons.location_on_outlined),
                border: OutlineInputBorder(),
              ),
              minLines: 2,
              maxLines: 3,
              validator: (v) =>
                  v == null || v.trim().isEmpty ? 'Please enter your delivery address' : null,
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _phoneCtrl,
              decoration: const InputDecoration(
                labelText: 'Phone Number (optional)',
                prefixIcon: Icon(Icons.phone_outlined),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 24),

            Text('Coupon Code', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _couponCtrl,
                    decoration: InputDecoration(
                      hintText: 'Enter coupon code',
                      errorText: _couponError,
                      border: const OutlineInputBorder(),
                    ),
                    enabled: _appliedCoupon == null,
                  ),
                ),
                const SizedBox(width: 8),
                _appliedCoupon != null
                    ? IconButton(
                        icon: const Icon(Icons.close, color: Colors.red),
                        onPressed: () {
                          setState(() {
                            _appliedCoupon = null;
                            _discount = 0;
                            _couponCtrl.clear();
                          });
                        },
                      )
                    : ElevatedButton(
                        onPressed: _validateCoupon,
                        child: const Text('Apply'),
                      ),
              ],
            ),
            const SizedBox(height: 24),

            // Order summary
            Text('Order Summary', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            ...cart.items.map((item) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(child: Text('${item.name} × ${item.quantity}')),
                      Text('${AppConfig.currencySymbol}${item.subtotal.toStringAsFixed(2)}'),
                    ],
                  ),
                )),
            const Divider(),
            _Row('Subtotal', cart.subtotal),
            _Row('Delivery Fee', cart.deliveryFee),
            if (_discount > 0) _Row('Discount', -_discount, color: Colors.green),
            const Divider(),
            _Row('Total', _total, bold: true),
            const SizedBox(height: 24),

            FilledButton(
              onPressed: _placing ? null : _placeOrder,
              child: _placing
                  ? const SizedBox(
                      height: 20, width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text('Pay ${AppConfig.currencySymbol}${_total.toStringAsFixed(2)} with Paystack'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final double amount;
  final bool bold;
  final Color? color;

  const _Row(this.label, this.amount, {this.bold = false, this.color});

  @override
  Widget build(BuildContext context) {
    final style = (bold
            ? Theme.of(context).textTheme.titleMedium
            : Theme.of(context).textTheme.bodyMedium)
        ?.copyWith(color: color);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text(
            '${AppConfig.currencySymbol}${amount.abs().toStringAsFixed(2)}',
            style: style,
          ),
        ],
      ),
    );
  }
}
