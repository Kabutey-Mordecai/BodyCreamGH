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
  final List<String> _selectedBrands = [];
  String _minRating = '';
  String _sortBy = 'newest'; // newest | price_low | price_high | name_asc | top_rated
  bool _inStockOnly = false;
  bool _onSaleOnly = false;
  String _minPrice = '';
  String _maxPrice = '';

  List<String> _apiCategories = const [];
  List<Map<String, dynamic>> _facetBrands = const [];
  double _priceBoundMin = 0;
  double _priceBoundMax = 600;
  String _storeName = 'BODYCREAM GH';

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

  Future<void> _fetchFacets() async {
    try {
      final data = await ApiService.instance.getFacets(
        category: (_selectedCategory != null && _selectedCategory != 'All')
            ? _selectedCategory
            : null,
        search: _searchCtrl.text.trim().isNotEmpty
            ? _searchCtrl.text.trim()
            : null,
        inStock: _inStockOnly ? true : null,
        onSale: _onSaleOnly ? true : null,
      );
      if (!mounted) return;
      final cats = (data['categories'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map((e) => e['category']?.toString().trim() ?? '')
          .where((e) => e.isNotEmpty)
          .toList();
      final brs = (data['brands'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map((e) => {
                'brand': e['brand']?.toString().trim() ?? '',
                'count': int.tryParse((e['count'] ?? 0).toString()) ?? 0,
              })
          .where((e) => (e['brand'] as String).isNotEmpty)
          .toList();
      final priceMap = data['price'] is Map ? data['price'] as Map : null;
      setState(() {
        if (cats.isNotEmpty) _apiCategories = cats;
        _facetBrands = brs;
        if (priceMap != null) {
          final lo = double.tryParse((priceMap['min'] ?? 0).toString()) ?? 0;
          final hi = double.tryParse((priceMap['max'] ?? 600).toString()) ?? 600;
          _priceBoundMin = lo >= 0 ? lo : 0;
          _priceBoundMax = hi > _priceBoundMin + 10 ? hi : _priceBoundMin + 100;
        }
      });
    } catch (_) {
      // Fallback to categories endpoint if facets is unavailable
      try {
        final cats = await ApiService.instance.getCategories();
        if (mounted && cats.isNotEmpty) {
          setState(() => _apiCategories = cats);
        }
      } catch (_) {}
    }
  }

  Future<void> _fetchSettings() async {
    try {
      final data = await ApiService.instance.getSettings();
      final name = data['store_name']?.toString().trim() ?? '';
      if (mounted && name.isNotEmpty) {
        setState(() => _storeName = name.toUpperCase());
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
    _fetchFacets();
    _fetchSettings();
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
        brand: _selectedBrands.isNotEmpty ? _selectedBrands.join(',') : null,
        search: _searchCtrl.text.trim().isNotEmpty
            ? _searchCtrl.text.trim()
            : null,
        sort: _sortBy,
        minPrice: _minPrice.isNotEmpty ? _minPrice : null,
        maxPrice: _maxPrice.isNotEmpty ? _maxPrice : null,
        minRating: _minRating.isNotEmpty ? _minRating : null,
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
      _selectedBrands.isNotEmpty ||
      _minRating.isNotEmpty ||
      _searchCtrl.text.trim().isNotEmpty ||
      _inStockOnly ||
      _onSaleOnly ||
      _hasPriceFilter ||
      _sortBy != 'newest';

  void _clearFilters() {
    _searchCtrl.clear();
    setState(() {
      _selectedCategory = null;
      _selectedBrands.clear();
      _minRating = '';
      _inStockOnly = false;
      _onSaleOnly = false;
      _minPrice = '';
      _maxPrice = '';
      _sortBy = 'newest';
      _page = 1;
    });
    _fetchFacets();
    _fetch();
  }

  Future<void> _openBrandFilterSheet() async {
    final searchCtrl = TextEditingController();
    final draft = List<String>.from(_selectedBrands);
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          final q = searchCtrl.text.trim().toLowerCase();
          final filtered = _facetBrands.where((b) {
            final name = (b['brand'] as String).toLowerCase();
            return q.isEmpty || name.contains(q);
          }).toList();

          return DraggableScrollableSheet(
            initialChildSize: 0.72,
            minChildSize: 0.45,
            maxChildSize: 0.92,
            expand: false,
            builder: (_, scrollCtrl) => Padding(
              padding: EdgeInsets.fromLTRB(
                18,
                16,
                18,
                MediaQuery.of(ctx).viewInsets.bottom + 16,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Filter by Brand (${_facetBrands.length})',
                        style: Theme.of(ctx).textTheme.titleLarge,
                      ),
                      if (draft.isNotEmpty)
                        TextButton(
                          onPressed: () => setSheetState(() => draft.clear()),
                          child: const Text('Clear all'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: searchCtrl,
                    onChanged: (_) => setSheetState(() {}),
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search, size: 19),
                      hintText: 'Search brands (e.g. CeraVe, Fenty, Nivea…)',
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Expanded(
                    child: filtered.isEmpty
                        ? const Center(
                            child: Text(
                              'No matching brands',
                              style: TextStyle(color: AppColors.muted),
                            ),
                          )
                        : ListView.builder(
                            controller: scrollCtrl,
                            itemCount: filtered.length,
                            itemBuilder: (_, i) {
                              final name = filtered[i]['brand'] as String;
                              final count = filtered[i]['count'] as int;
                              final selected = draft.any(
                                (d) => d.toLowerCase() == name.toLowerCase(),
                              );
                              return CheckboxListTile(
                                value: selected,
                                dense: true,
                                controlAffinity: ListTileControlAffinity.leading,
                                activeColor: AppColors.primary,
                                title: Text(
                                  name,
                                  style: TextStyle(
                                    fontWeight: selected
                                        ? FontWeight.w700
                                        : FontWeight.w500,
                                  ),
                                ),
                                secondary: Text(
                                  '$count',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.muted,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                onChanged: (_) => setSheetState(() {
                                  if (selected) {
                                    draft.removeWhere((d) =>
                                        d.toLowerCase() == name.toLowerCase());
                                  } else {
                                    draft.add(name);
                                  }
                                }),
                              );
                            },
                          ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      setState(() {
                        _selectedBrands
                          ..clear()
                          ..addAll(draft);
                        _page = 1;
                      });
                      _fetch();
                    },
                    child: Text(
                      draft.isEmpty
                          ? 'Show All Brands'
                          : 'Apply (${draft.length} selected)',
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _openRatingFilterSheet() async {
    await showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Product Rating',
                style: Theme.of(ctx).textTheme.titleLarge,
              ),
              const SizedBox(height: 10),
              for (final stars in [4, 3, 2, 1])
                ListTile(
                  dense: true,
                  leading: Text(
                    '${'★' * stars}${'☆' * (5 - stars)}',
                    style: const TextStyle(
                      color: AppColors.accent,
                      fontSize: 16,
                      letterSpacing: 1.2,
                    ),
                  ),
                  title: const Text('& up'),
                  trailing: _minRating == '$stars'
                      ? const Icon(Icons.check, color: AppColors.accentDark)
                      : null,
                  onTap: () {
                    Navigator.pop(ctx);
                    setState(() {
                      _minRating = _minRating == '$stars' ? '' : '$stars';
                      _page = 1;
                    });
                    _fetch();
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openPriceFilterSheet() async {
    final minCtrl = TextEditingController(text: _minPrice);
    final maxCtrl = TextEditingController(text: _maxPrice);
    double sliderStart =
        (double.tryParse(_minPrice) ?? _priceBoundMin).clamp(_priceBoundMin, _priceBoundMax);
    double sliderEnd =
        (double.tryParse(_maxPrice) ?? _priceBoundMax).clamp(sliderStart, _priceBoundMax);

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
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
              const SizedBox(height: 10),
              RangeSlider(
                values: RangeValues(sliderStart, sliderEnd),
                min: _priceBoundMin,
                max: _priceBoundMax,
                activeColor: AppColors.accent,
                inactiveColor: AppColors.border,
                labels: RangeLabels(
                  'GH₵${sliderStart.round()}',
                  'GH₵${sliderEnd.round()}',
                ),
                onChanged: (vals) => setSheetState(() {
                  sliderStart = vals.start;
                  sliderEnd = vals.end;
                  minCtrl.text = vals.start.round().toString();
                  maxCtrl.text = vals.end.round().toString();
                }),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: minCtrl,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: 'Min Price',
                        hintText: _priceBoundMin.round().toString(),
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
                      decoration: InputDecoration(
                        labelText: 'Max Price',
                        hintText: _priceBoundMax.round().toString(),
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
                  Expanded(
                    child: Text(
                      _storeName,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
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

          // Active category / brand / rating pills
          if (_selectedCategory != null ||
              _selectedBrands.isNotEmpty ||
              _minRating.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    if (_selectedCategory != null)
                      InputChip(
                        label: Text(
                          _selectedCategory!,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        onDeleted: () {
                          setState(() {
                            _selectedCategory = null;
                            _page = 1;
                          });
                          _fetchFacets();
                          _fetch();
                        },
                      ),
                    for (final b in _selectedBrands)
                      InputChip(
                        label: Text(
                          'Brand: $b',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        onDeleted: () {
                          setState(() {
                            _selectedBrands.remove(b);
                            _page = 1;
                          });
                          _fetch();
                        },
                      ),
                    if (_minRating.isNotEmpty)
                      InputChip(
                        label: Text(
                          '$_minRating★ & up',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        onDeleted: () {
                          setState(() {
                            _minRating = '';
                            _page = 1;
                          });
                          _fetch();
                        },
                      ),
                  ],
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
                  if (_facetBrands.isNotEmpty) ...[
                    FilterChip(
                      showCheckmark: false,
                      label: Text(
                        _selectedBrands.isEmpty
                            ? 'Brand'
                            : _selectedBrands.length == 1
                                ? _selectedBrands.first
                                : 'Brands (${_selectedBrands.length})',
                        style: TextStyle(
                          color: _selectedBrands.isNotEmpty
                              ? Colors.white
                              : AppColors.text,
                          fontWeight: _selectedBrands.isNotEmpty
                              ? FontWeight.w700
                              : FontWeight.w500,
                          fontSize: 12,
                        ),
                      ),
                      selected: _selectedBrands.isNotEmpty,
                      visualDensity: VisualDensity.compact,
                      onSelected: (_) => _openBrandFilterSheet(),
                    ),
                    const SizedBox(width: 6),
                  ],
                  FilterChip(
                    showCheckmark: false,
                    label: Text(
                      _minRating.isNotEmpty ? '$_minRating★+' : 'Rating',
                      style: TextStyle(
                        color:
                            _minRating.isNotEmpty ? Colors.white : AppColors.text,
                        fontWeight: _minRating.isNotEmpty
                            ? FontWeight.w700
                            : FontWeight.w500,
                        fontSize: 12,
                      ),
                    ),
                    selected: _minRating.isNotEmpty,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) => _openRatingFilterSheet(),
                  ),
                  const SizedBox(width: 6),
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
