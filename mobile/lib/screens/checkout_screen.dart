import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';

const List<String> _ghanaRegions = [
  'Greater Accra', 'Ashanti', 'Western', 'Western North',
  'Central', 'Eastern', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East',
  'Upper West', 'Bono', 'Bono East', 'Ahafo',
];

double? _parseNum(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

bool _parseBool(dynamic v, bool fallback) {
  if (v is bool) return v;
  if (v is String) {
    final lower = v.trim().toLowerCase();
    if (lower == 'true') return true;
    if (lower == 'false') return false;
  }
  return fallback;
}

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstNameCtrl = TextEditingController();
  final _lastNameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _couponCtrl = TextEditingController();

  String _selectedRegion = 'Greater Accra';
  String _fulfillmentMethod = 'delivery'; // 'delivery' | 'pickup'
  String _paymentMethod = 'paystack'; // 'paystack' | 'pay_on_delivery'

  bool _pickupEnabled = true;
  String _pickupLocation = 'East Legon, Accra (Call upon arrival)';
  bool _podEnabled = false;
  bool _podAccraOnly = true;

  bool _placing = false;
  String? _couponError;
  Map<String, dynamic>? _appliedCoupon;
  double _discount = 0;

  @override
  void initState() {
    super.initState();
    _loadStoreSettings();
  }

  Future<void> _loadStoreSettings() async {
    try {
      final settings = await ApiService.instance.getSettings();
      if (!mounted) return;
      context.read<CartProvider>().updateDeliverySettings(
            feeFlat: _parseNum(settings['delivery_fee_flat']),
            feeAccra: _parseNum(settings['delivery_fee_accra']),
            freeOver: _parseNum(settings['free_delivery_over']),
          );
      setState(() {
        _pickupEnabled = _parseBool(settings['pickup_enabled'], true);
        if (settings['pickup_location'] is String &&
            (settings['pickup_location'] as String).trim().isNotEmpty) {
          _pickupLocation = (settings['pickup_location'] as String).trim();
        }
        _podEnabled = _parseBool(settings['pay_on_delivery_enabled'], false);
        _podAccraOnly = _parseBool(settings['pay_on_delivery_accra_only'], true);
        if (!_pickupEnabled && _fulfillmentMethod == 'pickup') {
          _fulfillmentMethod = 'delivery';
        }
        if (!_isPodEligible && _paymentMethod == 'pay_on_delivery') {
          _paymentMethod = 'paystack';
        }
      });
    } catch (_) {
      // Keep safe defaults if settings request fails
    }
  }

  bool get _isPodEligible =>
      _podEnabled &&
      (!_podAccraOnly ||
          _fulfillmentMethod == 'pickup' ||
          _selectedRegion == 'Greater Accra');

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _emailCtrl.dispose();
    _addressCtrl.dispose();
    _cityCtrl.dispose();
    _phoneCtrl.dispose();
    _couponCtrl.dispose();
    super.dispose();
  }

  double _deliveryFee(CartProvider cart) => cart.computeDeliveryFee(
        region: _selectedRegion,
        isPickup: _fulfillmentMethod == 'pickup',
      );

  double _total(CartProvider cart) {
    final raw = cart.subtotal + _deliveryFee(cart) - _discount;
    return raw < 0 ? 0 : raw;
  }

  Future<void> _validateCoupon() async {
    final code = _couponCtrl.text.trim();
    if (code.isEmpty) return;

    final cart = context.read<CartProvider>();
    setState(() => _couponError = null);
    try {
      final data = await ApiService.instance.validateCoupon(
        code,
        cart.subtotal + _deliveryFee(cart),
      );
      setState(() {
        _appliedCoupon = data;
        _discount = double.parse(
          (data['discountAmount'] ?? data['discount_amount'] ?? 0).toString(),
        );
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Coupon applied: ${AppConfig.currencySymbol}${_discount.toStringAsFixed(2)} off',
            ),
          ),
        );
      }
    } catch (e) {
      setState(
        () => _couponError =
            e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), ''),
      );
    }
  }

  Future<void> _placeOrder() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _placing = true);

    final auth = context.read<AuthProvider>();
    final isGuest = !auth.isLoggedIn;
    final cart = context.read<CartProvider>();
    final isPickup = _fulfillmentMethod == 'pickup';
    final shippingAddress =
        isPickup ? 'Pickup: $_pickupLocation' : _addressCtrl.text.trim();
    final shippingCity = isPickup ? 'Accra' : _cityCtrl.text.trim();
    final shippingRegion = isPickup ? 'Greater Accra' : _selectedRegion;
    final couponCode = _appliedCoupon != null ? _couponCtrl.text.trim() : null;

    try {
      Map<String, dynamic> order;
      if (isGuest) {
        final guestPayload = cart.toGuestOrderPayload(
          email: _emailCtrl.text.trim(),
          firstName: _firstNameCtrl.text.trim(),
          lastName: _lastNameCtrl.text.trim(),
          phone: _phoneCtrl.text.trim(),
          shippingAddress: shippingAddress,
          shippingCity: shippingCity,
          shippingRegion: shippingRegion,
          deliveryFee: _deliveryFee(cart),
          fulfillmentMethod: _fulfillmentMethod,
          paymentMethod: _paymentMethod,
          couponCode: couponCode,
        );
        order = await ApiService.instance.createGuestOrder(guestPayload);
      } else {
        await cart.syncToServer();
        final payload = cart.toOrderPayload(
          shippingAddress: shippingAddress,
          shippingCity: shippingCity,
          shippingRegion: shippingRegion,
          fulfillmentMethod: _fulfillmentMethod,
          paymentMethod: _paymentMethod,
          phone:
              _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
          couponCode: couponCode,
        );
        order = await ApiService.instance.createOrder(payload);
      }

      final orderId = (order['orderId'] ?? order['id']).toString();
      final orderNum = (order['orderNumber'] ?? orderId).toString();

      if (_paymentMethod == 'pay_on_delivery') {
        if (!mounted) return;
        cart.clear();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Order $orderNum confirmed! Pay on ${isPickup ? 'pickup' : 'delivery'}.',
            ),
          ),
        );
        context.go(isGuest ? '/track-order' : '/orders');
        return;
      }

      // Initialize payment (guest or authenticated) and navigate to payment WebView
      final payment = isGuest
          ? await ApiService.instance.initializeGuestPayment(
              orderId,
              (order['email'] ?? _emailCtrl.text.trim()).toString(),
            )
          : await ApiService.instance.initializePayment(orderId);
      final authUrl = payment['authorization_url'];

      if (authUrl is! String || !isSafePaystackCheckoutUrl(authUrl)) {
        // Never navigate to an unexpected payment URL. The order is saved and
        // can be paid later from the Orders / Track Order page.
        throw Exception(
          'Received an invalid payment link. Your order was saved — please pay from your Orders page.',
        );
      }

      if (!mounted) return;
      cart.clear();
      context.go('/payment', extra: {'url': authUrl, 'order_id': orderId});
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
      setState(() => _placing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isGuest = !auth.isLoggedIn;
    final cart = context.watch<CartProvider>();
    final deliveryFee = _deliveryFee(cart);
    final total = _total(cart);
    final isPickup = _fulfillmentMethod == 'pickup';

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/cart'),
        ),
        title: const Text('Checkout'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (isGuest) ...[
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.blush,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Expanded(
                      child: Text(
                        'Checking out as a guest',
                        style: TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                    TextButton(
                      onPressed: () => context.push('/login'),
                      child: const Text('Log in instead'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text('Contact Information',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _firstNameCtrl,
                      decoration:
                          const InputDecoration(labelText: 'First Name *'),
                      validator: (v) =>
                          v == null || v.trim().isEmpty ? 'Required' : null,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextFormField(
                      controller: _lastNameCtrl,
                      decoration:
                          const InputDecoration(labelText: 'Last Name *'),
                      validator: (v) =>
                          v == null || v.trim().isEmpty ? 'Required' : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _emailCtrl,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Email Address (for receipt & tracking) *',
                  prefixIcon: Icon(Icons.email_outlined),
                ),
                validator: (v) => v == null || !v.contains('@')
                    ? 'Enter a valid email'
                    : null,
              ),
              const SizedBox(height: 20),
            ],

            Text('Delivery Method', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),

            if (_pickupEnabled) ...[
              RadioListTile<String>(
                value: 'delivery',
                groupValue: _fulfillmentMethod,
                title: const Text('Doorstep Delivery'),
                subtitle: Text(
                  'Accra: ${AppConfig.currencySymbol}${cart.deliveryFeeAccra.toStringAsFixed(0)} · Nationwide: ${AppConfig.currencySymbol}${cart.deliveryFeeFlat.toStringAsFixed(0)}',
                ),
                onChanged: (v) {
                  setState(() {
                    _fulfillmentMethod = v!;
                    if (!_isPodEligible && _paymentMethod == 'pay_on_delivery') {
                      _paymentMethod = 'paystack';
                    }
                  });
                },
              ),
              RadioListTile<String>(
                value: 'pickup',
                groupValue: _fulfillmentMethod,
                title: const Text('Pickup Station (Free)'),
                subtitle: Text(_pickupLocation),
                onChanged: (v) => setState(() => _fulfillmentMethod = v!),
              ),
              const SizedBox(height: 12),
            ],

            if (!isPickup) ...[
              TextFormField(
                controller: _addressCtrl,
                decoration: const InputDecoration(
                  labelText: 'Street Address *',
                  prefixIcon: Icon(Icons.location_on_outlined),
                  border: OutlineInputBorder(),
                ),
                minLines: 2,
                maxLines: 3,
                validator: (v) => v == null || v.trim().length < 3
                    ? 'Please enter your delivery address'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _cityCtrl,
                decoration: const InputDecoration(
                  labelText: 'City *',
                  prefixIcon: Icon(Icons.location_city_outlined),
                  border: OutlineInputBorder(),
                ),
                validator: (v) => v == null || v.trim().isEmpty
                    ? 'Please enter your city'
                    : null,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _selectedRegion,
                decoration: const InputDecoration(
                  labelText: 'Region *',
                  prefixIcon: Icon(Icons.map_outlined),
                  border: OutlineInputBorder(),
                ),
                items: _ghanaRegions
                    .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                    .toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() {
                    _selectedRegion = v;
                    if (!_isPodEligible && _paymentMethod == 'pay_on_delivery') {
                      _paymentMethod = 'paystack';
                    }
                  });
                },
              ),
              const SizedBox(height: 12),
            ],

            TextFormField(
              controller: _phoneCtrl,
              decoration: const InputDecoration(
                labelText: 'Phone Number *',
                prefixIcon: Icon(Icons.phone_outlined),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
              validator: (v) => v == null || v.trim().length < 5
                  ? 'Please enter your phone number'
                  : null,
            ),
            const SizedBox(height: 24),

            if (_podEnabled) ...[
              Text('Payment Method', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              RadioListTile<String>(
                value: 'paystack',
                groupValue: _paymentMethod,
                title: const Text('Pay Online (Paystack)'),
                subtitle: const Text('MTN MoMo, Telecel Cash, Card & Bank'),
                onChanged: (v) => setState(() => _paymentMethod = v!),
              ),
              RadioListTile<String>(
                value: 'pay_on_delivery',
                groupValue: _paymentMethod,
                title: Text(isPickup ? 'Pay on Pickup' : 'Pay on Delivery'),
                subtitle: Text(
                  _isPodEligible
                      ? 'Cash or Mobile Money on arrival'
                      : 'Available for Greater Accra or Store Pickup only',
                ),
                onChanged: _isPodEligible
                    ? (v) => setState(() => _paymentMethod = v!)
                    : null,
              ),
              const SizedBox(height: 16),
            ],

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
            _Row(isPickup ? 'Pickup Station' : 'Delivery Fee', deliveryFee),
            if (_discount > 0) _Row('Discount', -_discount, color: Colors.green),
            const Divider(),
            _Row('Total', total, bold: true),
            const SizedBox(height: 24),

            FilledButton(
              onPressed: _placing ? null : _placeOrder,
              child: _placing
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(
                      _paymentMethod == 'pay_on_delivery'
                          ? 'Place Order — ${AppConfig.currencySymbol}${total.toStringAsFixed(2)}'
                          : 'Pay ${AppConfig.currencySymbol}${total.toStringAsFixed(2)} with Paystack',
                    ),
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
            amount == 0 && !bold
                ? 'Free'
                : '${AppConfig.currencySymbol}${amount.abs().toStringAsFixed(2)}',
            style: style,
          ),
        ],
      ),
    );
  }
}
