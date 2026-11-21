import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';
import '../widgets/search_autocomplete_field.dart';

class ShopScreen extends StatefulWidget {
  final String? initialCategory;
  final String? initialSearch;

  const ShopScreen({
    super.key,
    this.initialCategory,
    this.initialSearch,
  });

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  static const int _pageLimit = 12;

  final _searchCtrl = TextEditingController();
  List<Product> _products = [];
  int _total = 0;
  int _page = 1;
  bool _loading = true;
  String? _selectedCategory;
  String _sortBy = 'newest'; // newest | price_low | price_high | name_asc | top_rated
  bool _inStockOnly = false;
  bool _onSaleOnly = false;
  String _minPrice = '';
  String _maxPrice = '';

  List<String> _apiCategories = const [];

  List<String> get _categories {
    final set = <String>{'All'};
    for (final c in _apiCategories) {
      if (c.trim().isNotEmpty) set.add(c.trim());
    }
    if (_selectedCategory != null && _selectedCategory!.trim().isNotEmpty) {
      set.add(_selectedCategory!.trim());
    }
    for (final p in _products) {
      if (p.category != null && p.category!.trim().isNotEmpty) {
        set.add(p.category!.trim());
      }
    }
    return set.toList();
  }

  Future<void> _fetchCategories() async {
    try {
      final cats = await ApiService.instance.getCategories();
      if (mounted && cats.isNotEmpty) {
        setState(() => _apiCategories = cats);
      }
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    _selectedCategory =
        (widget.initialCategory != null && widget.initialCategory!.isNotEmpty)
            ? widget.initialCategory
            : null;
    if (widget.initialSearch != null && widget.initialSearch!.isNotEmpty) {
      _searchCtrl.text = widget.initialSearch!;
    }
    _fetchCategories();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant ShopScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    bool changed = false;
    if (widget.initialCategory != oldWidget.initialCategory) {
      _selectedCategory =
          (widget.initialCategory != null && widget.initialCategory!.isNotEmpty)
              ? widget.initialCategory
              : null;
      _page = 1;
      changed = true;
    }
    if (widget.initialSearch != oldWidget.initialSearch) {
      _searchCtrl.text = widget.initialSearch ?? '';
      _page = 1;
      changed = true;
    }
    if (changed) _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final res = await ApiService.instance.getProductsWithMeta(
        page: _page,
        limit: _pageLimit,
        offset: (_page - 1) * _pageLimit,
        category: (_selectedCategory != null && _selectedCategory != 'All')
            ? _selectedCategory
            : null,
        search: _searchCtrl.text.trim().isNotEmpty
            ? _searchCtrl.text.trim()
            : null,
        sort: _sortBy,
        minPrice: _minPrice.isNotEmpty ? _minPrice : null,
        maxPrice: _maxPrice.isNotEmpty ? _maxPrice : null,
        inStock: _inStockOnly ? true : null,
        onSale: _onSaleOnly ? true : null,
      );
      final raw = res['products'] as List<dynamic>? ?? [];
      final total = res['total'] as int? ?? raw.length;
      if (mounted) {
        setState(() {
          _products = raw
              .whereType<Map<String, dynamic>>()
              .map(Product.fromJson)
              .toList();
          _total = total;
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
      final minP = double.tryParse(_minPrice);
      final maxP = double.tryParse(_maxPrice);
      if (minP != null && p.price < minP) return false;
      if (maxP != null && p.price > maxP) return false;
      return true;
    }).toList();

    switch (_sortBy) {
      case 'price_low':
        list.sort((a, b) => a.price.compareTo(b.price));
        break;
      case 'price_high':
        list.sort((a, b) => b.price.compareTo(a.price));
        break;
      case 'name_asc':
        list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        break;
      case 'top_rated':
        list.sort(
          (a, b) => (b.averageRating ?? 0).compareTo(a.averageRating ?? 0),
        );
        break;
      default:
        break;
    }
    return list;
  }

  bool get _hasPriceFilter => _minPrice.isNotEmpty || _maxPrice.isNotEmpty;

  bool get _hasActiveFilters =>
      _selectedCategory != null ||
      _searchCtrl.text.trim().isNotEmpty ||
      _inStockOnly ||
      _onSaleOnly ||
      _hasPriceFilter ||
      _sortBy != 'newest';

  void _clearFilters() {
    _searchCtrl.clear();
    setState(() {
      _selectedCategory = null;
      _inStockOnly = false;
      _onSaleOnly = false;
      _minPrice = '';
      _maxPrice = '';
      _sortBy = 'newest';
      _page = 1;
    });
    _fetch();
  }

  Future<void> _openPriceFilterSheet() async {
    final minCtrl = TextEditingController(text: _minPrice);
    final maxCtrl = TextEditingController(text: _maxPrice);
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          20,
          20,
          MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Filter by Price (GH₵)',
              style: Theme.of(ctx).textTheme.titleLarge,
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: minCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Min Price',
                      hintText: '0',
                    ),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10),
                  child: Text('–'),
                ),
                Expanded(
                  child: TextField(
                    controller: maxCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Max Price',
                      hintText: '500',
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      setState(() {
                        _minPrice = '';
                        _maxPrice = '';
                        _page = 1;
                      });
                      _fetch();
                    },
                    child: const Text('Clear'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      setState(() {
                        _minPrice = minCtrl.text.trim();
                        _maxPrice = maxCtrl.text.trim();
                        _page = 1;
                      });
                      _fetch();
                    },
                    child: const Text('Apply Price'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCategoryDrawer(BuildContext context) {
    final categoryList = _categories.where((c) => c != 'All').toList();
    return Drawer(
      backgroundColor: AppColors.surface,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.close, color: AppColors.text),
                    tooltip: 'Close menu',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 4),
                  const Expanded(
                    child: Text(
                      'BODYCREAM GH',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.0,
                        color: AppColors.text,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              dense: true,
              leading: const Icon(Icons.receipt_long_outlined, size: 20),
              title: const Text('Orders'),
              onTap: () {
                Navigator.of(context).pop();
                context.go('/orders');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.favorite_border, size: 20),
              title: const Text('Wishlist'),
              onTap: () {
                Navigator.of(context).pop();
                context.push('/wishlist');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.local_shipping_outlined, size: 20),
              title: const Text('Track Order'),
              onTap: () {
                Navigator.of(context).pop();
                context.push('/track');
              },
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 12, 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Expanded(
                    child: Text(
                      'OUR CATEGORIES',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.6,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    onPressed: () {
                      Navigator.of(context).pop();
                      setState(() {
                        _selectedCategory = null;
                        _page = 1;
                      });
                      _fetch();
                    },
                    child: const Text(
                      'See All',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.accentDark,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: categoryList.length,
                itemBuilder: (_, i) {
                  final cat = categoryList[i];
                  final isSelected = cat == _selectedCategory;
                  return ListTile(
                    dense: true,
                    leading: Icon(
                      Icons.spa_outlined,
                      size: 20,
                      color: isSelected ? AppColors.accentDark : AppColors.text,
                    ),
                    title: Text(
                      cat,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight:
                            isSelected ? FontWeight.w700 : FontWeight.w500,
                        color:
                            isSelected ? AppColors.accentDark : AppColors.text,
                      ),
                    ),
                    trailing: isSelected
                        ? const Icon(
                            Icons.check,
                            size: 18,
                            color: AppColors.accentDark,
                          )
                        : null,
                    onTap: () {
                      Navigator.of(context).pop();
                      setState(() {
                        _selectedCategory = cat;
                        _page = 1;
                      });
                      _fetch();
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleProducts;
    final totalPages = (_total / _pageLimit).ceil().clamp(1, 999);

    return Scaffold(
      drawer: _buildCategoryDrawer(context),
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
          // Search input with live autocomplete & recent searches (matches web SearchBar.jsx)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: SearchAutocompleteField(
              controller: _searchCtrl,
              hintText: 'Search products by name, collection, ingredients…',
              onSubmitted: (_) {
                setState(() => _page = 1);
                _fetch();
              },
              onProductSelected: (pid) => context.push('/product/$pid'),
              onClear: () {
                setState(() => _page = 1);
                _fetch();
              },
            ),
          ),

          // Active category pill (when a category is chosen from the side drawer or picker)
          if (_selectedCategory != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: InputChip(
                  label: Text(
                    _selectedCategory!,
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  onDeleted: () {
                    setState(() {
                      _selectedCategory = null;
                      _page = 1;
                    });
                    _fetch();
                  },
                ),
              ),
            ),

          // Sort & secondary filter bar (matches web Shop toolbar)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 6),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
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
                    onSelected: (v) {
                      setState(() {
                        _inStockOnly = v;
                        _page = 1;
                      });
                      _fetch();
                    },
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
                    onSelected: (v) {
                      setState(() {
                        _onSaleOnly = v;
                        _page = 1;
                      });
                      _fetch();
                    },
                  ),
                  const SizedBox(width: 6),
                  FilterChip(
                    showCheckmark: false,
                    label: Text(
                      _hasPriceFilter
                          ? 'GH₵${_minPrice.isEmpty ? '0' : _minPrice}–${_maxPrice.isEmpty ? '∞' : _maxPrice}'
                          : 'Price Range',
                      style: TextStyle(
                        color: _hasPriceFilter ? Colors.white : AppColors.text,
                        fontWeight:
                            _hasPriceFilter ? FontWeight.w700 : FontWeight.w500,
                        fontSize: 12,
                      ),
                    ),
                    selected: _hasPriceFilter,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) => _openPriceFilterSheet(),
                  ),
                  const SizedBox(width: 10),
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
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                        items: const [
                          DropdownMenuItem(
                              value: 'newest', child: Text('Newest first')),
                          DropdownMenuItem(
                              value: 'price_low',
                              child: Text('Price: low → high')),
                          DropdownMenuItem(
                              value: 'price_high',
                              child: Text('Price: high → low')),
                          DropdownMenuItem(
                              value: 'name_asc', child: Text('Name: A–Z')),
                          DropdownMenuItem(
                              value: 'top_rated', child: Text('Top rated')),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(() {
                              _sortBy = v;
                              _page = 1;
                            });
                            _fetch();
                          }
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Count + Clear filters bar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Showing ${visible.length} of ${_total > visible.length ? _total : visible.length} product${visible.length == 1 ? '' : 's'}',
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

          // Product grid + Pagination bar
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
                        child: CustomScrollView(
                          slivers: [
                            SliverPadding(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 16),
                              sliver: SliverGrid(
                                gridDelegate:
                                    const SliverGridDelegateWithFixedCrossAxisCount(
                                  crossAxisCount: 2,
                                  childAspectRatio: 0.56,
                                  crossAxisSpacing: 10,
                                  mainAxisSpacing: 12,
                                ),
                                delegate: SliverChildBuilderDelegate(
                                  (_, i) {
                                    final p = visible[i];
                                    return ProductCard(
                                      product: p,
                                      heroPrefix: 'shop',
                                      onTap: () =>
                                          context.push('/product/${p.id}'),
                                      onAddToCart: p.inStock
                                          ? () {
                                              context
                                                  .read<CartProvider>()
                                                  .add(p);
                                              ScaffoldMessenger.of(context)
                                                  .showSnackBar(
                                                SnackBar(
                                                  content: Text(
                                                      '${p.name} added to cart'),
                                                  duration: const Duration(
                                                      seconds: 2),
                                                ),
                                              );
                                            }
                                          : null,
                                    );
                                  },
                                  childCount: visible.length,
                                ),
                              ),
                            ),
                            if (totalPages > 1)
                              SliverToBoxAdapter(
                                child: Padding(
                                  padding:
                                      const EdgeInsets.fromLTRB(16, 0, 16, 24),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      OutlinedButton(
                                        onPressed: _page > 1
                                            ? () {
                                                setState(() => _page--);
                                                _fetch();
                                              }
                                            : null,
                                        child: const Text('← Prev'),
                                      ),
                                      Padding(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 14),
                                        child: Text(
                                          'Page $_page of $totalPages',
                                          style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                      OutlinedButton(
                                        onPressed: _page < totalPages
                                            ? () {
                                                setState(() => _page++);
                                                _fetch();
                                              }
                                            : null,
                                        child: const Text('Next →'),
                                      ),
                                    ],
                                  ),
                                ),
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
