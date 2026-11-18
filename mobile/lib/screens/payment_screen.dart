import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:webview_flutter/webview_flutter.dart';

// Loads Paystack's hosted payment page in a WebView.
// The backend initializes the transaction and returns an authorization_url;
// Paystack redirects to our callback URL on success/failure.
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

  // Paystack redirects to this path on completion — must match the callback
  // URL configured in your Paystack dashboard and backend PAYSTACK_CALLBACK_URL.
  static const _callbackPath = '/payment/callback';

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) => setState(() => _loading = true),
        onPageFinished: (_) => setState(() => _loading = false),
        onNavigationRequest: (req) {
          // Intercept Paystack callback redirect
          final uri = Uri.tryParse(req.url);
          if (uri != null && uri.path.contains(_callbackPath)) {
            // Paystack adds ?reference=xxx&trxref=xxx to the callback URL
            final ref = uri.queryParameters['reference'] ??
                uri.queryParameters['trxref'] ?? '';
            if (mounted) {
              context.go('/order/${widget.orderId}',
                  extra: {'paymentRef': ref, 'justPaid': true});
            }
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ))
      ..loadRequest(Uri.parse(widget.paymentUrl));
  }

  @override
  Widget build(BuildContext context) {
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
