import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cosmetics_app/models/order.dart';
import 'package:cosmetics_app/models/product.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/theme_provider.dart';
import 'package:cosmetics_app/theme/app_theme.dart';
import 'package:cosmetics_app/widgets/password_strength.dart';

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
}
