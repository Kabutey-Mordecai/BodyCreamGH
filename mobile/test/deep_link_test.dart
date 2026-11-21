import 'package:flutter_test/flutter_test.dart';
import 'package:cosmetics_app/main.dart';

void main() {
  test('normalizeDeepLinkPath maps custom-scheme URIs to GoRouter paths', () {
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://orders/ord-123')),
      '/orders/ord-123',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://order/ord-456')),
      '/order/ord-456',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://app/orders/ord-789')),
      '/orders/ord-789',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://payment')),
      '/payment',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('/orders/ord-123')),
      isNull,
    );
  });
}
