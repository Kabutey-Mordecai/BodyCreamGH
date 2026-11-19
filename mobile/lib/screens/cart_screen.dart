import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../widgets/status_chip.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cart'),
        actions: [
          if (cart.items.isNotEmpty)
            TextButton(
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (_) => AlertDialog(
                    title: const Text('Clear cart?'),
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
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.shopping_cart_outlined, size: 64, color: Colors.grey),
                  const SizedBox(height: 16),
                  Text('Your cart is empty',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () => context.go('/shop'),
                    child: const Text('Browse Products'),
                  ),
                ],
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: cart.items.length,
                    separatorBuilder: (_, __) => const Divider(),
                    itemBuilder: (_, i) {
                      final item = cart.items[i];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          item.variantLabel != null && item.variantLabel!.isNotEmpty
                              ? '${item.name} — ${item.variantLabel}'
                              : item.name,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: Text(
                          '${AppConfig.currencySymbol}${item.price.toStringAsFixed(2)} each',
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              icon: const Icon(Icons.remove, size: 18),
                              onPressed: () => cart.updateQuantity(
                                  item.productId, item.quantity - 1),
                            ),
                            Text('${item.quantity}'),
                            IconButton(
                              icon: const Icon(Icons.add, size: 18),
                              onPressed: () => cart.updateQuantity(
                                  item.productId, item.quantity + 1),
                            ),
                            IconButton(
                              icon: const Icon(Icons.delete_outline, color: Colors.red),
                              onPressed: () => cart.remove(item.productId),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),

                // Order summary
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    boxShadow: const [
                      BoxShadow(blurRadius: 8, color: Colors.black12, offset: Offset(0, -2))
                    ],
                  ),
                  child: SafeArea(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _SummaryRow('Subtotal',
                            '${AppConfig.currencySymbol}${cart.subtotal.toStringAsFixed(2)}'),
                        _SummaryRow('Delivery',
                            '${AppConfig.currencySymbol}${cart.deliveryFee.toStringAsFixed(2)}'),
                        const Divider(),
                        _SummaryRow(
                          'Total',
                          '${AppConfig.currencySymbol}${cart.total.toStringAsFixed(2)}',
                          bold: true,
                        ),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: () {
                            final auth = context.read<AuthProvider>();
                            if (!auth.isLoggedIn) {
                              context.go('/login');
                            } else {
                              context.go('/checkout');
                            }
                          },
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
        ? Theme.of(context).textTheme.titleMedium
        : Theme.of(context).textTheme.bodyMedium;
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
