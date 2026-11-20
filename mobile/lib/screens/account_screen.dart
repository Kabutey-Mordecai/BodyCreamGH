import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/wishlist_provider.dart';
import '../theme/app_theme.dart';
import '../utils/whatsapp_helper.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
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
                    const Icon(Icons.person_outline,
                        size: 56, color: AppColors.accentDark),
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
                    leading: const Icon(Icons.local_shipping_outlined,
                        color: AppColors.accentDark),
                    title: const Text('Track an Order'),
                    subtitle: const Text('Look up any guest or account order'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/track-order'),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: const Icon(Icons.favorite_border,
                        color: AppColors.accentDark),
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
            color: AppColors.primary,
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: AppColors.accent,
                  child: Text(
                    user.firstName.isNotEmpty
                        ? user.firstName[0].toUpperCase()
                        : (user.email.isNotEmpty
                            ? user.email[0].toUpperCase()
                            : 'U'),
                    style: const TextStyle(
                      fontFamily: 'serif',
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primary,
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
                            ?.copyWith(color: Colors.white),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        user.email,
                        style: const TextStyle(
                          color: AppColors.accentLight,
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
class _StoreSupportAndPaymentsCard extends StatelessWidget {
  const _StoreSupportAndPaymentsCard();

  static const _paymentBadges = [
    '🔒 Paystack',
    '📱 MTN MoMo',
    '💳 Visa / Mastercard',
    '🏪 Pickup Station',
    '💵 Pay on Delivery',
  ];

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'CUSTOMER SUPPORT & CONTACT',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
                color: AppColors.accentDark,
              ),
            ),
            const SizedBox(height: 10),
            const Row(
              children: [
                Icon(Icons.place_outlined, size: 16, color: AppColors.muted),
                SizedBox(width: 8),
                Text('Accra, Ghana', style: TextStyle(fontSize: 13)),
              ],
            ),
            const SizedBox(height: 8),
            InkWell(
              onTap: () => WhatsAppHelper.openUrl('tel:+233245852804'),
              child: const Row(
                children: [
                  Icon(Icons.phone_outlined,
                      size: 16, color: AppColors.accentDark),
                  SizedBox(width: 8),
                  Text(
                    '+233 24 585 2804',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primary,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            InkWell(
              onTap: () =>
                  WhatsAppHelper.openUrl('mailto:hello@bodycreamgh.com'),
              child: const Row(
                children: [
                  Icon(Icons.email_outlined,
                      size: 16, color: AppColors.accentDark),
                  SizedBox(width: 8),
                  Text(
                    'hello@bodycreamgh.com',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primary,
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
              children: _paymentBadges
                  .map(
                    (b) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.blush,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Text(
                        b,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }
}
