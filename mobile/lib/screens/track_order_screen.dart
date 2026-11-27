import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../config.dart';
import '../models/order.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';
import '../widgets/status_chip.dart';

const List<Map<String, String>> _trackSteps = [
  {'key': 'pending', 'label': 'Pending'},
  {'key': 'confirmed', 'label': 'Confirmed'},
  {'key': 'processing', 'label': 'Processing'},
  {'key': 'shipped', 'label': 'Shipped'},
  {'key': 'delivered', 'label': 'Delivered'},
];

class TrackOrderScreen extends StatefulWidget {
  final String? initialOrderNumber;
  const TrackOrderScreen({super.key, this.initialOrderNumber});

  static String? validateOrderNumber(String? value) {
    if (value == null || ApiService.normalizeOrderNumber(value).isEmpty) {
      return 'Enter your order number';
    }
    return null;
  }

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
  String? _pickupLocation;
  String? _pickupHours;

  @override
  void initState() {
    super.initState();
    if (widget.initialOrderNumber != null &&
        widget.initialOrderNumber!.trim().isNotEmpty) {
      _orderNumCtrl.text =
          ApiService.normalizeOrderNumber(widget.initialOrderNumber!);
    }
  }

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
      final normalizedNum =
          ApiService.normalizeOrderNumber(_orderNumCtrl.text);
      _orderNumCtrl.text = normalizedNum;
      final data = await ApiService.instance.trackOrder(
        normalizedNum,
        _emailCtrl.text.trim(),
      );
      final order = Order.fromJson(data);
      String? pickupLoc;
      String? pickupHrs;
      if (order.isPickup) {
        final settings = await ApiService.instance
            .getSettings()
            .catchError((_) => <String, dynamic>{});
        final loc = settings['pickup_location']?.toString().trim() ?? '';
        final hrs = settings['pickup_hours']?.toString().trim() ?? '';
        pickupLoc = loc.isEmpty ? null : loc;
        pickupHrs = hrs.isEmpty ? null : hrs;
      }
      if (!mounted) return;
      setState(() {
        _order = order;
        _pickupLocation = pickupLoc;
        _pickupHours = pickupHrs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.formatError(e);
        _loading = false;
      });
    }
  }

  void _reset() {
    setState(() {
      _order = null;
      _error = null;
      _orderNumCtrl.clear();
      _emailCtrl.clear();
    });
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
      context.push('/payment', extra: {
        'url': authUrl,
        'order_id': order.id,
        'order_number': order.orderNumber,
        'guest_email': _emailCtrl.text.trim(),
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiService.formatError(e)),
        ),
      );
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('d MMMM yyyy');
    final stepKeys = _trackSteps.map((s) => s['key']!).toList();
    final currentIdx =
        _order != null ? stepKeys.indexOf(_order!.status) : -1;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        title: const Text('Track Your Order'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_order == null) ...[
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
                'Track your order',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 6),
              const Text(
                'Enter your order number and email address to check your order status.',
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
                            hintText: 'e.g. ORD-23456789',
                            prefixIcon: Icon(Icons.tag),
                          ),
                          textCapitalization: TextCapitalization.characters,
                          validator: TrackOrderScreen.validateOrderNumber,
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _emailCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Email Address *',
                            hintText: 'The email used when ordering',
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
                          label:
                              Text(_loading ? 'Tracking…' : 'Track Order'),
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
                    border: Border.all(
                        color: AppColors.error.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    _error!,
                    style:
                        const TextStyle(color: AppColors.error, fontSize: 13.5),
                  ),
                ),
              ],
            ] else ...[
              // ── Result view (matches web TrackOrder.jsx) ──
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'ORDER',
                                style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.2,
                                  color: AppColors.muted,
                                ),
                              ),
                              Text(
                                '#${_order!.orderNumber}',
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Placed ${fmt.format(_order!.createdAt.toLocal())}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                          StatusChip(_order!.status),
                        ],
                      ),

                      // 5-Step Progress Tracker
                      if (currentIdx >= 0) ...[
                        const SizedBox(height: 18),
                        Row(
                          children: List.generate(
                            _trackSteps.length,
                            (i) {
                              final done = i <= currentIdx;
                              final label = _trackSteps[i]['label']!;
                              return Expanded(
                                child: Column(
                                  children: [
                                    CircleAvatar(
                                      radius: 13,
                                      backgroundColor: done
                                          ? AppColors.accent
                                          : AppColors.border,
                                      child: done
                                          ? const Icon(Icons.check,
                                              size: 14, color: Colors.white)
                                          : null,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      label,
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontWeight: i == currentIdx
                                            ? FontWeight.w800
                                            : FontWeight.w500,
                                        color: done
                                            ? AppColors.accentDark
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

                      // Delivery / Pickup Info Box
                      if (_order!.isPickup) ...[
                        const SizedBox(height: 16),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: AppColors.blush,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Fulfillment: Store Pickup',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13.5,
                                ),
                              ),
                              const SizedBox(height: 4),
                              const Text(
                                'We will notify you when your order is ready for pickup.',
                                style: TextStyle(
                                  fontSize: 12.5,
                                  color: AppColors.muted,
                                ),
                              ),
                              if (_pickupLocation != null) ...[
                                const SizedBox(height: 6),
                                Text(
                                  'Location: $_pickupLocation',
                                  style: const TextStyle(fontSize: 12.5),
                                ),
                              ],
                              if (_pickupHours != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  'Hours: $_pickupHours',
                                  style: const TextStyle(fontSize: 12.5),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ] else if (_order!.delivery != null) ...[
                        if (_order!.delivery!['pod_otp'] != null ||
                            _order!.delivery!['otp'] != null) ...[
                          const SizedBox(height: 16),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 14),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFFBEB),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: const Color(0xFFFDE68A), width: 1.5),
                            ),
                            child: Column(
                              children: [
                                const Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.verified_user_outlined, size: 18, color: Color(0xFFB45309)),
                                    SizedBox(width: 6),
                                    Text(
                                      'Doorstep Delivery Code',
                                      style: TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 13,
                                        color: Color(0xFF92400E),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  '${_order!.delivery!['pod_otp'] ?? _order!.delivery!['otp']}',
                                  style: const TextStyle(
                                    fontSize: 28,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 6,
                                    color: Color(0xFF78350F),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                const Text(
                                  'Share this 6-digit code ONLY with your dispatch rider after you receive and inspect your parcel.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    color: Color(0xFF92400E),
                                    height: 1.3,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: AppColors.blush,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Delivery Info',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13.5,
                                ),
                              ),
                              const SizedBox(height: 6),
                              if (_order!.delivery!['delivery_partner'] != null)
                                _TrackInfoRow(
                                  'Courier',
                                  _order!.delivery!['delivery_partner']
                                      .toString(),
                                ),
                              _TrackInfoRow(
                                'Tracking #',
                                _order!.trackingNumber ?? 'Pending assignment',
                              ),
                              if (_order!.delivery!['estimated_delivery'] !=
                                      null &&
                                  DateTime.tryParse(_order!
                                          .delivery!['estimated_delivery']
                                          .toString()) !=
                                      null)
                                _TrackInfoRow(
                                  'Est. Delivery',
                                  DateFormat('d MMMM').format(
                                    DateTime.parse(_order!
                                            .delivery!['estimated_delivery']
                                            .toString())
                                        .toLocal(),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ] else if (_order!.status == 'processing' ||
                          _order!.status == 'shipped') ...[
                        const SizedBox(height: 16),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: AppColors.blush,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Delivery Info',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13.5,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Courier & tracking details will appear here once assigned.',
                                style: TextStyle(
                                  fontSize: 12.5,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],

                      const SizedBox(height: 16),
                      const Text(
                        'Items',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ..._order!.items.map(
                        (item) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(
                            children: [
                              if (item.imageUrl != null) ...[
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(6),
                                  child: SizedBox(
                                    width: 44,
                                    height: 44,
                                    child: CachedNetworkImage(
                                      imageUrl: item.imageUrl!,
                                      fit: BoxFit.cover,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                              ],
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item.name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 13.5,
                                      ),
                                    ),
                                    if (item.variantLabel != null &&
                                        item.variantLabel!.isNotEmpty)
                                      Text(
                                        item.variantLabel!,
                                        style: const TextStyle(
                                          fontSize: 11.5,
                                          color: AppColors.muted,
                                        ),
                                      ),
                                    Text(
                                      'Qty: ${item.quantity}',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: AppColors.muted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                '${AppConfig.currencySymbol}${item.priceAtPurchase.toStringAsFixed(2)}',
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
                      if (_order!.shippingCity != null ||
                          _order!.shippingRegion != null ||
                          _order!.deliveryAddress != null) ...[
                        const SizedBox(height: 10),
                        Text(
                          'Shipping to: ${[_order!.shippingCity, _order!.shippingRegion].where((e) => e != null && e.isNotEmpty).isNotEmpty ? [_order!.shippingCity, _order!.shippingRegion].where((e) => e != null && e.isNotEmpty).join(', ') : _order!.deliveryAddress}',
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
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
              const SizedBox(height: 12),
              Center(
                child: TextButton(
                  onPressed: _reset,
                  child: const Text('Track another order'),
                ),
              ),
            ],
            const SizedBox(height: 16),
            Center(
              child: Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 4,
                children: [
                  const Text(
                    'Have an account?',
                    style: TextStyle(fontSize: 13, color: AppColors.muted),
                  ),
                  InkWell(
                    onTap: () => context.go('/orders'),
                    child: const Text(
                      'View all your orders →',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.accentDark,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TrackInfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _TrackInfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
          Text(value,
              style: const TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
