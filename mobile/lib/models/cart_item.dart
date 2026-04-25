import 'product.dart';

class CartItem {
  final int productId;
  final String name;
  final double price;
  final String? imageUrl;
  int quantity;

  CartItem({
    required this.productId,
    required this.name,
    required this.price,
    this.imageUrl,
    this.quantity = 1,
  });

  double get subtotal => price * quantity;

  factory CartItem.fromProduct(Product product, {int quantity = 1}) {
    return CartItem(
      productId: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
      quantity: quantity,
    );
  }

  factory CartItem.fromJson(Map<String, dynamic> json) {
    return CartItem(
      productId: json['product_id'] as int,
      name: json['name'] as String,
      price: double.parse(json['price'].toString()),
      imageUrl: json['image_url'] as String?,
      quantity: json['quantity'] as int? ?? 1,
    );
  }

  Map<String, dynamic> toJson() => {
        'product_id': productId,
        'quantity': quantity,
      };
}
