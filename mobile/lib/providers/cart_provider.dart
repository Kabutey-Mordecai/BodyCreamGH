import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/cart_item.dart';
import '../models/product.dart';
import '../services/api_service.dart';

const String _guestCartStorageKey = 'guest_cart';

class CartProvider extends ChangeNotifier {
  final List<CartItem> _items = [];

  double _deliveryFeeFlat = 15.0;
  double _deliveryFeeAccra = 10.0;
  double _freeDeliveryOver = 200.0;
  String? _mergeError;
  bool _isAuthenticated = false;
  bool _syncing = false;

  List<CartItem> get items => List.unmodifiable(_items);
  int get itemCount => _items.fold(0, (sum, i) => sum + i.quantity);

  double get subtotal => _items.fold(0, (sum, i) => sum + i.subtotal);

  double get deliveryFeeFlat => _deliveryFeeFlat;
  double get deliveryFeeAccra => _deliveryFeeAccra;
  double get freeDeliveryOver => _freeDeliveryOver;
  String? get mergeError => _mergeError;

  void clearMergeError() {
    if (_mergeError != null) {
      _mergeError = null;
      notifyListeners();
    }
  }

  Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_guestCartStorageKey);
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw) as List<dynamic>;
        _items
          ..clear()
          ..addAll(
            decoded
                .whereType<Map<String, dynamic>>()
                .map(CartItem.fromJson),
          );
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _guestCartStorageKey,
        jsonEncode(_items.map((i) => i.toJson()).toList()),
      );
    } catch (_) {}
  }

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

  Future<void> syncAuthState(bool isLoggedIn) async {
    if (isLoggedIn == _isAuthenticated) return;
    _isAuthenticated = isLoggedIn;
    if (isLoggedIn) {
      // Merge any local guest items (id == null) into the server cart, then load authoritative server cart
      final guestItems = _items.where((i) => i.id == null).toList();
      if (guestItems.isNotEmpty) {
        for (final item in guestItems) {
          try {
            await ApiService.instance.addToCart(
              item.productId,
              item.quantity,
              variantId: item.variantId,
            );
          } catch (_) {}
        }
      }
      await loadFromServer();
    } else {
      // Clear authenticated items on logout so the next user starts clean
      _items.clear();
      notifyListeners();
      _persist();
    }
  }

  Future<void> loadFromServer() async {
    if (!_isAuthenticated || _syncing) return;
    _syncing = true;
    try {
      final raw = await ApiService.instance.getCart();
      _items
        ..clear()
        ..addAll(
          raw.whereType<Map<String, dynamic>>().map(CartItem.fromJson),
        );
      notifyListeners();
      _persist();
    } catch (_) {
      // Keep local snapshot if offline
    } finally {
      _syncing = false;
    }
  }

  void add(
    Product product, {
    int quantity = 1,
    String? variantId,
    String? variantLabel,
    double? priceOverride,
  }) {
    final idx = _items.indexWhere(
      (i) => i.productId == product.id && i.variantId == variantId,
    );
    if (idx == -1) {
      _items.add(
        CartItem.fromProduct(
          product,
          quantity: quantity,
          variantId: variantId,
          variantLabel: variantLabel,
          priceOverride: priceOverride,
        ),
      );
    } else {
      _items[idx].quantity += quantity;
    }
    notifyListeners();
    _persist();
    if (_isAuthenticated) {
      ApiService.instance
          .addToCart(product.id, quantity, variantId: variantId)
          .then((_) => loadFromServer())
          .catchError((_) {});
    }
  }

  void remove(String productId, {String? variantId}) {
    final removed = _items
        .where(
          (i) =>
              i.productId == productId &&
              (variantId == null || i.variantId == variantId),
        )
        .toList();
    _items.removeWhere(
      (i) =>
          i.productId == productId &&
          (variantId == null || i.variantId == variantId),
    );
    notifyListeners();
    _persist();
    if (_isAuthenticated) {
      bool needsFullSync = false;
      for (final item in removed) {
        if (item.id != null) {
          ApiService.instance
              .removeCartItem(item.id!)
              .catchError((_) {});
        } else {
          needsFullSync = true;
        }
      }
      if (needsFullSync) {
        syncToServer().then((_) => loadFromServer()).catchError((_) {});
      }
    }
  }

  void updateQuantity(String productId, int quantity, {String? variantId}) {
    final idx = _items.indexWhere(
      (i) =>
          i.productId == productId &&
          (variantId == null || i.variantId == variantId),
    );
    if (idx == -1) return;
    final serverId = _items[idx].id;
    if (quantity <= 0) {
      _items.removeAt(idx);
    } else {
      _items[idx].quantity = quantity;
    }
    notifyListeners();
    _persist();
    if (_isAuthenticated) {
      if (serverId != null) {
        if (quantity <= 0) {
          ApiService.instance.removeCartItem(serverId).catchError((_) {});
        } else {
          ApiService.instance
              .updateCartItem(serverId, quantity)
              .catchError((_) {});
        }
      } else {
        syncToServer().then((_) => loadFromServer()).catchError((_) {});
      }
    }
  }

  /// Syncs all in-memory cart items to the server-side cart before checkout.
  /// Mirrors Web CartContext Promise.allSettled behavior and exposes mergeError
  /// if any individual item fails to merge.
  Future<void> syncToServer() async {
    final api = ApiService.instance;
    int failedCount = 0;
    try {
      await api.clearCart();
    } catch (_) {}
    for (final item in _items) {
      try {
        await api.addToCart(item.productId, item.quantity, variantId: item.variantId);
      } catch (_) {
        failedCount++;
      }
    }
    if (failedCount > 0) {
      _mergeError =
          '$failedCount item(s) could not be synced to your cart and have been kept locally for you.';
      notifyListeners();
    } else if (_mergeError != null) {
      _mergeError = null;
      notifyListeners();
    }
  }

  void clear({bool syncServer = true}) {
    _items.clear();
    _mergeError = null;
    notifyListeners();
    _persist();
    if (_isAuthenticated && syncServer) {
      ApiService.instance.clearCart().catchError((_) {});
    }
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

  Map<String, dynamic> toGuestOrderPayload({
    required String email,
    required String firstName,
    required String lastName,
    required String phone,
    required String shippingAddress,
    required String shippingCity,
    required String shippingRegion,
    required double deliveryFee,
    String fulfillmentMethod = 'delivery',
    String paymentMethod = 'paystack',
    String? notes,
    String? couponCode,
  }) {
    return {
      'email': email,
      'first_name': firstName,
      'last_name': lastName,
      'phone': phone,
      'fulfillment_method': fulfillmentMethod,
      'payment_method': paymentMethod,
      'shipping_address': shippingAddress,
      'shipping_city': shippingCity,
      'shipping_region': shippingRegion,
      'delivery_fee': deliveryFee,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      if (couponCode != null && couponCode.isNotEmpty) 'coupon_code': couponCode,
      'items': _items
          .map((i) => {
                'product_id': i.productId,
                'quantity': i.quantity,
                if (i.variantId != null) 'variant_id': i.variantId,
                if (i.variantLabel != null) 'variant_label': i.variantLabel,
              })
          .toList(),
    };
  }
}
