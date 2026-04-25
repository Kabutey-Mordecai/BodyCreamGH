import 'package:flutter/foundation.dart';
import '../models/cart_item.dart';
import '../models/product.dart';

class CartProvider extends ChangeNotifier {
  final List<CartItem> _items = [];

  List<CartItem> get items => List.unmodifiable(_items);
  int get itemCount => _items.fold(0, (sum, i) => sum + i.quantity);

  double get subtotal => _items.fold(0, (sum, i) => sum + i.subtotal);

  // Flat GHS 15 delivery fee — adjust to match backend setting
  double get deliveryFee => _items.isEmpty ? 0 : 15.0;

  double get total => subtotal + deliveryFee;

  bool contains(int productId) => _items.any((i) => i.productId == productId);

  int quantityOf(int productId) {
    final idx = _items.indexWhere((i) => i.productId == productId);
    return idx == -1 ? 0 : _items[idx].quantity;
  }

  void add(Product product, {int quantity = 1}) {
    final idx = _items.indexWhere((i) => i.productId == product.id);
    if (idx == -1) {
      _items.add(CartItem.fromProduct(product, quantity: quantity));
    } else {
      _items[idx].quantity += quantity;
    }
    notifyListeners();
  }

  void remove(int productId) {
    _items.removeWhere((i) => i.productId == productId);
    notifyListeners();
  }

  void updateQuantity(int productId, int quantity) {
    final idx = _items.indexWhere((i) => i.productId == productId);
    if (idx == -1) return;
    if (quantity <= 0) {
      _items.removeAt(idx);
    } else {
      _items[idx].quantity = quantity;
    }
    notifyListeners();
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }

  // Builds the payload expected by POST /orders
  Map<String, dynamic> toOrderPayload({
    required String deliveryAddress,
    String? phone,
    String? couponCode,
  }) {
    return {
      'items': _items.map((i) => i.toJson()).toList(),
      'delivery_address': deliveryAddress,
      if (phone != null) 'phone': phone,
      if (couponCode != null && couponCode.isNotEmpty) 'coupon_code': couponCode,
    };
  }
}
