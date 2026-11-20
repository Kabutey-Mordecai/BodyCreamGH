import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'config.dart';
import 'main_shell.dart';
import 'providers/auth_provider.dart';
import 'providers/cart_provider.dart';
import 'screens/account_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/checkout_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/order_detail_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/payment_screen.dart';
import 'screens/product_detail_screen.dart';
import 'screens/register_screen.dart';
import 'screens/shop_screen.dart';

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
        ChangeNotifierProvider(create: (_) => CartProvider()),
      ],
      child: Builder(builder: (ctx) {
        final router = _buildRouter(ctx);
        return MaterialApp.router(
          title: AppConfig.appName,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFFB5556A), // dusty rose — cosmetics brand color
            ),
            useMaterial3: true,
          ),
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
    // Redirect unauthenticated users away from protected routes
    redirect: (context, state) {
      final auth = context.read<AuthProvider>();
      final isAuth = auth.isLoggedIn;
      final isInitializing = auth.status == AuthStatus.unknown;

      // Wait for auth to initialise before redirecting
      if (isInitializing) return null;

      final protectedRoutes = ['/checkout', '/orders', '/profile/edit'];
      final isProtected = protectedRoutes.any((r) => state.matchedLocation.startsWith(r));

      if (isProtected && !isAuth) return '/login';
      return null;
    },
    routes: [
      // Shell with bottom nav — wraps the four main tabs
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => MainShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/shop', builder: (_, __) => const ShopScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/cart', builder: (_, __) => const CartScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/orders', builder: (_, __) => const OrdersScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
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
        path: '/checkout',
        builder: (_, __) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/payment',
        builder: (_, state) {
          final extra = state.extra as Map<String, dynamic>;
          return PaymentScreen(
            paymentUrl: extra['url'] as String,
            orderId: (extra['order_id'] ?? '').toString(),
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
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (_, __) => const RegisterScreen(),
      ),
    ],
  );
}
