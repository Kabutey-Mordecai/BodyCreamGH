import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../models/product.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/wishlist_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/whatsapp_helper.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';

const List<String> _productHighlights = [
  'Made with 100% raw Ghanaian shea butter',
  'Formulated for melanin-rich skin',
  'Free from parabens, sulfates & artificial dyes',
  'Cruelty-free & dermatologist tested',
];

const List<Map<String, String>> _pdpTrustRow = [
  {'icon': '🚚', 'label': 'Free delivery', 'sub': 'Over GHS 200'},
  {'icon': '✦', 'label': 'Handcrafted', 'sub': 'In small batches'},
  {'icon': '↩', 'label': '7-day returns', 'sub': 'No questions asked'},
];

class ProductDetailScreen extends StatefulWidget {
  final String productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  final PageController _galleryCtrl = PageController();
  Product? _product;
  List<ProductVariant> _variants = [];
  ProductVariant? _selectedVariant;
  List<Product> _related = [];
  Map<String, dynamic> _settings = {};

  List<Map<String, dynamic>> _reviews = [];
  int _reviewTotal = 0;
  int _reviewTotalPages = 1;
  int _reviewPage = 1;
  String _reviewSort = 'recent'; // recent | helpful | highest | lowest
  Map<String, dynamic>? _reviewSummary;
  Map<String, dynamic>? _canReviewData;
  final Map<String, bool> _helpfulSent = {};
  final Map<String, bool> _expandedReviews = {};

  bool _loading = true;
  int _quantity = 1;
  int _activeImageIdx = 0;

  Timer? _promoTimer;
  String _countdown = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _promoTimer?.cancel();
    _galleryCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final isAuthed = context.read<AuthProvider>().isLoggedIn;
      final results = await Future.wait([
        ApiService.instance.getProduct(widget.productId),
        ApiService.instance
            .getProductVariants(widget.productId)
            .catchError((_) => <dynamic>[]),
        ApiService.instance
            .getRelatedProducts(widget.productId)
            .catchError((_) => <dynamic>[]),
        ApiService.instance
            .getProductReviews(widget.productId, page: 1, sort: _reviewSort)
            .catchError((_) => <String, dynamic>{}),
        ApiService.instance
            .getSettings()
            .catchError((_) => <String, dynamic>{}),
        isAuthed
            ? ApiService.instance
                .canReviewProduct(widget.productId)
                .catchError((_) => <String, dynamic>{})
            : Future.value(<String, dynamic>{}),
      ]);

      final data = results[0] as Map<String, dynamic>;
      final rawVariants = results[1] as List<dynamic>;
      final rawRelated = results[2] as List<dynamic>;
      final reviewPayload = results[3] as Map<String, dynamic>;
      final settings = results[4] as Map<String, dynamic>;
      final canReview = results[5] as Map<String, dynamic>;

      final product = Product.fromJson(data);
      final variants = rawVariants.isNotEmpty
          ? rawVariants
              .whereType<Map<String, dynamic>>()
              .map((v) => ProductVariant.fromJson(v, fallbackPrice: product.price))
              .toList()
          : product.variants;

      final rawReviewList = (reviewPayload['reviews'] as List<dynamic>?) ?? [];

