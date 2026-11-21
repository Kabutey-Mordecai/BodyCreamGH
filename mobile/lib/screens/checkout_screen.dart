import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
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
  final _momoPhoneCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  final _couponCtrl = TextEditingController();

  String _selectedRegion = 'Greater Accra';
  String _fulfillmentMethod = 'delivery'; // 'delivery' | 'pickup'
  String _paymentMethod = 'paystack'; // 'paystack' | 'pay_on_delivery'
  final String _momoProvider = 'mtn'; // reserved for future direct MoMo UX

  bool _loadingSettings = true;
  bool _allowGuestCheckout = false;
  bool _pickupEnabled = true;
  String _pickupLocation = 'East Legon, Accra (Call upon arrival)';
  String _pickupHours = 'Mon–Sat, 9:00 AM – 6:00 PM';
  bool _podEnabled = false;
  bool _podAccraOnly = true;

  bool _placing = false;
  String? _couponError;
  Map<String, dynamic>? _appliedCoupon;
  bool _isAutoWelcome = false;
  double _discount = 0;
  int _welcomeCheckSeq = 0;
  Timer? _emailDebounce;
  static final _emailRegex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  // Guest cart pre-flight validation state (matches web Checkout.jsx)
  Map<String, dynamic>? _guestValidation;
  bool _validatingGuestCart = false;
  String? _validationFetchError;

  // Pay-on-Delivery confirmation state (matches web Checkout.jsx podConfirmation)
  Map<String, dynamic>? _podConfirmation;

  @override
  void initState() {
    super.initState();
    final user = context.read<AuthProvider>().user;
    if (user?.phone != null && user!.phone!.trim().isNotEmpty) {
      _phoneCtrl.text = user.phone!.trim();
      _momoPhoneCtrl.text = user.phone!.trim();
    }
    if (user?.address != null && user!.address!.trim().isNotEmpty) {
      _addressCtrl.text = user.address!.trim();
    }
    _loadStoreSettings();
    _autoApplyWelcomeCoupon();
  }

  void _onGuestEmailChanged(String value) {
    _emailDebounce?.cancel();
    final trimmed = value.trim();
    if (!_emailRegex.hasMatch(trimmed)) return;
    _emailDebounce = Timer(const Duration(milliseconds: 450), () {
      _checkWelcomeCouponForEmail(explicitEmail: trimmed);
    });
  }

  Future<void> _autoApplyWelcomeCoupon() async {
    await _checkWelcomeCouponForEmail();
  }

  Future<void> _checkWelcomeCouponForEmail({String? explicitEmail}) async {
    final auth = context.read<AuthProvider>();
    final cart = context.read<CartProvider>();
    if (cart.items.isEmpty) return;

    final seq = ++_welcomeCheckSeq;

    try {
      final prefs = await SharedPreferences.getInstance();
      final savedEmail = prefs.getString('bc_newsletter_email');
      final emailToCheck = explicitEmail ??
          (auth.isLoggedIn
              ? (auth.user?.email ?? savedEmail)
              : (_emailCtrl.text.trim().isNotEmpty
                  ? _emailCtrl.text.trim()
                  : savedEmail));
      if (emailToCheck == null ||
          emailToCheck.isEmpty ||
          !_emailRegex.hasMatch(emailToCheck)) {
        return;
      }

      final status =
          await ApiService.instance.getNewsletterStatus(email: emailToCheck);
      if (!mounted || seq != _welcomeCheckSeq) return;

      final welcomeCode = (status['couponCode'] ?? '').toString().toUpperCase();
      final activeCode =
          (_appliedCoupon?['code'] ?? _couponCtrl.text.trim()).toString().toUpperCase();

      if (status['hasPlacedOrder'] == true) {
        await prefs.setBool('bc_first_order_done', true);
        await prefs.remove('bc_welcome_coupon');
        final isActiveWelcome = _appliedCoupon != null &&
            (_isAutoWelcome ||
                (welcomeCode.isNotEmpty && activeCode == welcomeCode));
        if (isActiveWelcome && mounted) {
          setState(() {
            _appliedCoupon = null;
            _isAutoWelcome = false;
            _discount = 0;
            _couponCtrl.clear();
            _couponError = 'Welcome discount is valid on your first order only.';
          });
        }
        return;
      }
      if (status['eligibleForWelcomeDiscount'] == true &&
          status['couponCode'] != null &&
          _appliedCoupon == null) {
        final code = status['couponCode'].toString();
        final isGuest = !auth.isLoggedIn;
        final total = _validatedSubtotal(cart, isGuest) + _deliveryFee(cart);
        final data = await ApiService.instance.validateCoupon(
          code,
          total,
          email: emailToCheck,
        );
        if (!mounted || seq != _welcomeCheckSeq) return;
        setState(() {
          _couponCtrl.text = code;
          _appliedCoupon = data;
          _isAutoWelcome = true;
          _couponError = null;
          _discount = double.tryParse(
                  (data['discountAmount'] ?? data['discount_amount'] ?? 0)
                      .toString()) ??
              0;
        });
      }
    } catch (_) {}
  }

  Future<void> _runGuestCartValidation() async {
    final auth = context.read<AuthProvider>();
    final cart = context.read<CartProvider>();
    if (auth.isLoggedIn || cart.items.isEmpty) return;

    setState(() {
      _validatingGuestCart = true;
      _validationFetchError = null;
    });
    try {
      final itemsPayload = cart.items
          .map((i) => {
                'product_id': i.productId,
                'quantity': i.quantity,
                'variant_id': i.variantId,
              })
          .toList();
      final data = await ApiService.instance.validateGuestCart(itemsPayload);
      if (!mounted) return;
      setState(() {
        _guestValidation = data;
        _validatingGuestCart = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _validatingGuestCart = false;
        _validationFetchError =
            'Could not verify item availability. You can still try placing your order.';
      });
    }
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
      final allowGuest = _parseBool(settings['guest_checkout_enabled'], false);
      setState(() {
        _loadingSettings = false;
        _allowGuestCheckout = allowGuest;
        _pickupEnabled = _parseBool(settings['pickup_enabled'], true);
        if (settings['pickup_location'] is String &&
            (settings['pickup_location'] as String).trim().isNotEmpty) {
          _pickupLocation = (settings['pickup_location'] as String).trim();
        }
        if (settings['pickup_hours'] is String &&
            (settings['pickup_hours'] as String).trim().isNotEmpty) {
          _pickupHours = (settings['pickup_hours'] as String).trim();
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

      final isLoggedIn = context.read<AuthProvider>().isLoggedIn;
      if (!isLoggedIn && !allowGuest) {
        if (mounted) context.go('/login?from=checkout');
        return;
      }
      if (!isLoggedIn && allowGuest) {
        _runGuestCartValidation();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingSettings = false);
      if (!context.read<AuthProvider>().isLoggedIn && !_allowGuestCheckout) {
        context.go('/login?from=checkout');
      }
    }
  }

  bool get _isPodEligible =>
      _podEnabled &&
      (!_podAccraOnly ||
          _fulfillmentMethod == 'pickup' ||
          _selectedRegion == 'Greater Accra');

  @override
  void dispose() {
    _emailDebounce?.cancel();
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _emailCtrl.dispose();
    _addressCtrl.dispose();
    _cityCtrl.dispose();
    _phoneCtrl.dispose();
    _momoPhoneCtrl.dispose();
    _notesCtrl.dispose();
    _couponCtrl.dispose();
    super.dispose();
  }

  double _deliveryFee(CartProvider cart) => cart.computeDeliveryFee(
        region: _selectedRegion,
        isPickup: _fulfillmentMethod == 'pickup',
      );

  double _validatedSubtotal(CartProvider cart, bool isGuest) {
    if (isGuest &&
        _guestValidation != null &&
        _guestValidation!['valid'] == true &&
        _guestValidation!['items'] is List) {
      double sum = 0;
      for (final item in (_guestValidation!['items'] as List)) {
        if (item is Map) {
          sum += double.tryParse((item['subtotal'] ?? 0).toString()) ?? 0;
        }
      }
      if (sum > 0) return sum;
    }
    return cart.subtotal;
  }

  double _effectiveDiscount(CartProvider cart, bool isGuest) {
    if (_appliedCoupon == null) return 0;
    final type = _appliedCoupon!['type']?.toString();
    final val = _parseNum(_appliedCoupon!['value']) ?? 0;
    final baseTotal = _validatedSubtotal(cart, isGuest) + _deliveryFee(cart);
    if (type == 'percentage' && val > 0) {
      final computed = ((baseTotal * val / 100) * 100).roundToDouble() / 100;
      return computed > baseTotal ? baseTotal : computed;
    }
    return _discount > baseTotal ? baseTotal : _discount;
  }

  double _total(CartProvider cart, bool isGuest) {
    final raw = _validatedSubtotal(cart, isGuest) +
        _deliveryFee(cart) -
        _effectiveDiscount(cart, isGuest);
    return raw < 0 ? 0 : raw;
  }

  Future<void> _validateCoupon() async {
    final code = _couponCtrl.text.trim();
    if (code.isEmpty) return;

    final cart = context.read<CartProvider>();
    final auth = context.read<AuthProvider>();
    final isGuest = !auth.isLoggedIn;
    final emailToCheck = isGuest ? _emailCtrl.text.trim() : auth.user?.email;
    setState(() => _couponError = null);
    try {
      final data = await ApiService.instance.validateCoupon(
        code,
        _validatedSubtotal(cart, isGuest) + _deliveryFee(cart),
        email: emailToCheck,
      );
      setState(() {
        _appliedCoupon = data;
        _isAutoWelcome = false;
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
    final auth = context.read<AuthProvider>();
    final isGuest = !auth.isLoggedIn;

    if (isGuest &&
        _guestValidation != null &&
        _guestValidation!['valid'] == false) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Some items in your bag are unavailable. Please update your bag before proceeding.',
          ),
        ),
      );
      return;
    }

    setState(() => _placing = true);

    final cart = context.read<CartProvider>();
    final isPickup = _fulfillmentMethod == 'pickup';
    final shippingAddress =
        isPickup ? 'Pickup: $_pickupLocation' : _addressCtrl.text.trim();
    final shippingCity = isPickup ? 'Accra' : _cityCtrl.text.trim();
    final shippingRegion = isPickup ? 'Greater Accra' : _selectedRegion;
    final couponCode = _appliedCoupon != null ? _couponCtrl.text.trim() : null;
    final notesText =
        _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim();
    final finalTotal = _total(cart, isGuest);

    final backendPaymentMethod =
        _paymentMethod == 'pay_on_delivery' ? 'pay_on_delivery' : 'paystack';
    final momoPhone = _momoPhoneCtrl.text.trim().isNotEmpty
        ? _momoPhoneCtrl.text.trim()
        : _phoneCtrl.text.trim();

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
          paymentMethod: backendPaymentMethod,
          notes: notesText,
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
          paymentMethod: backendPaymentMethod,
          phone:
              _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
          notes: notesText,
          couponCode: couponCode,
        );
        order = await ApiService.instance.createOrder(payload);
      }

      final orderId = (order['orderId'] ?? order['id']).toString();
      final orderNum = (order['orderNumber'] ?? order['order_number'] ?? orderId).toString();
      final orderTotal =
          double.tryParse((order['total'] ?? order['total_amount'] ?? finalTotal).toString()) ??
              finalTotal;

      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool('bc_first_order_done', true);
        await prefs.remove('bc_welcome_coupon');
      } catch (_) {}

      if (_paymentMethod == 'pay_on_delivery') {
        if (!mounted) return;
        cart.clear(syncServer: false);
        setState(() {
          _placing = false;
          _podConfirmation = {
            'orderId': orderId,
            'orderNumber': orderNum,
            'total': orderTotal,
            'fulfillment_method': _fulfillmentMethod,
            'isGuest': isGuest,
            'email': _emailCtrl.text.trim(),
          };
        });
        return;
      }

      final guestEmail = (order['email'] ?? _emailCtrl.text.trim()).toString();

      if (_paymentMethod == 'momo_direct') {
        final charge = await ApiService.instance.chargeMobileMoney(
          orderId: orderId,
          phone: momoPhone,
          provider: _momoProvider,
          email: isGuest ? guestEmail : null,
        );
        final reference = (charge['reference'] ?? '').toString();
        if (reference.isEmpty) {
          throw Exception('Did not receive a payment reference from Paystack.');
        }
        if (!mounted) return;
        context.go('/momo-payment', extra: {
          'order_id': orderId,
          'order_number': orderNum,
          'amount': orderTotal,
          'reference': reference,
          'status': (charge['status'] ?? 'pay_offline').toString(),
          'display_text': (charge['display_text'] ?? charge['message'] ?? '').toString(),
          'phone': momoPhone,
          'provider': _momoProvider,
          if (isGuest) 'guest_email': guestEmail,
        });
        return;
      }

      final payment = isGuest
          ? await ApiService.instance.initializeGuestPayment(
              orderId,
              guestEmail,
            )
          : await ApiService.instance.initializePayment(orderId);
      final authUrl = payment['authorization_url'];

      if (authUrl is! String || !isSafePaystackCheckoutUrl(authUrl)) {
        throw Exception(
          'Received an invalid payment link. Your order was saved — please pay from your Orders page.',
        );
      }

      if (!mounted) return;
      cart.clear(syncServer: false);
      context.go('/payment', extra: {
        'url': authUrl,
        'order_id': orderId,
        'order_number': orderNum,
        if (isGuest) 'guest_email': guestEmail,
      });
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
    // Dedicated Pay-on-Delivery Confirmation View (matches web Checkout.jsx podConfirmation)
    if (_podConfirmation != null) {
      final orderNum = (_podConfirmation!['orderNumber'] ?? '').toString();
      final totalDue = double.tryParse(
              (_podConfirmation!['total'] ?? 0).toString()) ??
          0;
      final isPickup = _podConfirmation!['fulfillment_method'] == 'pickup';
      final isGuest = _podConfirmation!['isGuest'] == true;
      final orderId = (_podConfirmation!['orderId'] ?? '').toString();

      return Scaffold(
        appBar: AppBar(title: const Text('Order Confirmed')),
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: const BoxDecoration(
                        color: AppColors.accent,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check,
                          color: Colors.white, size: 30),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'ORDER CONFIRMED',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.8,
                        color: AppColors.accentDark,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Thank you!',
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Order #$orderNum has been confirmed.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Total due on ${isPickup ? 'pickup' : 'delivery'}: ${AppConfig.currencySymbol}${totalDue.toStringAsFixed(2)} (Cash or Mobile Money).',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    if (isPickup) ...[
                      const SizedBox(height: 16),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.blush,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Pickup Station',
                              style: TextStyle(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 4),
                            Text(_pickupLocation),
                            if (_pickupHours.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                'Hours: $_pickupHours',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () {
                          if (!isGuest && orderId.isNotEmpty) {
                            context.go('/order/$orderId');
                          } else {
                            context.go(
                              '/track-order?order_number=${Uri.encodeComponent(orderNum)}',
                            );
                          }
                        },
                        child: Text(
                            isGuest ? 'Track Your Order' : 'View Order Detail'),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => context.go('/shop'),
                        child: const Text('Continue Shopping'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    final auth = context.watch<AuthProvider>();
    final isGuest = !auth.isLoggedIn;

    // Require sign-in at checkout unless guest_checkout_enabled is explicitly true in Admin Settings (matches web Checkout.jsx)
    if (isGuest && _loadingSettings) {
      return Scaffold(
        appBar: AppBar(title: const Text('Checkout')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (isGuest && !_allowGuestCheckout) {
      return Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () =>
                context.canPop() ? context.pop() : context.go('/cart'),
          ),
          title: const Text('Checkout'),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.lock_outline, size: 48, color: AppColors.accent),
                const SizedBox(height: 16),
                Text('Sign in to Checkout',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                const Text(
                  'Please sign in or create an account to complete your order.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.muted),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => context.go('/login?from=checkout'),
                    child: const Text('Sign In'),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () => context.go('/register?from=checkout'),
                    child: const Text('Create Account'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final cart = context.watch<CartProvider>();
    final deliveryFee = _deliveryFee(cart);
    final subtotal = _validatedSubtotal(cart, isGuest);
    final total = _total(cart, isGuest);
    final isPickup = _fulfillmentMethod == 'pickup';
    final hasInvalidGuestItems =
        isGuest && _guestValidation != null && _guestValidation!['valid'] == false;

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
                        'Checking out as guest. Sign in to track orders in your account.',
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                    ),
                    TextButton(
                      onPressed: () =>
                          context.push('/login?from=checkout'),
                      child: const Text('Sign in'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text('Your Details',
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
                      decoration: const InputDecoration(
                          labelText: 'Last Name (optional)'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _emailCtrl,
                keyboardType: TextInputType.emailAddress,
                onChanged: _onGuestEmailChanged,
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

            Text('Delivery Method',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),

            if (_pickupEnabled) ...[
              RadioGroup<String>(
                groupValue: _fulfillmentMethod,
                onChanged: (v) {
                  if (v == null) return;
                  setState(() {
                    _fulfillmentMethod = v;
                    if (!_isPodEligible &&
                        _paymentMethod == 'pay_on_delivery') {
                      _paymentMethod = 'paystack';
                    }
                  });
                },
                child: Column(
                  children: [
                    RadioListTile<String>(
                      value: 'delivery',
                      title: const Text('Doorstep Delivery'),
                      subtitle: Text(
                        'Accra: ${AppConfig.currencySymbol}${cart.deliveryFeeAccra.toStringAsFixed(0)} · Nationwide: ${AppConfig.currencySymbol}${cart.deliveryFeeFlat.toStringAsFixed(0)}${cart.freeDeliveryOver > 0 ? ' (Free over ${AppConfig.currencySymbol}${cart.freeDeliveryOver.toStringAsFixed(0)})' : ''}',
                      ),
                    ),
                    RadioListTile<String>(
                      value: 'pickup',
                      title: const Text('Pickup Station — Free'),
                      subtitle: Text(_pickupLocation),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],

            if (isPickup)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.blush,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Pickup Location',
                      style:
                          TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                    ),
                    const SizedBox(height: 4),
                    Text(_pickupLocation),
                    if (_pickupHours.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        'Pickup hours: $_pickupHours',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ],
                ),
              )
            else ...[
              TextFormField(
                controller: _addressCtrl,
                decoration: const InputDecoration(
                  labelText: 'Street Address *',
                  hintText: 'e.g. 12 Oxford Street',
                  prefixIcon: Icon(Icons.location_on_outlined),
                  border: OutlineInputBorder(),
                ),
                minLines: 1,
                maxLines: 2,
                validator: (v) => v == null || v.trim().length < 3
                    ? 'Please enter your delivery address'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _cityCtrl,
                decoration: const InputDecoration(
                  labelText: 'City *',
                  hintText: 'e.g. Accra',
                  prefixIcon: Icon(Icons.location_city_outlined),
                  border: OutlineInputBorder(),
                ),
                validator: (v) => v == null || v.trim().isEmpty
                    ? 'Please enter your city'
                    : null,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _selectedRegion,
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
                    if (!_isPodEligible &&
                        _paymentMethod == 'pay_on_delivery') {
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
                hintText: '+233 XX XXX XXXX',
                prefixIcon: Icon(Icons.phone_outlined),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
              validator: (v) => v == null || v.trim().length < 5
                  ? 'Please enter your phone number'
                  : null,
            ),
            const SizedBox(height: 12),

            // Order Notes (matches web Checkout.jsx notes textarea)
            TextFormField(
              controller: _notesCtrl,
              maxLines: 2,
              decoration: InputDecoration(
                labelText: 'Order notes (optional)',
                hintText: isPickup
                    ? 'Preferred pickup time or notes?'
                    : 'Any special instructions for delivery?',
                prefixIcon: const Icon(Icons.edit_note_outlined),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 22),

            Text('Payment Method',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            RadioGroup<String>(
              groupValue: _paymentMethod,
              onChanged: (v) {
                if (v == null) return;
                if (v == 'pay_on_delivery' && !_isPodEligible) return;
                setState(() => _paymentMethod = v);
              },
              child: Column(
                children: [
                  const RadioListTile<String>(
                    value: 'paystack',
                    title: Text('Pay Online (Paystack)'),
                    subtitle: Text(
                        'MTN MoMo, Telecel Cash, Cards & Bank Transfer'),
                  ),
                  if (_podEnabled)
                    RadioListTile<String>(
                      value: 'pay_on_delivery',
                      enabled: _isPodEligible,
                      title:
                          Text(isPickup ? 'Pay on Pickup' : 'Pay on Delivery'),
                      subtitle: Text(
                        _isPodEligible
                            ? 'Pay with Cash or Mobile Money when your order arrives'
                            : 'Available for Greater Accra deliveries or Store Pickup only',
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            Text('Promo Code', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _couponCtrl,
                    decoration: InputDecoration(
                      hintText: 'Enter promo code',
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
                            _isAutoWelcome = false;
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

            // Order summary with item thumbnails & guest validation status
            Text('Your Order', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            if (_validatingGuestCart)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text(
                  'Checking item availability…',
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                ),
              ),
            if (_validationFetchError != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _validationFetchError!,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            if (hasInvalidGuestItems)
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                      color: AppColors.error.withValues(alpha: 0.3)),
                ),
                child: const Text(
                  'Some items are unavailable. Remove them from your bag before proceeding.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.error),
                ),
              ),

            ...cart.items.map((item) {
              Map<String, dynamic>? vItem;
              if (isGuest && _guestValidation?['items'] is List) {
                for (final vi in (_guestValidation!['items'] as List)) {
                  if (vi is Map<String, dynamic> &&
                      vi['product_id'].toString() == item.productId &&
                      (vi['variant_id']?.toString() ?? '') ==
                          (item.variantId ?? '')) {
                    vItem = vi;
                    break;
                  }
                }
              }
              final unavailable = vItem != null && vItem['available'] == false;
              final unitPrice = double.tryParse(
                      (vItem?['price'] ?? item.price).toString()) ??
                  item.price;

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(6),
                          child: SizedBox(
                            width: 44,
                            height: 44,
                            child: item.imageUrl != null
                                ? CachedNetworkImage(
                                    imageUrl: item.imageUrl!,
                                    fit: BoxFit.cover,
                                  )
                                : const ColoredBox(
                                    color: AppColors.blush,
                                    child: Icon(Icons.spa_outlined,
                                        size: 18, color: AppColors.accent),
                                  ),
                          ),
                        ),
                        Positioned(
                          right: -5,
                          top: -5,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 5, vertical: 1),
                            decoration: const BoxDecoration(
                              color: AppColors.primary,
                              shape: BoxShape.circle,
                            ),
                            child: Text(
                              '${item.quantity}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.variantLabel != null &&
                                    item.variantLabel!.isNotEmpty
                                ? '${item.name} (${item.variantLabel})'
                                : item.name,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13.5,
                              decoration: unavailable
                                  ? TextDecoration.lineThrough
                                  : null,
                            ),
                          ),
                          if (unavailable && vItem['error'] != null)
                            Text(
                              vItem['error'].toString(),
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppColors.error,
                              ),
                            ),
                        ],
                      ),
                    ),
                    Text(
                      '${AppConfig.currencySymbol}${(unitPrice * item.quantity).toStringAsFixed(2)}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              );
            }),
            const Divider(),
            _Row('Subtotal', subtotal),
            _Row(isPickup ? 'Pickup Station' : 'Delivery Fee', deliveryFee),
            if (_effectiveDiscount(cart, isGuest) > 0)
              _Row('Discount', -_effectiveDiscount(cart, isGuest),
                  color: AppColors.accentDark),
            const Divider(),
            _Row('Total', total, bold: true),
            const SizedBox(height: 20),

            FilledButton(
              onPressed: (_placing ||
                      _validatingGuestCart ||
                      hasInvalidGuestItems)
                  ? null
                  : _placeOrder,
              child: _placing
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text(
                      _validatingGuestCart
                          ? 'Checking availability…'
                          : _paymentMethod == 'pay_on_delivery'
                              ? 'Place Order — ${AppConfig.currencySymbol}${total.toStringAsFixed(2)} (${isPickup ? 'Pay on Pickup' : 'Pay on Delivery'})'
                              : _paymentMethod == 'momo_direct'
                                  ? 'Pay ${AppConfig.currencySymbol}${total.toStringAsFixed(2)} with Mobile Money'
                                  : 'Pay ${AppConfig.currencySymbol}${total.toStringAsFixed(2)} with Paystack',
                    ),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.lock_outline,
                    size: 14, color: AppColors.muted),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    _paymentMethod == 'pay_on_delivery'
                        ? 'Your order will be confirmed immediately. Pay in cash or Mobile Money upon receipt.'
                        : "Secured by Paystack — cards, Mobile Money, and bank transfers accepted.",
                    textAlign: TextAlign.center,
                    style:
                        const TextStyle(fontSize: 11.5, color: AppColors.muted),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
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
