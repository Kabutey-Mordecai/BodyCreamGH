import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:cosmetics_app/providers/auth_provider.dart';
import 'package:cosmetics_app/screens/order_detail_screen.dart';
import 'package:cosmetics_app/screens/track_order_screen.dart';
import 'package:cosmetics_app/services/api_service.dart';

void main() {
  Map<String, dynamic> pickupOrderPayload() => {
        'id': 'ord-pickup-1',
        'order_number': 'ORD-PICKUP01',
        'status': 'processing',
        'payment_status': 'paid',
        'total_amount': 85.0,
        'discount_amount': 0.0,
        'delivery_fee': 0.0,
        'fulfillment_method': 'pickup',
        'created_at': '2026-11-21T10:00:00Z',
        'items': [],
      };

  testWidgets(
    'TrackOrderScreen shows pickup_location and pickup_hours when present and hides when empty',
    (tester) async {
      bool includePickupDetails = true;

      final mockClient = MockClient((req) async {
        final path = req.url.path;
        if (path.endsWith('/api/orders/track') && req.method == 'POST') {
          return http.Response(jsonEncode(pickupOrderPayload()), 200);
        }
        if (path.endsWith('/api/settings') && req.method == 'GET') {
          return http.Response(
            jsonEncode(
              includePickupDetails
                  ? {
                      'pickup_location': '14 Oxford St, Osu, Accra',
                      'pickup_hours': 'Mon-Sat 9am-6pm',
                    }
                  : {
                      'pickup_location': '',
                      'pickup_hours': '   ',
                    },
            ),
            200,
          );
        }
        return http.Response(jsonEncode({'error': 'Unexpected $path'}), 404);
      });

      ApiService.instance.configureForTesting(client: mockClient);

      await tester.pumpWidget(
        const MaterialApp(
          home: TrackOrderScreen(initialOrderNumber: 'ORD-PICKUP01'),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byType(TextFormField).at(1),
        'buyer@example.com',
      );
      final submitBtn = find.byIcon(Icons.search);
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      expect(find.text('Fulfillment: Store Pickup'), findsOneWidget);
      expect(find.text('Location: 14 Oxford St, Osu, Accra'), findsOneWidget);
      expect(find.text('Hours: Mon-Sat 9am-6pm'), findsOneWidget);

      // Rebuild with empty pickup settings
      includePickupDetails = false;
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(
        const MaterialApp(
          home: TrackOrderScreen(initialOrderNumber: 'ORD-PICKUP01'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'buyer@example.com',
      );
      await tester.ensureVisible(find.byIcon(Icons.search));
      await tester.tap(find.byIcon(Icons.search));
      await tester.pumpAndSettle();

      expect(find.text('Fulfillment: Store Pickup'), findsOneWidget);
      expect(find.textContaining('Location:'), findsNothing);
      expect(find.textContaining('Hours:'), findsNothing);
    },
  );

  testWidgets(
    'OrderDetailScreen shows pickup_location and pickup_hours when present and hides when empty',
    (tester) async {
      bool includePickupDetails = true;

      final mockClient = MockClient((req) async {
        final path = req.url.path;
        if (path.endsWith('/api/orders/ord-pickup-1') && req.method == 'GET') {
          return http.Response(jsonEncode({'order': pickupOrderPayload()}), 200);
        }
        if (path.endsWith('/api/deliveries/order/ord-pickup-1')) {
          return http.Response(jsonEncode({'error': 'Not found'}), 404);
        }
        if (path.endsWith('/api/orders/ord-pickup-1/status-log')) {
          return http.Response(jsonEncode({'history': []}), 200);
        }
        if (path.endsWith('/api/settings') && req.method == 'GET') {
          return http.Response(
            jsonEncode(
              includePickupDetails
                  ? {
                      'pickup_location': '14 Oxford St, Osu, Accra',
                      'pickup_hours': 'Mon-Sat 9am-6pm',
                    }
                  : {},
            ),
            200,
          );
        }
        return http.Response(jsonEncode({'error': 'Unexpected $path'}), 404);
      });

      ApiService.instance.configureForTesting(
        client: mockClient,
        accessToken: 'test-token',
      );

      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: const MaterialApp(
            home: OrderDetailScreen(orderId: 'ord-pickup-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Fulfillment: Store Pickup'), findsOneWidget);
      expect(find.text('Location: 14 Oxford St, Osu, Accra'), findsOneWidget);
      expect(find.text('Hours: Mon-Sat 9am-6pm'), findsOneWidget);

      // Rebuild with empty settings
      includePickupDetails = false;
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: const MaterialApp(
            home: OrderDetailScreen(orderId: 'ord-pickup-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Fulfillment: Store Pickup'), findsOneWidget);
      expect(find.textContaining('Location:'), findsNothing);
      expect(find.textContaining('Hours:'), findsNothing);
    },
  );
}
