import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../providers/wishlist_provider.dart';
import '../theme/app_theme.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;
  final VoidCallback? onAddToCart;
  final String heroPrefix;

  const ProductCard({
    super.key,
    required this.product,
    required this.onTap,
    this.onAddToCart,
    this.heroPrefix = 'grid',
  });

  @override
  Widget build(BuildContext context) {
    final wishlist = context.watch<WishlistProvider>();
    final cart = context.watch<CartProvider>();
    final wishlisted = wishlist.isWishlisted(product.id);
    final cartQty = cart.quantityOf(product.id);
    final discountPct = product.effectiveDiscountPercent;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border, width: 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Product image + badges + wishlist heart
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Hero(
                    tag: 'product-img-$heroPrefix-${product.id}',
                    child: product.imageUrl != null
                        ? CachedNetworkImage(
                            imageUrl: product.imageUrl!,
                            fit: BoxFit.cover,
                            width: double.infinity,
                            placeholder: (_, __) => const ColoredBox(
                              color: AppColors.blush,
                              child: Center(
                                child: SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                ),
                              ),
                            ),
                            errorWidget: (_, __, ___) => const _Placeholder(),
                          )
                        : const _Placeholder(),
                  ),

                  // Top-left status / promo / low-stock badges (matches web ProductCard.jsx)
                  Positioned(
                    top: 8,
                    left: 8,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (!product.inStock)
                          _BadgePill(
                            label: 'SOLD OUT',
                            bg: AppColors.dark.withValues(alpha: 0.86),
                            fg: Colors.white,
                          )
                        else if (discountPct > 0)
                          _BadgePill(
                            label: product.promoName != null &&
                                    product.promoName!.isNotEmpty
                                ? '${product.promoName!.toUpperCase()} · -$discountPct%'
                                : 'SALE · -$discountPct%',
                            bg: AppColors.error,
                            fg: Colors.white,
                          )
                        else if (product.isNew)
                          const _BadgePill(
                            label: 'NEW',
                            bg: AppColors.primary,
                            fg: AppColors.accent,
                          ),
                        if (product.isLowStock) ...[
                          const SizedBox(height: 4),
                          _BadgePill(
                            label: 'Only ${product.stockQuantity} left',
                            bg: const Color(0xFFFEF3C7),
                            fg: const Color(0xFF92400E),
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Top-right Wishlist Heart toggle
                  Positioned(
                    top: 6,
                    right: 6,
                    child: Material(
                      color: Colors.white.withValues(alpha: 0.9),
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: () {
                          wishlist.toggle(product);
                          ScaffoldMessenger.of(context)
                            ..hideCurrentSnackBar()
                            ..showSnackBar(
                              SnackBar(
                                content: Text(
                                  wishlisted
                                      ? 'Removed from wishlist'
                                      : '${product.name} saved to wishlist',
                                ),
                                duration: const Duration(milliseconds: 1200),
                              ),
                            );
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(6),
                          child: Icon(
                            wishlisted ? Icons.favorite : Icons.favorite_border,
                            size: 17,
                            color: wishlisted ? AppColors.error : AppColors.primary,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Details + rating + quick add / stepper
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          (product.category ?? 'SKINCARE').toUpperCase(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.0,
                            color: AppColors.accentDark,
                          ),
                        ),
                      ),
                      if (product.averageRating != null && product.averageRating! > 0)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.star_rounded, size: 13, color: AppColors.accent),
                            const SizedBox(width: 2),
                            Text(
                              product.averageRating!.toStringAsFixed(1),
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppColors.primary,
                              ),
                            ),
                            if (product.reviewCount > 0)
                              Text(
                                ' (${product.reviewCount})',
                                style: const TextStyle(
                                  fontSize: 10.5,
                                  color: AppColors.muted,
                                ),
                              ),
                          ],
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  SizedBox(
                    height: 36,
                    child: Text(
                      product.name,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontFamily: 'serif',
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            height: 1.25,
                          ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text(
                        '${AppConfig.currencySymbol}${product.price.toStringAsFixed(2)}',
                        style: const TextStyle(
                          color: AppColors.primary,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (product.originalPrice != null &&
                          product.originalPrice! > product.price) ...[
                        const SizedBox(width: 6),
                        Text(
                          '${AppConfig.currencySymbol}${product.originalPrice!.toStringAsFixed(2)}',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11.5,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 7),
                  SizedBox(
                    width: double.infinity,
                    height: 33,
                    child: !product.inStock
                        ? OutlinedButton(
                            onPressed: null,
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size(0, 33),
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                              side: const BorderSide(color: AppColors.border),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(4),
                              ),
                              textStyle: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            child: const Text('Sold Out'),
                          )
                        : cartQty > 0
                            // Inline quantity stepper (matches web ProductCard.jsx)
                            ? Container(
                                decoration: BoxDecoration(
                                  color: AppColors.primary,
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    InkWell(
                                      onTap: () => cart.updateQuantity(
                                        product.id,
                                        cartQty - 1,
                                      ),
                                      child: const Padding(
                                        padding: EdgeInsets.symmetric(
                                            horizontal: 10, vertical: 4),
                                        child: Icon(Icons.remove,
                                            size: 16, color: Colors.white),
                                      ),
                                    ),
                                    Text(
                                      '$cartQty in bag',
                                      style: const TextStyle(
                                        color: AppColors.accentLight,
                                        fontSize: 11.5,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    InkWell(
                                      onTap: cartQty < product.stockQuantity
                                          ? () => cart.updateQuantity(
                                                product.id,
                                                cartQty + 1,
                                              )
                                          : null,
                                      child: const Padding(
                                        padding: EdgeInsets.symmetric(
                                            horizontal: 10, vertical: 4),
                                        child: Icon(Icons.add,
                                            size: 16, color: Colors.white),
                                      ),
                                    ),
                                  ],
                                ),
                              )
                            : FilledButton(
                                onPressed: onAddToCart ??
                                    () {
                                      cart.add(product);
                                      ScaffoldMessenger.of(context)
                                        ..hideCurrentSnackBar()
                                        ..showSnackBar(
                                          SnackBar(
                                            content: Text(
                                                '${product.name} added to bag'),
                                            duration: const Duration(
                                                milliseconds: 1400),
                                          ),
                                        );
                                    },
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                  minimumSize: const Size(0, 33),
                                  padding:
                                      const EdgeInsets.symmetric(horizontal: 8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  textStyle: const TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.4,
                                  ),
                                ),
                                child: const Text('Add to Cart'),
                              ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BadgePill extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;

  const _BadgePill({
    required this.label,
    required this.bg,
    required this.fg,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: AppColors.blush,
      child: Center(
        child: Icon(Icons.spa_outlined, color: AppColors.accent, size: 32),
      ),
    );
  }
}
