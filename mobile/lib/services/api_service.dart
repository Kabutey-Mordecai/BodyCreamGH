import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../config.dart';

class _TimeoutClient extends http.BaseClient {
  final http.Client _inner;
  static const Duration _timeout = Duration(seconds: 15);
  _TimeoutClient(this._inner);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    return _inner.send(request).timeout(
          _timeout,
          onTimeout: () => throw TimeoutException(
            'Request timed out. Please check your internet connection and try again.',
          ),
        );
  }
}

// Thrown for all non-2xx API responses so callers can show the server message.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  final int? retryAfter;
  const ApiException(this.statusCode, this.message, {this.retryAfter});

  @override
  String toString() => 'ApiException($statusCode): $message';
}

class ApiService {
  ApiService._();
  static final ApiService instance = ApiService._();

  final _storage = const FlutterSecureStorage();
  http.Client _client = _TimeoutClient(http.Client());
  String? _testAccessToken;
  Future<String?>? _refreshInFlight;

  /// Test hook allowing widget/unit tests to inject an in-memory [http.Client]
  /// (e.g. `MockClient`) and bypass `FlutterSecureStorage` platform channels.
  void configureForTesting({http.Client? client, String? accessToken}) {
    if (client != null) _client = client;
    _testAccessToken = accessToken;
  }

  /// Optional callback invoked when stored tokens can no longer be refreshed,
  /// so AuthProvider can immediately transition out of the authenticated state.
  void Function()? onSessionExpired;

  // ── Token management ──────────────────────────────────────────────────────

  Future<String?> getAccessToken() async =>
      _testAccessToken ?? await _storage.read(key: 'access_token');
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

  static String defaultStatusMessage(int statusCode, {int? retryAfter}) {
    switch (statusCode) {
      case 400:
        return 'Invalid request. Please check your input and try again.';
      case 401:
        return 'Session expired. Please sign in again.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'The requested resource was not found.';
      case 409:
        return 'This action conflicts with the current state. Please refresh and try again.';
      case 429:
        return retryAfter != null && retryAfter > 0
            ? 'Too many requests. Please wait $retryAfter seconds and try again.'
            : 'Too many requests. Please wait a moment and try again.';
      default:
        if (statusCode >= 500) {
          return 'Server error. Please try again shortly.';
        }
        return 'Request failed (HTTP $statusCode).';
    }
  }

  /// Centralized helper to turn any thrown error (ApiException, network error, etc.)
  /// into a clean user-facing message while preserving server messages verbatim.
  static String formatError(Object error) {
    if (error is ApiException) {
      return error.message;
    }
    return error
        .toString()
        .replaceFirst(RegExp(r'^ApiException\(\d+\):\s*'), '')
        .replaceFirst(RegExp(r'^Exception:\s*'), '');
  }

  /// Parses a non-2xx [http.Response] into an [ApiException], reading `Retry-After`
  /// from response headers (or body fallback) and preserving server error messages.
  static ApiException parseErrorResponse(http.Response res) {
    int? retryAfter = int.tryParse(res.headers['retry-after'] ?? '');
    String? serverMessage;
    try {
      final body = jsonDecode(res.body);
      if (body is Map<String, dynamic>) {
        final rawErr = body['error'] ?? body['message'];
        if (rawErr is String && rawErr.trim().isNotEmpty) {
          serverMessage = rawErr.trim();
        }
        retryAfter ??= int.tryParse((body['retryAfter'] ?? '').toString());
      }
    } catch (_) {}
    if (res.statusCode == 429 && retryAfter == null) {
      retryAfter = 60;
    }
    final message = serverMessage ??
        defaultStatusMessage(res.statusCode, retryAfter: retryAfter);
    return ApiException(res.statusCode, message, retryAfter: retryAfter);
  }

