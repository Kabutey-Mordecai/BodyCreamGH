import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:cosmetics_app/models/product.dart';
import 'package:cosmetics_app/providers/auth_provider.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/wishlist_provider.dart';
import 'package:cosmetics_app/screens/product_detail_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

void main() {
  test('ProductVariant.fromJson parses option_values and compare_at_price', () {
    final variant = ProductVariant.fromJson({
      'id': 'var-1',
      'price': '120.00',
      'compare_at_price': '150.00',
      'stock_quantity': 4,
      'option_values': [
        {'option_type_name': 'Size', 'value': 'Large'},
      ],
    });

    expect(variant.label, 'Large');
    expect(variant.optionTypeName, 'Size');
    expect(variant.price, 120.0);
    expect(variant.compareAtPrice, 150.0);
    expect(variant.inStock, true);
  });

  testWidgets(
    'ProductDetailScreen displays variation boxes and updates price on tap',
    (tester) async {
      final mockClient = MockClient((req) async {
        final path = req.url.path;
        if (path.endsWith('/api/products/prod-1') && req.method == 'GET') {
          return http.Response(
            jsonEncode({
              'id': 'prod-1',
              'name': 'Shea Butter Jar',
              'description': 'Whipped shea butter',
              'price': '55.00',
              'stock_quantity': 10,
              'has_variants': true,
              'min_price': '55.00',
            }),
            200,
          );
        }
        if (path.endsWith('/api/products/prod-1/variants') &&
            req.method == 'GET') {
          return http.Response(
            jsonEncode({
              'option_types': [
                {'id': 'ot-1', 'name': 'Size', 'values': []}
              ],
              'variants': [
                {
                  'id': 'v-xs',
                  'price': '40.00',
                  'stock_quantity': 0,
                  'option_values': [
                    {'option_type_name': 'Size', 'value': 'XS'}
                  ],
                },
                {
                  'id': 'v-sm',
                  'price': '55.00',
                  'stock_quantity': 8,
                  'option_values': [
                    {'option_type_name': 'Size', 'value': 'Small'}
                  ],
                },
                {
                  'id': 'v-lg',
                  'price': '120.00',
                  'compare_at_price': '140.00',
                  'stock_quantity': 5,
                  'option_values': [
                    {'option_type_name': 'Size', 'value': 'Large'}
                  ],
                },
              ],
            }),
            200,
          );
        }
        if (path.endsWith('/api/products/prod-1/related')) {
          return http.Response(jsonEncode([]), 200);
        }
        if (path.endsWith('/api/reviews/product/prod-1')) {
          return http.Response(
            jsonEncode({
              'reviews': [],
              'total': 0,
              'totalPages': 1,
              'summary': {'average': 0, 'total': 0},
            }),
            200,
          );
        }
        if (path.endsWith('/api/settings')) {
          return http.Response(jsonEncode({}), 200);
        }
        return http.Response(jsonEncode({}), 200);
      });

      ApiService.instance.configureForTesting(client: mockClient);

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
            ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
            ChangeNotifierProvider<WishlistProvider>(
              create: (_) => WishlistProvider(),
            ),
          ],
          child: const MaterialApp(
            home: ProductDetailScreen(productId: 'prod-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Should display VARIATION AVAILABLE · SIZE and pre-select first in-stock (Small)
      expect(find.text('VARIATION AVAILABLE · SIZE'), findsOneWidget);
      expect(find.text('Small · ₵55.00'), findsOneWidget);
      expect(find.text('₵55.00'), findsOneWidget);

      // Out-of-stock XS should be rendered with lineThrough
      final xsText = tester.widget<Text>(find.text('XS'));
      expect(xsText.style?.decoration, TextDecoration.lineThrough);

      // Tap Large and verify price updates to ₵120.00
      await tester.scrollUntilVisible(
        find.text('Large'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Large'));
      await tester.pumpAndSettle();

      expect(find.text('Large · ₵120.00'), findsOneWidget);
      expect(find.text('₵120.00'), findsOneWidget);
      expect(find.text('₵140.00'), findsOneWidget);
    },
  );
}
