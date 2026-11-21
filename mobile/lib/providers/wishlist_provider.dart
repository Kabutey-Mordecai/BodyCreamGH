import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/product.dart';
import '../services/api_service.dart';

const String _wishlistStorageKey = 'bodycream_wishlist_items';
const String _recentlyViewedKey = 'bodycream_recently_viewed';

class WishlistProvider extends ChangeNotifier {
  final List<Product> _items = [];
  final List<Product> _recentlyViewed = [];

  List<Product> get items => List.unmodifiable(_items);
  List<Product> get recentlyViewed => List.unmodifiable(_recentlyViewed);
  int get count => _items.length;

  bool isWishlisted(String productId) =>
      _items.any((p) => p.id == productId);

  Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final rawWish = prefs.getString(_wishlistStorageKey);
      if (rawWish != null && rawWish.isNotEmpty) {
        final decoded = jsonDecode(rawWish) as List<dynamic>;
        _items
          ..clear()
          ..addAll(
            decoded
                .whereType<Map<String, dynamic>>()
                .map(Product.fromJson),
          );
      }

      final rawRecent = prefs.getString(_recentlyViewedKey);
      if (rawRecent != null && rawRecent.isNotEmpty) {
        final decoded = jsonDecode(rawRecent) as List<dynamic>;
        _recentlyViewed
          ..clear()
          ..addAll(
            decoded
                .whereType<Map<String, dynamic>>()
                .map(Product.fromJson),
          );
      }
      notifyListeners();
    } catch (_) {}
  }

  Future<void> toggle(Product product) async {
    final idx = _items.indexWhere((p) => p.id == product.id);
    final removing = idx != -1;
    if (removing) {
      _items.removeAt(idx);
    } else {
      _items.insert(0, product);
    }
    notifyListeners();
    await _persistWishlist();

    // Best-effort sync to server wishlist when authenticated
    try {
      if (removing) {
        await ApiService.instance.removeWishlist(product.id);
      } else {
        await ApiService.instance.addWishlist(product.id);
      }
    } catch (_) {}
  }

  Future<void> clearWishlist() async {
    _items.clear();
    notifyListeners();
    await _persistWishlist();
  }

  Future<void> recordViewed(Product product) async {
    _recentlyViewed.removeWhere((p) => p.id == product.id);
    _recentlyViewed.insert(0, product);
    if (_recentlyViewed.length > 10) {
      _recentlyViewed.removeRange(10, _recentlyViewed.length);
    }
    notifyListeners();
    await _persistRecentlyViewed();
  }

  Future<void> clearRecentlyViewed() async {
    _recentlyViewed.clear();
    notifyListeners();
    await _persistRecentlyViewed();
  }

  Future<void> _persistWishlist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _wishlistStorageKey,
        jsonEncode(_items.map((p) => p.toJson()).toList()),
      );
    } catch (_) {}
  }

  Future<void> _persistRecentlyViewed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _recentlyViewedKey,
        jsonEncode(_recentlyViewed.map((p) => p.toJson()).toList()),
      );
    } catch (_) {}
  }
}
