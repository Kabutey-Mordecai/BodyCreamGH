import '../config.dart';

class ProductVariant {
  final String id;
  final String label;
  final double price;
  final double? compareAtPrice;
  final int stockQuantity;
  final String? optionTypeName;

  const ProductVariant({
    required this.id,
    required this.label,
    required this.price,
    this.compareAtPrice,
    required this.stockQuantity,
    this.optionTypeName,
  });

  bool get inStock => stockQuantity > 0;

  factory ProductVariant.fromJson(Map<String, dynamic> json, {double fallbackPrice = 0}) {
    String? optionLabel;
    String? optionTypeName;
    final rawOptionValues = json['option_values'];
    if (rawOptionValues is List && rawOptionValues.isNotEmpty) {
      final parts = <String>[];
      final types = <String>{};
      for (final ov in rawOptionValues) {
        if (ov is Map) {
          final v = ov['value']?.toString().trim() ?? '';
          final t = ov['option_type_name']?.toString().trim() ?? '';
          if (v.isNotEmpty) parts.add(v);
          if (t.isNotEmpty) types.add(t);
        }
      }
      if (parts.isNotEmpty) optionLabel = parts.join(' / ');
      if (types.length == 1) optionTypeName = types.first;
    }

    final rawLabel = optionLabel ??
        json['label'] ??
        json['name'] ??
        json['variant_label'] ??
        json['size'] ??
        json['sku'] ??
        'Standard';
    final rawCompare = json['compare_at_price'];
    final parsedCompare =
        rawCompare != null ? double.tryParse(rawCompare.toString()) : null;
    return ProductVariant(
      id: (json['id'] ?? '').toString(),
      label: rawLabel.toString(),
      price: double.tryParse((json['price'] ?? fallbackPrice).toString()) ?? fallbackPrice,
      compareAtPrice: (parsedCompare != null && parsedCompare > 0) ? parsedCompare : null,
      stockQuantity: int.tryParse((json['stock_quantity'] ?? json['stock'] ?? 10).toString()) ?? 10,
      optionTypeName: optionTypeName,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'price': price,
        if (compareAtPrice != null) 'compare_at_price': compareAtPrice,
        'stock_quantity': stockQuantity,
        if (optionTypeName != null) 'option_type_name': optionTypeName,
      };
}

class Product {
  final String id;
  final String name;
  final String description;
  final double price;
  final double? originalPrice;
  final int? discountPercent;
  final String? promoName;
  final DateTime? promoEndsAt;
  final DateTime? createdAt;
  final String? imageUrl;
  final List<String> images;
  final int stockQuantity;
  final String? category;
  final double? averageRating;
  final int reviewCount;
  final List<ProductVariant> variants;
  final bool hasVariants;
  final double? minPrice;

  const Product({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    this.originalPrice,
    this.discountPercent,
    this.promoName,
    this.promoEndsAt,
    this.createdAt,
    this.imageUrl,
    this.images = const [],
    required this.stockQuantity,
    this.category,
    this.averageRating,
    this.reviewCount = 0,
    this.variants = const [],
    this.hasVariants = false,
    this.minPrice,
  });

  bool get inStock => stockQuantity > 0;

  bool get isLowStock => stockQuantity > 0 && stockQuantity < 5;

  bool get isNew =>
      createdAt != null &&
      DateTime.now().difference(createdAt!).inDays < 30;

  bool get isOnSale =>
      (originalPrice != null && originalPrice! > price) ||
      (discountPercent != null && discountPercent! > 0);

  int get effectiveDiscountPercent {
    if (discountPercent != null && discountPercent! > 0) return discountPercent!;
    if (originalPrice != null && originalPrice! > price && originalPrice! > 0) {
      return (((originalPrice! - price) / originalPrice!) * 100).round();
    }
    return 0;
  }

