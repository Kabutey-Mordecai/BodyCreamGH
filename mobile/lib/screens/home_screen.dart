import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';

const String _defaultHeroImg =
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1024&q=80';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Product> _featured = [];
  Map<String, dynamic> _settings = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        ApiService.instance.getProducts(limit: 6),
        ApiService.instance.getSettings().catchError((_) => <String, dynamic>{}),
      ]);
      final rawProducts = results[0] as List<dynamic>;
      final settings = results[1] as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _featured = rawProducts
              .map((j) => Product.fromJson(j as Map<String, dynamic>))
              .toList();
          _settings = settings;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _str(String key, String fallback) {
    final v = _settings[key];
    return (v is String && v.trim().isNotEmpty) ? v.trim() : fallback;
  }

  @override
  Widget build(BuildContext context) {
    final storeName = _str('store_name', AppConfig.appName);
    final announcementEnabled = _settings['announcement_enabled'] != false;
    final announcementText = _str(
      'announcement_text',
      'Free delivery on orders over GHS 800 · Shop now',
    );
    final heroLabel = _str('hero_label', 'Handcrafted in Ghana');
    final heroHeadline = _str('hero_headline', 'Reveal your natural glow.');
    final heroSubtitle = _str(
      'hero_subtitle',
      "Luxury body creams blended with shea butter, cocoa butter, and Africa's finest botanicals.",
    );
    final heroCta = _str('hero_cta_text', 'Shop the Collection');
    final rawHeroImg = _str('hero_image', _defaultHeroImg);
    final heroImage = rawHeroImg.startsWith('http')
        ? rawHeroImg
        : AppConfig.resolveImageUrl(rawHeroImg);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              storeName.toUpperCase(),
              style: const TextStyle(
                fontFamily: 'serif',
                fontSize: 18,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.6,
                color: AppColors.primary,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search, color: AppColors.primary),
            onPressed: () => context.go('/shop'),
            tooltip: 'Search',
          ),
          CartBadge(onPressed: () => context.go('/cart')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.accent,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top dark announcement strip (matches web AnnouncementBar)
              if (announcementEnabled)
                Container(
                  width: double.infinity,
                  color: AppColors.dark,
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 9),
                  child: Text(
                    announcementText,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.accentLight,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w500,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),

              // Editorial Hero Banner
              _EditorialHero(
                imageUrl: heroImage,
                label: heroLabel,
                headline: heroHeadline,
                subtitle: heroSubtitle,
                ctaText: heroCta,
                onCta: () => context.go('/shop'),
              ),

              // Trust Strip (matches web TrustStrip)
              const _TrustStrip(),

              const SizedBox(height: 24),

              // Featured section header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'OUR COLLECTION',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.8,
                            color: AppColors.accentDark,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Featured Products',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                      ],
                    ),
                    TextButton(
                      onPressed: () => context.go('/shop'),
                      child: const Text('View all →'),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 12),

              if (_loading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(40),
                    child: CircularProgressIndicator(),
                  ),
                )
              else
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      childAspectRatio: 0.62,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 12,
                    ),
                    itemCount: _featured.length,
                    itemBuilder: (_, i) {
                      final p = _featured[i];
                      return ProductCard(
                        product: p,
                        onTap: () => context.go('/product/${p.id}'),
                        onAddToCart: p.inStock
                            ? () {
                                context.read<CartProvider>().add(p);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('${p.name} added to cart'),
                                    duration: const Duration(seconds: 2),
                                  ),
                                );
                              }
                            : null,
                      );
                    },
                  ),
                ),

              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}

class _EditorialHero extends StatelessWidget {
  final String imageUrl;
  final String label;
  final String headline;
  final String subtitle;
  final String ctaText;
  final VoidCallback onCta;

  const _EditorialHero({
    required this.imageUrl,
    required this.label,
    required this.headline,
    required this.subtitle,
    required this.ctaText,
    required this.onCta,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 270,
      child: Stack(
        fit: StackFit.expand,
        children: [
          CachedNetworkImage(
            imageUrl: imageUrl,
            fit: BoxFit.cover,
            placeholder: (_, __) => const ColoredBox(color: AppColors.dark),
            errorWidget: (_, __, ___) => const ColoredBox(color: AppColors.dark),
          ),
          // Warm espresso editorial scrim
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [
                  Color(0xD9141010),
                  Color(0x991C1410),
                  Color(0x4D141010),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.accent,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 2.0,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  headline,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'serif',
                    fontSize: 30,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                    height: 1.12,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.86),
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: onCta,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.accent,
                    foregroundColor: AppColors.primary,
                    minimumSize: const Size(0, 42),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 10),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(4),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.8,
                    ),
                  ),
                  child: Text(ctaText),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TrustStrip extends StatelessWidget {
  const _TrustStrip();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.border, width: 1)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _TrustItem(icon: Icons.eco_outlined, label: '100% Natural'),
          _TrustItem(icon: Icons.local_shipping_outlined, label: 'Nationwide'),
          _TrustItem(icon: Icons.verified_user_outlined, label: 'Paystack Safe'),
        ],
      ),
    );
  }
}

class _TrustItem extends StatelessWidget {
  final IconData icon;
  final String label;

  const _TrustItem({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppColors.accentDark),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
            color: AppColors.primary,
          ),
        ),
      ],
    );
  }
}
