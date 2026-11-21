import '../models/user.dart';
import 'api_service.dart';

// Thin wrapper around ApiService for auth-specific logic.
// Providers call this; screens call providers.
class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  final _api = ApiService.instance;

  // Returns the authenticated User and saves tokens to secure storage.
  Future<User> login(String email, String password) async {
    final data = await _api.login(email, password);
    final token = (data['token'] ?? data['access_token']) as String;
    final refreshToken = (data['refresh_token'] ?? '') as String;
    await _api.saveTokens(token, refreshToken);
    final userMap = data['user'] as Map<String, dynamic>? ?? {};
    return User.fromJson(userMap);
  }

  Future<User> register({
    required String firstName,
    required String lastName,
    required String email,
    required String password,
    String? phone,
  }) async {
    await _api.register(
      firstName: firstName,
      lastName: lastName,
      email: email,
      password: password,
      phone: phone,
    );
    // Backend returns { message, userId }. Automatically log in to get session tokens.
    return await login(email, password);
  }

  Future<void> logout() => _api.logout();

  // Checks whether an access token exists on device (used to restore session).
  Future<bool> hasSession() async {
    final token = await _api.getAccessToken();
    return token != null;
  }

  // Fetches current user from the server; throws ApiException if session is invalid.
  Future<User> getCurrentUser() async {
    final data = await _api.getProfile();
    return User.fromJson(data['user'] as Map<String, dynamic>? ?? data);
  }
}
