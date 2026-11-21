import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/wishlist_provider.dart';
import 'package:cosmetics_app/screens/shop_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

void main() {
  testWidgets(
    'ShopScreen moves 20+ categories into hamburger side drawer and filters on tap',
    (tester) async {
      final requestedCategories = <String?>[];
      final products = List.generate(25, (i) {
        final n = i + 1;
        return {
          'id': 'prod-$n',
          'name': 'Shea Product $n',
          'price': 50.0 + n,
          'stock_quantity': 10,
          'is_active': true,
          'category': 'Group $n',
        };
      });

      final mockClient = MockClient((req) async {
        final path = req.url.path;
        if (path.endsWith('/api/products') && req.method == 'GET') {
          final cat = req.url.queryParameters['category'];
          requestedCategories.add(cat);
          final list = cat == null
              ? products
              : products.where((p) => p['category'] == cat).toList();
          return http.Response(
            jsonEncode({
              'products': list,
              'total': list.length,
              'pages': 1,
            }),
            200,
          );
        }
        if (path.endsWith('/api/products/suggest') && req.method == 'GET') {
          return http.Response(jsonEncode({'suggestions': []}), 200);
        }
        return http.Response(jsonEncode({'error': 'Unexpected $path'}), 404);
      });

      ApiService.instance.configureForTesting(client: mockClient);

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
            ChangeNotifierProvider<WishlistProvider>(
              create: (_) => WishlistProvider(),
            ),
          ],
          child: const MaterialApp(home: ShopScreen()),
        ),
      );
      await tester.pumpAndSettle();

      // Category chip row is no longer shown under the search bar
      expect(find.text('Group 22'), findsNothing);

      // Open hamburger side drawer
      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();

      expect(find.text('OUR CATEGORIES'), findsOneWidget);
      expect(find.text('See All'), findsOneWidget);

      // Scroll inside drawer to Group 22 and tap it
      await tester.scrollUntilVisible(
        find.text('Group 22'),
        150,
        scrollable: find.descendant(
          of: find.byType(Drawer),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.drag(
        find.descendant(
          of: find.byType(Drawer),
          matching: find.byType(ListView),
        ),
        const Offset(0, -100),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Group 22'));
      await tester.pumpAndSettle();

      expect(requestedCategories, contains('Group 22'));
      expect(find.widgetWithText(InputChip, 'Group 22'), findsOneWidget);
    },
  );
}
