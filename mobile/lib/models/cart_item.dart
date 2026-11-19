import 'product.dart';

class CartItem {
  final String? id;
  final String productId;
  final String? variantId;
  final String? variantLabel;
  final String name;
  final double price;
  final String? imageUrl;
  int quantity;

  CartItem({
    this.id,
    required this.productId,
    this.variantId,
    this.variantLabel,
    required this.name,
    required this.price,
    this.imageUrl,
    this.quantity = 1,
  });

  double get subtotal => price * quantity;

  factory CartItem.fromProduct(
    Product product, {
    int quantity = 1,
    String? variantId,
    String? variantLabel,
    double? priceOverride,
  }) {
    return CartItem(
      productId: product.id,
      variantId: variantId,
      variantLabel: variantLabel,
      name: product.name,
      price: priceOverride ?? product.price,
      imageUrl: product.imageUrl,
      quantity: quantity,
    );
  }

  factory CartItem.fromJson(Map<String, dynamic> json) {
    return CartItem(
      id: json['id']?.toString(),
      productId: json['product_id'].toString(),
      variantId: json['variant_id']?.toString(),
      variantLabel: json['variant_label'] as String?,
      name: json['name'] as String? ?? '',
      price: double.parse((json['price'] ?? 0).toString()),
      imageUrl: json['image_url'] as String?,
      quantity: int.tryParse(json['quantity']?.toString() ?? '1') ?? 1,
    );
  }

  Map<String, dynamic> toJson() => {
        if (id != null) 'id': id,
        'product_id': productId,
        if (variantId != null) 'variant_id': variantId,
        if (variantLabel != null) 'variant_label': variantLabel,
        'quantity': quantity,
      };
}
