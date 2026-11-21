import 'package:flutter_test/flutter_test.dart';
import 'package:cosmetics_app/utils/payment_url.dart';

void main() {
  group('isSafePaystackCheckoutUrl', () {
    test('accepts the Paystack checkout host over https', () {
      expect(isSafePaystackCheckoutUrl('https://checkout.paystack.com/abc123'), isTrue);
    });

    test('rejects null, empty and unparsable input', () {
      expect(isSafePaystackCheckoutUrl(null), isFalse);
      expect(isSafePaystackCheckoutUrl(''), isFalse);
      expect(isSafePaystackCheckoutUrl('not a url'), isFalse);
    });

    test('rejects http, other hosts and lookalikes', () {
      expect(isSafePaystackCheckoutUrl('http://checkout.paystack.com/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('https://evil.com/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('https://checkout.paystack.com.evil.com/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('https://evilcheckout.paystack.com/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('https://paystack.com/abc'), isFalse);
    });

    test('rejects embedded credentials, custom ports and non-web schemes', () {
      expect(isSafePaystackCheckoutUrl('https://checkout.paystack.com@evil.com/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('https://user:pw@checkout.paystack.com/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('https://checkout.paystack.com:8443/abc'), isFalse);
      expect(isSafePaystackCheckoutUrl('javascript:alert(1)'), isFalse);
      expect(isSafePaystackCheckoutUrl('intent://checkout.paystack.com/abc'), isFalse);
    });
  });

  group('isPaymentCallbackUrl', () {
    final trusted = [
      Uri.parse('https://shop.example.com'),
      Uri.parse('https://api.example.com/api'),
    ];

    test('accepts trusted host with the exact callback path', () {
      expect(
        isPaymentCallbackUrl(Uri.parse('https://shop.example.com/payment/callback?reference=r1'),
            trustedOrigins: trusted),
        isTrue,
      );
      expect(
        isPaymentCallbackUrl(Uri.parse('https://api.example.com/payment/callback/'),
            trustedOrigins: trusted),
        isTrue,
      );
    });

    test('rejects the callback path on an untrusted host', () {
      expect(
        isPaymentCallbackUrl(Uri.parse('https://evil.com/payment/callback?reference=r1'),
            trustedOrigins: trusted),
        isFalse,
      );
      expect(
        isPaymentCallbackUrl(Uri.parse('https://shop.example.com.evil.com/payment/callback'),
            trustedOrigins: trusted),
        isFalse,
      );
    });

    test('rejects paths that merely contain the callback path', () {
      expect(
        isPaymentCallbackUrl(Uri.parse('https://shop.example.com/x/payment/callback'),
            trustedOrigins: trusted),
        isFalse,
      );
      expect(
        isPaymentCallbackUrl(Uri.parse('https://shop.example.com/payment/callback-evil'),
            trustedOrigins: trusted),
        isFalse,
      );
    });

    test('rejects a scheme or port mismatch', () {
      expect(
        isPaymentCallbackUrl(Uri.parse('http://shop.example.com/payment/callback'),
            trustedOrigins: trusted),
        isFalse,
      );
      expect(
        isPaymentCallbackUrl(Uri.parse('https://shop.example.com:8443/payment/callback'),
            trustedOrigins: trusted),
        isFalse,
      );
    });
  });
}
