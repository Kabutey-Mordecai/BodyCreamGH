import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';

const int _maxAttempts = 5;
const List<int> _pollDelaysMs = [1500, 2500, 3500, 4500];

class PaymentScreen extends StatefulWidget {
  final String paymentUrl;
  final String orderId;
  final String? orderNumber;
  final String? guestEmail;

  const PaymentScreen({
    super.key,
    required this.paymentUrl,
    required this.orderId,
    this.orderNumber,
    this.guestEmail,
  });

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  late final WebViewController _controller;
  bool _loadingWeb = true;
  String? _error;

  // Callback verification state (matches web PaymentCallback.jsx)
  String? _callbackRef;
  String _verifyStatus = 'verifying'; // verifying | pending | success | failed | attention
  String _verifyMessage = '';
  int _attempt = 1;
  String _resolvedOrderId = '';
  String _resolvedOrderNum = '';
  bool _retryingPay = false;

  @override
  void initState() {
    super.initState();
    _resolvedOrderId = widget.orderId;
    _resolvedOrderNum = widget.orderNumber ?? '';

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loadingWeb = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loadingWeb = false);
        },
        onNavigationRequest: (req) {
          final uri = Uri.tryParse(req.url);
          if (uri != null && isPaymentCallbackUrl(uri)) {
            final ref = uri.queryParameters['reference'] ??
                uri.queryParameters['trxref'] ??
                '';
            if (mounted) {
              _startVerification(ref);
            }
            return NavigationDecision.prevent;
          }
          if (uri != null &&
              (uri.path == paymentCallbackPath ||
                  uri.path == '$paymentCallbackPath/')) {
            debugPrint(
              '[PaymentScreen] Ignoring callback path on untrusted origin '
              '"${uri.scheme}://${uri.host}:${uri.port}". '
              'Trusted origins: ${AppConfig.trustedCallbackOrigins}.',
            );
          }
          return NavigationDecision.navigate;
        },
      ));

    if (isSafePaystackCheckoutUrl(widget.paymentUrl)) {
      _controller.loadRequest(Uri.parse(widget.paymentUrl));
    } else {
      _error = 'This payment link looks invalid, so it was not opened. '
          'Your order is saved — you can try paying again from your Orders page.';
      _loadingWeb = false;
    }
  }

  Future<void> _startVerification(String reference) async {
    if (reference.trim().isEmpty) {
      setState(() {
        _callbackRef = '';
        _verifyStatus = 'failed';
        _verifyMessage =
            'No payment reference found. If you completed a payment, please check your order status.';
      });
      return;
    }

    setState(() {
      _callbackRef = reference;
      _verifyStatus = 'verifying';
      _verifyMessage = '';
      _attempt = 1;
    });

    await _runAttempt(reference, 1);
  }

  bool _hasCancelledRefundState(Map<String, dynamic> data) {
    final os = data['order_status']?.toString();
    final rs = data['refund_status']?.toString();
    return os == 'cancelled' ||
        os == 'refunded' ||
        rs == 'pending' ||
        rs == 'needs_attention' ||
        rs == 'failed' ||
        rs == 'success';
  }

  Future<void> _runAttempt(String reference, int attemptNum) async {
    if (!mounted) return;
    setState(() => _attempt = attemptNum);

    try {
      final data = await ApiService.instance.verifyPayment(reference);
      if (!mounted) return;

      final httpStatus = data['httpStatus'] as int? ?? 200;
      final status = (data['status'] ?? '').toString();

      if (httpStatus == 202 || status == 'pending') {
        if (attemptNum < _maxAttempts) {
          final delayMs = _pollDelaysMs[(attemptNum - 1).clamp(0, _pollDelaysMs.length - 1)];
          await Future.delayed(Duration(milliseconds: delayMs));
          if (!mounted) return;
          await _runAttempt(reference, attemptNum + 1);
          return;
        }
        setState(() {
          _verifyStatus = 'pending';
          _verifyMessage =
              'Your payment is still being confirmed by Paystack (this can take a moment for Mobile Money). You can check again or retry payment.';
        });
        return;
      }

      final oid = (data['orderId'] ?? _resolvedOrderId).toString();
      final onum = (data['orderNumber'] ?? _resolvedOrderNum).toString();

      if (status == 'attention' || _hasCancelledRefundState(data)) {
        setState(() {
          _resolvedOrderId = oid;
          _resolvedOrderNum = onum;
          _verifyStatus = 'attention';
          _verifyMessage = (data['message'] ??
                  'Payment was received, but this order requires support review.')
              .toString();
        });
        return;
      }

      setState(() {
        _resolvedOrderId = oid;
        _resolvedOrderNum = onum;
        _verifyStatus = 'success';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _verifyStatus = 'failed';
        _verifyMessage = e
            .toString()
            .replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
      });
    }
  }

  Future<void> _retryPayment() async {
    if (_retryingPay) return;
    setState(() => _retryingPay = true);
    try {
      final isAuthed = context.read<AuthProvider>().isLoggedIn;
      final data = isAuthed
          ? await ApiService.instance.initializePayment(_resolvedOrderId)
          : await ApiService.instance.initializeGuestPayment(
              _resolvedOrderId,
              widget.guestEmail ?? '',
            );
      final authUrl = data['authorization_url'];
      if (authUrl is! String || !isSafePaystackCheckoutUrl(authUrl)) {
        throw Exception('Invalid payment redirect URL received.');
      }
      if (!mounted) return;
      setState(() {
        _callbackRef = null;
        _retryingPay = false;
        _loadingWeb = true;
      });
      _controller.loadRequest(Uri.parse(authUrl));
    } catch (e) {
      if (!mounted) return;
      setState(() => _retryingPay = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString()
                .replaceFirst(RegExp(r'ApiException\(\d+\): '), '')
                .replaceFirst('Exception: ', ''),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAuthed = context.watch<AuthProvider>().isLoggedIn;
    final canRetry = isAuthed
        ? _resolvedOrderId.isNotEmpty
        : (_resolvedOrderId.isNotEmpty &&
            widget.guestEmail != null &&
            widget.guestEmail!.isNotEmpty);

    // ── Post-Callback Verification States (matches web PaymentCallback.jsx) ──
    if (_callbackRef != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Payment Status')),
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_verifyStatus == 'verifying') ...[
                      const CircularProgressIndicator(),
                      const SizedBox(height: 20),
                      Text(
                        'Confirming your payment…',
                        style: Theme.of(context).textTheme.titleLarge,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _attempt > 1
                            ? 'Checking with Paystack (attempt $_attempt of $_maxAttempts)…'
                            : 'Please wait while we verify your transaction.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                    ] else if (_verifyStatus == 'pending') ...[
                      const Icon(Icons.hourglass_top_rounded,
                          size: 52, color: Color(0xFF92651E)),
                      const SizedBox(height: 14),
                      Text(
                        'Confirmation Pending',
                        style: Theme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _verifyMessage,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () =>
                              _startVerification(_callbackRef ?? ''),
                          child: const Text('Check Status Again'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (canRetry)
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton(
                            onPressed: _retryingPay ? null : _retryPayment,
                            child: Text(_retryingPay
                                ? 'Redirecting…'
                                : 'Retry Payment'),
                          ),
                        ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: () => context
                            .go(isAuthed ? '/orders' : '/track-order'),
                        child: Text(
                            isAuthed ? 'View My Orders' : 'Track Order'),
                      ),
                    ] else if (_verifyStatus == 'attention') ...[
                      const Icon(Icons.info_outline,
                          size: 52, color: Color(0xFF92651E)),
                      const SizedBox(height: 14),
                      Text(
                        'Order Needs Attention',
                        style: Theme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      if (_resolvedOrderNum.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Order #$_resolvedOrderNum',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Text(
                        _verifyMessage,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 20),
                      if (isAuthed && _resolvedOrderId.isNotEmpty)
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: () =>
                                context.go('/order/$_resolvedOrderId'),
                            child: const Text('View Order'),
                          ),
                        ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: () => context.go('/'),
                          child: const Text('Back to Home'),
                        ),
                      ),
                    ] else if (_verifyStatus == 'failed') ...[
                      const Icon(Icons.cancel_outlined,
                          size: 54, color: AppColors.error),
                      const SizedBox(height: 14),
                      Text(
                        'Payment Not Completed',
                        style: Theme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _verifyMessage,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 20),
                      if (canRetry)
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: _retryingPay ? null : _retryPayment,
                            child: Text(_retryingPay
                                ? 'Redirecting…'
                                : 'Retry Payment'),
                          ),
                        ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: () => context.go(
                            isAuthed && _resolvedOrderId.isNotEmpty
                                ? '/order/$_resolvedOrderId'
                                : '/orders',
                          ),
                          child: Text(isAuthed ? 'View Order' : 'Back to Home'),
                        ),
                      ),
                    ] else ...[
                      // Success
                      Container(
                        width: 64,
                        height: 64,
                        decoration: const BoxDecoration(
                          color: AppColors.accent,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.check,
                            color: Colors.white, size: 34),
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
                        'Payment Successful!',
                        style: Theme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      if (_resolvedOrderNum.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Order #$_resolvedOrderNum has been placed.',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                      const SizedBox(height: 8),
                      const Text(
                        "You'll receive a confirmation email with your order details and tracking information.",
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 22),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () {
                            if (isAuthed && _resolvedOrderId.isNotEmpty) {
                              context.go('/order/$_resolvedOrderId',
                                  extra: {'justPaid': true});
                            } else if (_resolvedOrderNum.isNotEmpty) {
                              context.go(
                                '/track-order?order_number=${Uri.encodeComponent(_resolvedOrderNum)}',
                              );
                            } else {
                              context.go(isAuthed ? '/orders' : '/');
                            }
                          },
                          child: Text(isAuthed ? 'View Order' : 'Track Order'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: () => context.go('/shop'),
                          child: const Text('Browse Products'),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Payment'),
          leading: IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => context.go('/orders'),
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, size: 48),
                const SizedBox(height: 16),
                Text(_error!, textAlign: TextAlign.center),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () => context.go('/orders'),
                  child: const Text('Go to Orders'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Paystack Checkout'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            showDialog(
              context: context,
              builder: (_) => AlertDialog(
                title: const Text('Cancel payment?'),
                content: const Text(
                    'Your order has been placed. You can complete payment later from your Orders page.'),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Continue Paying'),
                  ),
                  TextButton(
                    onPressed: () {
                      Navigator.pop(context);
                      context.go('/orders');
                    },
                    child: const Text('Go to Orders'),
                  ),
                ],
              ),
            );
          },
        ),
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loadingWeb) const LinearProgressIndicator(),
        ],
      ),
    );
  }
}
