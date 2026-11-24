import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../providers/cart_provider.dart';
import '../providers/wishlist_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';

class WishlistScreen extends StatelessWidget {
  const WishlistScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final wishlist = context.watch<WishlistProvider>();
    final items = wishlist.items;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        title: const Text('Saved Wishlist'),
        actions: [
          if (items.isNotEmpty)
            TextButton(
              onPressed: () => wishlist.clearWishlist(),
              child: const Text('Clear'),
            ),
          CartBadge(onPressed: () => context.go('/cart')),
        ],
      ),
      body: items.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.favorite_border,
                      size: 64,
                      color: AppColors.accent,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Your wishlist is empty',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Tap the heart icon on any product to save your favourites for later.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted),
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => context.go('/shop'),
                      child: const Text('Explore Collection'),
                    ),
                  ],
                ),
              ),
            )
          : GridView.builder(
              padding: const EdgeInsets.all(14),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                childAspectRatio: 0.60,
                crossAxisSpacing: 10,
                mainAxisSpacing: 12,
              ),
              itemCount: items.length,
              itemBuilder: (_, i) {
                final p = items[i];
                return ProductCard(
                  product: p,
                  heroPrefix: 'wishlist',
                  onTap: () => context.push('/product/${p.id}'),
                  onAddToCart: p.inStock
                      ? () {
                          if (p.hasVariants) {
                            context.push('/product/${p.id}');
                            return;
                          }
                          context.read<CartProvider>().add(p);
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('${p.name} added to cart')),
                          );
                        }
                      : null,
                );
              },
            ),
    );
  }
}
