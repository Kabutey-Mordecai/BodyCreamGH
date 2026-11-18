class OrderItem {
  final String productId;
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
      productId: (json['product_id'] ?? '').toString(),
      name: json['name'] as String? ?? json['product_name'] as String? ?? '',
      quantity: int.tryParse(json['quantity']?.toString() ?? '1') ?? 1,
      priceAtPurchase: double.parse((json['price_at_purchase'] ?? json['price'] ?? 0).toString()),
    );
  }
}

class Order {
  final String id;
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
    final orderMap = json.containsKey('order') && json['order'] is Map<String, dynamic>
        ? json['order'] as Map<String, dynamic>
        : json;
    final rawItems = (json['items'] ?? orderMap['items']) as List<dynamic>? ?? [];

    final addressParts = [
      orderMap['delivery_address'] ?? orderMap['shipping_address'],
      orderMap['shipping_city'],
      orderMap['shipping_region'],
    ].where((p) => p != null && p.toString().trim().isNotEmpty).join(', ');

    return Order(
      id: (orderMap['id'] ?? '').toString(),
      orderNumber: (orderMap['order_number'] ?? orderMap['orderNumber'] ?? '').toString(),
      status: (orderMap['status'] ?? 'pending').toString(),
      paymentStatus: (orderMap['payment_status'] ?? 'pending').toString(),
      totalAmount: double.parse((orderMap['total_amount'] ?? orderMap['total'] ?? 0).toString()),
      deliveryAddress: addressParts.isNotEmpty ? addressParts : null,
      deliveryStatus: (orderMap['delivery_status'] ?? orderMap['shipping_status']) as String?,
      createdAt: orderMap['created_at'] != null
          ? DateTime.tryParse(orderMap['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
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
