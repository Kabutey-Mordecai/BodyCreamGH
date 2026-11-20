import 'package:flutter/foundation.dart';

// Central configuration — change baseUrl to point at your deployed API.
// In development, use your machine's LAN IP so the emulator/device can reach it:
//   Android emulator: http://10.0.2.2:3000/api
//   Physical device:  http://192.168.x.x:3000/api
// In production:      https://api.yourdomain.com/api
class AppConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:3000/api',
  );

  // Public storefront URL. The backend builds the Paystack callback URL from
  // its FRONTEND_URL, so this must match it (build with
  // --dart-define=STOREFRONT_URL=https://yourdomain.com in production).
  static const bool hasStorefrontUrl = bool.hasEnvironment('STOREFRONT_URL');
  static const String storefrontUrl = String.fromEnvironment(
    'STOREFRONT_URL',
    defaultValue: 'http://localhost:5173',
  );

  /// Fails loudly in release builds (and logs clearly in debug builds) if
  /// STOREFRONT_URL was not configured, preventing silent Paystack callback
  /// detection failures.
  static void validateConfig() {
    final parsed = Uri.tryParse(storefrontUrl);
    final isLocalhost = parsed == null ||
        parsed.host.isEmpty ||
        parsed.host == 'localhost' ||
        parsed.host == '127.0.0.1';

    if (!hasStorefrontUrl || isLocalhost) {
      const msg =
          'STOREFRONT_URL is unset or points to localhost ("$storefrontUrl"). '
          'Pass --dart-define=STOREFRONT_URL=<backend FRONTEND_URL> so '
          'PaymentScreen can detect Paystack callbacks.';
      if (kReleaseMode) {
        throw StateError('[AppConfig] $msg');
      }
      debugPrint('[AppConfig] WARNING: $msg');
    }
  }

  /// Origins (scheme + host + port) that Paystack may redirect back to.
  static List<Uri> get trustedCallbackOrigins => [
        Uri.parse(storefrontUrl),
        Uri.parse(baseUrl),
      ];

  static const String appName = 'BodyCream GH';
  static const String currency = 'GHS';
  static const String currencySymbol = '₵';

  /// Resolves relative image paths (e.g. /uploads/products/...) against the server host.
  static String resolveImageUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    final serverBase = baseUrl.endsWith('/api')
        ? baseUrl.substring(0, baseUrl.length - 4)
        : baseUrl;
    final cleanPath = url.startsWith('/') ? url : '/$url';
    return '$serverBase$cleanPath';
  }
}
