import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../widgets/product_card.dart';
import '../widgets/cart_badge.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  final _searchCtrl = TextEditingController();
  List<Product> _products = [];
  bool _loading = true;
  String? _selectedCategory;
  final List<String> _categories = ['All', 'Skincare', 'Haircare', 'Makeup', 'Fragrance', 'Body Care'];

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final raw = await ApiService.instance.getProducts(
        category: (_selectedCategory == null || _selectedCategory == 'All') ? null : _selectedCategory,
        search: _searchCtrl.text.trim(),
        limit: 50,
      );
      if (mounted) {
        setState(() {
          _products = raw.map((j) => Product.fromJson(j as Map<String, dynamic>)).toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop'),
        actions: [CartBadge(onPressed: () => context.go('/cart'))],
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search products...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchCtrl.clear();
                          _fetch();
                        },
                      )
                    : null,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
              onSubmitted: (_) => _fetch(),
            ),
          ),

          // Category filter chips
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _categories.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final cat = _categories[i];
                final selected = cat == (_selectedCategory ?? 'All');
                return FilterChip(
                  label: Text(cat),
                  selected: selected,
                  onSelected: (_) {
                    setState(() => _selectedCategory = cat == 'All' ? null : cat);
                    _fetch();
                  },
                );
              },
            ),
          ),

          // Product grid
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _products.isEmpty
                    ? const Center(child: Text('No products found'))
                    : RefreshIndicator(
                        onRefresh: _fetch,
                        child: GridView.builder(
                          padding: const EdgeInsets.all(12),
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            childAspectRatio: 0.72,
                            crossAxisSpacing: 8,
                            mainAxisSpacing: 8,
                          ),
                          itemCount: _products.length,
                          itemBuilder: (_, i) {
                            final p = _products[i];
                            return ProductCard(
                              product: p,
                              onTap: () => context.go('/product/${p.id}'),
                              onAddToCart: p.inStock
                                  ? () {
                                      context.read<CartProvider>().add(p);
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(
                                          content: Text('${p.name} added'),
                                          duration: const Duration(seconds: 2),
                                        ),
                                      );
                                    }
                                  : null,
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}
