import '../config.dart';

double _parseDouble(dynamic raw, [double fallback = 0]) {
  if (raw == null) return fallback;
  if (raw is num) return raw.toDouble();
  return double.tryParse(raw.toString()) ?? fallback;
}

double? _parseNullableDouble(dynamic raw) {
  if (raw == null) return null;
  if (raw is num) return raw.toDouble();
  return double.tryParse(raw.toString());
}

class OrderItem {
  final String id;
  final String productId;
  final String name;
  final int quantity;
  final double priceAtPurchase;
  final double subtotal;
  final String? imageUrl;
  final String? variantLabel;

  const OrderItem({
    this.id = '',
    required this.productId,
    required this.name,
    required this.quantity,
    required this.priceAtPurchase,
    this.subtotal = 0,
    this.imageUrl,
    this.variantLabel,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    final rawImg = json['image_url']?.toString();
    final qty = int.tryParse(json['quantity']?.toString() ?? '1') ?? 1;
    final price = _parseDouble(json['price_at_purchase'] ?? json['price']);
    final sub = json['subtotal'] != null ? _parseDouble(json['subtotal']) : price * qty;
    return OrderItem(
      id: (json['id'] ?? json['order_item_id'] ?? '').toString(),
      productId: (json['product_id'] ?? '').toString(),
      name: json['name'] as String? ?? json['product_name'] as String? ?? '',
      quantity: qty,
      priceAtPurchase: price,
      subtotal: sub,
      imageUrl: (rawImg != null && rawImg.isNotEmpty)
          ? AppConfig.resolveImageUrl(rawImg)
          : null,
      variantLabel: json['variant_label'] as String?,
    );
  }
}

class ReturnRequestItem {
  final String id;
  final String orderItemId;
  final String productName;
  final String? variantLabel;
  final int quantity;
  final double unitRefundAmount;
  final double lineRefundAmount;

  const ReturnRequestItem({
    required this.id,
    required this.orderItemId,
    required this.productName,
    this.variantLabel,
    required this.quantity,
    required this.unitRefundAmount,
    required this.lineRefundAmount,
  });

  factory ReturnRequestItem.fromJson(Map<String, dynamic> json) {
    return ReturnRequestItem(
      id: (json['id'] ?? '').toString(),
      orderItemId: (json['order_item_id'] ?? '').toString(),
      productName: (json['product_name'] ?? json['name'] ?? 'Item').toString(),
      variantLabel: json['variant_label']?.toString(),
      quantity: int.tryParse((json['quantity'] ?? 1).toString()) ?? 1,
      unitRefundAmount: _parseDouble(json['unit_refund_amount']),
      lineRefundAmount: _parseDouble(json['line_refund_amount']),
    );
  }
}

class ReturnRequest {
  final String id;
  final String orderId;
  final String status;
  final String reason;
  final double refundAmount;
  final String? refundMethod;
  final String? refundReference;
  final List<ReturnRequestItem> items;

  const ReturnRequest({
    required this.id,
    required this.orderId,
    required this.status,
    required this.reason,
    required this.refundAmount,
    this.refundMethod,
    this.refundReference,
    this.items = const [],
  });

  factory ReturnRequest.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? [];
    return ReturnRequest(
      id: (json['id'] ?? '').toString(),
      orderId: (json['order_id'] ?? '').toString(),
      status: (json['status'] ?? 'pending').toString(),
      reason: (json['reason'] ?? '').toString(),
      refundAmount: _parseDouble(json['refund_amount']),
      refundMethod: json['refund_method']?.toString(),
      refundReference: json['refund_reference']?.toString(),
      items: rawItems
          .whereType<Map<String, dynamic>>()
          .map(ReturnRequestItem.fromJson)
          .toList(),
    );
  }
}

class Order {
  final String id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final String paymentMethod;
  final String fulfillmentMethod;
  final double totalAmount;
  final double? deliveryFee;
  final double? discountAmount;
  final String? deliveryAddress;
  final String? shippingCity;
  final String? shippingRegion;
  final String? customerPhone;
  final String? notes;
  final String? deliveryStatus;
  final Map<String, dynamic>? delivery;
  final DateTime? deliveredAt;
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
    this.fulfillmentMethod = 'delivery',
    required this.totalAmount,
    this.deliveryFee,
    this.discountAmount,
    this.deliveryAddress,
    this.shippingCity,
    this.shippingRegion,
    this.customerPhone,
    this.notes,
    this.deliveryStatus,
    this.delivery,
    this.deliveredAt,
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
      fulfillmentMethod:
          (orderMap['fulfillment_method'] ?? 'delivery').toString(),
      totalAmount: _parseDouble(orderMap['total_amount'] ?? orderMap['total']),
      deliveryFee: _parseNullableDouble(orderMap['delivery_fee']),
      discountAmount: _parseNullableDouble(orderMap['discount_amount']),
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
      deliveredAt: orderMap['delivered_at'] != null
          ? DateTime.tryParse(orderMap['delivered_at'].toString())
          : null,
      refundStatus: orderMap['refund_status']?.toString(),
      refundAmount: _parseNullableDouble(orderMap['refund_amount']),
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

  bool get isPickup => fulfillmentMethod.toLowerCase() == 'pickup';

  String? get trackingNumber {
    final raw = delivery?['tracking_number'];
    if (raw == null) return null;
    final s = raw.toString().trim();
    return s.isEmpty ? null : s;
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