      if (mounted) {
        context.read<WishlistProvider>().recordViewed(product);
        setState(() {
          _product = product;
          _variants = variants;
          _selectedVariant = variants.isNotEmpty ? variants.first : null;
          _related = rawRelated
              .whereType<Map<String, dynamic>>()
              .map(Product.fromJson)
              .toList();
          _reviews = rawReviewList.whereType<Map<String, dynamic>>().toList();
          _reviewTotal = int.tryParse(
                  (reviewPayload['total'] ?? _reviews.length).toString()) ??
              _reviews.length;
          _reviewTotalPages = int.tryParse(
                  (reviewPayload['totalPages'] ?? 1).toString()) ??
              1;
          _reviewSummary = reviewPayload['summary'] is Map<String, dynamic>
              ? reviewPayload['summary'] as Map<String, dynamic>
              : null;
          _settings = settings;
          _canReviewData = canReview.isNotEmpty ? canReview : null;
          _loading = false;
        });
        _initPromoCountdown(product);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _initPromoCountdown(Product product) {
    _promoTimer?.cancel();
    final endsAt = product.promoEndsAt;
    if (endsAt == null) {
      _countdown = '';
      return;
    }
    final diff = endsAt.difference(DateTime.now());
    if (diff.isNegative || diff.inHours >= 24) {
      _countdown = '';
      return;
    }
    void tick() {
      final d = endsAt.difference(DateTime.now());
      if (!mounted) return;
      if (d.isNegative) {
        _promoTimer?.cancel();
        setState(() => _countdown = '');
        return;
      }
      setState(() =>
          _countdown = 'Ends in ${d.inHours}h ${d.inMinutes % 60}m ${d.inSeconds % 60}s');
    }

    tick();
    _promoTimer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  Future<void> _loadReviews({required int page, required String sort}) async {
    try {
      final payload = await ApiService.instance.getProductReviews(
        widget.productId,
        page: page,
        sort: sort,
      );
      final rawList = (payload['reviews'] as List<dynamic>?) ?? [];
      final parsed = rawList.whereType<Map<String, dynamic>>().toList();
      if (!mounted) return;
      setState(() {
        _reviewPage = page;
        _reviewSort = sort;
        _reviews = page == 1 ? parsed : [..._reviews, ...parsed];
        _reviewTotal =
            int.tryParse((payload['total'] ?? _reviews.length).toString()) ??
                _reviews.length;
        _reviewTotalPages =
            int.tryParse((payload['totalPages'] ?? 1).toString()) ?? 1;
        if (payload['summary'] is Map<String, dynamic>) {
          _reviewSummary = payload['summary'] as Map<String, dynamic>;
        }
      });
    } catch (_) {}
  }

  Future<void> _markHelpful(String reviewId) async {
    if (_helpfulSent[reviewId] == true) return;
    setState(() => _helpfulSent[reviewId] = true);
    try {
      await ApiService.instance.markReviewHelpful(widget.productId, reviewId);
      if (!mounted) return;
      setState(() {
        _reviews = _reviews.map((r) {
          if ((r['id'] ?? '').toString() == reviewId) {
            final cur =
                int.tryParse((r['helpful_count'] ?? 0).toString()) ?? 0;
            return {...r, 'helpful_count': cur + 1};
          }
          return r;
        }).toList();
      });
    } catch (_) {
      if (mounted) setState(() => _helpfulSent[reviewId] = false);
    }
  }

  double get _effectivePrice => _selectedVariant?.price ?? _product?.price ?? 0;

  int get _effectiveStock =>
      _selectedVariant?.stockQuantity ?? _product?.stockQuantity ?? 0;

  bool get _inStock => _effectiveStock > 0;

  int get _lowStockThreshold =>
      int.tryParse((_settings['low_stock_threshold'] ?? 5).toString()) ?? 5;

  bool get _isLowStock => _inStock && _effectiveStock < _lowStockThreshold;

  void _addToCart({bool buyNow = false}) {
    if (_product == null) return;
    context.read<CartProvider>().add(
          _product!,
          quantity: _quantity,
          variantId: _selectedVariant?.id,
          variantLabel: _selectedVariant?.label,
          priceOverride: _effectivePrice,
        );
    if (buyNow) {
      context.push('/checkout');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '$_quantity × ${_product!.name}${_selectedVariant != null ? ' (${_selectedVariant!.label})' : ''} added to cart',
          ),
        ),
      );
    }
  }

  void _openLightbox(List<String> images, int initialIndex) {
    if (images.isEmpty) return;
    int currentIdx = initialIndex.clamp(0, images.length - 1);
    final lbCtrl = PageController(initialPage: currentIdx);
    showDialog(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.92),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLbState) => Dialog.fullscreen(
          backgroundColor: Colors.black,
          child: Stack(
            children: [
              PageView.builder(
                controller: lbCtrl,
                itemCount: images.length,
                onPageChanged: (i) => setLbState(() => currentIdx = i),
                itemBuilder: (_, i) => InteractiveViewer(
                  minScale: 1.0,
                  maxScale: 4.0,
                  child: Center(
                    child: CachedNetworkImage(
                      imageUrl: images[i],
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 16,
                right: 16,
                child: IconButton(
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white24,
                    foregroundColor: Colors.white,
                  ),
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ),
              if (images.length > 1)
                Positioned(
                  bottom: 24,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        '${currentIdx + 1} / ${images.length}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openWriteReviewSheet() async {
    final auth = context.read<AuthProvider>();
    if (!auth.isLoggedIn) {
      context.push('/login');
      return;
    }

    int pickedRating = 5;
    final titleCtrl = TextEditingController();
    final commentCtrl = TextEditingController();
    bool submitting = false;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Padding(
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
                    'Write a Customer Review',
                    style: Theme.of(ctx).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      5,
                      (idx) => IconButton(
                        onPressed: () =>
                            setModalState(() => pickedRating = idx + 1),
                        icon: Icon(
                          idx < pickedRating
                              ? Icons.star_rounded
                              : Icons.star_border_rounded,
                          size: 32,
                          color: AppColors.accent,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: titleCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Headline (optional)',
                      hintText: 'e.g. Rich, silky texture!',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: commentCtrl,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Your Review (optional)',
                      hintText: 'Share how this product worked for you...',
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: submitting
                        ? null
                        : () async {
                            setModalState(() => submitting = true);
                            try {
                              await ApiService.instance.createProductReview(
                                widget.productId,
                                rating: pickedRating,
                                title: titleCtrl.text,
                                comment: commentCtrl.text,
                              );
                              if (!ctx.mounted) return;
                              Navigator.pop(ctx);
                              if (mounted) {
                                setState(() {
                                  _canReviewData = {
                                    'can_review': false,
                                    'already_reviewed': true,
                                  };
                                });
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                      'Review submitted and awaiting approval.',
                                    ),
                                  ),
                                );
                              }
                            } catch (e) {
                              if (!ctx.mounted) return;
                              setModalState(() => submitting = false);
                              ScaffoldMessenger.of(ctx).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    e.toString().replaceFirst(
                                        RegExp(r'ApiException\(\d+\): '), ''),
                                  ),
                                ),
                              );
                            }
                          },
                    child: Text(submitting ? 'Submitting...' : 'Submit Review'),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  String _relativeDate(dynamic raw) {
    if (raw == null) return '';
    final dt = DateTime.tryParse(raw.toString());
    if (dt == null) return '';
    final days = DateTime.now().difference(dt).inDays;
    if (days < 1) return 'Today';
    if (days < 7) return '$days day${days == 1 ? '' : 's'} ago';
    if (days < 30) {
      final w = (days / 7).floor();
      return '$w week${w == 1 ? '' : 's'} ago';
    }
    if (days < 365) {
      final m = (days / 30).floor();
      return '$m month${m == 1 ? '' : 's'} ago';
    }
    final y = (days / 365).floor();
    return '$y year${y == 1 ? '' : 's'} ago';
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final wishlist = context.watch<WishlistProvider>();
    final wishlisted =
        _product != null && wishlist.isWishlisted(_product!.id);
    final images = _product != null && _product!.images.isNotEmpty
        ? _product!.images
        : (_product?.imageUrl != null ? [_product!.imageUrl!] : <String>[]);
    final recentlyViewed = wishlist.recentlyViewed
        .where((p) => p.id != widget.productId)
        .take(8)
        .toList();

    final rawWa = (_settings['whatsapp_number'] ?? '').toString();
    final waNumber = WhatsAppHelper.normalizeNumber(rawWa);
    final storeName = (_settings['store_name'] ?? AppConfig.appName).toString();
    final accraEst =
        (_settings['delivery_estimate_accra'] ?? '1–2 business days').toString();
    final nationEst =
        (_settings['delivery_estimate_nationwide'] ?? '3–5 business days')
            .toString();

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/shop'),
        ),
        title: Text(_product?.name ?? 'Product'),
        actions: [
          if (_product != null)
            IconButton(
              icon: Icon(
                wishlisted ? Icons.favorite : Icons.favorite_border,
                color: wishlisted ? AppColors.error : AppColors.primary,
              ),
              onPressed: () => wishlist.toggle(_product!),
              tooltip: 'Save to Wishlist',
            ),
          CartBadge(onPressed: () => context.go('/cart')),
        ],
      ),
      bottomNavigationBar: _product == null || !_inStock
          ? null
          : Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: SafeArea(
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _addToCart(buyNow: false),
                        child: const Text('Add to Cart'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => _addToCart(buyNow: true),
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.accent,
                          foregroundColor: AppColors.primary,
                        ),
                        child: const Text('Buy Now'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _product == null
              ? const Center(child: Text('Product not found'))
              : SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Swipeable image gallery with tap-to-zoom lightbox
                      SizedBox(
                        width: double.infinity,
                        height: 330,
                        child: images.isNotEmpty
                            ? Stack(
                                children: [
                                  PageView.builder(
                                    controller: _galleryCtrl,
                                    itemCount: images.length,
                                    onPageChanged: (i) =>
                                        setState(() => _activeImageIdx = i),
                                    itemBuilder: (_, i) => GestureDetector(
                                      onTap: () => _openLightbox(images, i),
                                      child: CachedNetworkImage(
                                        imageUrl: images[i],
                                        fit: BoxFit.cover,
                                        width: double.infinity,
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    right: 12,
                                    bottom: 12,
                                    child: GestureDetector(
                                      onTap: () =>
                                          _openLightbox(images, _activeImageIdx),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 8, vertical: 5),
                                        decoration: BoxDecoration(
                                          color: Colors.black54,
                                          borderRadius:
                                              BorderRadius.circular(6),
                                        ),
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            const Icon(Icons.zoom_in,
                                                size: 16, color: Colors.white),
                                            if (images.length > 1) ...[
                                              const SizedBox(width: 4),
                                              Text(
                                                '${_activeImageIdx + 1}/${images.length}',
                                                style: const TextStyle(
                                                  color: Colors.white,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              )
                            : const ColoredBox(
                                color: AppColors.blush,
                                child: Center(
                                  child: Icon(Icons.spa_outlined,
                                      size: 64, color: AppColors.accent),
                                ),
                              ),
                      ),

                      // Thumbnail strip when multiple images
                      if (images.length > 1)
                        SizedBox(
                          height: 62,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
                            itemCount: images.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(width: 8),
                            itemBuilder: (_, i) {
                              final selected = i == _activeImageIdx;
                              return GestureDetector(
                                onTap: () {
                                  setState(() => _activeImageIdx = i);
                                  _galleryCtrl.animateToPage(
                                    i,
                                    duration: const Duration(milliseconds: 220),
                                    curve: Curves.easeOut,
                                  );
                                },
                                child: Container(
                                  width: 52,
                                  height: 52,
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(
                                      color: selected
                                          ? AppColors.accent
                                          : AppColors.border,
                                      width: selected ? 2 : 1,
                                    ),
                                  ),
                                  clipBehavior: Clip.antiAlias,
                                  child: CachedNetworkImage(
                                    imageUrl: images[i],
                                    fit: BoxFit.cover,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),

                      Padding(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Category + Rating row
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                if (_product!.category != null)
                                  Text(
                                    _product!.category!.toUpperCase(),
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 1.5,
                                      color: AppColors.accentDark,
                                    ),
                                  ),
                                Row(
                                  children: [
                                    const Icon(Icons.star_rounded,
                                        size: 16, color: AppColors.accent),
                                    const SizedBox(width: 4),
                                    Text(
                                      (_product!.averageRating != null &&
                                              _product!.averageRating! > 0)
                                          ? '${_product!.averageRating!.toStringAsFixed(1)} (${_product!.reviewCount} review${_product!.reviewCount == 1 ? '' : 's'})'
                                          : 'No reviews yet',
                                      style: const TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _product!.name,
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: 10),

                            // Promotion / Sale badge
                            if (_product!.isOnSale &&
                                _product!.effectiveDiscountPercent > 0) ...[
                              Wrap(
                                spacing: 8,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppColors.error,
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(
                                      '${(_product!.promoName ?? 'SALE').toUpperCase()} · ${_product!.effectiveDiscountPercent}% OFF',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: 0.6,
                                      ),
                                    ),
                                  ),
                                  if (_countdown.isNotEmpty)
                                    Text(
                                      _countdown,
                                      style: const TextStyle(
                                        fontSize: 11.5,
                                        fontWeight: FontWeight.w700,
                                        color: AppColors.error,
                                      ),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 6),
                            ],

                            // Price + sale strikethrough + stock chip
                            Row(
                              children: [
                                Text(
                                  '${AppConfig.currencySymbol}${_effectivePrice.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    fontSize: 24,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.primary,
                                  ),
                                ),
                                if (_product!.originalPrice != null &&
                                    _product!.originalPrice! >
                                        _effectivePrice) ...[
                                  const SizedBox(width: 10),
                                  Text(
                                    '${AppConfig.currencySymbol}${_product!.originalPrice!.toStringAsFixed(2)}',
                                    style: const TextStyle(
                                      fontSize: 15,
                                      color: AppColors.muted,
                                      decoration: TextDecoration.lineThrough,
                                    ),
                                  ),
                                ],
                                const Spacer(),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: !_inStock
                                        ? AppColors.error
                                            .withValues(alpha: 0.12)
                                        : _isLowStock
                                            ? const Color(0xFFFEF3C7)
                                            : AppColors.success
                                                .withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    !_inStock
                                        ? 'Out of Stock'
                                        : _isLowStock
                                            ? 'Low stock — only $_effectiveStock left!'
                                            : 'In Stock ($_effectiveStock)',
                                    style: TextStyle(
                                      color: !_inStock
                                          ? AppColors.error
                                          : _isLowStock
                                              ? const Color(0xFF92400E)
                                              : AppColors.success,
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),

                            // Delivery Estimate
                            if (_inStock) ...[
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  const Icon(Icons.local_shipping_outlined,
                                      size: 15, color: AppColors.muted),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      'Accra: $accraEst · Nationwide: $nationEst',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: AppColors.muted,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ],

                            // Variant selector (size / scent)
                            if (_variants.isNotEmpty) ...[
                              const SizedBox(height: 18),
                              const Text(
                                'SELECT SIZE / VARIANT',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.2,
                                  color: AppColors.muted,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: _variants.map((v) {
                                  final selected = _selectedVariant?.id == v.id;
                                  return ChoiceChip(
                                    showCheckmark: false,
                                    label: Text(
                                      '${v.label} · ${AppConfig.currencySymbol}${v.price.toStringAsFixed(2)}',
                                      style: TextStyle(
                                        color: selected
                                            ? Colors.white
                                            : AppColors.text,
                                        fontWeight: selected
                                            ? FontWeight.w700
                                            : FontWeight.w500,
                                        fontSize: 12.5,
                                      ),
                                    ),
                                    selected: selected,
                                    onSelected: v.inStock
                                        ? (_) => setState(() {
                                              _selectedVariant = v;
                                              _quantity = 1;
                                            })
                                        : null,
                                  );
                                }).toList(),
                              ),
                            ],

                            // Quantity picker
                            if (_inStock) ...[
                              const SizedBox(height: 18),
                              Row(
                                children: [
                                  const Text(
                                    'Quantity',
                                    style: TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 14),
                                  ),
                                  const SizedBox(width: 16),
                                  Container(
                                    decoration: BoxDecoration(
                                      color: AppColors.surface,
                                      borderRadius: BorderRadius.circular(6),
                                      border:
                                          Border.all(color: AppColors.border),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(Icons.remove,
                                              size: 18),
                                          onPressed: _quantity > 1
                                              ? () =>
                                                  setState(() => _quantity--)
                                              : null,
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 10),
                                          child: Text(
                                            '$_quantity',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                                fontSize: 15),
                                          ),
                                        ),
                                        IconButton(
                                          icon: const Icon(Icons.add, size: 18),
                                          onPressed: _quantity < _effectiveStock
                                              ? () =>
                                                  setState(() => _quantity++)
                                              : null,
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ],

                            // Wishlist + Order via WhatsApp secondary actions (matches web ProductPage.jsx)
                            const SizedBox(height: 14),
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: () {
                                      wishlist.toggle(_product!);
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(
                                        SnackBar(
                                          content: Text(
                                            wishlisted
                                                ? 'Removed from wishlist'
                                                : 'Saved to wishlist!',
                                          ),
                                        ),
                                      );
                                    },
                                    icon: Icon(
                                      wishlisted
                                          ? Icons.favorite
                                          : Icons.favorite_border,
                                      size: 16,
                                      color: wishlisted
                                          ? AppColors.error
                                          : AppColors.primary,
                                    ),
                                    label: Text(
                                      wishlisted
                                          ? 'Saved to Wishlist'
                                          : 'Add to Wishlist',
                                    ),
                                  ),
                                ),
                                if (waNumber.isNotEmpty) ...[
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: FilledButton.icon(
                                      style: FilledButton.styleFrom(
                                        backgroundColor:
                                            const Color(0xFF25D366),
                                        foregroundColor: Colors.white,
                                      ),
                                      onPressed: () {
                                        final vText = _selectedVariant != null
                                            ? ' (${_selectedVariant!.label})'
                                            : '';
                                        WhatsAppHelper.openWhatsApp(
                                          rawNumber: waNumber,
                                          message:
                                              "Hi $storeName, I'd like to order ${_quantity}x ${_product!.name}$vText (GHS ${_effectivePrice.toStringAsFixed(2)}).",
                                        );
                                      },
                                      icon: const Icon(
                                          Icons.chat_bubble_outline,
                                          size: 16),
                                      label: const Text('Order via WhatsApp'),
                                    ),
                                  ),
                                ],
                              ],
                            ),

                            // Trust Row under CTA (matches web ProductPage.jsx TRUST_ROW)
                            const SizedBox(height: 16),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 10),
                              decoration: BoxDecoration(
                                color: AppColors.blush,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceAround,
                                children: _pdpTrustRow
                                    .map(
                                      (t) => Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(t['icon']!,
                                              style: const TextStyle(
                                                  fontSize: 14)),
                                          const SizedBox(width: 5),
                                          Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                t['label']!,
                                                style: const TextStyle(
                                                  fontSize: 10.5,
                                                  fontWeight: FontWeight.w700,
                                                  color: AppColors.primary,
                                                ),
                                              ),
                                              Text(
                                                t['sub']!,
                                                style: const TextStyle(
                                                  fontSize: 9.5,
                                                  color: AppColors.muted,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ],
                                      ),
                                    )
                                    .toList(),
                              ),
                            ),

                            const SizedBox(height: 22),
                            const Divider(),
                            const SizedBox(height: 16),

                            // Description + Static Highlights
                            Text(
                              'About This Product',
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              _product!.description.isNotEmpty
                                  ? _product!.description
                                  : 'Handcrafted in Ghana with pure unrefined shea butter and nourishing botanical extracts.',
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            const SizedBox(height: 12),
                            ..._productHighlights.map(
                              (h) => Padding(
                                padding: const EdgeInsets.only(bottom: 6),
                                child: Row(
                                  children: [
                                    const Icon(Icons.check_circle_outline,
                                        size: 16, color: AppColors.accentDark),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        h,
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: AppColors.text,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),

                            const SizedBox(height: 24),
                            const Divider(),
                            const SizedBox(height: 16),

                            // Customer Reviews section with distribution bars, sort, helpful votes & pagination
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Customer Reviews ($_reviewTotal)',
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                                if (!auth.isLoggedIn ||
                                    _canReviewData == null ||
                                    _canReviewData!['can_review'] == true)
                                  OutlinedButton.icon(
                                    onPressed: _openWriteReviewSheet,
                                    style: OutlinedButton.styleFrom(
                                      minimumSize: const Size(0, 36),
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 12),
                                    ),
                                    icon: const Icon(Icons.rate_review_outlined,
                                        size: 16),
                                    label: Text(
                                      auth.isLoggedIn
                                          ? 'Write Review'
                                          : 'Log in to Review',
                                    ),
                                  ),
                              ],
                            ),

                            if (auth.isLoggedIn && _canReviewData != null) ...[
                              if (_canReviewData!['already_reviewed'] == true)
                                const Padding(
                                  padding: EdgeInsets.only(top: 6),
                                  child: Text(
                                    '✓ Your review has been submitted and is awaiting approval.',
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.accentDark,
                                    ),
                                  ),
                                )
                              else if (_canReviewData!['can_review'] == false)
                                const Padding(
                                  padding: EdgeInsets.only(top: 6),
                                  child: Text(
                                    'Purchase this product to leave a verified review.',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: AppColors.muted,
                                    ),
                                  ),
                                ),
                            ],

                            // Rating distribution summary (5★ to 1★)
                            if (_reviewSummary != null &&
                                (int.tryParse((_reviewSummary!['review_count'] ?? 0)
                                            .toString()) ??
                                        0) >
                                    0) ...[
                              const SizedBox(height: 12),
                              Container(
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: AppColors.surface,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Column(
                                  children: [5, 4, 3, 2, 1].map((star) {
                                    final dist = _reviewSummary!['distribution'];
                                    final totalCount = int.tryParse(
                                            (_reviewSummary!['review_count'] ?? 1)
                                                .toString()) ??
                                        1;
                                    final starCount = dist is Map
                                        ? (int.tryParse((dist['$star'] ??
                                                    dist[star] ??
                                                    0)
                                                .toString()) ??
                                            0)
                                        : 0;
                                    final pct = totalCount > 0
                                        ? ((starCount / totalCount) * 100).round()
                                        : 0;
                                    return Padding(
                                      padding: const EdgeInsets.symmetric(
                                          vertical: 2),
                                      child: Row(
                                        children: [
                                          SizedBox(
                                            width: 30,
                                            child: Text(
                                              '$star ★',
                                              style: const TextStyle(
                                                fontSize: 11.5,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                          Expanded(
                                            child: ClipRRect(
                                              borderRadius:
                                                  BorderRadius.circular(3),
                                              child: LinearProgressIndicator(
                                                value: (pct / 100).clamp(0.0, 1.0),
                                                minHeight: 6,
                                                backgroundColor:
                                                    AppColors.border,
                                                valueColor:
                                                    const AlwaysStoppedAnimation<
                                                            Color>(
                                                        AppColors.accent),
                                              ),
                                            ),
                                          ),
                                          SizedBox(
                                            width: 36,
                                            child: Text(
                                              '$pct%',
                                              textAlign: TextAlign.right,
                                              style: const TextStyle(
                                                fontSize: 11,
                                                color: AppColors.muted,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    );
                                  }).toList(),
                                ),
                              ),
                            ],

                            // Sort chips for reviews
                            if (_reviews.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  children: [
                                    {'key': 'recent', 'label': 'Most Recent'},
                                    {'key': 'helpful', 'label': 'Most Helpful'},
                                    {'key': 'highest', 'label': 'Highest Rated'},
                                    {'key': 'lowest', 'label': 'Lowest Rated'},
                                  ].map((s) {
                                    final active = _reviewSort == s['key'];
                                    return Padding(
                                      padding: const EdgeInsets.only(right: 6),
                                      child: ChoiceChip(
                                        showCheckmark: false,
                                        visualDensity: VisualDensity.compact,
                                        label: Text(
                                          s['label']!,
                                          style: TextStyle(
                                            fontSize: 11.5,
                                            color: active
                                                ? Colors.white
                                                : AppColors.text,
                                            fontWeight: active
                                                ? FontWeight.w700
                                                : FontWeight.w500,
                                          ),
                                        ),
                                        selected: active,
                                        onSelected: (_) => _loadReviews(
                                            page: 1, sort: s['key']!),
                                      ),
                                    );
                                  }).toList(),
                                ),
                              ),
                            ],

                            const SizedBox(height: 12),
                            if (_reviews.isEmpty)
                              const Text(
                                'No reviews yet — be the first to review this product.',
                                style: TextStyle(color: AppColors.muted),
                              )
                            else
                              ..._reviews.map((r) {
                                final rid = (r['id'] ?? '').toString();
                                final rating = int.tryParse(
                                            (r['rating'] ?? 5).toString())
                                        ?.clamp(1, 5) ??
                                    5;
                                final author = r['first_name'] != null
                                    ? '${r['first_name']} ${r['last_initial'] ?? ''}.'
                                    : (r['customer_name'] ?? 'Verified Buyer')
                                        .toString();
                                final title =
                                    (r['title'] ?? '').toString().trim();
                                final fullBody = (r['body'] ?? r['comment'] ?? '')
                                    .toString()
                                    .trim();
                                final isLong = fullBody.length > 200;
                                final expanded = _expandedReviews[rid] == true;
                                final bodyText = isLong && !expanded
                                    ? '${fullBody.substring(0, 200)}…'
                                    : fullBody;
                                final helpfulCount = int.tryParse(
                                        (r['helpful_count'] ?? 0).toString()) ??
                                    0;
                                final sentHelpful = _helpfulSent[rid] == true;
                                final relDate = _relativeDate(r['created_at']);

                                return Card(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  child: Padding(
                                    padding: const EdgeInsets.all(14),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.spaceBetween,
                                          children: [
                                            Row(
                                              children: List.generate(
                                                5,
                                                (idx) => Icon(
                                                  idx < rating
                                                      ? Icons.star_rounded
                                                      : Icons
                                                          .star_border_rounded,
                                                  size: 14,
                                                  color: AppColors.accent,
                                                ),
                                              ),
                                            ),
                                            const Text(
                                              '✓ Verified Purchase',
                                              style: TextStyle(
                                                fontSize: 10.5,
                                                fontWeight: FontWeight.w700,
                                                color: AppColors.accentDark,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.spaceBetween,
                                          children: [
                                            Text(
                                              author,
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                                fontSize: 13,
                                              ),
                                            ),
                                            if (relDate.isNotEmpty)
                                              Text(
                                                relDate,
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  color: AppColors.muted,
                                                ),
                                              ),
                                          ],
                                        ),
                                        if (title.isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(
                                            title,
                                            style: const TextStyle(
                                              fontWeight: FontWeight.w700,
                                              fontSize: 13.5,
                                            ),
                                          ),
                                        ],
                                        if (bodyText.isNotEmpty) ...[
                                          const SizedBox(height: 4),
                                          Text(
                                            bodyText,
                                            style:
                                                const TextStyle(fontSize: 13.5),
                                          ),
                                          if (isLong)
                                            GestureDetector(
                                              onTap: () => setState(() =>
                                                  _expandedReviews[rid] =
                                                      !expanded),
                                              child: Padding(
                                                padding: const EdgeInsets.only(
                                                    top: 4),
                                                child: Text(
                                                  expanded
                                                      ? 'Show less'
                                                      : 'Read more',
                                                  style: const TextStyle(
                                                    fontSize: 12,
                                                    fontWeight: FontWeight.w700,
                                                    color: AppColors.accentDark,
                                                  ),
                                                ),
                                              ),
                                            ),
                                        ],
                                        if (rid.isNotEmpty) ...[
                                          const SizedBox(height: 8),
                                          InkWell(
                                            onTap: sentHelpful
                                                ? null
                                                : () => _markHelpful(rid),
                                            child: Text(
                                              sentHelpful
                                                  ? '✓ Marked helpful'
                                                  : 'Helpful? Yes ($helpfulCount)',
                                              style: TextStyle(
                                                fontSize: 11.5,
                                                fontWeight: FontWeight.w600,
                                                color: sentHelpful
                                                    ? AppColors.accentDark
                                                    : AppColors.muted,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                );
                              }),

                            if (_reviewPage < _reviewTotalPages)
                              Center(
                                child: OutlinedButton(
                                  onPressed: () => _loadReviews(
                                    page: _reviewPage + 1,
                                    sort: _reviewSort,
                                  ),
                                  child: const Text('Load more reviews'),
                                ),
                              ),

                            // Related Products ("You May Also Like")
                            if (_related.isNotEmpty) ...[
                              const SizedBox(height: 24),
                              Text(
                                'You May Also Like',
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 12),
                              SizedBox(
                                height: 265,
                                child: ListView.separated(
                                  scrollDirection: Axis.horizontal,
                                  itemCount: _related.length,
                                  separatorBuilder: (_, __) =>
                                      const SizedBox(width: 10),
                                  itemBuilder: (_, i) {
                                    final p = _related[i];
                                    return SizedBox(
                                      width: 168,
                                      child: ProductCard(
                                        product: p,
                                        heroPrefix: 'related',
                                        onTap: () =>
                                            context.push('/product/${p.id}'),
                                      ),
                                    );
                                  },
                                ),
                              ),
                            ],

                            // Recently Viewed ("Recently Viewed")
                            if (recentlyViewed.isNotEmpty) ...[
                              const SizedBox(height: 24),
                              Text(
                                'Recently Viewed',
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 12),
                              SizedBox(
                                height: 265,
                                child: ListView.separated(
                                  scrollDirection: Axis.horizontal,
                                  itemCount: recentlyViewed.length,
                                  separatorBuilder: (_, __) =>
                                      const SizedBox(width: 10),
                                  itemBuilder: (_, i) {
                                    final p = recentlyViewed[i];
                                    return SizedBox(
                                      width: 168,
                                      child: ProductCard(
                                        product: p,
                                        heroPrefix: 'pdp-recent',
                                        onTap: () =>
                                            context.push('/product/${p.id}'),
                                      ),
                                    );
                                  },
                                ),
                              ),
                            ],

                            const SizedBox(height: 28),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
