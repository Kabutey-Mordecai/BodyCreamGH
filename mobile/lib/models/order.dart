import '../config.dart';

class OrderItem {
  final String productId;
  final String name;
  final int quantity;
  final double priceAtPurchase;
  final String? imageUrl;
  final String? variantLabel;

  const OrderItem({
    required this.productId,
    required this.name,
    required this.quantity,
    required this.priceAtPurchase,
    this.imageUrl,
    this.variantLabel,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    final rawImg = json['image_url']?.toString();
    return OrderItem(
      productId: (json['product_id'] ?? '').toString(),
      name: json['name'] as String? ?? json['product_name'] as String? ?? '',
      quantity: int.tryParse(json['quantity']?.toString() ?? '1') ?? 1,
      priceAtPurchase:
          double.tryParse((json['price_at_purchase'] ?? json['price'] ?? 0).toString()) ?? 0,
      imageUrl: (rawImg != null && rawImg.isNotEmpty)
          ? AppConfig.resolveImageUrl(rawImg)
          : null,
      variantLabel: json['variant_label'] as String?,
    );
  }
}

class Order {
  final String id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final String paymentMethod;
  final double totalAmount;
  final double? deliveryFee;
  final String? deliveryAddress;
  final String? shippingCity;
  final String? shippingRegion;
  final String? customerPhone;
  final String? notes;
  final String? deliveryStatus;
  final Map<String, dynamic>? delivery;
  final String? refundStatus;
  final double? refundAmount;
  final String? refundMethod;
  final String? refundReference;
  final DateTime? refundedAt;
  final String? cancellationReason;
  final DateTime? cancelledAt;
  final bool cancelRequested;
  final bool cancelRequestRejected;
  final bool returnRequested;
  final bool returnRequestRejected;
  final DateTime createdAt;
  final List<OrderItem> items;

  const Order({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentStatus,
    this.paymentMethod = 'paystack',
    required this.totalAmount,
    this.deliveryFee,
    this.deliveryAddress,
    this.shippingCity,
    this.shippingRegion,
    this.customerPhone,
    this.notes,
    this.deliveryStatus,
    this.delivery,
    this.refundStatus,
    this.refundAmount,
    this.refundMethod,
    this.refundReference,
    this.refundedAt,
    this.cancellationReason,
    this.cancelledAt,
    this.cancelRequested = false,
    this.cancelRequestRejected = false,
    this.returnRequested = false,
    this.returnRequestRejected = false,
    required this.createdAt,
    this.items = const [],
  });

