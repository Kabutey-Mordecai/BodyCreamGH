import 'package:url_launcher/url_launcher.dart';

class WhatsAppHelper {
  /// Normalizes a raw WhatsApp phone number just like Web AnnouncementBar/WhatsAppFloat/ProductPage:
  /// strips non-digits and converts 10-digit Ghana numbers starting with 0 to 233XXXXXXXXX.
  static String normalizeNumber(dynamic raw) {
    if (raw == null) return '';
    final digits = raw.toString().replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10 && digits.startsWith('0')) {
      return '233${digits.substring(1)}';
    }
    return digits;
  }

  static Future<bool> openWhatsApp({
    required String rawNumber,
    required String message,
  }) async {
    final number = normalizeNumber(rawNumber);
    if (number.isEmpty) return false;
    final uri = Uri.parse(
      'https://wa.me/$number?text=${Uri.encodeComponent(message)}',
    );
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  static Future<bool> openUrl(String urlString) async {
    final uri = Uri.tryParse(urlString);
    if (uri == null) return false;
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
