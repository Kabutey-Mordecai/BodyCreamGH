import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/wishlist_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/whatsapp_helper.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final auth = context.watch<AuthProvider>();
    final wishlist = context.watch<WishlistProvider>();

    if (!auth.isLoggedIn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Account')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Icon(Icons.person_outline,
                        size: 56, color: cs.secondary),
                    const SizedBox(height: 12),
                    Text(
                      'Welcome to BodyCream GH',
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Sign in to manage your orders, saved addresses, and verified reviews — or shop anytime as a guest.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted, fontSize: 13.5),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () => context.push('/login'),
                        child: const Text('Log In'),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => context.push('/register'),
                        child: const Text('Create Account'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: Icon(Icons.local_shipping_outlined,
                        color: cs.secondary),
                    title: const Text('Track an Order'),
                    subtitle: const Text('Look up any guest or account order'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/track-order'),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: Icon(Icons.favorite_border,
                        color: cs.secondary),
                    title: Text('Saved Wishlist (${wishlist.count})'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/wishlist'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const _StoreSupportAndPaymentsCard(),
          ],
        ),
      );
    }

    final user = auth.user!;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Account'),
        actions: [
          TextButton(
            onPressed: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (_) => AlertDialog(
                  title: const Text('Log out?'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('Cancel')),
                    TextButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('Log Out')),
                  ],
                ),
              );
              if (confirmed == true && context.mounted) {
                await auth.logout();
              }
            },
            child: const Text('Log Out'),
          ),
        ],
      ),
      body: ListView(
        children: [
          // Profile header
          Container(
            color: cs.primary,
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: cs.secondary,
                  child: Text(
                    user.firstName.isNotEmpty
                        ? user.firstName[0].toUpperCase()
                        : (user.email.isNotEmpty
                            ? user.email[0].toUpperCase()
                            : 'U'),
                    style: TextStyle(
                      fontFamily: 'serif',
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: cs.onSecondary,
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.fullName,
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(color: cs.onPrimary),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        user.email,
                        style: TextStyle(
                          color: cs.primaryContainer,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 8),

          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: const Text('My Orders'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.go('/orders'),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.favorite_border),
            title: Text('Saved Wishlist (${wishlist.count})'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/wishlist'),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.local_shipping_outlined),
            title: const Text('Track an Order'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/track-order'),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.person_outline),
            title: const Text('Edit Profile & Password'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/profile/edit'),
          ),
          const Divider(height: 1),
          if (user.phone != null)
            ListTile(
              leading: const Icon(Icons.phone_outlined),
              title: const Text('Phone'),
              subtitle: Text(user.phone!),
            ),
          if (user.address != null)
            ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: const Text('Default Address'),
              subtitle: Text(user.address!),
            ),

          const Padding(
            padding: EdgeInsets.all(16),
            child: _StoreSupportAndPaymentsCard(),
          ),
        ],
      ),
    );
  }
}

/// Mirrors Web Footer.jsx contact details, social links & payment badges
class _StoreSupportAndPaymentsCard extends StatefulWidget {
  const _StoreSupportAndPaymentsCard();

  @override
  State<_StoreSupportAndPaymentsCard> createState() =>
      _StoreSupportAndPaymentsCardState();
}

class _StoreSupportAndPaymentsCardState
    extends State<_StoreSupportAndPaymentsCard> {
  Map<String, dynamic> _settings = const {};

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    try {
      final data = await ApiService.instance.getSettings();
      if (mounted) {
        setState(() => _settings = data);
      }
    } catch (_) {}
  }

  String _setting(List<String> keys, String fallback) {
    for (final k in keys) {
      final raw = _settings[k]?.toString().trim() ?? '';
      if (raw.isNotEmpty) return raw;
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final returnDays =
        int.tryParse(_settings['return_window_days']?.toString() ?? '') ?? 3;
    final address =
        _setting(const ['store_address', 'pickup_location'], 'Accra, Ghana');
    final phone = _setting(
        const ['store_phone', 'contact_phone', 'whatsapp_number'],
        '+233 24 585 2804');
    final telDigits = phone.replaceAll(RegExp(r'[^0-9+]'), '');
    final email = _setting(
        const ['store_email', 'contact_email'], 'hello@bodycreamgh.com');
    final pickupEnabled = _settings['pickup_enabled'] != false &&
        _settings['pickup_enabled'] != 'false';
    final podEnabled = _settings['pay_on_delivery_enabled'] == true ||
        _settings['pay_on_delivery_enabled'] == 'true';
    final paymentBadges = [
      '🔒 Paystack',
      '📱 MTN MoMo',
      '💳 Visa / Mastercard',
      if (pickupEnabled) '🏪 Pickup Station',
      if (podEnabled) '💵 Pay on Delivery',
    ];
    final accraEta =
        _setting(const ['delivery_estimate_accra'], '1–2 business days');
    final nationwideEta =
        _setting(const ['delivery_estimate_nationwide'], '3–5 business days');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'CUSTOMER SUPPORT & CONTACT',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
                color: cs.secondary,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(Icons.place_outlined,
                    size: 16, color: cs.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(address, style: const TextStyle(fontSize: 13)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            InkWell(
              onTap: () => WhatsAppHelper.openUrl('tel:$telDigits'),
              child: Row(
                children: [
                  Icon(Icons.phone_outlined,
                      size: 16, color: cs.secondary),
                  const SizedBox(width: 8),
                  Text(
                    phone,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: cs.primary,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            InkWell(
              onTap: () => WhatsAppHelper.openUrl('mailto:$email'),
              child: Row(
                children: [
                  Icon(Icons.email_outlined,
                      size: 16, color: cs.secondary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      email,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: cs.primary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            const Divider(),
            const SizedBox(height: 10),
            const Text(
              'ACCEPTED PAYMENT & DELIVERY METHODS',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: paymentBadges
                  .map(
                    (b) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: cs.secondaryContainer,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: cs.outline),
                      ),
                      child: Text(
                        b,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: cs.primary,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 14),
            const Divider(),
            const SizedBox(height: 10),
            const Text(
              'LEGAL & STORE POLICIES',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                _policyButton(
                  context,
                  'Privacy Policy',
                  _setting(const ['policy_privacy'],
                      'We collect only the contact and delivery details required to fulfill your orders under the Ghana Data Protection Act, 2012 (Act 843). Card and Mobile Money payments are processed securely by Paystack.'),
                ),
                _policyButton(
                  context,
                  'Terms & Conditions',
                  _setting(const ['policy_terms'],
                      'All prices are in GHS. Unpaid Paystack orders expire after 30 minutes to release reserved stock. Products are formulated for external cosmetic use only.'),
                ),
                _policyButton(
                  context,
                  'Refund Policy',
                  _setting(const ['policy_refund'],
                      'Returns are accepted within $returnDays days of delivery for wrong, damaged, or unopened sealed items. Opened skincare products cannot be returned for hygiene reasons unless defective.'),
                ),
                _policyButton(
                  context,
                  'Shipping Policy',
                  _setting(const ['policy_shipping'],
                      'Greater Accra deliveries arrive in $accraEta; nationwide orders arrive in $nationwideEta. Providing your GhanaPostGPS code and nearest landmark speeds up dispatch.'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _policyButton(BuildContext context, String title, String body) {
    return TextButton(
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (ctx) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 10),
              Text(
                body,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.5,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.secondary,
        ),
      ),
    );
  }
}
