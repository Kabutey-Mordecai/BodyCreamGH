import 'package:flutter/foundation.dart';

// Central configuration — change baseUrl to point at your deployed API.
// In development, use your machine's LAN IP so the emulator/device can reach it:
//   Android emulator: http://10.0.2.2:5000/api
//   Physical device:  http://192.168.x.x:5000/api
// In production:      https://api.yourdomain.com/api
class AppConfig {
  static const bool hasApiUrl = bool.hasEnvironment('API_URL');
  static const String baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:5000/api',
  );

  // Public storefront URL. The backend builds the Paystack callback URL from
  // its FRONTEND_URL, so this must match it (build with
  // --dart-define=STOREFRONT_URL=https://yourdomain.com in production).
  static const bool hasStorefrontUrl = bool.hasEnvironment('STOREFRONT_URL');
  static const String storefrontUrl = String.fromEnvironment(
    'STOREFRONT_URL',
    defaultValue: 'http://localhost:5173',
  );

  /// Returns true only for HTTPS URLs pointing to a public, non-local host.
  /// Rejects localhost, *.local, private IPv4 (10/8, 127/8, 169.254/16,
  /// 172.16/12, 192.168/16), IPv6 loopback (::1), and IPv6 ULA (fc00::/7).
  static bool isReleaseSafeUrl(String rawUrl) {
    final parsed = Uri.tryParse(rawUrl);
    if (parsed == null || parsed.scheme != 'https' || parsed.host.isEmpty) {
      return false;
    }
    final host = parsed.host
        .toLowerCase()
        .replaceAll('[', '')
        .replaceAll(']', '');
    const localHosts = {'localhost', '127.0.0.1', '10.0.2.2', '::1', '0.0.0.0'};
    if (localHosts.contains(host) || host.endsWith('.local')) return false;
    // Reject private & link-local IPv4 ranges (10/8, 127/8, 169.254/16, 172.16/12, 192.168/16)
    final privateIpv4 = RegExp(
      r'^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)',
    );
    if (privateIpv4.hasMatch(host)) return false;
    // Reject IPv6 ULA (fc00::/7 -> fc00::..fdff::) and link-local (fe80::/10)
    final privateIpv6 = RegExp(r'^(fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:');
    if (privateIpv6.hasMatch(host)) return false;
    return true;
  }

  /// Fails loudly in release builds (and logs clearly in debug/profile builds) if
  /// API_URL or STOREFRONT_URL is unset, cleartext HTTP, localhost, or a LAN IP.
  static void validateConfig({
    bool? isRelease,
    bool? hasApiUrlOverride,
    String? apiUrlOverride,
    bool? hasStorefrontUrlOverride,
    String? storefrontUrlOverride,
  }) {
    final release = isRelease ?? kReleaseMode;
    final apiDefined = hasApiUrlOverride ?? hasApiUrl;
    final apiUrl = apiUrlOverride ?? baseUrl;
    final storefrontDefined = hasStorefrontUrlOverride ?? hasStorefrontUrl;
    final sfUrl = storefrontUrlOverride ?? storefrontUrl;

    if (!apiDefined || !isReleaseSafeUrl(apiUrl)) {
      final apiMsg =
          'API_URL is unset or not a production HTTPS URL ("$apiUrl"). '
          'Pass --dart-define=API_URL=https://api.yourdomain.com/api for release builds.';
      if (release) {
        throw StateError('[AppConfig] $apiMsg');
      }
      debugPrint('[AppConfig] WARNING: $apiMsg');
    }

    if (!storefrontDefined || !isReleaseSafeUrl(sfUrl)) {
      final msg =
          'STOREFRONT_URL is unset or not a production HTTPS URL ("$sfUrl"). '
          'Pass --dart-define=STOREFRONT_URL=https://yourdomain.com so '
          'PaymentScreen can detect Paystack callbacks.';
      if (release) {
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
