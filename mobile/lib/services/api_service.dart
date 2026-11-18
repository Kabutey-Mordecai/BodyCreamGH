import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../config.dart';

// Thrown for all non-2xx API responses so callers can show the server message.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  const ApiException(this.statusCode, this.message);

  @override
  String toString() => 'ApiException($statusCode): $message';
}

class ApiService {
  ApiService._();
  static final ApiService instance = ApiService._();

  final _storage = const FlutterSecureStorage();
  final _client = http.Client();

  // ── Token management ──────────────────────────────────────────────────────

  Future<String?> getAccessToken() => _storage.read(key: 'access_token');
  Future<String?> getRefreshToken() => _storage.read(key: 'refresh_token');

  Future<void> saveTokens(String access, String refresh) async {
    await Future.wait([
      _storage.write(key: 'access_token', value: access),
      _storage.write(key: 'refresh_token', value: refresh),
    ]);
  }

  Future<void> clearTokens() async {
    await Future.wait([
      _storage.delete(key: 'access_token'),
      _storage.delete(key: 'refresh_token'),
    ]);
  }

  // ── Low-level request helpers ─────────────────────────────────────────────

  Uri _uri(String path) => Uri.parse('${AppConfig.baseUrl}$path');

  Map<String, String> _headers({String? token, bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> _handleResponse(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return Future.value(null);
      return Future.value(jsonDecode(res.body));
    }
    String message = 'Request failed';
    try {
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      message = body['error'] as String? ?? body['message'] as String? ?? message;
    } catch (_) {}
    throw ApiException(res.statusCode, message);
  }

  // Sends request with the access token; if it gets a 401, refreshes and retries once.
  Future<dynamic> _authed(Future<http.Response> Function(String token) call) async {
    var token = await getAccessToken();
    if (token == null) throw const ApiException(401, 'Not authenticated');

    var res = await call(token);

    // Token expired — attempt silent refresh
    if (res.statusCode == 401) {
      token = await _refreshAccessToken();
      if (token == null) throw const ApiException(401, 'Session expired');
      res = await call(token);
    }

    return _handleResponse(res);
  }

  Future<String?> _refreshAccessToken() async {
    final refresh = await getRefreshToken();
    if (refresh == null) return null;
    try {
      final res = await _client.post(
        _uri('/auth/refresh'),
        headers: _headers(),
        body: jsonEncode({'refresh_token': refresh}),
      );
      if (res.statusCode != 200) {
        await clearTokens();
        return null;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final newAccess = (data['token'] ?? data['access_token']) as String;
      final newRefresh = (data['refresh_token'] ?? refresh) as String;
      await saveTokens(newAccess, newRefresh);
      return newAccess;
    } catch (_) {
      await clearTokens();
      return null;
    }
  }

  // ── Auth endpoints ────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _client.post(
      _uri('/auth/login'),
      headers: _headers(),
      body: jsonEncode({'email': email, 'password': password}),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> register({
    required String firstName,
    required String lastName,
    required String email,
    required String password,
    String? phone,
  }) async {
    final res = await _client.post(
      _uri('/auth/register'),
      headers: _headers(),
      body: jsonEncode({
        'first_name': firstName,
        'last_name': lastName,
        'email': email,
        'password': password,
        if (phone != null) 'phone': phone,
      }),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  Future<void> logout() async {
    try {
      final token = await getAccessToken();
      final refresh = await getRefreshToken();
      if (token != null) {
        await _client.post(
          _uri('/auth/logout'),
          headers: _headers(token: token),
          body: jsonEncode({'refresh_token': refresh}),
        );
      }
    } catch (_) {
      // Best-effort — always clear local tokens
    } finally {
      await clearTokens();
    }
  }

  // ── Products ──────────────────────────────────────────────────────────────

  Future<List<dynamic>> getProducts({
    int page = 1,
    int limit = 20,
    String? category,
    String? search,
  }) async {
    final query = {
      'page': page.toString(),
      'limit': limit.toString(),
      if (category != null) 'category': category,
      if (search != null && search.isNotEmpty) 'search': search,
    };
    final uri = _uri('/products').replace(queryParameters: query);
    final res = await _client.get(uri, headers: _headers());
    final data = await _handleResponse(res);
    // Backend returns { products: [...], total: n } or just [...]
    if (data is Map) return data['products'] as List<dynamic>? ?? [];
    return data as List<dynamic>;
  }

  Future<Map<String, dynamic>> getProduct(String id) async {
    final res = await _client.get(_uri('/products/$id'), headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map && data.containsKey('product')) {
      return data['product'] as Map<String, dynamic>;
    }
    return data as Map<String, dynamic>;
  }

  // ── Cart ──────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getCart() async {
    return await _authed((token) => _client.get(
          _uri('/cart'),
          headers: _headers(token: token),
        )) as Map<String, dynamic>;
  }

  Future<void> addToCart(String productId, int quantity, {String? variantId}) async {
    await _authed((token) => _client.post(
          _uri('/cart/add'),
          headers: _headers(token: token),
          body: jsonEncode({
            'product_id': productId,
            'quantity': quantity,
            if (variantId != null) 'variant_id': variantId,
          }),
        ));
  }

  Future<void> clearCart() async {
    await _authed((token) => _client.delete(
          _uri('/cart'),
          headers: _headers(token: token),
        ));
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> payload) async {
    return await _authed((token) => _client.post(
          _uri('/orders'),
          headers: _headers(token: token),
          body: jsonEncode(payload),
        )) as Map<String, dynamic>;
  }

  Future<List<dynamic>> getMyOrders() async {
    final data = await _authed((token) => _client.get(
          _uri('/orders'),
          headers: _headers(token: token),
        ));
    if (data is Map && data.containsKey('orders')) {
      return data['orders'] as List<dynamic>? ?? [];
    }
    return data as List<dynamic>? ?? [];
  }

  Future<Map<String, dynamic>> getOrder(String id) async {
    return await _authed((token) => _client.get(
          _uri('/orders/$id'),
          headers: _headers(token: token),
        )) as Map<String, dynamic>;
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getSettings() async {
    final res = await _client.get(_uri('/settings'), headers: _headers());
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> initializePayment(dynamic orderId) async {
    return await _authed((token) => _client.post(
          _uri('/payments/initialize'),
          headers: _headers(token: token),
          body: jsonEncode({'orderId': orderId.toString()}),
        )) as Map<String, dynamic>;
  }

  // ── Coupons ───────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> validateCoupon(String code, double total) async {
    final res = await _client.post(
      _uri('/coupons/validate'),
      headers: _headers(),
      body: jsonEncode({'code': code, 'order_total': total}),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getProfile() async {
    return await _authed((token) => _client.get(
          _uri('/customers/profile'),
          headers: _headers(token: token),
        )) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> data) async {
    return await _authed((token) => _client.put(
          _uri('/customers/profile'),
          headers: _headers(token: token),
          body: jsonEncode(data),
        )) as Map<String, dynamic>;
  }
}
