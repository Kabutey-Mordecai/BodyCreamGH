import 'package:flutter/foundation.dart';
import '../models/user.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthProvider extends ChangeNotifier {
  final _auth = AuthService.instance;

  AuthStatus _status = AuthStatus.unknown;
  User? _user;
  String? _error;
  int? _lastStatusCode;
  int? _lastRetryAfter;

  AuthStatus get status => _status;
  User? get user => _user;
  String? get error => _error;
  int? get lastStatusCode => _lastStatusCode;
  int? get lastRetryAfter => _lastRetryAfter;
  bool get isLoggedIn => _status == AuthStatus.authenticated;

  // Called once at app start to restore session from secure storage.
  Future<void> init() async {
    final has = await _auth.hasSession();
    if (!has) {
      _status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }
    try {
      _user = await _auth.getCurrentUser();
      _status = AuthStatus.authenticated;
    } catch (_) {
      _status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<bool> login(String email, String password) async {
    _error = null;
    _lastStatusCode = null;
    _lastRetryAfter = null;
    try {
      _user = await _auth.login(email, password);
      _status = AuthStatus.authenticated;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _lastStatusCode = e.statusCode;
      _lastRetryAfter = e.retryAfter;
      _error = e.message;
      notifyListeners();
      return false;
    } on Exception catch (e) {
      _error = e.toString().replaceFirst(RegExp(r'ApiException\(\d+\):\s*'), '');
      notifyListeners();
      return false;
    }
  }

  Future<bool> register({
    required String firstName,
    required String lastName,
    required String email,
    required String password,
    String? phone,
  }) async {
    _error = null;
    _lastStatusCode = null;
    _lastRetryAfter = null;
    try {
      _user = await _auth.register(
        firstName: firstName,
        lastName: lastName,
        email: email,
        password: password,
        phone: phone,
      );
      _status = AuthStatus.authenticated;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _lastStatusCode = e.statusCode;
      _lastRetryAfter = e.retryAfter;
      _error = e.message;
      notifyListeners();
      return false;
    } on Exception catch (e) {
      _error = e.toString().replaceFirst(RegExp(r'ApiException\(\d+\):\s*'), '');
      notifyListeners();
      return false;
    }
  }

  Future<void> refreshUser() async {
    try {
      _user = await _auth.getCurrentUser();
      _status = AuthStatus.authenticated;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> logout() async {
    await _auth.logout();
    _user = null;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
