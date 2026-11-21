import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../models/order.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/status_chip.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen>
    with WidgetsBindingObserver {
  List<Order> _orders = [];
  List<Map<String, dynamic>> _pendingPrompts = [];
  Map<String, dynamic>? _pagination;
  int _page = 1;
  bool _loading = false;
  String? _error;
  bool _wasLoggedIn = false;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _wasLoggedIn && mounted) {
      _load(silent: true);
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted && _wasLoggedIn) _load(silent: true);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final isLoggedIn = context.watch<AuthProvider>().isLoggedIn;
    if (isLoggedIn && !_wasLoggedIn) {
      _wasLoggedIn = true;
      _load();
      _startPolling();
    } else if (!isLoggedIn && _wasLoggedIn) {
      _wasLoggedIn = false;
      _pollTimer?.cancel();
      _orders = [];
      _pendingPrompts = [];
      _pagination = null;
      _error = null;
    }
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait([
        ApiService.instance.getMyOrdersWithMeta(page: _page, limit: 20),
        ApiService.instance
            .getPendingReviewPrompts()
            .catchError((_) => <dynamic>[]),
      ]);
      final ordersPayload = results[0] as Map<String, dynamic>;
      final rawOrders = ordersPayload['orders'] as List<dynamic>? ?? [];
      final rawPrompts = results[1] as List<dynamic>;

      if (mounted) {
        setState(() {
          _orders = rawOrders
              .whereType<Map<String, dynamic>>()
              .map(Order.fromJson)
              .toList();
          _pagination =
              ordersPayload['pagination'] as Map<String, dynamic>?;
          _pendingPrompts =
              rawPrompts.whereType<Map<String, dynamic>>().toList();
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted && !silent) {
        setState(() {
          _error =
              e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
          _loading = false;
        });
      }
    }
  }

  String _dateGroupLabel(DateTime dt) {
    final now = DateTime.now();
    final local = dt.toLocal();
    final todayStart = DateTime(now.year, now.month, now.day);
    final yesterdayStart = todayStart.subtract(const Duration(days: 1));
    final weekStart = todayStart.subtract(const Duration(days: 6));
    final orderDay = DateTime(local.year, local.month, local.day);

    if (!orderDay.isBefore(todayStart)) return 'Today';
    if (!orderDay.isBefore(yesterdayStart)) return 'Yesterday';
    if (!orderDay.isBefore(weekStart)) return 'This week';
    return DateFormat('MMMM yyyy').format(local);
  }

  Map<String, List<Order>> _groupedOrders() {
    final map = <String, List<Order>>{};
    for (final o in _orders) {
      final label = _dateGroupLabel(o.createdAt);
      map.putIfAbsent(label, () => []).add(o);
    }
    return map;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    if (!auth.isLoggedIn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Orders')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.receipt_long_outlined,
                        size: 56, color: AppColors.accentDark),
                    const SizedBox(height: 14),
                    Text(
                      'Track or View Your Orders',
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Checked out as a guest? Look up your order by order number and email, or sign in to view your full order history.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted, fontSize: 13.5),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: () => context.push('/track-order'),
                        icon: const Icon(Icons.local_shipping_outlined,
                            size: 18),
                        label: const Text('Track a Guest Order'),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => context.push('/login'),
                        child: const Text('Log In to Account'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    final grouped = _groupedOrders();
    final totalPages =
        int.tryParse((_pagination?['pages'] ?? 1).toString()) ?? 1;

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Orders'),
        actions: [
          TextButton.icon(
            onPressed: () => context.push('/track-order'),
            icon: const Icon(Icons.search, size: 16),
            label: const Text('Track'),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_error!),
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : _orders.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.receipt_long_outlined,
                              size: 64, color: AppColors.accent),
                          const SizedBox(height: 16),
                          Text('Nothing here yet',
                              style: Theme.of(context).textTheme.titleLarge),
                          const SizedBox(height: 6),
                          const Text(
                            "When you place an order, you'll be able to track it right here.",
                            style:
                                TextStyle(color: AppColors.muted, fontSize: 13),
                          ),
                          const SizedBox(height: 16),
                          FilledButton(
                            onPressed: () => context.go('/shop'),
                            child: const Text('Start Shopping'),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: AppColors.accent,
                      child: ListView(
                        padding: const EdgeInsets.all(14),
                        children: [
                          // Pending review prompt banner for delivered orders (matches web Orders.jsx)
                          if (_pendingPrompts.isNotEmpty) ...[
                            Container(
                              margin: const EdgeInsets.only(bottom: 14),
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: AppColors.blush,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                    color: AppColors.accent
                                        .withValues(alpha: 0.5)),
                              ),
                              child: Row(
                                children: [
                                  const Text('⭐',
                                      style: TextStyle(fontSize: 22)),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        const Text(
                                          'Your opinion matters!',
                                          style: TextStyle(
                                            fontWeight: FontWeight.w700,
                                            fontSize: 13.5,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          'You recently received ${_pendingPrompts.first['product_name'] ?? 'your order'}${_pendingPrompts.length > 1 ? ' and ${_pendingPrompts.length - 1} other item${_pendingPrompts.length > 2 ? 's' : ''}' : ''}. Share your review!',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: AppColors.muted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  FilledButton(
                                    style: FilledButton.styleFrom(
                                      backgroundColor: AppColors.accent,
                                      foregroundColor: AppColors.primary,
                                      minimumSize: const Size(0, 34),
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10),
                                      textStyle: const TextStyle(
                                        fontSize: 11.5,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    onPressed: () {
                                      final oid =
                                          (_pendingPrompts.first['order_id'] ??
                                                  '')
                                              .toString();
                                      if (oid.isNotEmpty) {
                                        context.push('/order/$oid');
                                      }
                                    },
                                    child: const Text('Review →'),
                                  ),
                                ],
                              ),
                            ),
                          ],

                          // Date-grouped orders list
                          for (final entry in grouped.entries) ...[
                            Padding(
                              padding:
                                  const EdgeInsets.fromLTRB(4, 6, 4, 8),
                              child: Text(
                                entry.key.toUpperCase(),
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.4,
                                  color: AppColors.muted,
                                ),
                              ),
                            ),
                            for (final order in entry.value) ...[
                              _OrderCard(order: order),
                              const SizedBox(height: 10),
                            ],
                          ],

                          // Pagination bar
                          if (totalPages > 1)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  OutlinedButton(
                                    onPressed: _page > 1
                                        ? () {
                                            setState(() => _page--);
                                            _load();
                                          }
                                        : null,
                                    child: const Text('← Previous'),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 14),
                                    child: Text(
                                      'Page $_page of $totalPages',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        color: AppColors.muted,
                                      ),
                                    ),
                                  ),
                                  OutlinedButton(
                                    onPressed: _page < totalPages
                                        ? () {
                                            setState(() => _page++);
                                            _load();
                                          }
                                        : null,
                                    child: const Text('Next →'),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final Order order;
  const _OrderCard({required this.order});

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('d MMM yyyy');
    final hint = order.refundHint;
    final orderNum = order.orderNumber.isNotEmpty
        ? order.orderNumber
        : (order.id.length >= 8
            ? order.id.substring(0, 8).toUpperCase()
            : order.id);

    return Card(
      child: InkWell(
        onTap: () => context.push('/order/${order.id}'),
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        Flexible(
                          child: Text(
                            '#$orderNum',
                            style: Theme.of(context).textTheme.titleMedium,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Copy order number',
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.only(left: 4),
                          constraints: const BoxConstraints(
                              minWidth: 28, minHeight: 28),
                          icon: const Icon(Icons.copy_rounded,
                              size: 16, color: AppColors.muted),
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: orderNum));
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Copied $orderNum'),
                                duration: const Duration(seconds: 2),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  Wrap(
                    spacing: 6,
                    children: [
                      StatusChip(order.status),
                      if (order.status == 'delivered')
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppColors.accent,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: const Text(
                            '⭐ Review',
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Placed on ${fmt.format(order.createdAt.toLocal())}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  StatusChip(order.paymentStatus),
                ],
              ),
              if (hint.isNotEmpty) ...[
                const SizedBox(height: 6),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.blush,
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(
                    hint,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.accentDark,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${AppConfig.currencySymbol}${order.totalAmount.toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primary,
                    ),
                  ),
                  const Text(
                    'View details →',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.accentDark,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
