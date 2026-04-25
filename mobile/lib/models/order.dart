class OrderItem {
  final int productId;
  final String name;
  final int quantity;
  final double priceAtPurchase;

  const OrderItem({
    required this.productId,
    required this.name,
    required this.quantity,
    required this.priceAtPurchase,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    return OrderItem(
      productId: json['product_id'] as int,
      name: json['name'] as String? ?? json['product_name'] as String? ?? '',
      quantity: json['quantity'] as int,
      priceAtPurchase: double.parse(json['price_at_purchase'].toString()),
    );
  }
}

class Order {
  final int id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final double totalAmount;
  final String? deliveryAddress;
  final String? deliveryStatus;
  final DateTime createdAt;
  final List<OrderItem> items;

  const Order({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentStatus,
    required this.totalAmount,
    this.deliveryAddress,
    this.deliveryStatus,
    required this.createdAt,
    this.items = const [],
  });

  factory Order.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? [];
    return Order(
      id: json['id'] as int,
      orderNumber: json['order_number'] as String,
      status: json['status'] as String,
      paymentStatus: json['payment_status'] as String,
      totalAmount: double.parse(json['total_amount'].toString()),
      deliveryAddress: json['delivery_address'] as String?,
      deliveryStatus: json['delivery_status'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      items: rawItems.map((i) => OrderItem.fromJson(i as Map<String, dynamic>)).toList(),
    );
  }

  // Human-readable labels for UI chips
  String get statusLabel {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'confirmed':
        return 'Confirmed';
      case 'processing':
        return 'Processing';
      case 'shipped':
        return 'Shipped';
      case 'delivered':
        return 'Delivered';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }
}
