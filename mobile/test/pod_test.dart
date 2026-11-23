import 'package:flutter_test/flutter_test.dart';
import 'package:cosmetics_app/models/order.dart';
import 'package:cosmetics_app/providers/cart_provider.dart';

void main() {
  test('cart payload carries pay_on_delivery', () {
    final c = CartProvider();
    final p = c.toOrderPayload(
        shippingAddress: 'a',
        shippingCity: 'b',
        shippingRegion: 'Greater Accra',
        paymentMethod: 'pay_on_delivery');
    expect(p['payment_method'], 'pay_on_delivery');
    expect(
        c.toOrderPayload(
            shippingAddress: 'a', shippingCity: 'b', shippingRegion: 'c')['payment_method'],
        'paystack');
  });
  test('Order parses pay_on_delivery', () {
    final o = Order.fromJson({'id': '1', 'payment_method': 'pay_on_delivery', 'total_amount': 10});
    expect(o.paymentMethod, 'pay_on_delivery');
  });
}
