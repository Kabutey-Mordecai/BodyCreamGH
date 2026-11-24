import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:cosmetics_app/models/product.dart';
import 'package:cosmetics_app/providers/auth_provider.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/wishlist_provider.dart';
import 'package:cosmetics_app/screens/account_screen.dart';
import 'package:cosmetics_app/screens/cart_screen.dart';
import 'package:cosmetics_app/screens/checkout_screen.dart';
import 'package:cosmetics_app/screens/wishlist_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

void main() {
  test('getPendingReviewPrompts hits /api/reviews/pending-prompts', () async {
    Uri? requestedUri;
    final mockClient = MockClient((req) async {
      requestedUri = req.url;
      return http.Response(jsonEncode({'prompts': []}), 200);
    });
    ApiService.instance.configureForTesting(
      client: mockClient,
      accessToken: 'tok',
    );

    await ApiService.instance.getPendingReviewPrompts();
    expect(requestedUri?.path, '/api/reviews/pending-prompts');
  });

  testWidgets('CartScreen syncs delivery settings from getSettings on init',
      (tester) async {
    final mockClient = MockClient((req) async {
      if (req.url.path.endsWith('/api/settings')) {
        return http.Response(
          jsonEncode({
            'delivery_fee_flat': 30,
            'delivery_fee_accra': 15,
            'free_delivery_over': 500,
          }),
          200,
        );
      }
      return http.Response('{}', 200);
    });
    ApiService.instance.configureForTesting(client: mockClient);

    final cart = CartProvider();
    await tester.pumpWidget(
      ChangeNotifierProvider<CartProvider>.value(
        value: cart,
        child: const MaterialApp(home: CartScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(cart.deliveryFeeFlat, 30);
    expect(cart.deliveryFeeAccra, 15);
    expect(cart.freeDeliveryOver, 500);
  });

  testWidgets(
      'CheckoutScreen does not redirect guest to /login when getSettings fails',
      (tester) async {
    final mockClient = MockClient((req) async {
      if (req.url.path.endsWith('/api/settings')) {
        return http.Response('Server Error', 500);
      }
      return http.Response('{}', 200);
    });
    ApiService.instance.configureForTesting(client: mockClient);

    final router = GoRouter(
      initialLocation: '/checkout',
      routes: [
        GoRoute(
          path: '/checkout',
          builder: (_, __) => const CheckoutScreen(),
        ),
        GoRoute(
          path: '/login',
          builder: (_, __) => const Scaffold(body: Text('LOGIN_PAGE')),
        ),
      ],
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AuthProvider()),
          ChangeNotifierProvider(create: (_) => CartProvider()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('LOGIN_PAGE'), findsNothing);
    expect(find.text('Could not load checkout settings'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets(
      'AccountScreen reads store_phone/email and gates Pickup & POD badges',
      (tester) async {
    final mockClient = MockClient((req) async {
      if (req.url.path.endsWith('/api/settings')) {
        return http.Response(
          jsonEncode({
            'store_phone': '+233 55 000 1111',
            'store_email': 'care@glowhaus.gh',
            'pickup_enabled': false,
            'pay_on_delivery_enabled': true,
          }),
          200,
        );
      }
      return http.Response('{}', 200);
    });
    ApiService.instance.configureForTesting(client: mockClient);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AuthProvider()),
          ChangeNotifierProvider(create: (_) => WishlistProvider()),
        ],
        child: const MaterialApp(home: AccountScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('+233 55 000 1111'), findsOneWidget);
    expect(find.text('care@glowhaus.gh'), findsOneWidget);
    expect(find.text('🏪 Pickup Station'), findsNothing);
    expect(find.text('💵 Pay on Delivery'), findsOneWidget);
  });

  testWidgets(
      'WishlistScreen opens product detail when hasVariants is true instead of adding to cart',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final wishlist = WishlistProvider();
    final cart = CartProvider();
    final product = Product(
      id: 'prod-var-1',
      name: 'Shea Butter',
      description: 'Rich shea butter',
      price: 50,
      stockQuantity: 10,
      hasVariants: true,
    );
    wishlist.toggle(product);

    final router = GoRouter(
      initialLocation: '/wishlist',
      routes: [
        GoRoute(
          path: '/wishlist',
          builder: (_, __) => const WishlistScreen(),
        ),
        GoRoute(
          path: '/product/:id',
          builder: (_, state) =>
              Scaffold(body: Text('DETAIL:${state.pathParameters['id']}')),
        ),
      ],
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<WishlistProvider>.value(value: wishlist),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Select Options →'));
    await tester.tap(find.text('Select Options →'));
    await tester.pumpAndSettle();

    expect(cart.items, isEmpty);
    expect(find.text('DETAIL:prod-var-1'), findsOneWidget);
  });
}
