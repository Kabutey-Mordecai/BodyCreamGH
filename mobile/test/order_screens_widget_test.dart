import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:cosmetics_app/screens/order_detail_screen.dart';
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

  group('TrackOrderScreen widget tests (Item 5)', () {
    testWidgets(
      'tracked paid order with empty id renders without error, hides Complete Payment button, and shows Pending assignment when tracking_number is null',
      (tester) async {
        ApiService.instance.configureForTesting(
          client: MockClient((req) async {
            if (req.method == 'POST' && req.url.path.endsWith('/orders/track')) {
              return _jsonRes({
                'order_number': 'ORD-GCB7IRGJ',
                'status': 'shipped',
                'payment_status': 'paid',
                'fulfillment_method': 'delivery',
                'total_amount': '120.00',
                'delivery': {
                  'delivery_partner': 'DHL Ghana',
                  'tracking_number': null,
                },
                'items': [
                  {
                    'product_id': 'p1',
                    'product_name': 'Shea Body Cream',
                    'quantity': 1,
                    'price_at_purchase': '120.00',
                  },
                ],
                'created_at': '2026-11-20T10:00:00Z',
              });
            }
            return _jsonRes({'error': 'Unexpected ${req.method} ${req.url}'}, 404);
          }),
        );

        await tester.pumpWidget(const MaterialApp(home: TrackOrderScreen()));
        await tester.enterText(find.byType(TextFormField).first, ' #ord-gcb7irgj ');
        await tester.enterText(find.byType(TextFormField).last, 'buyer@example.com');
        await tester.tap(find.text('Track Order'));
        await tester.pumpAndSettle();

        expect(find.text('#ORD-GCB7IRGJ'), findsOneWidget);
        expect(find.text('Pending assignment'), findsOneWidget);
        expect(find.textContaining('Complete Payment'), findsNothing);
      },
    );

    testWidgets(
      'tracked pickup order with empty id renders Store Pickup card cleanly',
      (tester) async {
        ApiService.instance.configureForTesting(
          client: MockClient((req) async {
            if (req.method == 'POST' && req.url.path.endsWith('/orders/track')) {
              return _jsonRes({
                'order_number': 'ORD-1795247768659',
                'status': 'confirmed',
                'payment_status': 'paid',
                'fulfillment_method': 'pickup',
                'total_amount': '85.00',
                'items': [
                  {
                    'product_id': 'p1',
                    'product_name': 'Cocoa Glow Lotion',
                    'quantity': 1,
                    'price_at_purchase': '85.00',
                  },
                ],
                'created_at': '2026-11-20T10:00:00Z',
              });
            }
            return _jsonRes({'error': 'Unexpected'}, 404);
          }),
        );

        await tester.pumpWidget(const MaterialApp(home: TrackOrderScreen()));
        await tester.enterText(find.byType(TextFormField).first, 'ORD-1795247768659');
        await tester.enterText(find.byType(TextFormField).last, 'pickup@example.com');
        await tester.tap(find.text('Track Order'));
        await tester.pumpAndSettle();

        expect(find.text('#ORD-1795247768659'), findsOneWidget);
        expect(find.text('Fulfillment: Store Pickup'), findsOneWidget);
        expect(find.textContaining('Complete Payment'), findsNothing);
      },
    );
  });

  group('OrderDetailScreen partial returns widget tests (Item 6)', () {
    Map<String, dynamic> deliveredOrderJson() => {
          'id': 'ord-111',
          'order_number': 'ORD-GCB7IRGJ',
          'status': 'delivered',
          'payment_status': 'paid',
          'fulfillment_method': 'delivery',
          'total_amount': '150.00',
          'items': [
            {
              'id': 'oi-1',
              'product_id': 'p-1',
              'product_name': 'Shea Body Butter',
              'quantity': 3,
              'price_at_purchase': '50.00',
            },
          ],
          'created_at': '2026-11-20T10:00:00Z',
        };

    testWidgets(
      '(a) partial_returns_enabled false: item picker is hidden and legacy Request Return dialog opens',
      (tester) async {
        ApiService.instance.configureForTesting(
          accessToken: 'test-token',
          client: MockClient((req) async {
            if (req.url.path.endsWith('/orders/ord-111')) {
              return _jsonRes(deliveredOrderJson());
            }
            if (req.url.path.endsWith('/deliveries/order/ord-111')) {
              return _jsonRes({'status': 'delivered', 'tracking_number': 'TRK-1'});
            }
            if (req.url.path.endsWith('/orders/ord-111/log')) {
              return _jsonRes([]);
            }
            if (req.url.path.endsWith('/orders/ord-111/review-status')) {
              return _jsonRes({'reviewed': []});
            }
            if (req.url.path.endsWith('/settings')) {
              return _jsonRes({'partial_returns_enabled': false});
            }
            return _jsonRes({}, 200);
          }),
        );

        await tester.pumpWidget(
          const MaterialApp(home: OrderDetailScreen(orderId: 'ord-111')),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Request return'));
        await tester.pumpAndSettle();

        expect(find.text('Request Return'), findsOneWidget);
        expect(find.text('Select Items to Return'), findsNothing);
      },
    );

    testWidgets(
      '(b) partial_returns_enabled true with pending return: Cancel return request button is visible and calls cancelOrderReturn once',
      (tester) async {
        int cancelCalls = 0;
        ApiService.instance.configureForTesting(
          accessToken: 'test-token',
          client: MockClient((req) async {
            if (req.url.path.endsWith('/orders/ord-111')) {
              return _jsonRes(deliveredOrderJson());
            }
            if (req.url.path.endsWith('/deliveries/order/ord-111')) {
              return _jsonRes({'status': 'delivered'});
            }
            if (req.url.path.endsWith('/orders/ord-111/log')) {
              return _jsonRes([]);
            }
            if (req.url.path.endsWith('/orders/ord-111/review-status')) {
              return _jsonRes({'reviewed': []});
            }
            if (req.url.path.endsWith('/settings')) {
              return _jsonRes({'partial_returns_enabled': true});
            }
            if (req.method == 'GET' && req.url.path.endsWith('/orders/ord-111/returns')) {
              return _jsonRes({
                'returns': [
                  {
                    'id': 'ret-pending-1',
                    'order_id': 'ord-111',
                    'status': 'pending',
                    'reason': 'Wrong scent',
                    'refund_amount': '50.00',
                    'items': [
                      {
                        'id': 'rri-1',
                        'order_item_id': 'oi-1',
                        'product_name': 'Shea Body Butter',
                        'quantity': 1,
                      },
                    ],
                  },
                ],
                'returnable_items': [
                  {
                    'id': 'oi-1',
                    'product_name': 'Shea Body Butter',
                    'remaining_quantity': 2,
                  },
                ],
              });
            }
            if (req.method == 'POST' &&
                req.url.path.endsWith('/orders/ord-111/returns/ret-pending-1/cancel')) {
              cancelCalls++;
              return _jsonRes({'message': 'Cancelled'});
            }
            return _jsonRes({}, 200);
          }),
        );

        await tester.pumpWidget(
          const MaterialApp(home: OrderDetailScreen(orderId: 'ord-111')),
        );
        await tester.pumpAndSettle();

        final cancelBtn = find.text('Cancel return request');
        expect(cancelBtn, findsOneWidget);

        await tester.tap(cancelBtn);
        await tester.pumpAndSettle();

        expect(cancelCalls, 1);
      },
    );

    testWidgets(
      '(c) 409 on createOrderReturn shows the server error message verbatim',
      (tester) async {
        ApiService.instance.configureForTesting(
          accessToken: 'test-token',
          client: MockClient((req) async {
            if (req.url.path.endsWith('/orders/ord-111')) {
              return _jsonRes(deliveredOrderJson());
            }
            if (req.url.path.endsWith('/deliveries/order/ord-111')) {
              return _jsonRes({'status': 'delivered'});
            }
            if (req.url.path.endsWith('/orders/ord-111/log')) {
              return _jsonRes([]);
            }
            if (req.url.path.endsWith('/orders/ord-111/review-status')) {
              return _jsonRes({'reviewed': []});
            }
            if (req.url.path.endsWith('/settings')) {
              return _jsonRes({'partial_returns_enabled': true});
            }
            if (req.method == 'GET' && req.url.path.endsWith('/orders/ord-111/returns')) {
              return _jsonRes({
                'returns': [],
                'returnable_items': [
                  {
                    'id': 'oi-1',
                    'product_name': 'Shea Body Butter',
                    'remaining_quantity': 3,
                  },
                ],
              });
            }
            if (req.method == 'POST' && req.url.path.endsWith('/orders/ord-111/returns')) {
              return _jsonRes(
                {'error': 'A full order refund is already in progress or completed'},
                409,
              );
            }
            return _jsonRes({}, 200);
          }),
        );

        await tester.pumpWidget(
          const MaterialApp(home: OrderDetailScreen(orderId: 'ord-111')),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Request return'));
        await tester.pumpAndSettle();

        expect(find.text('Select Items to Return'), findsOneWidget);
        await tester.tap(find.byType(Checkbox).first);
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, 'Reason *'),
          'Damaged lid on arrival',
        );
        await tester.tap(find.text('Submit Return'));
        await tester.pumpAndSettle();

        expect(
          find.text('A full order refund is already in progress or completed'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      '(d) server refund_amount is shown in SnackBar after successful createOrderReturn',
      (tester) async {
        ApiService.instance.configureForTesting(
          accessToken: 'test-token',
          client: MockClient((req) async {
            if (req.url.path.endsWith('/orders/ord-111')) {
              return _jsonRes(deliveredOrderJson());
            }
            if (req.url.path.endsWith('/deliveries/order/ord-111')) {
              return _jsonRes({'status': 'delivered'});
            }
            if (req.url.path.endsWith('/orders/ord-111/log')) {
              return _jsonRes([]);
            }
            if (req.url.path.endsWith('/orders/ord-111/review-status')) {
              return _jsonRes({'reviewed': []});
            }
            if (req.url.path.endsWith('/settings')) {
              return _jsonRes({'partial_returns_enabled': true});
            }
            if (req.method == 'GET' && req.url.path.endsWith('/orders/ord-111/returns')) {
              return _jsonRes({
                'returns': [],
                'returnable_items': [
                  {
                    'id': 'oi-1',
                    'product_name': 'Shea Body Butter',
                    'remaining_quantity': 3,
                  },
                ],
              });
            }
            if (req.method == 'POST' && req.url.path.endsWith('/orders/ord-111/returns')) {
              return _jsonRes(
                {
                  'message': 'Return request submitted',
                  'return_request': {
                    'id': 'ret-new-1',
                    'status': 'pending',
                    'refund_amount': 46.67,
                  },
                },
                201,
              );
            }
            return _jsonRes({}, 200);
          }),
        );

        await tester.pumpWidget(
          const MaterialApp(home: OrderDetailScreen(orderId: 'ord-111')),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Request return'));
        await tester.pumpAndSettle();

        await tester.tap(find.byType(Checkbox).first);
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, 'Reason *'),
          'Returning 1 jar',
        );
        await tester.tap(find.text('Submit Return'));
        await tester.pumpAndSettle();

        expect(
          find.textContaining('46.67'),
          findsOneWidget,
        );
      },
    );
  });
}
