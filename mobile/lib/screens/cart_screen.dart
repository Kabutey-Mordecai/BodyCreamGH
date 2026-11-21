import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../providers/cart_provider.dart';
import '../theme/app_theme.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<CartProvider>().loadFromServer();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      context.read<CartProvider>().loadFromServer();
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final remainingForFree = cart.freeDeliveryOver - cart.subtotal;

    return Scaffold(
      appBar: AppBar(
        title: Text('Shopping Bag (${cart.itemCount})'),
        actions: [
          IconButton(
            tooltip: 'Sync bag',
            icon: const Icon(Icons.refresh, size: 20),
            onPressed: () => cart.loadFromServer(),
          ),
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
                      child: const Text('Browse Products'),
                    ),
                  ],
                ),
              ),
            )
          : Column(
              children: [
                // Merge error banner if any item failed to sync on login
                if (cart.mergeError != null)
                  Container(
                    width: double.infinity,
                    color: const Color(0xFFFEF3C7),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    child: Row(
                      children: [
                        const Icon(Icons.warning_amber_rounded,
                            size: 16, color: Color(0xFF92400E)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            cart.mergeError!,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF92400E),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close, size: 16),
                          onPressed: cart.clearMergeError,
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                  ),

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
                              GestureDetector(
                                onTap: () =>
                                    context.push('/product/${item.productId}'),
                                child: ClipRRect(
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
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: GestureDetector(
                                  onTap: () => context
                                      .push('/product/${item.productId}'),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
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
                                      const SizedBox(height: 3),
                                      Text(
                                        '${AppConfig.currencySymbol}${item.price.toStringAsFixed(2)} each',
                                        style: const TextStyle(
                                          color: AppColors.muted,
                                          fontSize: 12,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        '${AppConfig.currencySymbol}${item.subtotal.toStringAsFixed(2)}',
                                        style: const TextStyle(
                                          color: AppColors.primary,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                  ),
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
                                    tooltip: 'Remove',
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

                // Order summary footer + Continue Shopping + Trust Badges (matches web Cart.jsx)
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
                  decoration: const BoxDecoration(
                    color: AppColors.surface,
                    border: Border(top: BorderSide(color: AppColors.border)),
                  ),
                  child: SafeArea(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _SummaryRow(
                          'Subtotal (${cart.itemCount})',
                          '${AppConfig.currencySymbol}${cart.subtotal.toStringAsFixed(2)}',
                        ),
                        const _SummaryRow(
                          'Delivery',
                          'Calculated at checkout',
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 6),
                          child: Divider(),
                        ),
                        _SummaryRow(
                          'Total',
                          '${AppConfig.currencySymbol}${cart.subtotal.toStringAsFixed(2)}+',
                          bold: true,
                        ),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: () => context.push('/checkout'),
                          child: const Text('Proceed to Checkout'),
                        ),
                        const SizedBox(height: 6),
                        Center(
                          child: TextButton(
                            onPressed: () => context.go('/shop'),
                            child: const Text('← Continue Shopping'),
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _CartTrustItem(
                                icon: '🔒', label: 'Secure Paystack'),
                            _CartTrustItem(
                                icon: '🚚', label: 'Nationwide delivery'),
                            _CartTrustItem(icon: '↩', label: '7-day returns'),
                          ],
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

class _CartTrustItem extends StatelessWidget {
  final String icon;
  final String label;
  const _CartTrustItem({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(icon, style: const TextStyle(fontSize: 12)),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            color: AppColors.muted,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
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
