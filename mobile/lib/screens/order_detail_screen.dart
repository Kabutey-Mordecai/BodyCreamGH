import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../config.dart';
import '../models/order.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';
import '../widgets/status_chip.dart';

const List<Map<String, String>> _orderStatusSteps = [
  {'key': 'pending', 'label': 'Placed'},
  {'key': 'confirmed', 'label': 'Confirmed'},
  {'key': 'processing', 'label': 'Processing'},
  {'key': 'shipped', 'label': 'Shipped'},
  {'key': 'delivered', 'label': 'Delivered'},
];

const List<Map<String, String>> _deliverySteps = [
  {'key': 'pending', 'label': 'Packed'},
  {'key': 'in_transit', 'label': 'In transit'},
  {'key': 'out_for_delivery', 'label': 'Out for delivery'},
  {'key': 'delivered', 'label': 'Delivered'},
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
  Map<String, dynamic>? _delivery;
  List<Map<String, dynamic>> _statusLog = [];
  bool _partialReturnsEnabled = false;
  List<Map<String, dynamic>> _returnRequests = [];
  Set<String> _reviewedProductIds = {};
  final Map<String, int> _reviewRatings = {};
  final Map<String, TextEditingController> _reviewTitleCtrls = {};
  final Map<String, TextEditingController> _reviewBodyCtrls = {};
  final Map<String, bool> _reviewSaving = {};
  final Map<String, String?> _reviewErrors = {};

  bool _loading = true;
  bool _paying = false;
  String? _loadError;
  String? _pickupLocation;
  String? _pickupHours;
  Timer? _pollTimer;

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

  @override
  void dispose() {
    _pollTimer?.cancel();
    for (final c in _reviewTitleCtrls.values) {
      c.dispose();
    }
    for (final c in _reviewBodyCtrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _loadError = null;
      });
    }
    try {
      final results = await Future.wait([
        ApiService.instance.getOrder(widget.orderId),
        ApiService.instance
            .getOrderDelivery(widget.orderId)
            .catchError((_) => null),
        ApiService.instance
            .getOrderStatusLog(widget.orderId)
            .catchError((_) => <dynamic>[]),
      ]);
      final data = results[0] as Map<String, dynamic>;
      final delivery = results[1] as Map<String, dynamic>?;
      final rawLog = results[2] as List<dynamic>;

      final order = Order.fromJson(data);
      Set<String> reviewed = _reviewedProductIds;
      bool partialEnabled = _partialReturnsEnabled;
      List<Map<String, dynamic>> returnRequests = _returnRequests;
      Map<String, dynamic>? settings;
      if (order.isPickup) {
        settings = await ApiService.instance
            .getSettings()
            .catchError((_) => <String, dynamic>{});
      }
      if (order.status == 'delivered' && order.refundStatus != 'success') {
        try {
          final revList =
              await ApiService.instance.getOrderReviewStatus(widget.orderId);
          reviewed = revList.toSet();
        } catch (_) {}
        if (order.paymentStatus == 'paid' ||
            order.paymentStatus == 'partially_refunded') {
          try {
            settings ??= await ApiService.instance.getSettings();
            partialEnabled = settings['partial_returns_enabled'] == true ||
                settings['partial_returns_enabled'] == 'true';
            if (partialEnabled) {
              final retData =
                  await ApiService.instance.getOrderReturns(widget.orderId);
              returnRequests = (retData['returns'] as List<dynamic>? ?? [])
                  .whereType<Map<String, dynamic>>()
                  .toList();
            } else {
              returnRequests = [];
            }
          } catch (_) {}
        }
      }
      final rawLoc = settings?['pickup_location']?.toString().trim() ?? '';
      final rawHrs = settings?['pickup_hours']?.toString().trim() ?? '';

      if (mounted) {
        setState(() {
          _order = order;
          _delivery = delivery ?? order.delivery;
          _statusLog = rawLog.whereType<Map<String, dynamic>>().toList();
          _reviewedProductIds = reviewed;
          _partialReturnsEnabled = partialEnabled;
          _returnRequests = returnRequests;
          _pickupLocation = rawLoc.isEmpty ? null : rawLoc;
          _pickupHours = rawHrs.isEmpty ? null : rawHrs;
          _loadError = null;
          _loading = false;
        });
        _configureBackgroundPoll(order);
      }
    } catch (e) {
      if (mounted && !silent) {
        setState(() {
          _loadError = ApiService.formatError(e);
          _loading = false;
        });
      }
    }
  }

  void _configureBackgroundPoll(Order order) {
    _pollTimer?.cancel();
    final needsPoll = (order.cancelRequested &&
            !order.cancelRequestRejected &&
            order.status != 'cancelled') ||
        (order.returnRequested &&
            !order.returnRequestRejected &&
            order.status != 'refunded' &&
            order.refundStatus != 'success');
    if (needsPoll) {
      _pollTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _load(silent: true),
      );
    }
  }

  int _lastNormalStatusIdx(Order order) {
    final keys = _orderStatusSteps.map((s) => s['key']!).toList();
    if (keys.contains(order.status)) {
      return keys.indexOf(order.status);
    }
    int maxIdx = 0;
    for (final entry in _statusLog) {
      final idx = keys.indexOf((entry['to_status'] ?? '').toString());
      if (idx > maxIdx) maxIdx = idx;
    }
    return maxIdx;
  }

  bool get _canPayNow =>
      _order != null &&
      _order!.paymentMethod == 'paystack' &&
      (_order!.paymentStatus == 'unpaid' ||
          _order!.paymentStatus == 'pending') &&
      (_order!.status == 'pending' || _order!.status == 'confirmed');

  bool get _showCancelSection =>
      _order != null &&
      (_order!.status == 'pending' || _order!.status == 'confirmed');

  bool get _showReturnSection =>
      _order != null &&
      _order!.status == 'delivered' &&
      (_order!.paymentStatus == 'paid' ||
          _order!.paymentStatus == 'partially_refunded') &&
      (_order!.refundStatus == null ||
          _order!.refundStatus == 'not_requested');

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
      context.push('/payment', extra: {
        'url': authUrl,
        'order_id': _order!.id,
        'order_number': _order!.orderNumber,
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
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _promptAction({required bool isReturn}) async {
    if (_order == null) return;
    if (isReturn) {
      // Only show item-level partial return picker when PARTIAL_RETURNS_ENABLED is on
      try {
        final settings = await ApiService.instance.getSettings();
        final enabled = settings['partial_returns_enabled'] == true ||
            settings['partial_returns_enabled'] == 'true';
        if (enabled && mounted) {
          await _promptPartialReturn();
          return;
        }
      } catch (_) {}
      if (!mounted) return;
    }
    final reasonCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isReturn ? 'Request Return' : 'Request Cancellation'),
        content: TextField(
          controller: reasonCtrl,
          maxLines: 3,
          maxLength: 500,
          decoration: InputDecoration(
            labelText: 'Reason *',
            hintText: isReturn
                ? 'Please describe the reason for your return…'
                : 'Please explain why you want to cancel this order…',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
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
                ? 'Return request submitted'
                : 'Cancellation request submitted',
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

  Future<void> _promptPartialReturn() async {
    if (_order == null) return;
    Map<String, dynamic> retData;
    try {
      retData = await ApiService.instance.getOrderReturns(_order!.id);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), ''))),
      );
      return;
    }
    if (!mounted) return;

    final returnable = (retData['returnable_items'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .where((it) => ((it['remaining_quantity'] as num?)?.toInt() ?? 0) > 0)
        .toList();

    if (returnable.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No returnable items remaining on this order.')),
      );
      return;
    }

    final selectedQty = <String, int>{};
    final reasonCtrl = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Select Items to Return'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ...returnable.map((it) {
                  final itemId = it['id'].toString();
                  final name = (it['product_name'] ?? 'Item').toString();
                  final maxQty = (it['remaining_quantity'] as num?)?.toInt() ?? 1;
                  final qty = selectedQty[itemId] ?? 0;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Checkbox(
                      value: qty > 0,
                      onChanged: (v) => setDialogState(() {
                        selectedQty[itemId] = v == true ? 1 : 0;
                      }),
                    ),
                    title: Text(name, style: const TextStyle(fontSize: 13)),
                    subtitle: Text('Max: $maxQty', style: const TextStyle(fontSize: 11)),
                    trailing: qty > 0
                        ? Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.remove_circle_outline, size: 20),
                                onPressed: qty > 1
                                    ? () => setDialogState(() => selectedQty[itemId] = qty - 1)
                                    : null,
                              ),
                              Text('$qty'),
                              IconButton(
                                icon: const Icon(Icons.add_circle_outline, size: 20),
                                onPressed: qty < maxQty
                                    ? () => setDialogState(() => selectedQty[itemId] = qty + 1)
                                    : null,
                              ),
                            ],
                          )
                        : null,
                  );
                }),
                const SizedBox(height: 8),
                TextField(
                  controller: reasonCtrl,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Reason *',
                    hintText: 'Please describe the reason for your return…',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Submit Return'),
            ),
          ],
        ),
      ),
    );

    final chosen = selectedQty.entries
        .where((e) => e.value > 0)
        .map((e) => {'order_item_id': e.key, 'quantity': e.value})
        .toList();
    if (confirmed != true || chosen.isEmpty || reasonCtrl.text.trim().isEmpty || _order == null) {
      return;
    }

    try {
      final res = await ApiService.instance.createOrderReturn(
        _order!.id,
        items: chosen,
        reason: reasonCtrl.text,
      );
      if (!mounted) return;
      final rrMap = res['return_request'] is Map<String, dynamic>
          ? res['return_request'] as Map<String, dynamic>
          : null;
      final serverAmt = rrMap != null
          ? double.tryParse((rrMap['refund_amount'] ?? '').toString())
          : null;
      final msg = serverAmt != null && serverAmt > 0
          ? 'Return request submitted (Refund: ${AppConfig.currencySymbol}${serverAmt.toStringAsFixed(2)})'
          : 'Partial return request submitted';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiService.formatError(e)),
        ),
      );
    }
  }

  Future<void> _cancelPartialReturn(String returnId) async {
    if (_order == null) return;
    try {
      await ApiService.instance.cancelOrderReturn(_order!.id, returnId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Return request cancelled')),
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

  Future<void> _submitItemReview(String productId) async {
    final rating = _reviewRatings[productId] ?? 0;
    if (rating < 1) {
      setState(() => _reviewErrors[productId] = 'Please select a star rating.');
      return;
    }
    setState(() {
      _reviewSaving[productId] = true;
      _reviewErrors[productId] = null;
    });
    try {
      final title = _reviewTitleCtrls[productId]?.text ?? '';
      final body = _reviewBodyCtrls[productId]?.text ?? '';
      await ApiService.instance.createProductReview(
        productId,
        rating: rating,
        title: title,
        comment: body,
      );
      if (!mounted) return;
      setState(() {
        _reviewedProductIds.add(productId);
        _reviewSaving[productId] = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Review submitted — thank you!')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 409) {
        setState(() {
          _reviewedProductIds.add(productId);
          _reviewSaving[productId] = false;
        });
      } else {
        setState(() {
          _reviewSaving[productId] = false;
          _reviewErrors[productId] = e.message;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _reviewSaving[productId] = false;
        _reviewErrors[productId] =
            'Could not submit review. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('d MMM yyyy · HH:mm');
    final dateOnlyFmt = DateFormat('d MMM yyyy');

    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Order Detail')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_order == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Order Detail')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _loadError ?? 'Order not found',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  children: [
                    if (_loadError != null)
                      FilledButton(
                        onPressed: () => _load(),
                        child: const Text('Retry'),
                      ),
                    OutlinedButton(
                      onPressed: () => context.go('/orders'),
                      child: const Text('Back to Orders'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
    }

    final order = _order!;
    final orderNum = order.orderNumber.isNotEmpty
        ? order.orderNumber
        : (order.id.length >= 8
            ? order.id.substring(0, 8).toUpperCase()
            : order.id);
    final osIdx = _lastNormalStatusIdx(order);
    final isTerminal =
        order.status == 'cancelled' || order.status == 'refunded';
    final deliveryStepIdx = _delivery != null
        ? _deliverySteps
            .indexWhere((s) => s['key'] == _delivery!['status']?.toString())
        : -1;
    final itemsSubtotal = order.items.fold<double>(
      0,
      (sum, item) => sum + item.priceAtPurchase * item.quantity,
    );
    final subtotal = itemsSubtotal > 0
        ? itemsSubtotal
        : (order.totalAmount - (order.deliveryFee ?? 0));
    final showReviewPrompt = order.status == 'delivered' &&
        order.refundStatus != 'success' &&
        order.items.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/orders'),
        ),
        title: Text('Order #$orderNum'),
        actions: [
          IconButton(
            tooltip: 'Copy order number',
            icon: const Icon(Icons.copy_rounded, size: 20),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: orderNum));
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Copied $orderNum'),
                  duration: const Duration(seconds: 2),
                ),
              );
            },
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.accent,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── 1. Payment Pending Banner ──
            if (_canPayNow) ...[
              _StateBanner(
                color: const Color(0xFFF7F9F2),
                borderColor: const Color(0xFFC9DBA0),
                title: 'Payment Pending',
                children: [
                  const Text(
                    'Your order is reserved, but online payment has not been completed yet.',
                    style: TextStyle(fontSize: 13),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _paying ? null : _payNow,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.accent,
                        foregroundColor: AppColors.primary,
                      ),
                      icon: const Icon(Icons.lock_outline, size: 17),
                      label: Text(
                        _paying
                            ? 'Redirecting to Paystack…'
                            : 'Pay ${AppConfig.currencySymbol}${order.totalAmount.toStringAsFixed(2)} Now',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── 2. Cancelled State Banner ──
            if (order.status == 'cancelled') ...[
              _StateBanner(
                color: const Color(0xFFFFF8F7),
                borderColor: const Color(0xFFF2C7C1),
                title: 'Order cancelled',
                children: [
                  if (order.refundMessage != null)
                    Text(order.refundMessage!,
                        style: const TextStyle(fontSize: 13)),
                  if (order.cancellationReason != null &&
                      order.cancellationReason!.isNotEmpty)
                    Text('Reason: ${order.cancellationReason}',
                        style: const TextStyle(fontSize: 13)),
                  if (order.cancelledAt != null)
                    Text(
                      'Cancelled on ${fmt.format(order.cancelledAt!.toLocal())}',
                      style:
                          const TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── 3. Refunded State Banner ──
            if (order.status == 'refunded' ||
                order.refundStatus == 'success') ...[
              _StateBanner(
                color: const Color(0xFFF7F8FA),
                borderColor: const Color(0xFFD9DDE5),
                title: 'Order refunded',
                children: [
                  Text(
                    order.refundAmount != null
                        ? '${AppConfig.currencySymbol}${order.refundAmount!.toStringAsFixed(2)} refunded'
                        : 'Your refund has been completed.',
                    style: const TextStyle(fontSize: 13),
                  ),
                  if (order.refundMethod != null)
                    Text('Method: ${order.refundMethod}',
                        style: const TextStyle(fontSize: 12.5)),
                  if (order.refundReference != null)
                    Text('Reference: ${order.refundReference}',
                        style: const TextStyle(fontSize: 12.5)),
                  if (order.refundedAt != null)
                    Text(
                      'Refunded on ${fmt.format(order.refundedAt!.toLocal())}',
                      style:
                          const TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── 4. Refund Failed Banner ──
            if (order.refundStatus == 'failed' &&
                order.status != 'refunded') ...[
              _StateBanner(
                color: const Color(0xFFFFF8F7),
                borderColor: const Color(0xFFF2C7C1),
                title: 'Refund failed',
                children: [
                  const Text('Refund failed - contact support.',
                      style: TextStyle(fontSize: 13)),
                  if (order.refundReference != null)
                    Text('Reference: ${order.refundReference}',
                        style: const TextStyle(fontSize: 12.5)),
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── 5. Cancel Request Status Banner ──
            if (_showCancelSection) ...[
              _StateBanner(
                color: const Color(0xFFF7F9F2),
                borderColor: const Color(0xFFC9DBA0),
                title: order.cancelRequested && !order.cancelRequestRejected
                    ? 'Cancellation requested'
                    : order.cancelRequestRejected
                        ? 'Cancellation request rejected'
                        : 'Need to cancel?',
                children: [
                  Text(
                    order.cancelRequested && !order.cancelRequestRejected
                        ? 'Your request is pending admin review. We will notify you once processed.'
                        : order.cancelRequestRejected
                            ? 'Your cancellation request was not approved. Contact support for assistance.'
                            : 'You can request a cancellation while your order is pending or confirmed.',
                    style: const TextStyle(fontSize: 13),
                  ),
                  if (!order.cancelRequested ||
                      order.cancelRequestRejected) ...[
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: () => _promptAction(isReturn: false),
                      child: Text(order.cancelRequestRejected
                          ? 'Resubmit request'
                          : 'Request cancellation'),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── 6. Return Request Status Banner ──
            if (_showReturnSection) ...[
              _StateBanner(
                color: const Color(0xFFF7F9F2),
                borderColor: const Color(0xFFC9DBA0),
                title: order.returnRequested && !order.returnRequestRejected
                    ? 'Return requested'
                    : order.returnRequestRejected
                        ? 'Return request rejected'
                        : 'Need a return or refund?',
                children: [
                  Text(
                    order.returnRequested && !order.returnRequestRejected
                        ? 'Your return request is pending admin review. We will notify you once processed.'
                        : order.returnRequestRejected
                            ? 'Your return request was not approved. Contact support for assistance.'
                            : 'Not satisfied with your order? Request a return and our team will review it.',
                    style: const TextStyle(fontSize: 13),
                  ),
                  if (!order.returnRequested ||
                      order.returnRequestRejected ||
                      _partialReturnsEnabled) ...[
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: () => _promptAction(isReturn: true),
                      child: Text(order.returnRequestRejected
                          ? 'Resubmit request'
                          : 'Request return'),
                    ),
                  ],
                  if (_partialReturnsEnabled && _returnRequests.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    ..._returnRequests.map((rr) {
                      final rrId = (rr['id'] ?? '').toString();
                      final rrStatus = (rr['status'] ?? 'pending').toString();
                      final rrAmt = double.tryParse(
                              (rr['refund_amount'] ?? 0).toString()) ??
                          0;
                      final rrReason = (rr['reason'] ?? '').toString();
                      final rrItems =
                          (rr['items'] as List<dynamic>? ?? [])
                              .whereType<Map<String, dynamic>>()
                              .toList();
                      return Container(
                        margin: const EdgeInsets.only(top: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Return · ${AppConfig.currencySymbol}${rrAmt.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700),
                                ),
                                StatusChip(rrStatus),
                              ],
                            ),
                            if (rrReason.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                rrReason,
                                style: const TextStyle(
                                    fontSize: 12.5, color: AppColors.muted),
                              ),
                            ],
                            if (rrItems.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              ...rrItems.map((it) {
                                final pName =
                                    (it['product_name'] ?? 'Item').toString();
                                final vLabel = it['variant_label']?.toString();
                                final q = it['quantity'] ?? 1;
                                return Text(
                                  '• $pName${(vLabel != null && vLabel.isNotEmpty) ? ' ($vLabel)' : ''} × $q',
                                  style: const TextStyle(fontSize: 12),
                                );
                              }),
                            ],
                            if (rrStatus == 'pending' && rrId.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              OutlinedButton(
                                onPressed: () => _cancelPartialReturn(rrId),
                                child: const Text('Cancel return request'),
                              ),
                            ],
                          ],
                        ),
                      );
                    }),
                  ],
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── 7. Visual 5-Step Order Progress Timeline (matches web OrderDetail) ──
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
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
                        StatusChip(order.status),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        ...List.generate(
                          _orderStatusSteps.length,
                          (i) {
                            final done = i <= osIdx;
                            final label = _orderStatusSteps[i]['label']!;
                            return Expanded(
                              child: Column(
                                children: [
                                  CircleAvatar(
                                    radius: 13,
                                    backgroundColor: done
                                        ? AppColors.accent
                                        : AppColors.border,
                                    child: Text(
                                      done ? '✓' : '${i + 1}',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: done
                                            ? Colors.white
                                            : AppColors.muted,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    label,
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 9.5,
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
                        if (isTerminal)
                          Expanded(
                            child: Column(
                              children: [
                                CircleAvatar(
                                  radius: 13,
                                  backgroundColor:
                                      AppColors.error.withValues(alpha: 0.15),
                                  child: const Text(
                                    '✗',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.error,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  order.status == 'cancelled'
                                      ? 'Cancelled'
                                      : 'Refunded',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.error,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // ── 8. Shipment Progress & Tracking Details / Store Pickup ──
            if (order.isPickup && !order.isTerminal) ...[
              Card(
                child: ListTile(
                  leading: const Icon(Icons.storefront_outlined,
                      color: AppColors.accentDark),
                  title: const Text('Fulfillment: Store Pickup'),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        order.status == 'delivered'
                            ? 'Picked up'
                            : 'We will notify you when your order is ready for pickup.',
                      ),
                      if (_pickupLocation != null) ...[
                        const SizedBox(height: 4),
                        Text('Location: $_pickupLocation'),
                      ],
                      if (_pickupHours != null) ...[
                        const SizedBox(height: 2),
                        Text('Hours: $_pickupHours'),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ] else if (_delivery != null && !order.isTerminal) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'SHIPMENT PROGRESS',
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
                          _deliverySteps.length,
                          (i) {
                            final done = i <= deliveryStepIdx;
                            final label = _deliverySteps[i]['label']!;
                            return Expanded(
                              child: Column(
                                children: [
                                  CircleAvatar(
                                    radius: 12,
                                    backgroundColor: done
                                        ? AppColors.accent
                                        : AppColors.border,
                                    child: Text(
                                      done ? '✓' : '${i + 1}',
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w700,
                                        color: done
                                            ? Colors.white
                                            : AppColors.muted,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 5),
                                  Text(
                                    label,
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 9.5,
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
                      const SizedBox(height: 12),
                      const Divider(),
                      if (_delivery!['delivery_partner'] != null)
                        _MetaRow('Courier',
                            _delivery!['delivery_partner'].toString()),
                      _MetaRow(
                        'Tracking #',
                        _delivery!['tracking_number']?.toString() ??
                            'Pending assignment',
                      ),
                      if (_delivery!['estimated_delivery'] != null &&
                          DateTime.tryParse(
                                  _delivery!['estimated_delivery'].toString()) !=
                              null)
                        _MetaRow(
                          'Est. Delivery',
                          dateOnlyFmt.format(DateTime.parse(
                                  _delivery!['estimated_delivery'].toString())
                              .toLocal()),
                        ),
                      if (_delivery!['actual_delivery_date'] != null &&
                          DateTime.tryParse(_delivery!['actual_delivery_date']
                                  .toString()) !=
                              null)
                        _MetaRow(
                          'Delivered on',
                          dateOnlyFmt.format(DateTime.parse(
                                  _delivery!['actual_delivery_date'].toString())
                              .toLocal()),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ] else if (!order.isPickup &&
                !order.isTerminal &&
                (order.status == 'processing' || order.status == 'shipped')) ...[
              Card(
                child: const ListTile(
                  leading: Icon(Icons.local_shipping_outlined,
                      color: AppColors.accentDark),
                  title: Text('Shipment Status'),
                  subtitle: Text(
                    'Courier & tracking number will appear here once assigned.',
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            // ── 9. Delivery Address Card ──
            if (order.deliveryAddress != null) ...[
              Card(
                child: ListTile(
                  leading: const Icon(Icons.location_on_outlined,
                      color: AppColors.accentDark),
                  title: const Text('Delivery Address'),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(order.deliveryAddress!),
                      if (order.customerPhone != null &&
                          order.customerPhone!.isNotEmpty)
                        Text(
                          order.customerPhone!,
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.muted),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            // ── 10. Items & Totals Card + Status History Log ──
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Items',
                            style: Theme.of(context).textTheme.titleLarge),
                        Text(
                          'Placed ${fmt.format(order.createdAt.toLocal())}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    ...order.items.map(
                      (item) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          children: [
                            Expanded(
                              child: GestureDetector(
                                onTap: item.productId.isNotEmpty
                                    ? () =>
                                        context.push('/product/${item.productId}')
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
                              style:
                                  const TextStyle(fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Divider(),
                    ),
                    _MetaRow(
                      'Subtotal',
                      '${AppConfig.currencySymbol}${subtotal.toStringAsFixed(2)}',
                    ),
                    if (order.deliveryFee != null)
                      _MetaRow(
                        'Delivery',
                        order.deliveryFee == 0
                            ? 'Free'
                            : '${AppConfig.currencySymbol}${order.deliveryFee!.toStringAsFixed(2)}',
                      ),
                    if (order.refundAmount != null && order.refundAmount! > 0)
                      _MetaRow(
                        'Refunded',
                        '-${AppConfig.currencySymbol}${order.refundAmount!.toStringAsFixed(2)}',
                      ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Total paid',
                            style: TextStyle(
                                fontSize: 16, fontWeight: FontWeight.w700)),
                        Text(
                          '${AppConfig.currencySymbol}${order.totalAmount.toStringAsFixed(2)}',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primary,
                          ),
                        ),
                      ],
                    ),

                    // Vertical Status History Timeline (GET /orders/:id/log)
                    if (_statusLog.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      const Divider(),
                      const SizedBox(height: 10),
                      const Text(
                        'STATUS HISTORY',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.5,
                          color: AppColors.accentDark,
                        ),
                      ),
                      const SizedBox(height: 10),
                      ..._statusLog.map((entry) {
                        final fromS = entry['from_status']?.toString();
                        final toS =
                            (entry['to_status'] ?? 'pending').toString();
                        final note = entry['note']?.toString();
                        final dt = entry['created_at'] != null
                            ? DateTime.tryParse(entry['created_at'].toString())
                            : null;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                margin: const EdgeInsets.only(top: 5),
                                width: 8,
                                height: 8,
                                decoration: const BoxDecoration(
                                  color: AppColors.accent,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Wrap(
                                      spacing: 6,
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        if (fromS != null &&
                                            fromS.isNotEmpty) ...[
                                          StatusChip(fromS),
                                          const Text('→',
                                              style: TextStyle(
                                                  fontSize: 11,
                                                  color: AppColors.muted)),
                                        ],
                                        StatusChip(toS),
                                      ],
                                    ),
                                    if (note != null && note.isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 3),
                                        child: Text(
                                          note,
                                          style: const TextStyle(
                                              fontSize: 12.5,
                                              color: AppColors.muted),
                                        ),
                                      ),
                                    if (dt != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: Text(
                                          fmt.format(dt.toLocal()),
                                          style: const TextStyle(
                                              fontSize: 11,
                                              color: AppColors.muted),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        );
                      }),
                    ],
                  ],
                ),
              ),
            ),

            // ── 11. In-Order Review Prompt ("How did we do?") for delivered orders ──
            if (showReviewPrompt) ...[
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('How did we do?',
                          style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 4),
                      const Text(
                        'Your feedback helps other shoppers and keeps our quality high. Thank you!',
                        style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                      ),
                      const SizedBox(height: 14),
                      ...order.items.map((item) {
                        final pid = item.productId;
                        final done = _reviewedProductIds.contains(pid);
                        final rating = _reviewRatings[pid] ?? 0;
                        final titleCtrl = _reviewTitleCtrls.putIfAbsent(
                            pid, () => TextEditingController());
                        final bodyCtrl = _reviewBodyCtrls.putIfAbsent(
                            pid, () => TextEditingController());
                        final saving = _reviewSaving[pid] == true;
                        final err = _reviewErrors[pid];

                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: done ? AppColors.bg : AppColors.surface,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color:
                                  done ? AppColors.accent : AppColors.border,
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  if (item.imageUrl != null) ...[
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(6),
                                      child: SizedBox(
                                        width: 40,
                                        height: 40,
                                        child: CachedNetworkImage(
                                          imageUrl: item.imageUrl!,
                                          fit: BoxFit.cover,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                  ],
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          item.name,
                                          style: const TextStyle(
                                            fontFamily: 'serif',
                                            fontWeight: FontWeight.w600,
                                            fontSize: 15,
                                          ),
                                        ),
                                        Text(
                                          '${AppConfig.currencySymbol}${item.priceAtPurchase.toStringAsFixed(2)}',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: AppColors.muted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppColors.accentLight,
                                      borderRadius: BorderRadius.circular(99),
                                    ),
                                    child: const Text(
                                      '✓ Verified Purchase',
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800,
                                        color: AppColors.accentDark,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              if (done)
                                const Row(
                                  children: [
                                    Icon(Icons.check_circle,
                                        size: 18, color: AppColors.accentDark),
                                    SizedBox(width: 6),
                                    Text(
                                      'Thank you for your review!',
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.accentDark,
                                      ),
                                    ),
                                  ],
                                )
                              else ...[
                                Row(
                                  children: List.generate(
                                    5,
                                    (idx) => IconButton(
                                      visualDensity: VisualDensity.compact,
                                      onPressed: () => setState(() =>
                                          _reviewRatings[pid] = idx + 1),
                                      icon: Icon(
                                        idx < rating
                                            ? Icons.star_rounded
                                            : Icons.star_border_rounded,
                                        color: AppColors.accent,
                                        size: 26,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                TextField(
                                  controller: titleCtrl,
                                  decoration: const InputDecoration(
                                    hintText: 'Review title (optional)',
                                    isDense: true,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                TextField(
                                  controller: bodyCtrl,
                                  maxLines: 2,
                                  decoration: const InputDecoration(
                                    hintText: 'Tell us what you think…',
                                    isDense: true,
                                  ),
                                ),
                                if (err != null) ...[
                                  const SizedBox(height: 6),
                                  Text(
                                    err,
                                    style: const TextStyle(
                                        fontSize: 12, color: AppColors.error),
                                  ),
                                ],
                                const SizedBox(height: 10),
                                FilledButton(
                                  onPressed: saving || pid.isEmpty
                                      ? null
                                      : () => _submitItemReview(pid),
                                  child: Text(saving
                                      ? 'Submitting…'
                                      : 'Submit Review'),
                                ),
                              ],
                            ],
                          ),
                        );
                      }),
                    ],
                  ),
                ),
              ),
            ],

            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => context.go('/orders'),
              child: const Text('← Back to Orders'),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _StateBanner extends StatelessWidget {
  final Color color;
  final Color borderColor;
  final String title;
  final List<Widget> children;

  const _StateBanner({
    required this.color,
    required this.borderColor,
    required this.title,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontFamily: 'serif',
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: AppColors.primary,
            ),
          ),
          const SizedBox(height: 4),
          ...children,
        ],
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  final String label;
  final String value;
  const _MetaRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 13, color: AppColors.muted)),
          Text(value,
              style:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
