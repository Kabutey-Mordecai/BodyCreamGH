class Product {
  final int id;
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
    return Product(
      id: json['id'] as int,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      price: double.parse(json['price'].toString()),
      imageUrl: json['image_url'] as String?,
      stockQuantity: json['stock_quantity'] as int? ?? 0,
      category: json['category'] as String?,
      averageRating: json['average_rating'] != null
          ? double.parse(json['average_rating'].toString())
          : null,
      reviewCount: json['review_count'] as int? ?? 0,
    );
  }
}
