import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:cosmetics_app/providers/auth_provider.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';
import 'package:cosmetics_app/providers/wishlist_provider.dart';
import 'package:cosmetics_app/screens/product_detail_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

class _LoggedInAuthProvider extends AuthProvider {
  @override
  bool get isLoggedIn => true;

  @override
  AuthStatus get status => AuthStatus.authenticated;
}

void main() {
  testWidgets(
    'Write Review sheet renders 429 and 400 errors inline inside the sheet',
    (tester) async {
      int postAttempt = 0;

      final mockClient = MockClient((req) async {
        final path = req.url.path;
        if (path.endsWith('/api/products/prod-1') && req.method == 'GET') {
          return http.Response(
            jsonEncode({
              'product': {
                'id': 'prod-1',
                'name': 'Shea Body Butter',
                'description': 'Rich Ghanaian shea butter.',
                'price': 85.0,
                'stock_quantity': 12,
                'is_active': true,
                'category_name': 'Body Care',
                'images': [],
                'variants': [],
              },
            }),
            200,
          );
        }
        if (path.endsWith('/api/products/prod-1/reviews') &&
            req.method == 'GET') {
          return http.Response(
            jsonEncode({
              'reviews': [],
              'average_rating': 0,
              'total_reviews': 0,
            }),
            200,
          );
        }
        if (path.endsWith('/api/products/prod-1/can-review') &&
            req.method == 'GET') {
          return http.Response(
            jsonEncode({'can_review': true, 'already_reviewed': false}),
            200,
          );
        }
        if (path.endsWith('/api/products') && req.method == 'GET') {
          return http.Response(jsonEncode({'products': []}), 200);
        }
        if (path.endsWith('/api/products/prod-1/reviews') &&
            req.method == 'POST') {
          postAttempt += 1;
          if (postAttempt == 1) {
            return http.Response(
              jsonEncode({
                'error': 'Too many reviews submitted. Please try again later.',
              }),
              429,
            );
          }
          return http.Response(
            jsonEncode({'error': 'Please write a short review comment.'}),
            400,
          );
        }
        return http.Response(jsonEncode({'error': 'Unexpected $path'}), 404);
      });

      ApiService.instance.configureForTesting(
        client: mockClient,
        accessToken: 'test-token',
      );

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>(
              create: (_) => _LoggedInAuthProvider(),
            ),
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

      // Scroll to and tap Write a Review
      final writeBtn = find.byIcon(Icons.rate_review_outlined);
      await tester.scrollUntilVisible(
        writeBtn,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(writeBtn);
      await tester.pumpAndSettle();

      expect(find.text('Write a Customer Review'), findsOneWidget);

      final submitBtn = find.descendant(
        of: find.byType(BottomSheet),
        matching: find.byType(FilledButton),
      );

      // First submit -> 429 inline error inside the BottomSheet
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      final errorFinder = find.descendant(
        of: find.byType(BottomSheet),
        matching: find.byKey(const ValueKey('review-sheet-error')),
      );
      expect(errorFinder, findsOneWidget);
      expect(
        find.descendant(
          of: errorFinder,
          matching: find.text(
            'Too many reviews submitted. Please try again later.',
          ),
        ),
        findsOneWidget,
      );
      expect(find.byType(SnackBar), findsNothing);

      // Second submit -> 400 inline error inside the BottomSheet
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      expect(errorFinder, findsOneWidget);
      expect(
        find.descendant(
          of: errorFinder,
          matching: find.text('Please write a short review comment.'),
        ),
        findsOneWidget,
      );
      expect(find.byType(SnackBar), findsNothing);
    },
  );
}
