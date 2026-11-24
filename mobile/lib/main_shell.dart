import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'providers/cart_provider.dart';

// Persistent bottom navigation shell — wraps the main tab screens.
// Screens that live outside the shell (login, product detail, checkout,
// payment, order detail) are pushed on top and don't show the nav bar.
class MainShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;
  const MainShell({super.key, required this.navigationShell});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final cartCount = context.watch<CartProvider>().itemCount;
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: cs.outline, width: 1)),
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: (i) => navigationShell.goBranch(
            i,
            // Re-tap on current branch navigates back to its root
            initialLocation: i == navigationShell.currentIndex,
          ),
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home),
              label: 'Home',
            ),
            const NavigationDestination(
              icon: Icon(Icons.storefront_outlined),
              selectedIcon: Icon(Icons.storefront),
              label: 'Shop',
            ),
            NavigationDestination(
              icon: Badge.count(
                count: cartCount,
                isLabelVisible: cartCount > 0,
                backgroundColor: cs.secondary,
                textColor: cs.onSecondary,
                child: const Icon(Icons.shopping_bag_outlined),
              ),
              selectedIcon: Badge.count(
                count: cartCount,
                isLabelVisible: cartCount > 0,
                backgroundColor: cs.secondary,
                textColor: cs.onSecondary,
                child: const Icon(Icons.shopping_bag),
              ),
              label: 'Cart',
            ),
            const NavigationDestination(
              icon: Icon(Icons.receipt_long_outlined),
              selectedIcon: Icon(Icons.receipt_long),
              label: 'Orders',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Account',
            ),
          ],
        ),
      ),
    );
  }
}
