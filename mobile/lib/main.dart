import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'config.dart';
import 'main_shell.dart';
import 'providers/auth_provider.dart';
import 'providers/cart_provider.dart';
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
import 'theme/app_theme.dart';

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
        ChangeNotifierProvider(create: (_) => CartProvider()..init()),
        ChangeNotifierProvider(create: (_) => WishlistProvider()..init()),
      ],
      child: Builder(builder: (ctx) {
        final router = _buildRouter(ctx);
        return MaterialApp.router(
          title: AppConfig.appName,
          theme: AppTheme.light(),
          routerConfig: router,
          debugShowCheckedModeBanner: false,
        );
      }),
    );
  }
}

GoRouter _buildRouter(BuildContext ctx) {
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final auth = context.read<AuthProvider>();
      final isAuth = auth.isLoggedIn;
      final isInitializing = auth.status == AuthStatus.unknown;

      if (isInitializing) return null;

      final protectedRoutes = ['/profile/edit'];
      final isProtected =
          protectedRoutes.any((r) => state.matchedLocation.startsWith(r));

      if (isProtected && !isAuth) return '/login';
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
          return OrderDetailScreen(
            orderId: state.pathParameters['id']!,
            justPaid: extra?['justPaid'] as bool? ?? false,
          );
        },
      ),
      GoRoute(
        path: '/login',
        builder: (_, state) => LoginScreen(
          isCheckoutRedirect: state.uri.queryParameters['from'] == 'checkout',
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
