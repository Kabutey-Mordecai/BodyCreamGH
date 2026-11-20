import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../models/product.dart';
import '../providers/cart_provider.dart';
import '../providers/wishlist_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';

const String _defaultHeroImg =
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1024&q=80';

const List<Map<String, String>> _defaultFaqs = [
  {
    'q': 'How quickly do you deliver across Ghana?',
    'a': 'Orders within Greater Accra arrive within 24–48 hours. Nationwide deliveries across all 16 regions take 2–4 business days.'
  },
  {
    'q': 'Are your shea and cocoa butter products 100% natural?',
    'a': 'Yes — every batch is hand-whipped with unrefined Northern Ghana shea butter, cold-pressed botanical oils, and zero parabens.'
  },
  {
    'q': 'How do I pay and can I track my order as a guest?',
    'a': 'Pay securely via Paystack (Mobile Money or Card). Both guests and registered customers can track orders anytime from the Track Order page.'
  },
];

const List<Map<String, dynamic>> _defaultTestimonials = [
  {
    'customer_name': 'Akosua M. · East Legon',
    'rating': 5,
    'comment': 'The Cinnamon & Honey Glow Mask left my skin luminous after the very first use. Best Ghanaian skincare brand!',
  },
  {
    'customer_name': 'Nana Ama K. · Kumasi',
    'rating': 5,
    'comment': 'Rich, whipped texture that melts right in without feeling greasy in our warm weather. Delivery to Kumasi was super fast.',
  },
  {
    'customer_name': 'Efua T. · Tema',
    'rating': 5,
    'comment': 'The Lavender Calm Night Butter smells heavenly and completely healed my dry elbows in a week.',
  },
];

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Product> _products = [];
  List<Map<String, dynamic>> _reviews = [];
  Map<String, dynamic> _settings = {};
  bool _loading = true;
  String _activeCategory = 'All';

  final _nlEmailCtrl = TextEditingController();
  bool _nlSubmitting = false;
  String? _nlCouponResult;
  String? _nlError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nlEmailCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        ApiService.instance.getProducts(limit: 12),
        ApiService.instance.getSettings().catchError((_) => <String, dynamic>{}),
        ApiService.instance.getFeaturedReviews().catchError((_) => <dynamic>[]),
      ]);
      final rawProducts = results[0] as List<dynamic>;
      final settings = results[1] as Map<String, dynamic>;
      final rawReviews = results[2] as List<dynamic>;
      if (mounted) {
        setState(() {
          _products = rawProducts
              .whereType<Map<String, dynamic>>()
              .map(Product.fromJson)
              .toList();
          _settings = settings;
          _reviews = rawReviews.whereType<Map<String, dynamic>>().toList();
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

  List<String> get _categories {
    final set = <String>{'All'};
    for (final p in _products) {
      if (p.category != null && p.category!.trim().isNotEmpty) {
        set.add(p.category!.trim());
      }
    }
    if (set.length <= 1) {
      set.addAll(['Skincare', 'Body Care', 'Haircare', 'Fragrance']);
    }
    return set.toList();
  }

  List<Product> get _filteredFeatured {
    if (_activeCategory == 'All') return _products.take(6).toList();
    return _products
        .where((p) =>
            (p.category ?? '').toLowerCase() == _activeCategory.toLowerCase())
        .toList();
  }

  List<Product> get _flashDeals {
    final onSale = _products.where((p) => p.isOnSale && p.inStock).toList();
    if (onSale.isNotEmpty) return onSale;
    return _products.where((p) => p.inStock).take(4).toList();
  }

  Future<void> _subscribeNewsletter() async {
    final email = _nlEmailCtrl.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _nlError = 'Please enter a valid email address');
      return;
    }
    setState(() {
      _nlSubmitting = true;
      _nlError = null;
    });
    try {
      await ApiService.instance.subscribeNewsletter(email);
      if (!mounted) return;
      final code = _str('newsletter_coupon_code', 'WELCOME10');
      setState(() {
        _nlSubmitting = false;
        _nlCouponResult = code;
        _nlEmailCtrl.clear();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _nlSubmitting = false;
        _nlError = e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final wishlist = context.watch<WishlistProvider>();
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

    final flashEnabled = _settings['flash_sale_enabled'] != false;
    final flashTitle = _str('flash_sale_title', "Today's Deals");
    final flashBadge = _str('flash_sale_badge', 'FLASH SALE');

    final reviewsToShow =
        _reviews.isNotEmpty ? _reviews : _defaultTestimonials;

    final List<Map<String, String>> faqs = [];
    if (_settings['faq_items'] is List) {
      for (final item in (_settings['faq_items'] as List)) {
        if (item is Map && item['q'] != null && item['a'] != null) {
          faqs.add({'q': item['q'].toString(), 'a': item['a'].toString()});
        }
      }
    }
    if (faqs.isEmpty) faqs.addAll(_defaultFaqs);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          storeName.toUpperCase(),
          style: const TextStyle(
            fontFamily: 'serif',
            fontSize: 18,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.6,
            color: AppColors.primary,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.local_shipping_outlined,
                color: AppColors.primary, size: 21),
            onPressed: () => context.push('/track-order'),
            tooltip: 'Track Order',
          ),
          Stack(
            children: [
              IconButton(
                icon: const Icon(Icons.favorite_border,
                    color: AppColors.primary, size: 21),
                onPressed: () => context.push('/wishlist'),
                tooltip: 'Wishlist',
              ),
              if (wishlist.count > 0)
                Positioned(
                  right: 6,
                  top: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: const BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                    ),
                    constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
                    child: Text(
                      '${wishlist.count}',
                      style: const TextStyle(
                        color: AppColors.primary,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
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
              // 1. Top dark announcement strip
              if (announcementEnabled)
                InkWell(
                  onTap: () => context.go('/shop'),
                  child: Container(
                    width: double.infinity,
                    color: AppColors.dark,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
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
                ),

              // 2. Editorial Hero Banner
              _EditorialHero(
                imageUrl: heroImage,
                label: heroLabel,
                headline: heroHeadline,
                subtitle: heroSubtitle,
                ctaText: heroCta,
                onCta: () => context.go('/shop'),
              ),

              // 3. Trust Strip
              const _TrustStrip(),

              const SizedBox(height: 22),

              // 4. Flash Sale / Today's Deals Shelf with live Countdown Timer
              if (flashEnabled && _flashDeals.isNotEmpty) ...[
                _FlashSaleSection(
                  badge: flashBadge,
                  title: flashTitle,
                  products: _flashDeals,
                ),
                const SizedBox(height: 26),
              ],

              // 5. Featured Collection header + Category filter tabs
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

              const SizedBox(height: 10),

              // Category tabs (matches web Home category tabs)
              SizedBox(
                height: 38,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  itemCount: _categories.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final cat = _categories[i];
                    final selected = cat == _activeCategory;
                    return ChoiceChip(
                      showCheckmark: false,
                      label: Text(
                        cat,
                        style: TextStyle(
                          color: selected ? Colors.white : AppColors.text,
                          fontWeight:
                              selected ? FontWeight.w700 : FontWeight.w500,
                          fontSize: 12.5,
                        ),
                      ),
                      selected: selected,
                      onSelected: (_) => setState(() => _activeCategory = cat),
                    );
                  },
                ),
              ),

              const SizedBox(height: 14),

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
                      childAspectRatio: 0.59,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 12,
                    ),
                    itemCount: _filteredFeatured.length,
                    itemBuilder: (_, i) {
                      final p = _filteredFeatured[i];
                      return ProductCard(
                        product: p,
                        heroPrefix: 'home',
                        onTap: () => context.push('/product/${p.id}'),
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

              // 6. Mid-page Brand Story Banner (matches web MidPageBanner)
              _MidPageStoryBanner(onExplore: () => context.go('/shop')),

              // 7. Recently Viewed Shelf (matches web RecentlyViewed)
              if (wishlist.recentlyViewed.isNotEmpty) ...[
                const SizedBox(height: 28),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'PICK UP WHERE YOU LEFT OFF',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.6,
                              color: AppColors.accentDark,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Recently Viewed',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ],
                      ),
                      TextButton(
                        onPressed: () => wishlist.clearRecentlyViewed(),
                        child: const Text('Clear'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 255,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    itemCount: wishlist.recentlyViewed.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 10),
                    itemBuilder: (_, i) {
                      final p = wishlist.recentlyViewed[i];
                      return SizedBox(
                        width: 165,
                        child: ProductCard(
                          product: p,
                          heroPrefix: 'recent',
                          onTap: () => context.push('/product/${p.id}'),
                          onAddToCart: p.inStock
                              ? () {
                                  context.read<CartProvider>().add(p);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                        content: Text('${p.name} added to cart')),
                                  );
                                }
                              : null,
                        ),
                      );
                    },
                  ),
                ),
              ],

              const SizedBox(height: 28),

              // 8. Customer Testimonials Carousel
              _TestimonialsSection(reviews: reviewsToShow),

              const SizedBox(height: 28),

              // 9. FAQ Accordion (matches web HomeFaq)
              _FaqSection(faqs: faqs),

              const SizedBox(height: 28),

              // 10. Newsletter Subscription Card (matches web Newsletter)
              _NewsletterCard(
                headline: _str(
                    'newsletter_headline', 'Get 10% off your first order'),
                subtitle: _str(
                  'newsletter_subtitle',
                  'Join our newsletter for exclusive offers, skincare tips, and new arrivals.',
                ),
                emailCtrl: _nlEmailCtrl,
                submitting: _nlSubmitting,
                couponResult: _nlCouponResult,
                error: _nlError,
                onSubmit: _subscribeNewsletter,
              ),

              const SizedBox(height: 32),
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
                    padding:
                        const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
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

class _FlashSaleSection extends StatefulWidget {
  final String badge;
  final String title;
  final List<Product> products;

  const _FlashSaleSection({
    required this.badge,
    required this.title,
    required this.products,
  });

  @override
  State<_FlashSaleSection> createState() => _FlashSaleSectionState();
}

class _FlashSaleSectionState extends State<_FlashSaleSection> {
  late Timer _timer;
  Duration _left = Duration.zero;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    final now = DateTime.now();
    final endOfDay = DateTime(now.year, now.month, now.day, 23, 59, 59);
    final diff = endOfDay.difference(now);
    if (mounted) {
      setState(() => _left = diff.isNegative ? Duration.zero : diff);
    }
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hrs = _left.inHours.toString().padLeft(2, '0');
    final min = (_left.inMinutes % 60).toString().padLeft(2, '0');
    final sec = (_left.inSeconds % 60).toString().padLeft(2, '0');

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.blush,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.accent.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      widget.badge.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.accent,
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    widget.title,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ],
              ),
              Row(
                children: [
                  _TimeBox(value: hrs, unit: 'HRS'),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 3),
                    child: Text(':',
                        style: TextStyle(fontWeight: FontWeight.w800)),
                  ),
                  _TimeBox(value: min, unit: 'MIN'),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 3),
                    child: Text(':',
                        style: TextStyle(fontWeight: FontWeight.w800)),
                  ),
                  _TimeBox(value: sec, unit: 'SEC'),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 255,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: widget.products.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (_, i) {
                final p = widget.products[i];
                return SizedBox(
                  width: 165,
                  child: ProductCard(
                    product: p,
                    heroPrefix: 'flash',
                    onTap: () => context.push('/product/${p.id}'),
                    onAddToCart: p.inStock
                        ? () {
                            context.read<CartProvider>().add(p);
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('${p.name} added to cart')),
                            );
                          }
                        : null,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TimeBox extends StatelessWidget {
  final String value;
  final String unit;
  const _TimeBox({required this.value, required this.unit});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          Text(
            unit,
            style: const TextStyle(
              color: AppColors.accent,
              fontSize: 8,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _MidPageStoryBanner extends StatelessWidget {
  final VoidCallback onExplore;
  const _MidPageStoryBanner({required this.onExplore});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'PURE GHANAIAN BOTANICALS',
            style: TextStyle(
              color: AppColors.accent,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.8,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Hand-whipped in small batches with unrefined Northern Ghana shea butter.',
            style: TextStyle(
              fontFamily: 'serif',
              color: Colors.white,
              fontSize: 21,
              fontWeight: FontWeight.w600,
              height: 1.22,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Ethically sourced directly from women-led cooperatives and formulated for deep, lasting radiance in tropical climates.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.8),
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: onExplore,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.accent,
              side: const BorderSide(color: AppColors.accent),
              minimumSize: const Size(0, 40),
            ),
            child: const Text('Explore Collection →'),
          ),
        ],
      ),
    );
  }
}

