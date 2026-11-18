import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    if (!auth.isLoggedIn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Account')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.person_outline, size: 80, color: Colors.grey),
                const SizedBox(height: 16),
                Text('Sign in to see your account',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Log In'),
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () => context.go('/register'),
                  child: const Text('Create Account'),
                ),
              ],
            ),
          ),
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
            color: Theme.of(context).colorScheme.primaryContainer,
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  child: Text(
                    user.firstName.isNotEmpty
                        ? user.firstName[0].toUpperCase()
                        : (user.email.isNotEmpty ? user.email[0].toUpperCase() : 'U'),
                    style: const TextStyle(fontSize: 28, color: Colors.white),
                  ),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(user.fullName,
                        style: Theme.of(context).textTheme.titleLarge),
                    Text(user.email,
                        style: Theme.of(context).textTheme.bodyMedium),
                  ],
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
            leading: const Icon(Icons.person_outline),
            title: const Text('Edit Profile'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.go('/profile/edit'),
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
        ],
      ),
    );
  }
}
