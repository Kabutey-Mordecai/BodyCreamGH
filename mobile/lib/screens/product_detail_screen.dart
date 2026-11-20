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
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';

class ProductDetailScreen extends StatefulWidget {
  final String productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Product? _product;
  List<ProductVariant> _variants = [];
  ProductVariant? _selectedVariant;
  List<Product> _related = [];
  List<Map<String, dynamic>> _reviews = [];
  bool _loading = true;
  int _quantity = 1;
  int _activeImageIdx = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        ApiService.instance.getProduct(widget.productId),
        ApiService.instance
            .getProductVariants(widget.productId)
            .catchError((_) => <dynamic>[]),
        ApiService.instance
            .getRelatedProducts(widget.productId)
            .catchError((_) => <dynamic>[]),
        ApiService.instance
            .getProductReviews(widget.productId)
            .catchError((_) => <String, dynamic>{}),
      ]);

      final data = results[0] as Map<String, dynamic>;
      final rawVariants = results[1] as List<dynamic>;
      final rawRelated = results[2] as List<dynamic>;
      final reviewPayload = results[3] as Map<String, dynamic>;

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
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  double get _effectivePrice => _selectedVariant?.price ?? _product?.price ?? 0;

  int get _effectiveStock =>
      _selectedVariant?.stockQuantity ?? _product?.stockQuantity ?? 0;

  bool get _inStock => _effectiveStock > 0;

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
                      labelText: 'Your Review *',
                      hintText: 'Share how this product worked for you...',
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: submitting
                        ? null
                        : () async {
                            if (commentCtrl.text.trim().isEmpty) return;
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
                              _load();
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Thank you for your review!'),
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

  @override
  Widget build(BuildContext context) {
    final wishlist = context.watch<WishlistProvider>();
    final wishlisted =
        _product != null && wishlist.isWishlisted(_product!.id);
    final images = _product != null && _product!.images.isNotEmpty
        ? _product!.images
        : (_product?.imageUrl != null ? [_product!.imageUrl!] : <String>[]);

    return Scaffold(
      appBar: AppBar(
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
                      // Swipeable image gallery
                      SizedBox(
                        width: double.infinity,
                        height: 330,
                        child: images.isNotEmpty
                            ? Stack(
                                children: [
                                  PageView.builder(
                                    itemCount: images.length,
                                    onPageChanged: (i) =>
                                        setState(() => _activeImageIdx = i),
                                    itemBuilder: (_, i) => CachedNetworkImage(
                                      imageUrl: images[i],
                                      fit: BoxFit.cover,
                                      width: double.infinity,
                                    ),
                                  ),
                                  if (images.length > 1)
                                    Positioned(
                                      bottom: 12,
                                      left: 0,
                                      right: 0,
                                      child: Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        children: List.generate(
                                          images.length,
                                          (i) => Container(
                                            width: i == _activeImageIdx ? 18 : 7,
                                            height: 7,
                                            margin: const EdgeInsets.symmetric(
                                                horizontal: 3),
                                            decoration: BoxDecoration(
                                              color: i == _activeImageIdx
                                                  ? AppColors.accent
                                                  : Colors.white
                                                      .withValues(alpha: 0.6),
                                              borderRadius:
                                                  BorderRadius.circular(4),
                                            ),
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
                                if (_product!.averageRating != null &&
                                    _product!.averageRating! > 0)
                                  Row(
                                    children: [
                                      const Icon(Icons.star_rounded,
                                          size: 16, color: AppColors.accent),
                                      const SizedBox(width: 4),
                                      Text(
                                        '${_product!.averageRating!.toStringAsFixed(1)} (${_product!.reviewCount} reviews)',
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
                                    color: _inStock
                                        ? AppColors.success
                                            .withValues(alpha: 0.12)
                                        : AppColors.error
                                            .withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    _inStock
                                        ? 'In Stock ($_effectiveStock)'
                                        : 'Out of Stock',
                                    style: TextStyle(
                                      color: _inStock
                                          ? AppColors.success
                                          : AppColors.error,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),

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
                                    label: Text(
                                      '${v.label} · ${AppConfig.currencySymbol}${v.price.toStringAsFixed(2)}',
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

                            const SizedBox(height: 22),
                            const Divider(),
                            const SizedBox(height: 16),

                            // Description
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

                            const SizedBox(height: 26),
                            const Divider(),
                            const SizedBox(height: 16),

                            // Customer Reviews section
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Customer Reviews (${_reviews.length})',
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                                OutlinedButton.icon(
                                  onPressed: _openWriteReviewSheet,
                                  style: OutlinedButton.styleFrom(
                                    minimumSize: const Size(0, 36),
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 12),
                                  ),
                                  icon: const Icon(Icons.rate_review_outlined,
                                      size: 16),
                                  label: const Text('Write Review'),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            if (_reviews.isEmpty)
                              const Text(
                                'No reviews yet — be the first to review this product.',
                                style: TextStyle(color: AppColors.muted),
                              )
                            else
                              ..._reviews.take(5).map((r) {
                                final rating = int.tryParse(
                                            (r['rating'] ?? 5).toString())
                                        ?.clamp(1, 5) ??
                                    5;
                                final author = (r['customer_name'] ??
                                        r['first_name'] ??
                                        'Verified Buyer')
                                    .toString();
                                final comment =
                                    (r['comment'] ?? '').toString().trim();
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
                                            Text(
                                              author,
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                                fontSize: 13.5,
                                              ),
                                            ),
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
                                          ],
                                        ),
                                        if (comment.isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(comment,
                                              style: const TextStyle(
                                                  fontSize: 13.5)),
                                        ],
                                      ],
                                    ),
                                  ),
                                );
                              }),

                            // Related Products ("You May Also Like")
                            if (_related.isNotEmpty) ...[
                              const SizedBox(height: 24),
                              Text(
                                'You May Also Like',
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 12),
                              SizedBox(
                                height: 255,
                                child: ListView.separated(
                                  scrollDirection: Axis.horizontal,
                                  itemCount: _related.length,
                                  separatorBuilder: (_, __) =>
                                      const SizedBox(width: 10),
                                  itemBuilder: (_, i) {
                                    final p = _related[i];
                                    return SizedBox(
                                      width: 165,
                                      child: ProductCard(
                                        product: p,
                                        heroPrefix: 'related',
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
                                                  ),
                                                );
                                              }
                                            : null,
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
