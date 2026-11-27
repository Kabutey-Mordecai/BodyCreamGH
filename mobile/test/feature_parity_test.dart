import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cosmetics_app/data/ghana_locations.dart';
import 'package:cosmetics_app/models/product.dart';
import 'package:cosmetics_app/models/user.dart';
import 'package:cosmetics_app/providers/auth_provider.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/wishlist_provider.dart';
import 'package:cosmetics_app/screens/checkout_screen.dart';
import 'package:cosmetics_app/screens/order_detail_screen.dart';
import 'package:cosmetics_app/screens/shop_screen.dart';
import 'package:cosmetics_app/screens/track_order_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

http.Response _jsonRes(Object body, [int status = 200]) {
  return http.Response(
    jsonEncode(body),
    status,
    headers: {'content-type': 'application/json'},
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Ghana Locations Directory Unit Tests', () {
    test('contains all 16 Ghanaian regions', () {
      final regions = getGhanaRegions();
      expect(regions.length, 16);
      expect(regions, contains('Greater Accra'));
      expect(regions, contains('Ashanti'));
      expect(regions, contains('Western'));
      expect(regions, contains('Central'));
      expect(regions, contains('Eastern'));
      expect(regions, contains('Northern'));
      expect(regions, contains('Volta'));
    });

    test('Greater Accra contains Ashaiman with standalone suburbs', () {
      final areas = getAreasForRegion('Greater Accra');
      expect(areas, contains('Ashaiman'));
      expect(areas, contains('Accra Central'));
      expect(areas, contains('East Legon & Adjiringanor'));

      final ashaimanTowns = getTownsForArea('Greater Accra', 'Ashaiman');
      expect(ashaimanTowns, isNotEmpty);
      expect(ashaimanTowns, contains('Zenu'));
      expect(ashaimanTowns, contains('Atadeka'));
      expect(ashaimanTowns, contains('Official Town Ashaiman'));
      expect(ashaimanTowns, contains('Lebanon Zone 1'));

      // Ensure zero slashes or compound groupings inside towns
      for (final town in ashaimanTowns) {
        expect(town.contains('/'), isFalse, reason: 'Town $town should not have slashes');
      }

      final eastLegonTowns = getTownsForArea('Greater Accra', 'East Legon & Adjiringanor');
      expect(eastLegonTowns, contains('East Legon'));
      expect(eastLegonTowns, contains('Adjiringanor'));
    });

    test('Unknown region returns empty areas and towns safely', () {
      expect(getAreasForRegion('Atlantis'), isEmpty);
      expect(getTownsForArea('Atlantis', 'Nowhere'), isEmpty);
    });
  });

  group('Checkout Ghana Location & Payment Badges Widget Tests', () {
    testWidgets('renders cascading location selectors and payment badges', (tester) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() => tester.view.resetPhysicalSize());

      ApiService.instance.configureForTesting(
        client: MockClient((req) async {
          if (req.url.path.endsWith('/settings')) {
            return _jsonRes({
              'delivery_fee_accra': 15,
              'delivery_fee_flat': 30,
              'free_delivery_over': 300,
              'pickup_enabled': true,
              'pickup_location': 'East Legon, Accra',
              'pay_on_delivery_enabled': true,
              'guest_checkout_enabled': true,
            });
          }
          if (req.url.path.endsWith('/newsletter/status')) {
            return _jsonRes({'eligibleForWelcomeDiscount': false});
          }
          if (req.url.path.endsWith('/cart/guest-validate')) {
            return _jsonRes({
              'valid': true,
              'items': [
                {
                  'product_id': 'p1',
                  'name': 'Glow Body Cream',
                  'quantity': 1,
                  'price': '85.00',
                  'subtotal': '85.00',
                }
              ],
            });
          }
          return _jsonRes({});
        }),
      );

      final cart = CartProvider();
      cart.add(
        const Product(
          id: 'p1',
          name: 'Glow Body Cream',
          description: 'Rich moisturizing cream',
          price: 85.0,
          stockQuantity: 10,
        ),
      );

      final auth = AuthProvider();
      auth.setMockUser(
        const User(
          id: 'usr-1',
          firstName: 'Kofi',
          lastName: 'Mensah',
          email: 'kofi@example.com',
          role: 'customer',
        ),
      );

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider.value(value: auth),
          ],
          child: const MaterialApp(
            home: CheckoutScreen(),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Verify cascading dropdowns are present
      expect(find.text('1. Region *'), findsOneWidget);
      expect(find.text('2. Area / District *'), findsOneWidget);
      expect(find.text('3. Town / Neighborhood *'), findsOneWidget);

      // Verify Ghanaian payment network badges are rendered
      expect(find.text('Ghanaian Instant Payment Networks Supported'), findsOneWidget);
      expect(find.text('MTN MoMo'), findsOneWidget);
      expect(find.text('Telecel Cash'), findsOneWidget);
      expect(find.text('AT Money'), findsOneWidget);
      expect(find.text('Visa / Mastercard'), findsOneWidget);
      expect(find.text('Paystack Secured'), findsOneWidget);
    });
  });

  group('Doorstep Delivery Code (OTP) Security Widget Tests', () {
    testWidgets('TrackOrderScreen renders Doorstep Delivery Code when order has OTP', (tester) async {
      ApiService.instance.configureForTesting(
        client: MockClient((req) async {
          if (req.method == 'POST' && req.url.path.endsWith('/orders/track')) {
            return _jsonRes({
              'order_number': 'ORD-OTP999',
              'status': 'shipped',
              'payment_status': 'paid',
              'fulfillment_method': 'delivery',
              'total_amount': '150.00',
              'delivery': {
                'delivery_partner': 'Speedy Rider',
                'tracking_number': 'TRK-12345',
                'pod_otp': '984321',
              },
              'items': [
                {
                  'product_id': 'p1',
                  'product_name': 'Moisturizing Cream',
                  'quantity': 1,
                  'price_at_purchase': '150.00',
                },
              ],
              'created_at': '2026-11-25T12:00:00Z',
            });
          }
          return _jsonRes({}, 404);
        }),
      );

      await tester.pumpWidget(const MaterialApp(home: TrackOrderScreen()));
      await tester.enterText(find.byType(TextFormField).first, 'ORD-OTP999');
      await tester.enterText(find.byType(TextFormField).last, 'buyer@example.com');
      await tester.tap(find.text('Track Order'));
      await tester.pumpAndSettle();

      // Check OTP card
      expect(find.text('Doorstep Delivery Code'), findsOneWidget);
      expect(find.text('984321'), findsOneWidget);
      expect(find.textContaining('Share this 6-digit code ONLY with your dispatch rider'), findsOneWidget);
    });

    testWidgets('OrderDetailScreen renders Doorstep Delivery Code for customer inspection', (tester) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() => tester.view.resetPhysicalSize());

      ApiService.instance.configureForTesting(
        accessToken: 'test-token',
        client: MockClient((req) async {
          if (req.method == 'GET' && (req.url.path.endsWith('/deliveries/order/ord-123') || req.url.path.endsWith('/orders/ord-123/delivery'))) {
            return _jsonRes({
              'delivery_partner': 'Express Courier',
              'tracking_number': 'EX-9988',
              'otp': '654321',
            });
          }
          if (req.method == 'GET' && (req.url.path.endsWith('/orders/ord-123/log') || req.url.path.endsWith('/orders/ord-123/status-log'))) {
            return _jsonRes([]);
          }
          if (req.method == 'GET' && req.url.path.endsWith('/orders/ord-123')) {
            return _jsonRes({
              'id': 'ord-123',
              'order_number': 'ORD-123',
              'status': 'shipped',
              'payment_status': 'paid',
              'fulfillment_method': 'delivery',
              'total_amount': '150.00',
              'delivery': {
                'delivery_partner': 'Express Courier',
                'tracking_number': 'EX-9988',
                'otp': '654321',
              },
              'items': [
                {
                  'product_id': 'p1',
                  'name': 'Rosehip Radiance Oil',
                  'quantity': 1,
                  'price': '150.00',
                },
              ],
              'created_at': '2026-11-25T12:00:00Z',
            });
          }
          if (req.url.path.endsWith('/settings')) {
            return _jsonRes({});
          }
          return _jsonRes({});
        }),
      );

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider(create: (_) => AuthProvider()),
            ChangeNotifierProvider(create: (_) => CartProvider()),
          ],
          child: const MaterialApp(
            home: OrderDetailScreen(orderId: 'ord-123'),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('Doorstep Delivery Code'), findsOneWidget);
      expect(find.text('654321'), findsOneWidget);
    });
  });

  group('ShopScreen Deals & Brand Filter Tests', () {
    testWidgets('ShopScreen activates Deals / On Sale when initialOnSale is true', (tester) async {
      String? queriedOnSale;
      String? queriedBrand;

      ApiService.instance.configureForTesting(
        client: MockClient((req) async {
          if (req.url.path.endsWith('/products')) {
            queriedOnSale = req.url.queryParameters['on_sale'];
            queriedBrand = req.url.queryParameters['brand'];
            return _jsonRes({
              'products': [
                {
                  'id': 'deal-1',
                  'name': 'Sale Shea Lotion',
                  'price': '45.00',
                  'compare_at_price': '60.00',
                  'stock_quantity': 10,
                  'brand': 'Nivea',
                  'is_on_sale': true,
                }
              ],
              'total': 1,
            });
          }
          if (req.url.path.endsWith('/products/facets')) {
            return _jsonRes({
              'categories': [],
              'brands': [{'brand': 'Nivea', 'count': 1}],
              'price': {'min': 10, 'max': 100},
            });
          }
          if (req.url.path.endsWith('/settings')) {
            return _jsonRes({'store_name': 'BodyCream GH'});
          }
          return _jsonRes({});
        }),
      );

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider(create: (_) => CartProvider()),
            ChangeNotifierProvider(create: (_) => WishlistProvider()),
          ],
          child: const MaterialApp(
            home: ShopScreen(
              initialOnSale: true,
              initialBrand: 'Nivea',
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(queriedOnSale, 'true');
      expect(queriedBrand, 'Nivea');
      expect(find.text('Sale Shea Lotion'), findsOneWidget);
      expect(find.text('Deals / On Sale'), findsOneWidget);
    });
  });
}