  Future<dynamic> _handleResponse(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return Future.value(null);
      return Future.value(jsonDecode(res.body));
    }
    throw parseErrorResponse(res);
  }

  // Sends request with the access token; if it gets a 401, refreshes and retries once.
  Future<dynamic> _authed(Future<http.Response> Function(String token) call) async {
    var token = await getAccessToken();
    token ??= await _refreshAccessToken();
    if (token == null) {
      onSessionExpired?.call();
      throw const ApiException(401, 'Session expired. Please sign in again.');
    }

    var res = await call(token);

    // Token expired — attempt single-flight silent refresh
    if (res.statusCode == 401) {
      final refreshed = await _refreshAccessToken();
      if (refreshed == null) {
        onSessionExpired?.call();
        throw const ApiException(401, 'Session expired. Please sign in again.');
      }
      res = await call(refreshed);
    }

    return _handleResponse(res);
  }

  /// Single-flight refresh: concurrent 401s share one POST /auth/refresh call
  /// so rotated refresh tokens are never double-spent and wiped.
  Future<String?> _refreshAccessToken() {
    return _refreshInFlight ??= _doRefreshAccessToken().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<String?> _doRefreshAccessToken() async {
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
      // Do not wipe tokens on transient network errors — only on 401/403 from server.
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

  Future<void> forgotPassword(String email) async {
    final res = await _client.post(
      _uri('/auth/forgot-password'),
      headers: _headers(),
      body: jsonEncode({'email': email}),
    );
    await _handleResponse(res);
  }

  Future<void> verifyResetToken(String token, {String? email}) async {
    final query = (email != null && email.trim().isNotEmpty)
        ? '?email=${Uri.encodeQueryComponent(email.trim())}'
        : '';
    final res = await _client.get(
      _uri('/auth/verify-reset-token/${Uri.encodeComponent(token.trim())}$query'),
      headers: _headers(),
    );
    await _handleResponse(res);
  }

  Future<void> resetPassword({
    required String token,
    required String newPassword,
    String? email,
  }) async {
    final res = await _client.post(
      _uri('/auth/reset-password'),
      headers: _headers(),
      body: jsonEncode({
        'token': token.trim(),
        'new_password': newPassword,
        if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
      }),
    );
    await _handleResponse(res);
    // Server revokes all refresh tokens on password reset; clear local session
    // and only fire onSessionExpired if a token existed before the reset so a
    // logged-out reset on LoginScreen never triggers a redundant redirect.
    final hadToken = _testAccessToken != null ||
        (await _storage.read(key: 'access_token')) != null ||
        (await _storage.read(key: 'refresh_token')) != null;
    _testAccessToken = null;
    await clearTokens();
    if (hadToken) {
      onSessionExpired?.call();
    }
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

  Future<Map<String, dynamic>> getProductsWithMeta({
    int page = 1,
    int limit = 20,
    int? offset,
    String? category,
    String? brand,
    String? search,
    String? sort,
    String? minPrice,
    String? maxPrice,
    String? minRating,
    bool? inStock,
    bool? onSale,
  }) async {
    final query = <String, String>{
      'limit': limit.toString(),
      'offset': (offset ?? ((page - 1) * limit)).toString(),
      'page': page.toString(),
      if (category != null && category.isNotEmpty) 'category': category,
      if (brand != null && brand.isNotEmpty) 'brand': brand,
      if (search != null && search.isNotEmpty) 'search': search,
      if (sort != null && sort.isNotEmpty) 'sort': sort,
      if (minPrice != null && minPrice.isNotEmpty) 'min_price': minPrice,
      if (maxPrice != null && maxPrice.isNotEmpty) 'max_price': maxPrice,
      if (minRating != null && minRating.isNotEmpty) 'min_rating': minRating,
      if (inStock == true) 'in_stock': 'true',
      if (onSale == true) 'on_sale': 'true',
    };
    final uri = _uri('/products').replace(queryParameters: query);
    final res = await _client.get(uri, headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map) {
      final list = data['products'] as List<dynamic>? ?? [];
      final total = int.tryParse((data['total'] ?? list.length).toString()) ?? list.length;
      return {'products': list, 'total': total};
    }
    if (data is List) {
      return {'products': data, 'total': data.length};
    }
    return {'products': <dynamic>[], 'total': 0};
  }

  Future<List<String>> getCategories() async {
    final res = await _client.get(_uri('/products/categories'), headers: _headers());
    final data = await _handleResponse(res) as Map<String, dynamic>;
    final list = data['categories'] as List<dynamic>? ?? const [];
    return list
        .map((e) => e.toString().trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }

  Future<Map<String, dynamic>> getFacets({
    String? category,
    String? search,
    bool? inStock,
    bool? onSale,
  }) async {
    final query = <String, String>{
      if (category != null && category.isNotEmpty) 'category': category,
      if (search != null && search.isNotEmpty) 'search': search,
      if (inStock == true) 'in_stock': 'true',
      if (onSale == true) 'on_sale': 'true',
    };
    final uri = query.isEmpty
        ? _uri('/products/facets')
        : _uri('/products/facets').replace(queryParameters: query);
    final res = await _client.get(uri, headers: _headers());
    final data = await _handleResponse(res);
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  Future<List<dynamic>> getProducts({
    int page = 1,
    int limit = 20,
    String? category,
    String? search,
    String? sort,
    String? minPrice,
    String? maxPrice,
    bool? inStock,
    bool? onSale,
  }) async {
    final res = await getProductsWithMeta(
      page: page,
      limit: limit,
      category: category,
      search: search,
      sort: sort,
      minPrice: minPrice,
      maxPrice: maxPrice,
      inStock: inStock,
      onSale: onSale,
    );
    return res['products'] as List<dynamic>? ?? [];
  }

  Future<List<dynamic>> suggestProducts(String q) async {
    if (q.trim().length < 2) return [];
    final uri = _uri('/products/suggest').replace(queryParameters: {'q': q.trim()});
    final res = await _client.get(uri, headers: _headers());
    final data = await _handleResponse(res);
    if (data is List) return data;
    if (data is Map) return data['products'] as List<dynamic>? ?? [];
    return [];
  }

  Future<Map<String, dynamic>> getProduct(String id) async {
    final res = await _client.get(_uri('/products/$id'), headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map && data.containsKey('product')) {
      return data['product'] as Map<String, dynamic>;
    }
    return data as Map<String, dynamic>;
  }

  Future<List<dynamic>> getRelatedProducts(String id) async {
    final res = await _client.get(_uri('/products/$id/related'), headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map) return data['products'] as List<dynamic>? ?? [];
    if (data is List) return data;
    return [];
  }

  Future<Map<String, dynamic>> getProductVariantsFull(String id) async {
    final res = await _client.get(_uri('/products/$id/variants'), headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map<String, dynamic>) return data;
    if (data is List) return {'option_types': <dynamic>[], 'variants': data};
    return {'option_types': <dynamic>[], 'variants': <dynamic>[]};
  }

  Future<List<dynamic>> getProductVariants(String id) async {
    final data = await getProductVariantsFull(id);
    return data['variants'] as List<dynamic>? ?? [];
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getProductReviews(
    String productId, {
    int page = 1,
    int limit = 10,
    String sort = 'recent',
  }) async {
    final uri = _uri('/products/$productId/reviews').replace(queryParameters: {
      'page': page.toString(),
      'limit': limit.toString(),
      'sort': sort,
    });
    final res = await _client.get(uri, headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map<String, dynamic>) return data;
    if (data is List) return {'reviews': data, 'total': data.length, 'totalPages': 1};
    return {'reviews': <dynamic>[], 'total': 0, 'totalPages': 1};
  }

  Future<Map<String, dynamic>> canReviewProduct(String productId) async {
    final data = await _authed((token) => _client.get(
          _uri('/products/$productId/reviews/can-review'),
          headers: _headers(token: token),
        ));
    return data is Map<String, dynamic>
        ? data
        : {'can_review': false, 'already_reviewed': false};
  }

  Future<void> createProductReview(
    String productId, {
    required int rating,
    String? title,
    required String comment,
  }) async {
    await _authed((token) => _client.post(
          _uri('/products/$productId/reviews'),
          headers: _headers(token: token),
          body: jsonEncode({
            'rating': rating,
            if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
            'body': comment.trim(),
            'comment': comment.trim(),
          }),
        ));
  }

  Future<void> markReviewHelpful(String productId, dynamic reviewId) async {
    final token = await getAccessToken();
    final res = await _client.post(
      _uri('/products/$productId/reviews/$reviewId/helpful'),
      headers: _headers(token: token),
    );
    await _handleResponse(res);
  }

  Future<List<dynamic>> getPendingReviewPrompts() async {
    final data = await _authed((token) => _client.get(
          _uri('/reviews/pending-prompts'),
          headers: _headers(token: token),
        ));
    if (data is Map) return data['prompts'] as List<dynamic>? ?? [];
    if (data is List) return data;
    return [];
  }

  Future<List<dynamic>> getFeaturedReviews() async {
    final res = await _client.get(_uri('/reviews/featured'), headers: _headers());
    final data = await _handleResponse(res);
    if (data is Map) return data['reviews'] as List<dynamic>? ?? [];
    if (data is List) return data;
    return [];
  }

  // ── Cart ──────────────────────────────────────────────────────────────────

  Future<List<dynamic>> getCart() async {
    final data = await _authed((token) => _client.get(
          _uri('/cart'),
          headers: _headers(token: token),
        ));
    if (data is List) return data;
    if (data is Map && data['items'] is List) return data['items'] as List<dynamic>;
    return [];
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

  Future<void> updateCartItem(String cartItemId, int quantity) async {
    await _authed((token) => _client.patch(
          _uri('/cart/$cartItemId'),
          headers: _headers(token: token),
          body: jsonEncode({'quantity': quantity}),
        ));
  }

  Future<void> removeCartItem(String cartItemId) async {
    await _authed((token) => _client.delete(
          _uri('/cart/$cartItemId'),
          headers: _headers(token: token),
        ));
  }

  Future<void> clearCart() async {
    await _authed((token) => _client.delete(
          _uri('/cart'),
          headers: _headers(token: token),
        ));
  }

  Future<Map<String, dynamic>> validateGuestCart(
    List<Map<String, dynamic>> items,
  ) async {
    final res = await _client.post(
      _uri('/cart/validate-guest'),
      headers: _headers(),
      body: jsonEncode({'items': items}),
    );
    final data = await _handleResponse(res);
    return data is Map<String, dynamic> ? data : {'valid': true, 'items': <dynamic>[]};
  }

  // ── Orders & Order Tracking ───────────────────────────────────────────────

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> payload) async {
    return await _authed((token) => _client.post(
          _uri('/orders'),
          headers: _headers(token: token),
          body: jsonEncode(payload),
        )) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> createGuestOrder(Map<String, dynamic> payload) async {
    final res = await _client.post(
      _uri('/orders/guest'),
      headers: _headers(),
      body: jsonEncode(payload),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  Future<void> saveCheckoutSession(Map<String, dynamic> payload) async {
    final token = await getAccessToken();
    await _client.post(
      _uri('/orders/checkout-session'),
      headers: _headers(token: token),
      body: jsonEncode(payload),
    );
  }

  Future<Map<String, dynamic>> getMyOrdersWithMeta({
    int page = 1,
    int limit = 20,
  }) async {
    final uri = _uri('/orders').replace(queryParameters: {
      'page': page.toString(),
      'limit': limit.toString(),
    });
    final data = await _authed((token) => _client.get(
          uri,
          headers: _headers(token: token),
        ));
    if (data is Map<String, dynamic>) {
      return {
        'orders': data['orders'] as List<dynamic>? ?? [],
        'pagination': data['pagination'] as Map<String, dynamic>?,
      };
    }
    if (data is List) {
      return {'orders': data, 'pagination': null};
    }
    return {'orders': <dynamic>[], 'pagination': null};
  }

  Future<List<dynamic>> getMyOrders({int page = 1, int limit = 20}) async {
    final res = await getMyOrdersWithMeta(page: page, limit: limit);
    return res['orders'] as List<dynamic>? ?? [];
  }

  Future<Map<String, dynamic>> getOrder(String id) async {
    return await _authed((token) => _client.get(
          _uri('/orders/$id'),
          headers: _headers(token: token),
        )) as Map<String, dynamic>;
  }

  Future<List<dynamic>> getOrderStatusLog(String orderId) async {
    final data = await _authed((token) => _client.get(
          _uri('/orders/$orderId/log'),
          headers: _headers(token: token),
        ));
    if (data is List) return data;
    if (data is Map && data['log'] is List) return data['log'] as List<dynamic>;
    return [];
  }

  Future<List<String>> getOrderReviewStatus(String orderId) async {
    final data = await _authed((token) => _client.get(
          _uri('/orders/$orderId/review-status'),
          headers: _headers(token: token),
        ));
    if (data is Map && data['reviewed'] is List) {
      return (data['reviewed'] as List).map((e) => e.toString()).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>?> getOrderDelivery(String orderId) async {
    final data = await _authed((token) => _client.get(
          _uri('/deliveries/order/$orderId'),
          headers: _headers(token: token),
        ));
    return data is Map<String, dynamic> ? data : null;
  }

  Future<Map<String, dynamic>> confirmOrderReceipt(String orderId) async {
    final data = await _authed((token) => _client.post(
          _uri('/deliveries/order/$orderId/confirm-receipt'),
          headers: _headers(token: token),
        ));
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  /// Normalizes user-entered order numbers: strips leading '#', trims spaces, and uppercases.
  static String normalizeOrderNumber(String raw) {
    return raw.trim().replaceFirst(RegExp(r'^#+\s*'), '').trim().toUpperCase();
  }

  Future<Map<String, dynamic>> trackOrder(String orderNumber, String email) async {
    final normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    final res = await _client.post(
      _uri('/orders/track'),
      headers: _headers(),
      body: jsonEncode({
        'order_number': normalizedOrderNumber,
        'email': email.trim(),
      }),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  Future<void> requestOrderCancel(String orderId, String reason) async {
    await _authed((token) => _client.post(
          _uri('/orders/$orderId/request-cancel'),
          headers: _headers(token: token),
          body: jsonEncode({'reason': reason.trim()}),
        ));
  }

  Future<void> requestOrderReturn(String orderId, String reason) async {
    await _authed((token) => _client.post(
          _uri('/orders/$orderId/request-return'),
          headers: _headers(token: token),
          body: jsonEncode({'reason': reason.trim()}),
        ));
  }

  Future<Map<String, dynamic>> getOrderReturns(String orderId) async {
    final data = await _authed((token) => _client.get(
          _uri('/orders/$orderId/returns'),
          headers: _headers(token: token),
        ));
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> createOrderReturn(
    String orderId, {
    required List<Map<String, dynamic>> items,
    required String reason,
  }) async {
    final data = await _authed((token) => _client.post(
          _uri('/orders/$orderId/returns'),
          headers: _headers(token: token),
          body: jsonEncode({'items': items, 'reason': reason.trim()}),
        ));
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  Future<void> cancelOrderReturn(String orderId, String returnId) async {
    await _authed((token) => _client.post(
          _uri('/orders/$orderId/returns/$returnId/cancel'),
          headers: _headers(token: token),
        ));
  }

  // ── Settings & Traffic ────────────────────────────────────────────────────

  String? _cachedVisitorId;

  Future<void> recordVisit(String path) async {
    try {
      var vid = _cachedVisitorId;
      if (vid == null || vid.isEmpty) {
        try {
          vid = await _storage.read(key: 'bc_mobile_vid');
        } catch (_) {}
        if (vid == null || vid.isEmpty) {
          vid = 'mob_${DateTime.now().millisecondsSinceEpoch}_${path.hashCode.abs()}';
          try {
            await _storage.write(key: 'bc_mobile_vid', value: vid);
          } catch (_) {}
        }
        _cachedVisitorId = vid;
      }
      final cleanPath = path.trim().isEmpty ? '/' : path.trim();
      await _client
          .post(
            _uri('/traffic/visit'),
            headers: _headers(),
            body: jsonEncode({
              'path': '/app${cleanPath.startsWith('/') ? cleanPath : '/$cleanPath'}',
              'visitor_id': vid,
              'referrer': 'mobile_app',
            }),
          )
          .timeout(const Duration(seconds: 4));
    } catch (_) {
      // Never block app navigation on analytics
    }
  }

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

  Future<Map<String, dynamic>> initializeGuestPayment(String orderId, String email) async {
    final res = await _client.post(
      _uri('/payments/guest/initialize'),
      headers: _headers(),
      body: jsonEncode({'orderId': orderId, 'email': email.trim()}),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> verifyPayment(String reference) async {
    final token = await getAccessToken();
    final res = await _client.post(
      _uri('/payments/verify'),
      headers: _headers(token: token),
      body: jsonEncode({'reference': reference.trim()}),
    );
    if (res.statusCode == 202) {
      Map<String, dynamic> body = {};
      try {
        body = jsonDecode(res.body) as Map<String, dynamic>;
      } catch (_) {}
      return {'httpStatus': 202, 'status': 'pending', ...body};
    }
    final data = await _handleResponse(res);
    return data is Map<String, dynamic>
        ? {'httpStatus': res.statusCode, ...data}
        : {'httpStatus': res.statusCode, 'status': 'success'};
  }

  // ── Coupons ───────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> validateCoupon(
    String code,
    double total, {
    String? email,
  }) async {
    final token = await getAccessToken();
    final res = await _client.post(
      _uri('/coupons/validate'),
      headers: _headers(token: token),
      body: jsonEncode({
        'code': code,
        'orderTotal': total,
        'order_total': total,
        if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
      }),
    );
    return await _handleResponse(res) as Map<String, dynamic>;
  }

  // ── Wishlist ──────────────────────────────────────────────────────────────

  Future<List<dynamic>> getWishlist() async {
    final data = await _authed((token) => _client.get(
          _uri('/wishlist'),
          headers: _headers(token: token),
        ));
    if (data is Map) return data['items'] as List<dynamic>? ?? data['products'] as List<dynamic>? ?? [];
    if (data is List) return data;
    return [];
  }

  Future<void> addWishlist(String productId) async {
    await _authed((token) => _client.post(
          _uri('/wishlist/$productId'),
          headers: _headers(token: token),
        ));
  }

  Future<void> removeWishlist(String productId) async {
    await _authed((token) => _client.delete(
          _uri('/wishlist/$productId'),
          headers: _headers(token: token),
        ));
  }

  // ── Newsletter ────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getNewsletterStatus({String? email}) async {
    final token = await getAccessToken();
    final uri = email != null && email.trim().isNotEmpty
        ? _uri('/newsletter/status')
            .replace(queryParameters: {'email': email.trim()})
        : _uri('/newsletter/status');
    final res = await _client.get(uri, headers: _headers(token: token));
    final data = await _handleResponse(res);
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> subscribeNewsletter(String email, {String? name}) async {
    final res = await _client.post(
      _uri('/newsletter/subscribe'),
      headers: _headers(),
      body: jsonEncode({
        'email': email.trim(),
        if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
      }),
    );
    final data = await _handleResponse(res);
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
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

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _authed((token) => _client.put(
          _uri('/customers/password'),
          headers: _headers(token: token),
          body: jsonEncode({
            'current_password': currentPassword,
            'new_password': newPassword,
          }),
        ));
  }

  Future<void> registerDeviceToken({
    required String fcmToken,
    String? platform,
    String? deviceName,
  }) async {
    final resolvedPlatform = platform ??
        (defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
    try {
      await _authed((token) => _client.post(
            _uri('/notifications/register-device'),
            headers: _headers(token: token),
            body: jsonEncode({
              'fcm_token': fcmToken,
              'platform': resolvedPlatform,
              'device_name': deviceName,
            }),
          ));
    } catch (_) {
      // Best-effort push token registration
    }
  }
}
