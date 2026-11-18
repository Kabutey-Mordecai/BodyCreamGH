import '../config.dart';

class Product {
  final String id;
  final String name;
  final String description;
  final double price;
  final String? imageUrl;
  final int stockQuantity;
  final String? category;
  final double? averageRating;
  final int reviewCount;

  const Product({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    this.imageUrl,
    required this.stockQuantity,
    this.category,
    this.averageRating,
    this.reviewCount = 0,
  });

  bool get inStock => stockQuantity > 0;

  factory Product.fromJson(Map<String, dynamic> json) {
    final rawRating = json['avg_rating'] ?? json['average_rating'];
    return Product(
      id: json['id'].toString(),
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      price: double.parse((json['price'] ?? 0).toString()),
      imageUrl: json['image_url'] != null
          ? AppConfig.resolveImageUrl(json['image_url'] as String)
          : null,
      stockQuantity: int.tryParse(json['stock_quantity']?.toString() ?? '0') ?? 0,
      category: json['category'] as String?,
      averageRating: rawRating != null
          ? double.tryParse(rawRating.toString())
          : null,
      reviewCount: int.tryParse(json['review_count']?.toString() ?? '0') ?? 0,
    );
  }
}