class _TestimonialsSection extends StatelessWidget {
  final List<Map<String, dynamic>> reviews;
  const _TestimonialsSection({required this.reviews});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'VERIFIED BUYERS',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.8,
                  color: AppColors.accentDark,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'What Our Customers Say',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 170,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            itemCount: reviews.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (_, i) {
              final r = reviews[i];
              final rating =
                  int.tryParse((r['rating'] ?? 5).toString())?.clamp(1, 5) ?? 5;
              final comment =
                  (r['comment'] ?? r['text'] ?? '').toString().trim();
              final author = (r['customer_name'] ??
                      r['author'] ??
                      r['first_name'] ??
                      'Verified Customer')
                  .toString();

              return Container(
                width: 265,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: List.generate(
                        5,
                        (idx) => Icon(
                          idx < rating ? Icons.star_rounded : Icons.star_border_rounded,
                          size: 16,
                          color: AppColors.accent,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: Text(
                        '"$comment"',
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.4,
                          color: AppColors.text,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(Icons.verified,
                            size: 14, color: AppColors.accentDark),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Text(
                            author,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _FaqSection extends StatelessWidget {
  final List<Map<String, String>> faqs;
  const _FaqSection({required this.faqs});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 2),
            child: Text(
              'COMMON QUESTIONS',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.8,
                color: AppColors.accentDark,
              ),
            ),
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Text(
              'Frequently Asked Questions',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Column(
              children: faqs
                  .map(
                    (f) => ExpansionTile(
                      title: Text(
                        f['q'] ?? '',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                      iconColor: AppColors.accentDark,
                      collapsedIconColor: AppColors.muted,
                      childrenPadding:
                          const EdgeInsets.fromLTRB(16, 0, 16, 14),
                      children: [
                        Text(
                          f['a'] ?? '',
                          style: const TextStyle(
                            fontSize: 13.5,
                            color: AppColors.muted,
                            height: 1.45,
                          ),
                        ),
                      ],
                    ),
                  )
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _NewsletterCard extends StatelessWidget {
  final String headline;
  final String subtitle;
  final TextEditingController emailCtrl;
  final bool submitting;
  final String? couponResult;
  final String? error;
  final VoidCallback onSubmit;

  const _NewsletterCard({
    required this.headline,
    required this.subtitle,
    required this.emailCtrl,
    required this.submitting,
    required this.couponResult,
    required this.error,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'THE INNER CIRCLE',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.8,
              color: AppColors.accentDark,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            headline,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: const TextStyle(color: AppColors.muted, fontSize: 13.5),
          ),
          const SizedBox(height: 14),
          if (couponResult != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.blush,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: AppColors.accent),
              ),
              child: Column(
                children: [
                  const Text(
                    "You're on the list! Use this code at checkout:",
                    style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                  ),
                  const SizedBox(height: 4),
                  SelectableText(
                    couponResult!,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 2.0,
                      color: AppColors.primary,
                    ),
                  ),
                ],
              ),
            )
          else ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      hintText: 'Enter your email address',
                      isDense: true,
                    ),
                    onSubmitted: (_) => onSubmit(),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton(
                  onPressed: submitting ? null : onSubmit,
                  child: Text(submitting ? '...' : 'Subscribe'),
                ),
              ],
            ),
            if (error != null) ...[
              const SizedBox(height: 8),
              Text(
                error!,
                style: const TextStyle(color: AppColors.error, fontSize: 12.5),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
