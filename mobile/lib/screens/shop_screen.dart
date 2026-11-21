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

  List<String> get _categories {
    final set = <String>{
      'All',
      'Body Cream',
      'Body Butter',
      'Body Oil',
      'Body Scrub',
      'Body Mask',
    };
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

  static const int _maxInlineCategories = 6;

  List<String> get _visibleInlineCategories {
    final all = _categories;
    if (all.length <= _maxInlineCategories) return all;
    final visible = <String>[all.first];
    if (_selectedCategory != null &&
        _selectedCategory!.trim().isNotEmpty &&
        _selectedCategory != 'All' &&
        !all.take(_maxInlineCategories - 1).contains(_selectedCategory)) {
      visible.add(_selectedCategory!);
    }
    for (final cat in all.skip(1)) {
      if (visible.length >= _maxInlineCategories - 1) break;
      if (!visible.contains(cat)) visible.add(cat);
    }
    return visible;
  }

  Future<void> _openCategoryPickerSheet() async {
    final allCategories = _categories;
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _CategoryPickerSheet(
        categories: allCategories,
        selectedCategory: _selectedCategory,
      ),
    );
    if (!mounted || picked == null) return;
    setState(() {
      _selectedCategory = picked == 'All' ? null : picked;
      _page = 1;
    });
    _fetch();
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

  @override
  Widget build(BuildContext context) {
    final visible = _visibleProducts;
    final totalPages = (_total / _pageLimit).ceil().clamp(1, 999);

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

          // Category chips
          SizedBox(
            height: 40,
            child: Builder(
              builder: (_) {
                final inlineCats = _visibleInlineCategories;
                final hasMore = _categories.length > _maxInlineCategories;
                final itemCount = inlineCats.length + (hasMore ? 1 : 0);
                return ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  itemCount: itemCount,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    if (hasMore && i == 1) {
                      return ActionChip(
                        key: const ValueKey('more-categories-chip'),
                        avatar: const Icon(
                          Icons.grid_view_rounded,
                          size: 15,
                          color: AppColors.text,
                        ),
                        label: Text(
                          'All (${_categories.length - 1}) ▾',
                          style: const TextStyle(
                            color: AppColors.text,
                            fontWeight: FontWeight.w600,
                            fontSize: 12.5,
                          ),
                        ),
                        onPressed: _openCategoryPickerSheet,
                      );
                    }
                    final catIdx = hasMore && i > 1 ? i - 1 : i;
                    final cat = inlineCats[catIdx];
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
                        setState(() {
                          _selectedCategory = cat == 'All' ? null : cat;
                          _page = 1;
                        });
                        _fetch();
                      },
                    );
                  },
                );
              },
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

class _CategoryPickerSheet extends StatefulWidget {
  final List<String> categories;
  final String? selectedCategory;

  const _CategoryPickerSheet({
    required this.categories,
    required this.selectedCategory,
  });

  @override
  State<_CategoryPickerSheet> createState() => _CategoryPickerSheetState();
}

class _CategoryPickerSheetState extends State<_CategoryPickerSheet> {
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _query.isEmpty
        ? widget.categories
        : widget.categories
            .where((c) => c.toLowerCase().contains(_query))
            .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.65,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (_, scrollCtrl) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            16,
            16,
            16,
            MediaQuery.of(context).viewInsets.bottom + 16,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Browse Categories (${widget.categories.length - 1})',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (widget.selectedCategory != null)
                    TextButton(
                      onPressed: () => Navigator.pop(context, 'All'),
                      child: const Text('Clear'),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                key: const ValueKey('category-search-field'),
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: 'Search categories...',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  isDense: true,
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.close, size: 18),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() => _query = '');
                          },
                        )
                      : null,
                ),
                onChanged: (v) =>
                    setState(() => _query = v.trim().toLowerCase()),
              ),
              const SizedBox(height: 10),
              Expanded(
                child: filtered.isEmpty
                    ? const Center(
                        child: Text(
                          'No matching categories',
                          style: TextStyle(color: AppColors.muted),
                        ),
                      )
                    : ListView.separated(
                        controller: scrollCtrl,
                        itemCount: filtered.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final cat = filtered[i];
                          final isSelected =
                              cat == (widget.selectedCategory ?? 'All');
                          return ListTile(
                            dense: true,
                            title: Text(
                              cat,
                              style: TextStyle(
                                fontWeight: isSelected
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: isSelected
                                    ? AppColors.accentDark
                                    : AppColors.text,
                              ),
                            ),
                            trailing: isSelected
                                ? const Icon(
                                    Icons.check,
                                    size: 18,
                                    color: AppColors.accentDark,
                                  )
                                : null,
                            onTap: () => Navigator.pop(context, cat),
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