  factory Order.fromJson(Map<String, dynamic> json) {
    final orderMap =
        json.containsKey('order') && json['order'] is Map<String, dynamic>
            ? json['order'] as Map<String, dynamic>
            : json;
    final rawItems =
        (json['items'] ?? orderMap['items']) as List<dynamic>? ?? [];

    String? street;
    String? city = orderMap['shipping_city']?.toString();
    String? region = orderMap['shipping_region']?.toString();

    final rawShipping =
        orderMap['delivery_address'] ?? orderMap['shipping_address'];
    if (rawShipping is Map) {
      street = rawShipping['address']?.toString();
      city ??= rawShipping['city']?.toString();
      region ??= rawShipping['region']?.toString();
    } else if (rawShipping != null) {
      street = rawShipping.toString();
    }

    final addressParts = [street, city, region]
        .where((p) => p != null && p.toString().trim().isNotEmpty)
        .join(', ');

    final notesStr = orderMap['notes']?.toString();
    String? phone = orderMap['customer_phone']?.toString();
    if ((phone == null || phone.isEmpty) && notesStr != null) {
      final m =
          RegExp(r'^Phone:\s*(.+?)(\n|$)', caseSensitive: false).firstMatch(notesStr);
      if (m != null) phone = m.group(1)?.trim();
    }

    return Order(
      id: (orderMap['id'] ?? '').toString(),
      orderNumber:
          (orderMap['order_number'] ?? orderMap['orderNumber'] ?? '').toString(),
      status: (orderMap['status'] ?? 'pending').toString(),
      paymentStatus: (orderMap['payment_status'] ?? 'unpaid').toString(),
      paymentMethod: (orderMap['payment_method'] ?? 'paystack').toString(),
      totalAmount: double.tryParse(
              (orderMap['total_amount'] ?? orderMap['total'] ?? 0).toString()) ??
          0,
      deliveryFee: orderMap['delivery_fee'] != null
          ? double.tryParse(orderMap['delivery_fee'].toString())
          : null,
      deliveryAddress: addressParts.isNotEmpty ? addressParts : null,
      shippingCity: city,
      shippingRegion: region,
      customerPhone: phone,
      notes: notesStr,
      deliveryStatus:
          (orderMap['delivery_status'] ?? orderMap['shipping_status']) as String?,
      delivery: (orderMap['delivery'] ?? json['delivery']) is Map<String, dynamic>
          ? (orderMap['delivery'] ?? json['delivery']) as Map<String, dynamic>
          : null,
      refundStatus: orderMap['refund_status']?.toString(),
      refundAmount: orderMap['refund_amount'] != null
          ? double.tryParse(orderMap['refund_amount'].toString())
          : null,
      refundMethod: orderMap['refund_method']?.toString(),
      refundReference: orderMap['refund_reference']?.toString(),
      refundedAt: orderMap['refunded_at'] != null
          ? DateTime.tryParse(orderMap['refunded_at'].toString())
          : null,
      cancellationReason: orderMap['cancellation_reason']?.toString(),
      cancelledAt: orderMap['cancelled_at'] != null
          ? DateTime.tryParse(orderMap['cancelled_at'].toString())
          : null,
      cancelRequested: orderMap['cancel_requested'] == true,
      cancelRequestRejected: orderMap['cancel_request_rejected'] == true,
      returnRequested: orderMap['return_requested'] == true,
      returnRequestRejected: orderMap['return_request_rejected'] == true,
      createdAt: orderMap['created_at'] != null
          ? DateTime.tryParse(orderMap['created_at'].toString()) ??
              DateTime.now()
          : DateTime.now(),
      items: rawItems
          .whereType<Map<String, dynamic>>()
          .map(OrderItem.fromJson)
          .toList(),
    );
  }

  bool get isTerminal =>
      status == 'cancelled' || status == 'refunded' || refundStatus == 'success';

  /// Matches Web `Orders.jsx` `refundHint(order)`
  String get refundHint {
    final rs = refundStatus ?? 'not_requested';
    if (status == 'cancelled' &&
        (paymentStatus == 'paid' ||
            paymentStatus == 'partially_refunded' ||
            paymentStatus == 'payment_review') &&
        rs == 'not_requested') {
      return 'Refund may be pending';
    }
    if (rs == 'pending') return 'Refund pending';
    if (rs == 'failed') return 'Refund failed - contact support';
    if (status == 'refunded' || rs == 'success') return 'Refunded';
    if (paymentStatus == 'partially_refunded') {
      return refundAmount != null && refundAmount! > 0
          ? '${AppConfig.currencySymbol}${refundAmount!.toStringAsFixed(2)} refunded'
          : 'Partially refunded';
    }
    return '';
  }

  /// Matches Web `OrderDetail.jsx` `getRefundMessage(order)`
  String? get refundMessage {
    final rs = refundStatus ?? 'not_requested';
    if (status == 'cancelled' &&
        (paymentStatus == 'paid' ||
            paymentStatus == 'partially_refunded' ||
            paymentStatus == 'payment_review') &&
        rs == 'not_requested') {
      return 'This order was cancelled. A refund may be pending.';
    }
    if (rs == 'pending') return 'Refund pending';
    if (rs == 'needs_attention') {
      return 'Refund needs additional details - please contact support';
    }
    if (rs == 'failed') return 'Refund failed - contact support';
    if (status == 'refunded' || rs == 'success') return 'Refunded';
    if (paymentStatus == 'partially_refunded') {
      return refundAmount != null && refundAmount! > 0
          ? '${AppConfig.currencySymbol}${refundAmount!.toStringAsFixed(2)} refunded so far'
          : 'Partially refunded';
    }
    return null;
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
      case 'refunded':
        return 'Refunded';
      default:
        return status;
    }
  }
}
