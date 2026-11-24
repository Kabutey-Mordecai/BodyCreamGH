import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'config.dart';
import 'main_shell.dart';
import 'services/api_service.dart';
import 'providers/auth_provider.dart';
import 'providers/cart_provider.dart';
import 'providers/theme_provider.dart';
import 'providers/wishlist_provider.dart';
import 'screens/account_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/checkout_screen.dart';
import 'screens/edit_profile_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/order_detail_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/payment_screen.dart';
import 'screens/product_detail_screen.dart';
import 'screens/register_screen.dart';
import 'screens/shop_screen.dart';
import 'screens/track_order_screen.dart';
import 'screens/wishlist_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  AppConfig.validateConfig();
  runApp(const CosmeticsApp());
}

class CosmeticsApp extends StatelessWidget {
  const CosmeticsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()..init()),
        ChangeNotifierProxyProvider<AuthProvider, CartProvider>(
          create: (_) => CartProvider()..init(),
          update: (_, auth, cart) {
            final c = cart ?? (CartProvider()..init());
            c.syncAuthState(auth.isLoggedIn);
            return c;
          },
        ),
        ChangeNotifierProvider(create: (_) => WishlistProvider()..init()),
        ChangeNotifierProvider(create: (_) => ThemeProvider()..init()),
      ],
      child: const _ThemedRouterApp(),
    );
  }
}

class _ThemedRouterApp extends StatefulWidget {
  const _ThemedRouterApp();

  @override
  State<_ThemedRouterApp> createState() => _ThemedRouterAppState();
}

class _ThemedRouterAppState extends State<_ThemedRouterApp> {
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _router = _buildRouter(context);
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>().themeData;
    return MaterialApp.router(
      title: AppConfig.appName,
      theme: theme,
      routerConfig: _router,
      debugShowCheckedModeBanner: false,
    );
  }
}

final RegExp _safeDeepLinkIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,100}$');

String? normalizeDeepLinkPath(Uri uri) {
  if (uri.scheme != 'cosmeticsgh') return null;
  final host = uri.host.toLowerCase();
  if ((host == 'orders' || host == 'order') && uri.pathSegments.length == 1) {
    final id = uri.pathSegments.first.trim();
    if (_safeDeepLinkIdPattern.hasMatch(id)) {
      return '/$host/$id';
    }
  }
  if (host == 'payment') {
    return '/payment';
  }
  if (host == 'app' &&
      uri.pathSegments.length == 2 &&
      (uri.pathSegments[0] == 'orders' || uri.pathSegments[0] == 'order') &&
      _safeDeepLinkIdPattern.hasMatch(uri.pathSegments[1])) {
    return '/${uri.pathSegments[0]}/${uri.pathSegments[1]}';
  }
  return '/';
}

bool _isProtectedRoute(String path) =>
    path.startsWith('/profile/edit') ||
    path.startsWith('/orders/') ||
    path.startsWith('/order/');

GoRouter _buildRouter(BuildContext ctx) {
  final authProvider = ctx.read<AuthProvider>();
  String? lastTrackedRoute;
  return GoRouter(
    initialLocation: '/',
    refreshListenable: authProvider,
    redirect: (context, state) {
      final auth = context.read<AuthProvider>();
      final isAuth = auth.isLoggedIn;
      final isInitializing = auth.status == AuthStatus.unknown;

      final normalized = normalizeDeepLinkPath(state.uri);
      if (normalized != null) {
        debugPrint('[DeepLink] ${state.uri} -> $normalized');
        if (normalized == '/payment' && state.extra is! Map<String, dynamic>) {
          return '/orders';
        }
        if (!isInitializing && !isAuth && _isProtectedRoute(normalized)) {
          return '/login?redirect=${Uri.encodeComponent(normalized)}';
        }
        return normalized;
      }

      if (isInitializing) return null;

      final loc = state.matchedLocation;
      if (_isProtectedRoute(loc) && !isAuth) {
        return '/login?redirect=${Uri.encodeComponent(state.uri.toString())}';
      }

      if (loc.isNotEmpty && loc != lastTrackedRoute) {
        lastTrackedRoute = loc;
        ApiService.instance.recordVisit(loc);
      }

      if (isAuth && loc == '/login') {
        final target = state.uri.queryParameters['redirect'];
        if (target != null &&
            target.startsWith('/') &&
            !target.startsWith('//')) {
          return target;
        }
      }
      return null;
    },
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => MainShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/shop',
              builder: (_, state) => ShopScreen(
                initialCategory: state.uri.queryParameters['category'],
                initialSearch: state.uri.queryParameters['search'],
              ),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/cart', builder: (_, __) => const CartScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/orders', builder: (_, __) => const OrdersScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/account', builder: (_, __) => const AccountScreen()),
          ]),
        ],
      ),

      // Routes outside the shell (no bottom nav)
      GoRoute(
        path: '/product/:id',
        builder: (_, state) => ProductDetailScreen(
          productId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/wishlist',
        builder: (_, __) => const WishlistScreen(),
      ),
      GoRoute(
        path: '/track-order',
        builder: (_, state) => TrackOrderScreen(
          initialOrderNumber: state.uri.queryParameters['order_number'],
        ),
      ),
      GoRoute(
        path: '/profile/edit',
        builder: (_, __) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/checkout',
        builder: (_, __) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/payment',
        redirect: (_, state) {
          final extra = state.extra;
          if (extra is! Map<String, dynamic> ||
              extra['url'] is! String ||
              extra['order_id'] is! String) {
            return '/orders';
          }
          return null;
        },
        builder: (_, state) {
          final extra = state.extra as Map<String, dynamic>;
          return PaymentScreen(
            paymentUrl: extra['url'] as String,
            orderId: extra['order_id'] as String,
            orderNumber: extra['order_number'] as String?,
            guestEmail: extra['guest_email'] as String?,
          );
        },
      ),
      GoRoute(
        path: '/order/:id',
        builder: (_, state) {
          final extra = state.extra as Map<String, dynamic>?;
          final id = state.pathParameters['id']!;
          return OrderDetailScreen(
            key: ValueKey('order-$id'),
            orderId: id,
            justPaid: extra?['justPaid'] as bool? ?? false,
          );
        },
      ),
      GoRoute(
        path: '/orders/:id',
        builder: (_, state) {
          final extra = state.extra as Map<String, dynamic>?;
          final id = state.pathParameters['id']!;
          return OrderDetailScreen(
            key: ValueKey('order-$id'),
            orderId: id,
            justPaid: extra?['justPaid'] as bool? ?? false,
          );
        },
      ),
      GoRoute(
        path: '/login',
        builder: (_, state) => LoginScreen(
          isCheckoutRedirect: state.uri.queryParameters['from'] == 'checkout',
          redirectTo: state.uri.queryParameters['redirect'],
        ),
      ),
      GoRoute(
        path: '/register',
        builder: (_, state) => RegisterScreen(
          isCheckoutRedirect: state.uri.queryParameters['from'] == 'checkout',
        ),
      ),
    ],
  );
}
