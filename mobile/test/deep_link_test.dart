import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:cosmetics_app/main.dart';
import 'package:cosmetics_app/providers/auth_provider.dart';
import 'package:cosmetics_app/screens/order_detail_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

void main() {
  test('normalizeDeepLinkPath maps valid custom-scheme URIs', () {
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

  test('normalizeDeepLinkPath rejects empty, overlong, and traversal IDs', () {
    expect(normalizeDeepLinkPath(Uri.parse('cosmeticsgh://orders/')), '/');
    expect(normalizeDeepLinkPath(Uri.parse('cosmeticsgh://orders')), '/');
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://orders/${'a' * 200}')),
      '/',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://orders/../../etc/passwd')),
      '/',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://orders/..%2Fetc')),
      '/',
    );
    expect(
      normalizeDeepLinkPath(Uri.parse('cosmeticsgh://app/orders/../admin')),
      '/',
    );
  });

  testWidgets(
    'OrderDetailScreen shows safe error on malformed or inaccessible order ID',
    (tester) async {
      final mockClient = MockClient((req) async {
        if (req.url.path.endsWith('/api/orders/abc')) {
          return http.Response(jsonEncode({'error': 'Order not found'}), 404);
        }
        return http.Response(jsonEncode({'error': 'Not found'}), 404);
      });

      ApiService.instance.configureForTesting(
        client: mockClient,
        accessToken: 'test-token',
      );

      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: const MaterialApp(
            home: OrderDetailScreen(orderId: 'abc'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Order not found'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Back to Orders'), findsOneWidget);
    },
  );
}
