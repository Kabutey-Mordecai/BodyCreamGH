import '../config.dart';

class ProductVariant {
  final String id;
  final String label;
  final double price;
  final int stockQuantity;

  const ProductVariant({
    required this.id,
    required this.label,
    required this.price,
    required this.stockQuantity,
  });

  bool get inStock => stockQuantity > 0;

  factory ProductVariant.fromJson(Map<String, dynamic> json, {double fallbackPrice = 0}) {
    final rawLabel = json['label'] ??
        json['name'] ??
        json['variant_label'] ??
        json['size'] ??
        json['sku'] ??
        'Standard';
    return ProductVariant(
      id: (json['id'] ?? '').toString(),
      label: rawLabel.toString(),
      price: double.tryParse((json['price'] ?? fallbackPrice).toString()) ?? fallbackPrice,
      stockQuantity: int.tryParse((json['stock_quantity'] ?? json['stock'] ?? 10).toString()) ?? 10,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'price': price,
        'stock_quantity': stockQuantity,
      };
}

class Product {
  final String id;
  final String name;
  final String description;
  final double price;
  final double? originalPrice;
  final int? discountPercent;
  final String? imageUrl;
  final List<String> images;
  final int stockQuantity;
  final String? category;
  final double? averageRating;
  final int reviewCount;
  final List<ProductVariant> variants;

  const Product({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    this.originalPrice,
    this.discountPercent,
    this.imageUrl,
    this.images = const [],
    required this.stockQuantity,
    this.category,
    this.averageRating,
    this.reviewCount = 0,
    this.variants = const [],
  });

  bool get inStock => stockQuantity > 0;

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
    final price = double.tryParse((json['price'] ?? json['sale_price'] ?? 0).toString()) ?? 0;

    final rawOrig = json['original_price'] ?? json['compare_at_price'];
    double? originalPrice = rawOrig != null ? double.tryParse(rawOrig.toString()) : null;
    final discountPct = int.tryParse((json['discount_percent'] ?? json['discount'] ?? '').toString());
    if (originalPrice == null && discountPct != null && discountPct > 0 && discountPct < 100) {
      originalPrice = double.parse((price / (1 - discountPct / 100)).toStringAsFixed(2));
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
          parsedVariants.add(ProductVariant.fromJson(v, fallbackPrice: price));
        }
      }
    }

    return Product(
      id: (json['id'] ?? '').toString(),
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      price: price,
      originalPrice: originalPrice,
      discountPercent: discountPct,
      imageUrl: primaryImg ?? (allImages.isNotEmpty ? allImages.first : null),
      images: allImages,
      stockQuantity: int.tryParse(json['stock_quantity']?.toString() ?? '0') ?? 0,
      category: json['category'] as String?,
      averageRating: rawRating != null ? double.tryParse(rawRating.toString()) : null,
      reviewCount: int.tryParse(json['review_count']?.toString() ?? '0') ?? 0,
      variants: parsedVariants,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'description': description,
        'price': price,
        if (originalPrice != null) 'original_price': originalPrice,
        if (discountPercent != null) 'discount_percent': discountPercent,
        'image_url': imageUrl,
        'images': images,
        'stock_quantity': stockQuantity,
        'category': category,
        'avg_rating': averageRating,
        'review_count': reviewCount,
        'variants': variants.map((v) => v.toJson()).toList(),
      };
}