  factory Product.fromJson(Map<String, dynamic> json) {
    final rawRating = json['avg_rating'] ?? json['average_rating'];
    final basePrice = double.tryParse((json['price'] ?? json['sale_price'] ?? 0).toString()) ?? 0;

    double effectivePrice = basePrice;
    double? originalPrice;
    String? promoName;
    DateTime? promoEndsAt;

    // 1. Check active_promotion from backend (matches web ProductCard.jsx)
    final promo = json['active_promotion'];
    if (promo is Map) {
      final promoPrice = double.tryParse((promo['discounted_price'] ?? '').toString());
      if (promoPrice != null && promoPrice > 0 && promoPrice < basePrice) {
        effectivePrice = promoPrice;
        originalPrice = basePrice;
        promoName = promo['name']?.toString();
        if (promo['ends_at'] != null) {
          promoEndsAt = DateTime.tryParse(promo['ends_at'].toString());
        }
      }
    }

    // 2. Fallback to compare_at_price / original_price
    if (originalPrice == null) {
      final rawOrig = json['original_price'] ?? json['compare_at_price'];
      final parsedOrig = rawOrig != null ? double.tryParse(rawOrig.toString()) : null;
      if (parsedOrig != null && parsedOrig > effectivePrice) {
        originalPrice = parsedOrig;
      }
    }

    final discountPct = int.tryParse((json['discount_percent'] ?? json['discount'] ?? '').toString());
    if (originalPrice == null && discountPct != null && discountPct > 0 && discountPct < 100) {
      originalPrice = double.parse((effectivePrice / (1 - discountPct / 100)).toStringAsFixed(2));
    }

    final primaryImg = json['image_url'] != null && json['image_url'].toString().isNotEmpty
        ? AppConfig.resolveImageUrl(json['image_url'].toString())
        : null;

    final List<String> allImages = [];
    if (primaryImg != null && primaryImg.isNotEmpty) {
      allImages.add(primaryImg);
    }
    if (json['images'] is List) {
      for (final item in (json['images'] as List)) {
        final rawUrl = item is Map ? (item['image_url'] ?? item['url']) : item;
        if (rawUrl != null && rawUrl.toString().isNotEmpty) {
          final resolved = AppConfig.resolveImageUrl(rawUrl.toString());
          if (resolved.isNotEmpty && !allImages.contains(resolved)) {
            allImages.add(resolved);
          }
        }
      }
    }

    final List<ProductVariant> parsedVariants = [];
    if (json['variants'] is List) {
      for (final v in (json['variants'] as List)) {
        if (v is Map<String, dynamic>) {
          parsedVariants.add(ProductVariant.fromJson(v, fallbackPrice: effectivePrice));
        }
      }
    }

    return Product(
      id: (json['id'] ?? '').toString(),
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      price: effectivePrice,
      originalPrice: originalPrice,
      discountPercent: discountPct,
      promoName: promoName,
      promoEndsAt: promoEndsAt,
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString())
          : null,
      imageUrl: primaryImg ?? (allImages.isNotEmpty ? allImages.first : null),
      images: allImages,
      stockQuantity: int.tryParse(json['stock_quantity']?.toString() ?? '0') ?? 0,
      category: json['category'] as String?,
      averageRating: rawRating != null ? double.tryParse(rawRating.toString()) : null,
      reviewCount: int.tryParse(json['review_count']?.toString() ?? '0') ?? 0,
      variants: parsedVariants,
      hasVariants: json['has_variants'] == true || parsedVariants.isNotEmpty,
      minPrice: json['min_price'] != null
          ? double.tryParse(json['min_price'].toString())
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'description': description,
        'price': price,
        if (originalPrice != null) 'original_price': originalPrice,
        if (discountPercent != null) 'discount_percent': discountPercent,
        if (promoName != null)
          'active_promotion': {
            'name': promoName,
            'discounted_price': price,
            if (promoEndsAt != null) 'ends_at': promoEndsAt!.toIso8601String(),
          },
        if (createdAt != null) 'created_at': createdAt!.toIso8601String(),
        'image_url': imageUrl,
        'images': images,
        'stock_quantity': stockQuantity,
        'category': category,
        'avg_rating': averageRating,
        'review_count': reviewCount,
        'variants': variants.map((v) => v.toJson()).toList(),
      };
}
