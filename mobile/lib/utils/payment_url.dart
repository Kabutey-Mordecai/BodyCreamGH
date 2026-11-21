import '../config.dart';

const String _paystackCheckoutHost = 'checkout.paystack.com';

/// Path Paystack redirects to after a payment attempt.
const String paymentCallbackPath = '/payment/callback';

/// True only for https URLs whose host is exactly checkout.paystack.com.
/// Anything else (http, other hosts, lookalike hosts, embedded credentials,
/// custom ports) must never be loaded into the payment WebView.
bool isSafePaystackCheckoutUrl(String? url) {
  if (url == null || url.isEmpty) return false;
  final uri = Uri.tryParse(url);
  if (uri == null) return false;
  return uri.scheme == 'https' &&
      uri.host == _paystackCheckoutHost &&
      uri.userInfo.isEmpty &&
      uri.port == 443;
}

/// True when [uri] is our payment callback: same scheme, host and port as one
/// of the trusted origins AND the exact callback path. A path match alone is
/// not enough, otherwise any site could trigger the in-app "payment done" flow.
bool isPaymentCallbackUrl(Uri uri, {List<Uri>? trustedOrigins}) {
  final origins = trustedOrigins ?? AppConfig.trustedCallbackOrigins;
  if (uri.path != paymentCallbackPath && uri.path != '$paymentCallbackPath/') {
    return false;
  }
  return origins.any(
    (o) => o.scheme == uri.scheme && o.host == uri.host && o.port == uri.port,
  );
}
