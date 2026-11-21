import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cosmetics_app/config.dart';
import 'package:cosmetics_app/models/order.dart';
import 'package:cosmetics_app/models/product.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/theme_provider.dart';
import 'package:cosmetics_app/screens/track_order_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';
import 'package:cosmetics_app/theme/app_theme.dart';
import 'package:cosmetics_app/widgets/password_strength.dart';
import 'package:cosmetics_app/widgets/status_chip.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('CartProvider', () {
    late CartProvider cart;
    late Product lotion;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      cart = CartProvider();
      lotion = const Product(
        id: 'prod-1',
        name: 'Shea Glow Butter',
        description: 'Rich whipped shea butter',
        price: 80.0,
        stockQuantity: 10,
      );
    });

    test('adds items and scopes quantity updates/removals by variantId', () {
      cart.add(lotion, quantity: 1, variantId: 'v-250', variantLabel: '250ml', priceOverride: 80.0);
      cart.add(lotion, quantity: 2, variantId: 'v-500', variantLabel: '500ml', priceOverride: 140.0);
      expect(cart.items.length, 2);
      expect(cart.itemCount, 3);
      expect(cart.subtotal, closeTo(360.0, 0.001));

      cart.updateQuantity('prod-1', 3, variantId: 'v-250');
      expect(cart.itemCount, 5);
      expect(cart.subtotal, closeTo(520.0, 0.001));

      cart.remove('prod-1', variantId: 'v-250');
      expect(cart.items.length, 1);
      expect(cart.items.first.variantId, 'v-500');

      cart.clear(syncServer: false);
      expect(cart.items, isEmpty);
      expect(cart.itemCount, 0);
      expect(cart.subtotal, 0.0);
    });

    test('computes delivery fee for Accra, Nationwide, Pickup, and free-over threshold', () {
      cart.updateDeliverySettings(feeFlat: 15.0, feeAccra: 10.0, freeOver: 200.0);
      expect(cart.computeDeliveryFee(region: 'Greater Accra'), 0.0);

      cart.add(lotion, quantity: 1); // subtotal 80
      expect(cart.computeDeliveryFee(region: 'Greater Accra'), 10.0);
      expect(cart.computeDeliveryFee(region: 'Ashanti'), 15.0);
      expect(cart.computeDeliveryFee(region: 'Ashanti', isPickup: true), 0.0);

      cart.add(lotion, quantity: 2); // subtotal 240 >= 200
      expect(cart.computeDeliveryFee(region: 'Ashanti'), 0.0);
      expect(cart.computeDeliveryFee(region: 'Greater Accra'), 0.0);
    });

    test('builds authenticated and guest order payloads accurately', () {
      cart.add(lotion, quantity: 2, variantId: 'v-1', variantLabel: '250ml', priceOverride: 80.0);

      final authPayload = cart.toOrderPayload(
        shippingAddress: '12 Oxford Street',
        shippingCity: 'Accra',
        shippingRegion: 'Greater Accra',
        phone: '+233240000000',
        notes: 'Call on arrival',
        couponCode: 'WELCOME10',
      );
      expect(authPayload['shipping_region'], 'Greater Accra');
      expect(authPayload['coupon_code'], 'WELCOME10');
      expect(authPayload['notes'], 'Phone: +233240000000\nCall on arrival');

      final guestPayload = cart.toGuestOrderPayload(
        email: 'guest@example.com',
        firstName: 'Ama',
        lastName: 'Mensah',
        phone: '+233240000000',
        shippingAddress: '12 Oxford Street',
        shippingCity: 'Accra',
        shippingRegion: 'Greater Accra',
        deliveryFee: 10.0,
        couponCode: 'WELCOME10',
      );
      expect(guestPayload['email'], 'guest@example.com');
      expect(guestPayload['delivery_fee'], 10.0);
      expect(guestPayload['coupon_code'], 'WELCOME10');
      final items = guestPayload['items'] as List;
      expect(items.length, 1);
      expect((items.first as Map)['variant_id'], 'v-1');
      expect((items.first as Map)['variant_label'], '250ml');
    });
  });

  group('getPasswordStrength', () {
    test('scores all 4 rules consistently with Web PasswordStrength.jsx', () {
      expect(getPasswordStrength('abc').score, 0);
      expect(getPasswordStrength('abcdefgh').score, 1); // length only
      expect(getPasswordStrength('Abcdefgh').score, 2); // + uppercase
      expect(getPasswordStrength('Abcdefg1').score, 3); // + digit
      expect(getPasswordStrength('Abcdef1!').score, 4); // + special char
    });
  });

  group('Product.fromJson', () {
    test('parses active_promotion and computes effectiveDiscountPercent', () {
      final p = Product.fromJson({
        'id': 'p1',
        'name': 'Cocoa Butter',
        'description': 'Pure cocoa butter',
        'price': 100,
        'stock_quantity': 8,
        'active_promotion': {
          'name': 'Flash Sale',
          'discounted_price': 75,
          'ends_at': '2026-12-31T23:59:59Z',
        },
      });
      expect(p.price, 75.0);
      expect(p.originalPrice, 100.0);
      expect(p.promoName, 'Flash Sale');
      expect(p.isOnSale, isTrue);
      expect(p.effectiveDiscountPercent, 25);
    });
  });

  group('Order.fromJson', () {
    test('derives refundHint, refundMessage, and isTerminal accurately', () {
      final cancelledPaid = Order.fromJson({
        'id': 'o1',
        'order_number': 'BC-0001',
        'status': 'cancelled',
        'payment_status': 'paid',
        'total_amount': 120,
        'created_at': '2026-11-20T10:00:00Z',
      });
      expect(cancelledPaid.isTerminal, isTrue);
      expect(cancelledPaid.refundHint, 'Refund may be pending');
      expect(cancelledPaid.refundMessage, 'This order was cancelled. A refund may be pending.');

      final refunded = Order.fromJson({
        'id': 'o2',
        'order_number': 'BC-0002',
        'status': 'refunded',
        'payment_status': 'paid',
        'refund_status': 'success',
        'total_amount': 120,
        'created_at': '2026-11-20T10:00:00Z',
      });
      expect(refunded.isTerminal, isTrue);
      expect(refunded.refundHint, 'Refunded');
      expect(refunded.refundMessage, 'Refunded');

      final active = Order.fromJson({
        'id': 'o3',
        'order_number': 'BC-0003',
        'status': 'processing',
        'payment_status': 'paid',
        'total_amount': 90,
        'created_at': '2026-11-20T10:00:00Z',
      });
      expect(active.isTerminal, isFalse);
      expect(active.refundHint, '');
      expect(active.refundMessage, isNull);

      final partiallyRefunded = Order.fromJson({
        'id': 'o4',
        'order_number': 'BC-0004',
        'status': 'delivered',
        'payment_status': 'partially_refunded',
        'refund_amount': 50.0,
        'total_amount': 150.0,
        'created_at': '2026-11-20T10:00:00Z',
      });
      expect(partiallyRefunded.isTerminal, isFalse);
      expect(partiallyRefunded.refundHint, '${AppConfig.currencySymbol}50.00 refunded');
      expect(partiallyRefunded.refundMessage, '${AppConfig.currencySymbol}50.00 refunded so far');
    });

    test('tolerates null delivered_at, null tracking_number, string/numeric amounts, pickup, and all return statuses', () {
      // 1. Numeric fields as strings, null delivered_at, null tracking_number, omitted id (track endpoint for paid order)
      final stringNumsOrder = Order.fromJson({
        'order_number': 'ORD-23456789',
        'status': 'shipped',
        'payment_status': 'partially_refunded',
        'fulfillment_method': 'delivery',
        'total_amount': '250.50',
        'delivery_fee': '20.00',
        'discount_amount': '15.25',
        'refund_amount': '50.25',
        'delivered_at': null,
        'delivery': {
          'delivery_partner': 'DHL Ghana',
          'tracking_number': null,
        },
        'items': [
          {
            'id': 'item-1',
            'product_id': 'p-1',
            'product_name': 'Cocoa Body Butter',
            'quantity': '2',
            'price_at_purchase': '115.25',
            'subtotal': '230.50',
          },
        ],
        'created_at': '2026-11-20T10:00:00Z',
      });
      expect(stringNumsOrder.id, '');
      expect(stringNumsOrder.orderNumber, 'ORD-23456789');
      expect(stringNumsOrder.deliveredAt, isNull);
      expect(stringNumsOrder.trackingNumber, isNull);
      expect(stringNumsOrder.isPickup, isFalse);
      expect(stringNumsOrder.totalAmount, closeTo(250.50, 0.001));
      expect(stringNumsOrder.deliveryFee, closeTo(20.00, 0.001));
      expect(stringNumsOrder.discountAmount, closeTo(15.25, 0.001));
      expect(stringNumsOrder.refundAmount, closeTo(50.25, 0.001));
      expect(stringNumsOrder.items.first.id, 'item-1');
      expect(stringNumsOrder.items.first.quantity, 2);
      expect(stringNumsOrder.items.first.priceAtPurchase, closeTo(115.25, 0.001));
      expect(stringNumsOrder.items.first.subtotal, closeTo(230.50, 0.001));

      // 2. Numeric fields as numbers, pickup fulfillment, valid delivered_at
      final numOrder = Order.fromJson({
        'id': 'ord-num-1',
        'order_number': 'ORD-100042',
        'status': 'delivered',
        'payment_status': 'paid',
        'fulfillment_method': 'pickup',
        'total_amount': 180,
        'delivery_fee': 0,
        'discount_amount': 10,
        'refund_amount': 0,
        'delivered_at': '2026-11-21T09:30:00Z',
        'created_at': '2026-11-20T10:00:00Z',
      });
      expect(numOrder.isPickup, isTrue);
      expect(numOrder.deliveredAt, isNotNull);
      expect(numOrder.totalAmount, 180.0);
      expect(numOrder.deliveryFee, 0.0);

      // 3. ReturnRequest & ReturnRequestItem with string & number line_refund_amount + all 6 return statuses
      const returnStatuses = [
        'pending',
        'rejected',
        'refund_pending',
        'refunded',
        'refund_failed',
        'cancelled',
      ];
      for (final st in returnStatuses) {
        final rr = ReturnRequest.fromJson({
          'id': 'ret-$st',
          'order_id': 'ord-num-1',
          'status': st,
          'reason': 'Damaged seal',
          'refund_amount': st == 'pending' ? '45.75' : 45.75,
          'items': [
            {
              'id': 'rri-1',
              'order_item_id': 'item-1',
              'product_name': 'Cocoa Body Butter',
              'quantity': '1',
              'unit_refund_amount': '45.75',
              'line_refund_amount': st == 'pending' ? '45.75' : 45.75,
            },
          ],
        });
        expect(rr.status, st);
        expect(rr.refundAmount, closeTo(45.75, 0.001));
        expect(rr.items.first.lineRefundAmount, closeTo(45.75, 0.001));
        final (chipLabel, _, _) = StatusChip.resolve(st);
        expect(chipLabel.isNotEmpty, isTrue);
      }
      final (partChipLabel, _, _) = StatusChip.resolve('partially_refunded');
      expect(partChipLabel, 'Partially Refunded');
    });

    test('normalizes new base32 and legacy numeric order numbers and maps HTTP errors centrally', () {
      expect(ApiService.normalizeOrderNumber('  #ord-23456789 '), 'ORD-23456789');
      expect(ApiService.normalizeOrderNumber('##ORD-998877'), 'ORD-998877');
      expect(ApiService.normalizeOrderNumber('ord-20240429-0012'), 'ORD-20240429-0012');

      expect(ApiService.defaultStatusMessage(400), contains('Invalid request'));
      expect(ApiService.defaultStatusMessage(401), contains('Session expired'));
      expect(ApiService.defaultStatusMessage(403), contains('permission'));
      expect(ApiService.defaultStatusMessage(404), contains('not found'));
      expect(ApiService.defaultStatusMessage(409), contains('conflicts'));
      expect(ApiService.defaultStatusMessage(429, retryAfter: 30), contains('30 seconds'));
      expect(ApiService.defaultStatusMessage(502), contains('Server error'));
      expect(
        ApiService.formatError(const ApiException(400, 'Return window of 14 days has expired')),
        'Return window of 14 days has expired',
      );

      // Exact required order number strings through normalizeOrderNumber and TrackOrderScreen.validateOrderNumber
      const sampleInputs = <String, String>{
        'ORD-1795247768659': 'ORD-1795247768659',
        'ord-gcb7irgj': 'ORD-GCB7IRGJ',
        '#ORD-GCB7IRGJ': 'ORD-GCB7IRGJ',
        ' #ord-gcb7irgj ': 'ORD-GCB7IRGJ',
      };
      sampleInputs.forEach((raw, expected) {
        expect(ApiService.normalizeOrderNumber(raw), expected);
        expect(TrackOrderScreen.validateOrderNumber(raw), isNull);
      });
      expect(TrackOrderScreen.validateOrderNumber('   ###   '), isNotNull);

      // 429 Retry-After header parsing: header present, header missing, non-numeric header
      final errWithHeader = ApiService.parseErrorResponse(
        http.Response('', 429, headers: {'retry-after': '42'}),
      );
      expect(errWithHeader.statusCode, 429);
      expect(errWithHeader.retryAfter, 42);
      expect(errWithHeader.message, contains('42 seconds'));

      final errMissingHeader = ApiService.parseErrorResponse(
        http.Response('', 429),
      );
      expect(errMissingHeader.statusCode, 429);
      expect(errMissingHeader.retryAfter, 60);
      expect(errMissingHeader.message, contains('60 seconds'));

      final errNonNumericHeader = ApiService.parseErrorResponse(
        http.Response('', 429, headers: {'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT'}),
      );
      expect(errNonNumericHeader.statusCode, 429);
      expect(errNonNumericHeader.retryAfter, 60);
      expect(errNonNumericHeader.message, contains('60 seconds'));
    });
  });

  group('ThemeProvider & parseHexColor', () {
    test('parses 6-digit, 3-digit, and invalid hex strings safely', () {
      expect(parseHexColor('#c9a55a', AppColors.primary), const Color(0xFFC9A55A));
      expect(parseHexColor('#fff', AppColors.primary), const Color(0xFFFFFFFF));
      expect(parseHexColor('not-a-color', AppColors.primary), AppColors.primary);
      expect(parseHexColor(null, AppColors.accent), AppColors.accent);
    });

    test('applies Admin theme settings to ThemeData dynamically', () {
      SharedPreferences.setMockInitialValues({});
      final tp = ThemeProvider();
      tp.applyFromSettings({
        'theme_color_primary': '#2c1810',
        'theme_color_accent': '#d4af37',
        'theme_color_accent_dark': '#9c7c19',
        'theme_color_bg': '#f5f0e6',
        'theme_color_blush': '#faece6',
      });
      expect(tp.primary, const Color(0xFF2C1810));
      expect(tp.accent, const Color(0xFFD4AF37));
      expect(tp.themeData.scaffoldBackgroundColor, const Color(0xFFF5F0E6));
      expect(tp.themeData.colorScheme.primary, const Color(0xFF2C1810));
      expect(tp.themeData.colorScheme.secondary, const Color(0xFFD4AF37));
    });
  });

  group('AppConfig.isReleaseSafeUrl & validateConfig', () {
    test('accepts public HTTPS URLs and rejects HTTP, localhost, and LAN IPs', () {
      expect(AppConfig.isReleaseSafeUrl('https://api.example.com/api'), isTrue);
      expect(AppConfig.isReleaseSafeUrl('http://192.168.1.153:3000/api'), isFalse);
      expect(AppConfig.isReleaseSafeUrl('https://192.168.1.153/api'), isFalse);
      expect(AppConfig.isReleaseSafeUrl('http://10.0.2.2:3000/api'), isFalse);
      expect(AppConfig.isReleaseSafeUrl('https://10.0.0.5/api'), isFalse);
      expect(AppConfig.isReleaseSafeUrl('https://localhost:5173'), isFalse);
      expect(AppConfig.isReleaseSafeUrl(''), isFalse);
    });

    test('validateConfig throws StateError in release mode for localhost, *.local, LAN, link-local, ::1, and fc00::/7', () {
      const rejectedUrls = [
        'http://192.168.1.153:3000/api',
        'https://192.168.1.153/api',
        'https://localhost/api',
        'https://myhost.local/api',
        'https://169.254.169.254/api',
        'https://[::1]/api',
        'https://[fc00::1]/api',
        'https://[fd12:3456::1]/api',
      ];
      for (final badUrl in rejectedUrls) {
        expect(
          () => AppConfig.validateConfig(
            isRelease: true,
            hasApiUrlOverride: true,
            apiUrlOverride: badUrl,
            hasStorefrontUrlOverride: true,
            storefrontUrlOverride: 'https://shop.example.com',
          ),
          throwsStateError,
          reason: 'Expected validateConfig to reject $badUrl in release mode',
        );
      }
      expect(
        () => AppConfig.validateConfig(
          isRelease: true,
          hasApiUrlOverride: true,
          apiUrlOverride: 'https://api.example.com/api',
          hasStorefrontUrlOverride: true,
          storefrontUrlOverride: 'https://shop.example.com',
        ),
        returnsNormally,
      );
    });
  });
}
