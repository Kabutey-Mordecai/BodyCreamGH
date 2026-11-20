import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';

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
  String _sortBy = 'newest'; // newest | price_asc | price_desc | rating
  bool _inStockOnly = false;
  bool _onSaleOnly = false;

  List<String> get _categories {
    final set = <String>{'All'};
    for (final p in _products) {
      if (p.category != null && p.category!.trim().isNotEmpty) {
        set.add(p.category!.trim());
      }
    }
    return set.toList();
  }

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
        search: _searchCtrl.text.trim(),
        limit: 100,
      );
      if (mounted) {
        setState(() {
          _products = raw
              .whereType<Map<String, dynamic>>()
              .map(Product.fromJson)
              .toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Product> get _visibleProducts {
    var list = _products.where((p) {
      if (_selectedCategory != null &&
          _selectedCategory != 'All' &&
          (p.category ?? '').toLowerCase() !=
              _selectedCategory!.toLowerCase()) {
        return false;
      }
      if (_inStockOnly && !p.inStock) return false;
      if (_onSaleOnly && !p.isOnSale) return false;
      return true;
    }).toList();

    switch (_sortBy) {
      case 'price_asc':
        list.sort((a, b) => a.price.compareTo(b.price));
        break;
      case 'price_desc':
        list.sort((a, b) => b.price.compareTo(a.price));
        break;
      case 'rating':
        list.sort(
          (a, b) => (b.averageRating ?? 0).compareTo(a.averageRating ?? 0),
        );
        break;
      default:
        break;
    }
    return list;
  }

  bool get _hasActiveFilters =>
      _selectedCategory != null ||
      _searchCtrl.text.trim().isNotEmpty ||
      _inStockOnly ||
      _onSaleOnly ||
      _sortBy != 'newest';

  void _clearFilters() {
    _searchCtrl.clear();
    setState(() {
      _selectedCategory = null;
      _inStockOnly = false;
      _onSaleOnly = false;
      _sortBy = 'newest';
    });
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleProducts;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop Collection'),
        actions: [
          IconButton(
            icon: const Icon(Icons.favorite_border, color: AppColors.primary),
            onPressed: () => context.push('/wishlist'),
            tooltip: 'Wishlist',
          ),
          CartBadge(onPressed: () => context.go('/cart')),
        ],
      ),
      body: Column(
        children: [
          // Search input
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search shea butter, oils, masks...',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                          _fetch();
                        },
                      )
                    : null,
                isDense: true,
              ),
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _fetch(),
            ),
          ),

          // Category chips
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              itemCount: _categories.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final cat = _categories[i];
                final selected = cat == (_selectedCategory ?? 'All');
                return FilterChip(
                  showCheckmark: false,
                  label: Text(
                    cat,
                    style: TextStyle(
                      color: selected ? Colors.white : AppColors.text,
                      fontWeight:
                          selected ? FontWeight.w700 : FontWeight.w500,
                      fontSize: 12.5,
                    ),
                  ),
                  selected: selected,
                  onSelected: (_) {
                    setState(
                      () => _selectedCategory = cat == 'All' ? null : cat,
                    );
                  },
                );
              },
            ),
          ),

          // Sort & secondary filter bar (matches web Shop toolbar)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 6),
            child: Row(
              children: [
                FilterChip(
                  showCheckmark: false,
                  label: Text(
                    'In Stock',
                    style: TextStyle(
                      color: _inStockOnly ? Colors.white : AppColors.text,
                      fontWeight:
                          _inStockOnly ? FontWeight.w700 : FontWeight.w500,
                      fontSize: 12,
                    ),
                  ),
                  selected: _inStockOnly,
                  visualDensity: VisualDensity.compact,
                  onSelected: (v) => setState(() => _inStockOnly = v),
                ),
                const SizedBox(width: 6),
                FilterChip(
                  showCheckmark: false,
                  label: Text(
                    'On Sale',
                    style: TextStyle(
                      color: _onSaleOnly ? Colors.white : AppColors.text,
                      fontWeight:
                          _onSaleOnly ? FontWeight.w700 : FontWeight.w500,
                      fontSize: 12,
                    ),
                  ),
                  selected: _onSaleOnly,
                  visualDensity: VisualDensity.compact,
                  onSelected: (v) => setState(() => _onSaleOnly = v),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: _sortBy,
                      isDense: true,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.primary,
                      ),
                      items: const [
                        DropdownMenuItem(
                            value: 'newest', child: Text('Sort: Featured')),
                        DropdownMenuItem(
                            value: 'price_asc',
                            child: Text('Price: Low to High')),
                        DropdownMenuItem(
                            value: 'price_desc',
                            child: Text('Price: High to Low')),
                        DropdownMenuItem(
                            value: 'rating', child: Text('Top Rated')),
                      ],
                      onChanged: (v) {
                        if (v != null) setState(() => _sortBy = v);
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Count + Clear filters bar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Showing ${visible.length} product${visible.length == 1 ? '' : 's'}',
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                if (_hasActiveFilters)
                  GestureDetector(
                    onTap: _clearFilters,
                    child: const Text(
                      'Reset filters',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.accentDark,
                      ),
                    ),
                  ),
              ],
            ),
          ),

          // Product grid
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : visible.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.search_off,
                                size: 48, color: AppColors.muted),
                            const SizedBox(height: 12),
                            const Text('No matching products found'),
                            if (_hasActiveFilters)
                              TextButton(
                                onPressed: _clearFilters,
                                child: const Text('Clear all filters'),
                              ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _fetch,
                        color: AppColors.accent,
                        child: GridView.builder(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            childAspectRatio: 0.59,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 12,
                          ),
                          itemCount: visible.length,
                          itemBuilder: (_, i) {
                            final p = visible[i];
                            return ProductCard(
                              product: p,
                              heroPrefix: 'shop',
                              onTap: () => context.push('/product/${p.id}'),
                              onAddToCart: p.inStock
                                  ? () {
                                      context.read<CartProvider>().add(p);
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(
                                        SnackBar(
                                          content:
                                              Text('${p.name} added to cart'),
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
