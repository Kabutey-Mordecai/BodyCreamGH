import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../widgets/cart_badge.dart';

class ProductDetailScreen extends StatefulWidget {
  final String productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Product? _product;
  bool _loading = true;
  int _quantity = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ApiService.instance.getProduct(widget.productId);
      if (mounted) {
        setState(() {
          _product = Product.fromJson(data);
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _addToCart() {
    if (_product == null) return;
    context.read<CartProvider>().add(_product!, quantity: _quantity);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$_quantity × ${_product!.name} added to cart')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_product?.name ?? 'Product'),
        actions: [CartBadge(onPressed: () => context.go('/cart'))],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _product == null
              ? const Center(child: Text('Product not found'))
              : SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Product image
                      SizedBox(
                        width: double.infinity,
                        height: 300,
                        child: _product!.imageUrl != null
                            ? CachedNetworkImage(
                                imageUrl: _product!.imageUrl!,
                                fit: BoxFit.cover,
                              )
                            : const ColoredBox(
                                color: Color(0xFFF5F5F5),
                                child: Center(
                                  child: Icon(Icons.image_not_supported_outlined,
                                      size: 64, color: Colors.grey),
                                ),
                              ),
                      ),

                      Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (_product!.category != null)
                              Text(
                                _product!.category!,
                                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                      color: Theme.of(context).colorScheme.secondary,
                                    ),
                              ),
                            const SizedBox(height: 4),
                            Text(_product!.name,
                                style: Theme.of(context).textTheme.headlineSmall),
                            const SizedBox(height: 8),

                            // Price + stock
                            Row(
                              children: [
                                Text(
                                  '${AppConfig.currencySymbol}${_product!.price.toStringAsFixed(2)}',
                                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                        color: Theme.of(context).colorScheme.primary,
                                        fontWeight: FontWeight.bold,
                                      ),
                                ),
                                const Spacer(),
                                if (!_product!.inStock)
                                  const Chip(
                                    label: Text('Out of stock',
                                        style: TextStyle(color: Colors.white)),
                                    backgroundColor: Colors.red,
                                  ),
                              ],
                            ),
                            const SizedBox(height: 16),

                            // Description
                            Text('Description',
                                style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 8),
                            Text(_product!.description,
                                style: Theme.of(context).textTheme.bodyMedium),
                            const SizedBox(height: 24),

                            // Quantity selector
                            if (_product!.inStock) ...[
                              Row(
                                children: [
                                  const Text('Quantity:'),
                                  const SizedBox(width: 16),
                                  IconButton(
                                    onPressed: _quantity > 1
                                        ? () => setState(() => _quantity--)
                                        : null,
                                    icon: const Icon(Icons.remove_circle_outline),
                                  ),
                                  Text('$_quantity',
                                      style: Theme.of(context).textTheme.titleMedium),
                                  IconButton(
                                    onPressed: _quantity < _product!.stockQuantity
                                        ? () => setState(() => _quantity++)
                                        : null,
                                    icon: const Icon(Icons.add_circle_outline),
                                  ),
                                  Text(
                                    '(${_product!.stockQuantity} available)',
                                    style: Theme.of(context).textTheme.bodySmall,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton.icon(
                                  onPressed: _addToCart,
                                  icon: const Icon(Icons.shopping_cart),
                                  label: const Text('Add to Cart'),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
