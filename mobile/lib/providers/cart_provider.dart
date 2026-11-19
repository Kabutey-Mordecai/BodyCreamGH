import 'package:flutter/foundation.dart';
import '../models/cart_item.dart';
import '../models/product.dart';
import '../services/api_service.dart';

class CartProvider extends ChangeNotifier {
  final List<CartItem> _items = [];

  double _deliveryFeeFlat = 15.0;
  double _deliveryFeeAccra = 10.0;
  double _freeDeliveryOver = 200.0;

  List<CartItem> get items => List.unmodifiable(_items);
  int get itemCount => _items.fold(0, (sum, i) => sum + i.quantity);

  double get subtotal => _items.fold(0, (sum, i) => sum + i.subtotal);

  double get deliveryFeeFlat => _deliveryFeeFlat;
  double get deliveryFeeAccra => _deliveryFeeAccra;
  double get freeDeliveryOver => _freeDeliveryOver;

  void updateDeliverySettings({
    double? feeFlat,
    double? feeAccra,
    double? freeOver,
  }) {
    if (feeFlat != null && feeFlat >= 0) _deliveryFeeFlat = feeFlat;
    if (feeAccra != null && feeAccra >= 0) _deliveryFeeAccra = feeAccra;
    if (freeOver != null && freeOver >= 0) _freeDeliveryOver = freeOver;
    notifyListeners();
  }

  double computeDeliveryFee({
    String region = 'Greater Accra',
    bool isPickup = false,
  }) {
    if (_items.isEmpty || isPickup) return 0;
    if (_freeDeliveryOver > 0 && subtotal >= _freeDeliveryOver) return 0;
    final norm = region.trim().toLowerCase();
    return (norm == 'greater accra' || norm == 'accra')
        ? _deliveryFeeAccra
        : _deliveryFeeFlat;
  }

  // Fallback getter used by CartScreen before region selection
  double get deliveryFee => computeDeliveryFee(region: '');

  double get total => subtotal + deliveryFee;

  bool contains(String productId) => _items.any((i) => i.productId == productId);

  int quantityOf(String productId) {
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

  void remove(String productId) {
    _items.removeWhere((i) => i.productId == productId);
    notifyListeners();
  }

  void updateQuantity(String productId, int quantity) {
    final idx = _items.indexWhere((i) => i.productId == productId);
    if (idx == -1) return;
    if (quantity <= 0) {
      _items.removeAt(idx);
    } else {
      _items[idx].quantity = quantity;
    }
    notifyListeners();
  }

  /// Syncs all in-memory cart items to the server-side cart before checkout.
  Future<void> syncToServer() async {
    final api = ApiService.instance;
    try {
      await api.clearCart();
      for (final item in _items) {
        await api.addToCart(item.productId, item.quantity, variantId: item.variantId);
      }
    } catch (_) {
      // Best-effort sync
    }
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }

  // Builds the payload expected by POST /api/orders (validateCreateOrder)
  Map<String, dynamic> toOrderPayload({
    required String shippingAddress,
    required String shippingCity,
    required String shippingRegion,
    String fulfillmentMethod = 'delivery',
    String paymentMethod = 'paystack',
    String? phone,
    String? notes,
    String? couponCode,
  }) {
    final combinedNotes = [
      if (phone != null && phone.isNotEmpty) 'Phone: $phone',
      if (notes != null && notes.isNotEmpty) notes,
    ].join('\n');

    return {
      'fulfillment_method': fulfillmentMethod,
      'payment_method': paymentMethod,
      'shipping_address': shippingAddress,
      'shipping_city': shippingCity,
      'shipping_region': shippingRegion,
      if (combinedNotes.isNotEmpty) 'notes': combinedNotes,
      if (couponCode != null && couponCode.isNotEmpty) 'coupon_code': couponCode,
    };
  }
}
