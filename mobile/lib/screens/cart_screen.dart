import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../providers/cart_provider.dart';
import '../theme/app_theme.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final remainingForFree = cart.freeDeliveryOver - cart.subtotal;

    return Scaffold(
      appBar: AppBar(
        title: Text('Shopping Bag (${cart.itemCount})'),
        actions: [
          if (cart.items.isNotEmpty)
            TextButton(
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (_) => AlertDialog(
                    title: const Text('Clear shopping bag?'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Cancel')),
                      TextButton(
                          onPressed: () {
                            cart.clear();
                            Navigator.pop(context);
                          },
                          child: const Text('Clear')),
                    ],
                  ),
                );
              },
              child: const Text('Clear'),
            ),
        ],
      ),
      body: cart.items.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.shopping_bag_outlined,
                        size: 64, color: AppColors.accent),
                    const SizedBox(height: 16),
                    Text('Your shopping bag is empty',
                        style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    const Text(
                      'Explore our handcrafted Ghanaian shea and cocoa butter collection.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted),
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => context.go('/shop'),
                      child: const Text('Browse Collection'),
                    ),
                  ],
                ),
              ),
            )
          : Column(
              children: [
                // Free delivery progress bar (matches web Cart)
                if (cart.freeDeliveryOver > 0)
                  Container(
                    width: double.infinity,
                    color: AppColors.blush,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 10),
                    child: Text(
                      remainingForFree > 0
                          ? 'Add ${AppConfig.currencySymbol}${remainingForFree.toStringAsFixed(2)} more for FREE delivery!'
                          : '🎉 You qualify for FREE delivery!',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.primary,
                      ),
                    ),
                  ),

                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.all(14),
                    itemCount: cart.items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (_, i) {
                      final item = cart.items[i];
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Row(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(6),
                                child: SizedBox(
                                  width: 64,
                                  height: 64,
                                  child: item.imageUrl != null
                                      ? CachedNetworkImage(
                                          imageUrl: item.imageUrl!,
                                          fit: BoxFit.cover,
                                        )
                                      : const ColoredBox(
                                          color: AppColors.blush,
                                          child: Icon(Icons.spa_outlined,
                                              color: AppColors.accent),
                                        ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item.variantLabel != null &&
                                              item.variantLabel!.isNotEmpty
                                          ? '${item.name} (${item.variantLabel})'
                                          : item.name,
                                      style: const TextStyle(
                                        fontFamily: 'serif',
                                        fontSize: 15,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${AppConfig.currencySymbol}${item.price.toStringAsFixed(2)} each',
                                      style: const TextStyle(
                                        color: AppColors.muted,
                                        fontSize: 12.5,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    icon: const Icon(Icons.remove, size: 18),
                                    onPressed: () => cart.updateQuantity(
                                      item.productId,
                                      item.quantity - 1,
                                      variantId: item.variantId,
                                    ),
                                  ),
                                  Text(
                                    '${item.quantity}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.add, size: 18),
                                    onPressed: () => cart.updateQuantity(
                                      item.productId,
                                      item.quantity + 1,
                                      variantId: item.variantId,
                                    ),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline,
                                        color: AppColors.error, size: 20),
                                    onPressed: () => cart.remove(
                                      item.productId,
                                      variantId: item.variantId,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),

                // Order summary footer
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: const BoxDecoration(
                    color: AppColors.surface,
                    border: Border(top: BorderSide(color: AppColors.border)),
                  ),
                  child: SafeArea(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _SummaryRow('Subtotal',
                            '${AppConfig.currencySymbol}${cart.subtotal.toStringAsFixed(2)}'),
                        _SummaryRow(
                          'Estimated Delivery',
                          cart.deliveryFee == 0
                              ? 'Free'
                              : '${AppConfig.currencySymbol}${cart.deliveryFee.toStringAsFixed(2)}',
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 8),
                          child: Divider(),
                        ),
                        _SummaryRow(
                          'Total',
                          '${AppConfig.currencySymbol}${cart.total.toStringAsFixed(2)}',
                          bold: true,
                        ),
                        const SizedBox(height: 14),
                        FilledButton(
                          onPressed: () => context.push('/checkout'),
                          child: const Text('Proceed to Checkout'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final bool bold;

  const _SummaryRow(this.label, this.value, {this.bold = false});

  @override
  Widget build(BuildContext context) {
    final style = bold
        ? const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)
        : const TextStyle(fontSize: 13.5, color: AppColors.muted);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text(value, style: style),
        ],
      ),
    );
  }
}
