import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../utils/payment_url.dart';

// Loads Paystack's hosted payment page in a WebView.
// The backend initializes the transaction and returns an authorization_url;
// Paystack redirects to our callback URL on success/failure.
//
// Security: the URL is only loaded when it is https://checkout.paystack.com,
// and the callback is only honoured for our own (trusted) host + callback path.
class PaymentScreen extends StatefulWidget {
  final String paymentUrl;
  final String orderId;

  const PaymentScreen({
    super.key,
    required this.paymentUrl,
    required this.orderId,
  });

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onNavigationRequest: (req) {
          // Intercept the Paystack callback redirect (host AND path must match).
          final uri = Uri.tryParse(req.url);
          if (uri != null && isPaymentCallbackUrl(uri)) {
            // Paystack adds ?reference=xxx&trxref=xxx to the callback URL
            final ref = uri.queryParameters['reference'] ??
                uri.queryParameters['trxref'] ??
                '';
            if (mounted) {
              context.go('/order/${widget.orderId}',
                  extra: {'paymentRef': ref, 'justPaid': true});
            }
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ));

    if (isSafePaystackCheckoutUrl(widget.paymentUrl)) {
      _controller.loadRequest(Uri.parse(widget.paymentUrl));
    } else {
      // Never load an unexpected URL into the payment WebView.
      _error = 'This payment link looks invalid, so it was not opened. '
          'Your order is saved — you can try paying again from your Orders page.';
      _loading = false;
    }
  }

  @override
  Widget build(BuildContext context) {
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
        title: const Text('Payment'),
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
          if (_loading) const LinearProgressIndicator(),
        ],
      ),
    );
  }
}
