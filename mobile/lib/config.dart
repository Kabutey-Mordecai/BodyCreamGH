import 'package:flutter/foundation.dart';

// Central configuration — change baseUrl to point at your deployed API.
// In development, use your machine's LAN IP so the emulator/device can reach it:
//   Android emulator: http://10.0.2.2:3000/api
//   Physical device:  http://192.168.x.x:3000/api
// In production:      https://api.yourdomain.com/api
class AppConfig {
  static const bool hasApiUrl = bool.hasEnvironment('API_URL');
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

  /// Returns true only for HTTPS URLs pointing to a non-local host.
  static bool isReleaseSafeUrl(String rawUrl) {
    final parsed = Uri.tryParse(rawUrl);
    if (parsed == null || parsed.scheme != 'https' || parsed.host.isEmpty) {
      return false;
    }
    const localHosts = {'localhost', '127.0.0.1', '10.0.2.2', '::1'};
    return !localHosts.contains(parsed.host.toLowerCase());
  }

  /// Fails loudly in release builds (and logs clearly in debug/profile builds) if
  /// API_URL or STOREFRONT_URL is unset, cleartext HTTP, or localhost.
  static void validateConfig() {
    if (!hasApiUrl || !isReleaseSafeUrl(baseUrl)) {
      const apiMsg =
          'API_URL is unset or not a production HTTPS URL ("$baseUrl"). '
          'Pass --dart-define=API_URL=https://api.yourdomain.com/api for release builds.';
      if (kReleaseMode) {
        throw StateError('[AppConfig] $apiMsg');
      }
      debugPrint('[AppConfig] WARNING: $apiMsg');
    }

    if (!hasStorefrontUrl || !isReleaseSafeUrl(storefrontUrl)) {
      const msg =
          'STOREFRONT_URL is unset or not a production HTTPS URL ("$storefrontUrl"). '
          'Pass --dart-define=STOREFRONT_URL=https://yourdomain.com so '
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
