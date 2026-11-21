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
    'ShopScreen caps inline category chips and opens searchable picker for 20+ groups',
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

      // Overflow chip is shown and Group 22 is NOT in the initial inline bar
      final moreChip = find.byKey(const ValueKey('more-categories-chip'));
      expect(moreChip, findsOneWidget);
      expect(find.text('Group 22'), findsNothing);

      // Open searchable category picker bottom sheet
      await tester.tap(moreChip);
      await tester.pumpAndSettle();

      final searchField = find.byKey(const ValueKey('category-search-field'));
      expect(searchField, findsOneWidget);

      await tester.enterText(searchField, 'Group 22');
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(ListTile, 'Group 22'));
      await tester.pumpAndSettle();

      expect(requestedCategories, contains('Group 22'));
      // Selected deep category is now pinned in the inline chip bar
      expect(find.widgetWithText(FilterChip, 'Group 22'), findsOneWidget);
    },
  );
}
