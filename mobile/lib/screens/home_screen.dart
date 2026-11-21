import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../models/product.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';
import '../providers/wishlist_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/whatsapp_helper.dart';
import '../widgets/cart_badge.dart';
import '../widgets/product_card.dart';
import '../widgets/search_autocomplete_field.dart';

bool _promoPopupShownThisSession = false;

const String _defaultHeroImg =
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1024&q=80';

const List<String> _galleryImages = [
  'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=400&h=400&q=80',
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=400&h=400&q=80',
];

const List<Map<String, String>> _defaultCategories = [
  {
    'label': 'Body Butter',
    'image': 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=600&q=80',
  },
  {
    'label': 'Body Cream',
    'image': 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=600&q=80',
  },
  {
    'label': 'Body Oil',
    'image': 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=600&q=80',
  },
  {
    'label': 'Body Scrub',
    'image': 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=600&q=80',
  },
];

const List<Map<String, String>> _defaultLookbookSlides = [
  {
    'badge': 'PURE GHANAIAN BOTANICALS',
    'title': 'Handcrafted in Small Batches.',
    'highlight': 'Zero Harsh Bleaching Agents.',
    'subtitle': 'Raw unrefined shea butter from Northern Ghana cooperatives, blended with botanical oils for rich, natural skin nutrition.',
    'cta_text': 'Shop Collection',
    'category': '',
    'image': 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80',
  },
  {
    'badge': 'CLINICALLY PROVEN HYDRATION',
    'title': '48-Hour Deep Moisture Lock.',
    'highlight': 'Melanin-Rich Formula.',
    'subtitle': 'Enriched with cold-pressed baobab and virgin coconut oil to soothe eczema, stretch marks, and dry harmattan skin.',
    'cta_text': 'Shop Body Creams',
    'category': 'Body Cream',
    'image': 'https://images.unsplash.com/photo-1576426863848-c21f53c60b19?auto=format&fit=crop&w=700&q=80',
  },
  {
    'badge': 'BESTSELLER RADIANCE',
    'title': 'Rose Gold Botanical Glow.',
    'highlight': 'Non-Greasy Velvet Finish.',
    'subtitle': 'Infused with golden mica particles and wild rosehip seed oil for an instant sun-kissed Ghanaian summer glow.',
    'cta_text': 'Discover Glow Oils',
    'category': 'Body Oil',
    'image': 'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=700&q=80',
  },
  {
    'badge': 'WEEKEND LUXURY RITUAL',
    'title': 'Botanical Exfoliating Polish.',
    'highlight': 'Silky Smooth Finish.',
    'subtitle': 'Natural Ghanaian cane sugar crystals and raw shea butter to gently buff away dry skin and reveal radiant softness.',
    'cta_text': 'Shop Body Scrubs',
    'category': 'Body Scrub',
    'image': 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=700&q=80',
  },
];

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
    'customer_name': 'Akosua M.',
    'location': 'East Legon, Accra',
    'rating': 5,
    'comment': 'The Cinnamon & Honey Glow Mask left my skin luminous after the very first use. Best Ghanaian skincare brand!',
  },
  {
    'customer_name': 'Nana Ama K.',
    'location': 'Kumasi',
    'rating': 5,
    'comment': 'Rich, whipped texture that melts right in without feeling greasy in our warm weather. Delivery to Kumasi was super fast.',
  },
  {
    'customer_name': 'Efua T.',
    'location': 'Tema',
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

  final _heroSearchCtrl = TextEditingController();
  final _nlEmailCtrl = TextEditingController();
  bool _nlSubmitting = false;
  String? _nlCouponResult;
  String? _nlError;
  bool _hideNewsletterBar = false;
  bool _announcementDismissed = false;
  Timer? _promoPopupTimer;

  @override
  void initState() {
    super.initState();
    _initNewsletterVisibility();
    _load();
  }

  Future<void> _initNewsletterVisibility() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final sub = prefs.getBool('bc_newsletter_subscribed') == true;
      final ordered = prefs.getBool('bc_first_order_done') == true;
      final savedEmail = prefs.getString('bc_newsletter_email');
      if (mounted && (sub || ordered)) {
        setState(() => _hideNewsletterBar = true);
      }
      final userEmail = context.mounted ? context.read<AuthProvider>().user?.email : null;
      final emailToCheck = (userEmail != null && userEmail.isNotEmpty)
          ? userEmail
          : savedEmail;
      if (emailToCheck != null || (context.mounted && context.read<AuthProvider>().isLoggedIn)) {
        final status = await ApiService.instance.getNewsletterStatus(email: emailToCheck);
        if (!mounted) return;
        if (status['shouldHideBar'] == true) {
          setState(() => _hideNewsletterBar = true);
        }
        if (status['hasPlacedOrder'] == true) {
          await prefs.setBool('bc_first_order_done', true);
          await prefs.remove('bc_welcome_coupon');
        } else if (status['eligibleForWelcomeDiscount'] == true &&
            status['couponCode'] != null) {
          await prefs.setString('bc_welcome_coupon', status['couponCode'].toString());
        }
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _promoPopupTimer?.cancel();
    _heroSearchCtrl.dispose();
    _nlEmailCtrl.dispose();
    super.dispose();
  }

  List<Map<String, String>> _buildDynamicFaqs() {
    if (_settings['faq_items'] is List) {
      final custom = <Map<String, String>>[];
      for (final item in (_settings['faq_items'] as List)) {
        if (item is Map && item['q'] != null && item['a'] != null) {
          final q = item['q'].toString().trim();
          final a = item['a'].toString().trim();
          if (q.isNotEmpty && a.isNotEmpty) {
            custom.add({'q': q, 'a': a});
          }
        }
      }
      if (custom.isNotEmpty) return custom;
    }

    final storeName = _str('store_name', 'BodyCream GH');
    final accraEta = _str('delivery_estimate_accra', '1–2 business days');
    final nationEta = _str('delivery_estimate_nationwide', '3–5 business days');
    final freeOver = double.tryParse((_settings['free_delivery_over'] ?? 200).toString()) ?? 200;
    final pickupEnabled = _settings['pickup_enabled'] != false && _settings['pickup_enabled'] != 'false';
    final pickupLocation = _str('pickup_location', 'East Legon, Accra (Call upon arrival)');
    final pickupHours = _str('pickup_hours', 'Mon–Sat, 9:00 AM – 6:00 PM');
    final podEnabled = _settings['pay_on_delivery_enabled'] == true || _settings['pay_on_delivery_enabled'] == 'true';
    final podAccraOnly = _settings['pay_on_delivery_accra_only'] != false && _settings['pay_on_delivery_accra_only'] != 'false';

    final freeDeliverySentence = freeOver > 0
        ? ' Orders over GHS ${freeOver.toStringAsFixed(0)} qualify for free delivery.'
        : '';
    final pickupSentence = pickupEnabled
        ? ' Free store pickup is also available at $pickupLocation ($pickupHours).'
        : '';
    final podSentence = podEnabled
        ? (podAccraOnly
            ? ' Pay on Delivery is also available for Greater Accra deliveries and Store Pickup.'
            : ' Pay on Delivery (Cash or Mobile Money on arrival) is also available.')
        : '';

    return [
      {
        'q': 'How long does delivery take across Ghana?',
        'a': 'Orders within Greater Accra typically arrive in $accraEta. Nationwide deliveries across all 16 regions of Ghana take $nationEta.$freeDeliverySentence$pickupSentence',
      },
      {
        'q': 'Which payment methods do you accept?',
        'a': 'We accept MTN Mobile Money (MoMo), Telecel Cash, AirtelTigo Money, Visa, Mastercard, and Bank Transfer securely through Paystack.$podSentence',
      },
      {
        'q': 'Are $storeName products safe for all skin types?',
        'a': 'Yes. Every batch is handcrafted in Ghana with raw, unrefined Northern Ghana shea butter and cold-pressed botanical oils — free from hydroquinone, mercury, parabens, sulfates, and harsh bleaching agents.',
      },
      {
        'q': 'How do I track my order after checkout?',
        'a': 'As soon as your order is confirmed, you receive an order number by email. You can check live order and delivery updates anytime on our Track Order page or under My Orders in your account.',
      },
      {
        'q': 'What is your return and refund policy?',
        'a': 'If an item arrives damaged or differs from what you ordered, you can request a return or refund within 7 days of delivery directly from your Order Detail page.',
      },
    ];
  }

  void _maybeSchedulePromoPopup(Map<String, dynamic> settings) {
    if (_promoPopupShownThisSession) return;
    final enabled = settings['promo_popup_enabled'] == true ||
        settings['promo_popup_enabled'] == 'true';
    if (!enabled) return;
    final delaySec = (int.tryParse((settings['promo_popup_delay_sec'] ?? 2).toString()) ?? 2)
        .clamp(0, 30);
    _promoPopupTimer?.cancel();
    _promoPopupTimer = Timer(Duration(seconds: delaySec), () {
      if (!mounted || _promoPopupShownThisSession) return;
      _promoPopupShownThisSession = true;
      _showPromoPopupDialog(settings);
    });
  }

  void _showPromoPopupDialog(Map<String, dynamic> s) {
    final badge = (s['promo_popup_badge'] ?? '● BRAND DAY · TODAY ONLY').toString();
    final title = (s['promo_popup_title'] ?? 'Pure Shea Radiance.').toString();
    final highlight = (s['promo_popup_highlight'] ?? 'Slashed Prices').toString();
    final discount = (s['promo_popup_discount'] ?? 'UP TO 50% OFF').toString();
    final subtext = (s['promo_popup_subtext'] ?? 'Limited quantity · Handcrafted in Ghana').toString();
    final ctaText = (s['promo_popup_cta_text'] ?? 'Claim Your Glow').toString();
    final rawImg = (s['promo_popup_image'] ?? _defaultHeroImg).toString();
    final img = rawImg.startsWith('http') ? rawImg : AppConfig.resolveImageUrl(rawImg);

    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: AppColors.dark,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: AppColors.accent, width: 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Stack(
              children: [
                SizedBox(
                  height: 155,
                  width: double.infinity,
                  child: CachedNetworkImage(imageUrl: img, fit: BoxFit.cover),
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: IconButton(
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.black54,
                      foregroundColor: Colors.white,
                    ),
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ),
                Positioned(
                  left: 14,
                  bottom: 10,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.accent,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      discount,
                      style: const TextStyle(
                        color: AppColors.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.0,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    badge,
                    style: const TextStyle(
                      color: AppColors.accent,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.4,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '$title $highlight',
                    style: const TextStyle(
                      fontFamily: 'serif',
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    subtext,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.78),
                      fontSize: 12.5,
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.accent,
                        foregroundColor: AppColors.primary,
                      ),
                      onPressed: () {
                        Navigator.pop(ctx);
                        _navigateStorefrontLink(
                          s['promo_popup_cta_link']?.toString(),
                        );
                      },
                      child: Text('$ctaText →'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        ApiService.instance.getProducts(limit: 20),
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
        if (settings.isNotEmpty) {
          context.read<ThemeProvider>().applyFromSettings(settings);
        }
        _maybeSchedulePromoPopup(settings);
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
    return set.toList();
  }

  List<Map<String, String>> get _categoryCards {
    if (_settings['categories'] is List) {
      final list = <Map<String, String>>[];
      for (final c in (_settings['categories'] as List)) {
        if (c is Map && c['label'] != null) {
          final img = (c['image'] ?? '').toString();
          list.add({
            'label': c['label'].toString(),
            'image': img.startsWith('http') ? img : AppConfig.resolveImageUrl(img),
          });
        }
      }
      if (list.isNotEmpty) return list;
    }
    return _defaultCategories;
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

  void _goToShop({String? category, String? search}) {
    final params = <String, String>{
      if (category != null && category.isNotEmpty) 'category': category,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
    };
    final uri = Uri(
      path: '/shop',
      queryParameters: params.isEmpty ? null : params,
    );
    context.go(uri.toString());
  }

  /// Resolves any storefront CTA link (from Admin Storefront Editor):
  /// - `/products/:id` or `/product/:id` -> pushes directly to ProductDetailScreen
  /// - `/shop?category=...&search=...` -> navigates to ShopScreen with filters
  /// - external `http(s)://`, `wa.me`, `tel:`, `mailto:` -> opens externally
  void _navigateStorefrontLink(String? rawLink, {String? fallbackCategory}) {
    final link = (rawLink ?? '').trim();
    if (link.isEmpty) {
      _goToShop(category: fallbackCategory);
      return;
    }
    if (RegExp(r'^(https?:\/\/|mailto:|tel:|wa\.me)', caseSensitive: false)
        .hasMatch(link)) {
      WhatsAppHelper.openUrl(link);
      return;
    }
    final uri = Uri.tryParse(link);
    if (uri != null) {
      if (uri.pathSegments.length >= 2 &&
          (uri.pathSegments[0] == 'products' ||
              uri.pathSegments[0] == 'product')) {
        context.push('/product/${uri.pathSegments[1]}');
        return;
      }
      if (uri.path == '/shop') {
        _goToShop(
          category: uri.queryParameters['category'] ?? fallbackCategory,
          search: uri.queryParameters['search'],
        );
        return;
      }
    }
    _goToShop(category: fallbackCategory);
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
      final res = await ApiService.instance.subscribeNewsletter(email);
      if (!mounted) return;
      final isEligible = res['isFirstOrderEligible'] == true;
      final code = (res['couponCode'] ?? _str('newsletter_coupon_code', 'WELCOME10'))
          .toString();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('bc_newsletter_subscribed', true);
      await prefs.setString('bc_newsletter_email', email);
      if (isEligible) {
        await prefs.setString('bc_welcome_coupon', code);
      } else {
        await prefs.remove('bc_welcome_coupon');
        await prefs.setBool('bc_first_order_done', true);
      }
      if (!mounted) return;
      setState(() {
        _nlSubmitting = false;
        _nlCouponResult = isEligible ? code : 'SUBSCRIBED';
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
    final campaignTilesEnabled = _settings['campaign_tiles_enabled'] != false;

    final reviewsToShow =
        _reviews.isNotEmpty ? _reviews : _defaultTestimonials;

    final faqs = _buildDynamicFaqs();
    final logoUrl = _str('logo_url', '');
    final whatsappNumber = _str('whatsapp_number', '');
    final whatsappFloatEnabled =
        _settings['whatsapp_float_enabled'] != false &&
            _settings['whatsapp_float_enabled'] != 'false';
    final showAnnounceWhatsapp =
        _settings['announcement_show_whatsapp'] != false &&
            _settings['announcement_show_whatsapp'] != 'false' &&
            WhatsAppHelper.normalizeNumber(whatsappNumber).isNotEmpty;
    final seoEnabled = _settings['seo_editorial_enabled'] != false &&
        _settings['seo_editorial_enabled'] != 'false';
    final seoTitle = _str(
      'seo_editorial_title',
      'Handcrafted Luxury Skincare & Organic Body Creams in Ghana',
    );
    final seoText = _str(
      'seo_editorial_text',
      "Welcome to BodyCream GH, Ghana's premier destination for raw, unrefined shea butter creams, botanical radiance oils, and whipped moisturizing butters. Every formulation is handcrafted in Ghana using sustainably wildcrafted shea nuts harvested by women cooperatives across the Northern Region. Whether you are in Accra, Tema, Kumasi, Takoradi, Sunyani, or Tamale, we deliver glowing, deeply nourished skin directly to your doorstep with same-day express delivery in Accra and swift nationwide dispatch.",
    );

    return Scaffold(
      floatingActionButton: whatsappFloatEnabled &&
              WhatsAppHelper.normalizeNumber(whatsappNumber).isNotEmpty
          ? FloatingActionButton.small(
              heroTag: 'home-whatsapp-fab',
              backgroundColor: const Color(0xFF25D366),
              foregroundColor: Colors.white,
              tooltip: 'Chat on WhatsApp',
              onPressed: () => WhatsAppHelper.openWhatsApp(
                rawNumber: whatsappNumber,
                message:
                    'Hi $storeName, I have a question about your products.',
              ),
              child: const Icon(Icons.chat_bubble_outline, size: 20),
            )
          : null,
      appBar: AppBar(
        title: logoUrl.isNotEmpty
            ? SizedBox(
                height: 30,
                child: CachedNetworkImage(
                  imageUrl: logoUrl.startsWith('http')
                      ? logoUrl
                      : AppConfig.resolveImageUrl(logoUrl),
                  fit: BoxFit.contain,
                  errorWidget: (_, __, ___) => Text(
                    storeName.toUpperCase(),
                    style: const TextStyle(
                      fontFamily: 'serif',
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.6,
                      color: AppColors.primary,
                    ),
                  ),
                ),
              )
            : Text(
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
                    padding:
                        const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: const BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                    ),
                    constraints:
                        const BoxConstraints(minWidth: 15, minHeight: 15),
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
              // 1. Top dark announcement strip (with WhatsApp link & dismiss button)
              if (announcementEnabled && !_announcementDismissed)
                Container(
                  width: double.infinity,
                  color: AppColors.dark,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                  child: Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          onTap: () => _goToShop(),
                          child: Text(
                            announcementText,
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.accentLight,
                              fontSize: 11.5,
                              fontWeight: FontWeight.w500,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ),
                      if (showAnnounceWhatsapp) ...[
                        const SizedBox(width: 8),
                        InkWell(
                          onTap: () => WhatsAppHelper.openWhatsApp(
                            rawNumber: whatsappNumber,
                            message:
                                "Hi $storeName, I'd like to place an order.",
                          ),
                          child: const Text(
                            'WhatsApp',
                            style: TextStyle(
                              color: Color(0xFF4ADE80),
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              decoration: TextDecoration.underline,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(width: 6),
                      InkWell(
                        onTap: () =>
                            setState(() => _announcementDismissed = true),
                        child: const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 4),
                          child: Icon(Icons.close,
                              size: 14, color: AppColors.accentLight),
                        ),
                      ),
                    ],
                  ),
                ),

              // 2. Editorial Hero Banner with Live Autocomplete Search Bar & Dual CTAs
              _EditorialHero(
                imageUrl: heroImage,
                label: heroLabel,
                headline: heroHeadline,
                subtitle: heroSubtitle,
                ctaText: heroCta,
                searchCtrl: _heroSearchCtrl,
                onSearch: (q) => _goToShop(search: q),
                onProductSelected: (pid) => context.push('/product/$pid'),
                onCta: () => _navigateStorefrontLink(
                  _settings['hero_cta_link']?.toString(),
                ),
              ),

              // 3. Dynamic Trust Strip (reads settings.trust_items)
              _TrustStrip(trustItems: _settings['trust_items']),

              const SizedBox(height: 22),

              // 4. Flash Sale / Today's Deals Shelf with live Countdown Timer
              if (flashEnabled && _flashDeals.isNotEmpty) ...[
                _FlashSaleSection(
                  badge: flashBadge,
                  title: flashTitle,
                  products: _flashDeals,
                  onSeeAll: () => _goToShop(),
                ),
                const SizedBox(height: 24),
              ],

              // 5. Dual Campaign Split Tiles (matches web CampaignTiles.jsx)
              if (campaignTilesEnabled) ...[
                _CampaignTilesSection(
                  settings: _settings,
                  onNavigateLink: (link, cat) =>
                      _navigateStorefrontLink(link, fallbackCategory: cat),
                ),
                const SizedBox(height: 26),
              ],

              // 6. Browse by Category Image Grid (matches web Home.jsx categories-section)
              _CategoriesGridSection(
                categories: _categoryCards,
                onSelectCategory: (cat) => _goToShop(category: cat),
              ),

              // 7. Recently Viewed Shelf (matches web Home.jsx recently-viewed-section)
              if (wishlist.recentlyViewed.isNotEmpty) ...[
                const SizedBox(height: 26),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'PICKED UP WHERE YOU LEFT OFF',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.6,
                              color: AppColors.accentDark,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Recently viewed',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ],
                      ),
                      TextButton(
                        onPressed: () => wishlist.clearRecentlyViewed(),
                        child: const Text('Clear history'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 265,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    itemCount: wishlist.recentlyViewed.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 10),
                    itemBuilder: (_, i) {
                      final p = wishlist.recentlyViewed[i];
                      return SizedBox(
                        width: 168,
                        child: ProductCard(
                          product: p,
                          heroPrefix: 'recent',
                          onTap: () => context.push('/product/${p.id}'),
                        ),
                      );
                    },
                  ),
                ),
              ],

              const SizedBox(height: 28),

              // 8. Bestsellers / Featured Collection (matches web Home.jsx featured-section)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'BESTSELLERS',
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.8,
                                color: AppColors.accentDark,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Loved by thousands',
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                          ],
                        ),
                        TextButton(
                          onPressed: () => _goToShop(
                            category: _activeCategory == 'All'
                                ? null
                                : _activeCategory,
                          ),
                          child: const Text('View all →'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      "Our most-reordered creams — made for melanin-rich skin and Ghana's climate.",
                      style: TextStyle(color: AppColors.muted, fontSize: 13),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 12),

              // Category filter tabs
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
                      childAspectRatio: 0.58,
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
                      );
                    },
                  ),
                ),

              const SizedBox(height: 28),

              // 9. Mid-Page Interactive Editorial Lookbook Carousel (matches web MidPageBanner.jsx)
              _MidPageLookbookCarousel(
                settings: _settings,
                onNavigateLink: (link, cat) =>
                    _navigateStorefrontLink(link, fallbackCategory: cat),
              ),

              const SizedBox(height: 28),

              // 10. Brand Story Split Section ("OUR STORY · Born in Ghana, made for her.")
              _BrandStorySection(onDiscover: () => _goToShop()),

              const SizedBox(height: 28),

              // 11. Verified Buyer Reviews Carousel
              _TestimonialsSection(reviews: reviewsToShow),

              const SizedBox(height: 28),

              // 12. Lifestyle Photo Gallery Strip (matches web Home.jsx gallery-strip)
              const _GalleryStripSection(),

              const SizedBox(height: 28),

              // 13. FAQ Accordion (matches web HomeFaq)
              _FaqSection(
                faqs: faqs,
                onTrackOrder: () => context.push('/track-order'),
              ),

              // 14. Newsletter Subscription Card (hidden once subscribed or after first order)
              if (!_hideNewsletterBar &&
                  _settings['newsletter_enabled'] != false &&
                  _settings['newsletter_enabled'] != 'false') ...[
                const SizedBox(height: 28),
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
              ],

              // 15. Expandable Regional SEO Editorial Block (matches web HomeSeoBlock.jsx)
              if (seoEnabled) ...[
                const SizedBox(height: 24),
                _HomeSeoBlock(
                  title: seoTitle,
                  text: seoText,
                  onSelectCategory: (cat) => _goToShop(category: cat),
                ),
              ],

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
  final TextEditingController searchCtrl;
  final ValueChanged<String> onSearch;
  final ValueChanged<String>? onProductSelected;
  final VoidCallback onCta;

  const _EditorialHero({
    required this.imageUrl,
    required this.label,
    required this.headline,
    required this.subtitle,
    required this.ctaText,
    required this.searchCtrl,
    required this.onSearch,
    this.onProductSelected,
    required this.onCta,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 360,
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
                  Color(0xE0141010),
                  Color(0xA61C1410),
                  Color(0x66141010),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
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
                const SizedBox(height: 6),
                Text(
                  headline,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'serif',
                    fontSize: 28,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                    height: 1.12,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.88),
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 14),
                // Hero Search Bar with live autocomplete & recent searches (matches web SearchBar variant="hero")
                SearchAutocompleteField(
                  controller: searchCtrl,
                  isHeroVariant: true,
                  hintText: 'Search for body creams, oils, scrubs…',
                  onSubmitted: onSearch,
                  onProductSelected: onProductSelected,
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    FilledButton(
                      onPressed: onCta,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.accent,
                        foregroundColor: AppColors.primary,
                        minimumSize: const Size(0, 40),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 18, vertical: 8),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(4),
                        ),
                        textStyle: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                        ),
                      ),
                      child: Text(ctaText),
                    ),
                    const SizedBox(width: 10),
                    OutlinedButton(
                      onPressed: onCta,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: BorderSide(
                            color: Colors.white.withValues(alpha: 0.65)),
                        minimumSize: const Size(0, 40),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(4),
                        ),
                        textStyle: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      child: const Text('Explore All'),
                    ),
                  ],
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
  final dynamic trustItems;
  const _TrustStrip({this.trustItems});

  static const List<Map<String, String>> _defaults = [
    {'icon': '🚚', 'label': 'Free delivery', 'sub': 'Over GHS 200'},
    {'icon': '✦', 'label': 'Handcrafted', 'sub': 'In small batches'},
    {'icon': '↩', 'label': '7-day returns', 'sub': 'No questions asked'},
    {'icon': '🔒', 'label': 'Secure checkout', 'sub': 'Paystack'},
  ];

  @override
  Widget build(BuildContext context) {
    final items = <Map<String, String>>[];
    if (trustItems is List) {
      for (final raw in (trustItems as List)) {
        if (raw is Map && raw['label'] != null) {
          items.add({
            'icon': (raw['icon'] ?? '✦').toString(),
            'label': raw['label'].toString(),
            'sub': (raw['sub'] ?? '').toString(),
          });
        }
      }
    }
    final list = items.isNotEmpty ? items : _defaults;

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.border, width: 1)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      child: Wrap(
        alignment: WrapAlignment.spaceAround,
        spacing: 12,
        runSpacing: 8,
        children: list
            .map(
              (t) => _TrustItem(
                iconText: t['icon'] ?? '✦',
                label: t['label'] ?? '',
                sub: t['sub'] ?? '',
              ),
            )
            .toList(),
      ),
    );
  }
}

class _TrustItem extends StatelessWidget {
  final String iconText;
  final String label;
  final String sub;

  const _TrustItem({
    required this.iconText,
    required this.label,
    required this.sub,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          iconText,
          style: const TextStyle(fontSize: 15, color: AppColors.accentDark),
        ),
        const SizedBox(width: 6),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
            if (sub.isNotEmpty)
              Text(
                sub,
                style: const TextStyle(
                  fontSize: 10,
                  color: AppColors.muted,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _FlashSaleSection extends StatefulWidget {
  final String badge;
  final String title;
  final List<Product> products;
  final VoidCallback onSeeAll;

  const _FlashSaleSection({
    required this.badge,
    required this.title,
    required this.products,
    required this.onSeeAll,
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
            height: 265,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: widget.products.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (_, i) {
                final p = widget.products[i];
                return SizedBox(
                  width: 168,
                  child: ProductCard(
                    product: p,
                    heroPrefix: 'flash',
                    onTap: () => context.push('/product/${p.id}'),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              onPressed: widget.onSeeAll,
              child: const Text('See All Deals →'),
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

class _CampaignTilesSection extends StatelessWidget {
  final Map<String, dynamic> settings;
  final void Function(String? link, String? fallbackCategory) onNavigateLink;

  const _CampaignTilesSection({
    required this.settings,
    required this.onNavigateLink,
  });

  String _s(String key, String fallback) {
    final v = settings[key];
    return (v is String && v.trim().isNotEmpty) ? v.trim() : fallback;
  }

  @override
  Widget build(BuildContext context) {
    final tiles = [
      {
        'badge': _s('tile1_badge', 'LIMITED BATCH'),
        'title': _s('tile1_title', 'Whipped Shea Butters'),
        'sub': _s('tile1_subtitle',
            'Deep 48-hour moisture crafted with raw Northern Ghana shea.'),
        'cta': _s('tile1_cta_text', 'Shop Butters'),
        'link': _s('tile1_link', '/shop?category=Body+Butter'),
        'cat': 'Body Butter',
        'img': _s('tile1_image',
            'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=700&q=80'),
      },
      {
        'badge': _s('tile2_badge', 'HOT SELLER'),
        'title': _s('tile2_title', 'Botanical Radiance Oils'),
        'sub': _s('tile2_subtitle',
            'Fast-absorbing golden glow with hibiscus and baobab oils.'),
        'cta': _s('tile2_cta_text', 'Explore Oils'),
        'link': _s('tile2_link', '/shop?category=Body+Oil'),
        'cat': 'Body Oil',
        'img': _s('tile2_image',
            'https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&w=700&q=80'),
      },
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Column(
        children: tiles
            .map(
              (t) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: InkWell(
                  onTap: () => onNavigateLink(t['link'], t['cat']),
                  borderRadius: BorderRadius.circular(10),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: SizedBox(
                      height: 165,
                      width: double.infinity,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          CachedNetworkImage(
                            imageUrl: t['img']!,
                            fit: BoxFit.cover,
                          ),
                          const DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.centerLeft,
                                end: Alignment.centerRight,
                                colors: [
                                  Color(0xE6141010),
                                  Color(0x801C1410),
                                ],
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.all(18),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppColors.accent,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    t['badge']!,
                                    style: const TextStyle(
                                      color: AppColors.primary,
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 1.0,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  t['title']!,
                                  style: const TextStyle(
                                    fontFamily: 'serif',
                                    color: Colors.white,
                                    fontSize: 21,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  t['sub']!,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.85),
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  '${t['cta']} →',
                                  style: const TextStyle(
                                    color: AppColors.accent,
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.4,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

class _CategoriesGridSection extends StatelessWidget {
  final List<Map<String, String>> categories;
  final ValueChanged<String> onSelectCategory;

  const _CategoriesGridSection({
    required this.categories,
    required this.onSelectCategory,
  });

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
              'BROWSE BY CATEGORY',
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
              'Shop the range',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          const SizedBox(height: 12),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              childAspectRatio: 1.45,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
            ),
            itemCount: categories.length,
            itemBuilder: (_, i) {
              final cat = categories[i];
              final label = cat['label'] ?? '';
              final img = cat['image'] ?? '';
              return InkWell(
                onTap: () => onSelectCategory(label),
                borderRadius: BorderRadius.circular(8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (img.isNotEmpty)
                        CachedNetworkImage(imageUrl: img, fit: BoxFit.cover)
                      else
                        const ColoredBox(color: AppColors.primary),
                      const DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Color(0x33141010),
                              Color(0xCC141010),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        left: 12,
                        right: 12,
                        bottom: 10,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                label,
                                style: const TextStyle(
                                  fontFamily: 'serif',
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const Icon(Icons.arrow_forward,
                                size: 15, color: AppColors.accent),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _MidPageLookbookCarousel extends StatefulWidget {
  final Map<String, dynamic> settings;
  final void Function(String? link, String? fallbackCategory) onNavigateLink;
  const _MidPageLookbookCarousel({
    required this.settings,
    required this.onNavigateLink,
  });

  @override
  State<_MidPageLookbookCarousel> createState() =>
      _MidPageLookbookCarouselState();
}

class _MidPageLookbookCarouselState extends State<_MidPageLookbookCarousel> {
  final PageController _ctrl = PageController();
  int _idx = 0;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  List<Map<String, String>> get _slides {
    final raw = widget.settings['mid_banner_slides'];
    if (raw is List && raw.isNotEmpty) {
      final parsed = <Map<String, String>>[];
      for (final item in raw) {
        if (item is Map) {
          final rawImg = (item['image'] ?? '').toString();
          parsed.add({
            'badge': (item['badge'] ?? '').toString(),
            'title': (item['title'] ?? '').toString(),
            'highlight': (item['highlight'] ?? '').toString(),
            'subtitle': (item['subtitle'] ?? '').toString(),
            'cta_text': (item['cta_text'] ?? 'Shop Now').toString(),
            'cta_link': (item['cta_link'] ?? '/shop').toString(),
            'category': '',
            'image': rawImg.startsWith('http')
                ? rawImg
                : AppConfig.resolveImageUrl(rawImg),
          });
        }
      }
      if (parsed.isNotEmpty) return parsed;
    }
    return _defaultLookbookSlides;
  }

  @override
  Widget build(BuildContext context) {
    final slides = _slides;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              height: 255,
              child: PageView.builder(
                controller: _ctrl,
                itemCount: slides.length,
                onPageChanged: (i) => setState(() => _idx = i),
                itemBuilder: (_, i) {
                  final s = slides[i];
                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      CachedNetworkImage(
                        imageUrl: s['image']!,
                        fit: BoxFit.cover,
                      ),
                      const DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.centerLeft,
                            end: Alignment.centerRight,
                            colors: [
                              Color(0xEB141010),
                              Color(0x991C1410),
                            ],
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              s['badge']!,
                              style: const TextStyle(
                                color: AppColors.accent,
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.8,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              s['title']!,
                              style: const TextStyle(
                                fontFamily: 'serif',
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.w600,
                                height: 1.15,
                              ),
                            ),
                            Text(
                              s['highlight']!,
                              style: const TextStyle(
                                fontFamily: 'serif',
                                color: AppColors.accent,
                                fontSize: 19,
                                fontStyle: FontStyle.italic,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              s['subtitle']!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.85),
                                fontSize: 12.5,
                                height: 1.4,
                              ),
                            ),
                            const SizedBox(height: 14),
                            OutlinedButton(
                              onPressed: () => widget.onNavigateLink(
                                s['cta_link'],
                                s['category'],
                              ),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppColors.accent,
                                side: const BorderSide(color: AppColors.accent),
                                minimumSize: const Size(0, 36),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 14, vertical: 6),
                              ),
                              child: Text('${s['cta_text']} →'),
                            ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              slides.length,
              (i) => Container(
                width: i == _idx ? 20 : 7,
                height: 7,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                decoration: BoxDecoration(
                  color: i == _idx ? AppColors.primary : AppColors.border,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BrandStorySection extends StatelessWidget {
  final VoidCallback onDiscover;
  const _BrandStorySection({required this.onDiscover});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 190,
            width: double.infinity,
            child: CachedNetworkImage(
              imageUrl:
                  'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=700&q=80',
              fit: BoxFit.cover,
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'OUR STORY',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.8,
                    color: AppColors.accentDark,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Born in Ghana, made for her.',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 10),
                const Text(
                  'Every product begins with a simple belief: Ghanaian women deserve skincare that was made for them — not adapted from formulas designed for other climates and skin tones.',
                  style: TextStyle(
                    fontSize: 13.5,
                    color: AppColors.text,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'We source raw shea butter directly from women cooperatives in the Northern Region, blend it with locally grown botanical oils, and bottle it with love right here in Accra.',
                  style: TextStyle(
                    fontSize: 13.5,
                    color: AppColors.muted,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: onDiscover,
                  child: const Text('Discover the Range'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GalleryStripSection extends StatelessWidget {
  const _GalleryStripSection();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 120,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        itemCount: _galleryImages.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) => ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 120,
            height: 120,
            child: CachedNetworkImage(
              imageUrl: _galleryImages[i],
              fit: BoxFit.cover,
            ),
          ),
        ),
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
                'VERIFIED BUYER REVIEWS',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.8,
                  color: AppColors.accentDark,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'What our buyers say',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 185,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            itemCount: reviews.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (_, i) {
              final r = reviews[i];
              final rating =
                  int.tryParse((r['rating'] ?? 5).toString())?.clamp(1, 5) ?? 5;
              final comment = (r['comment'] ??
                      r['body'] ??
                      r['text'] ??
                      'Exceptional handcrafted skincare!')
                  .toString()
                  .trim();
              final author = (r['customer_name'] ??
                      r['author'] ??
                      (r['first_name'] != null
                          ? '${r['first_name']} ${r['last_initial'] ?? ''}.'
                          : 'Verified Buyer'))
                  .toString();
              final location = (r['location'] ?? 'Accra, Ghana').toString();

              return Container(
                width: 275,
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
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: List.generate(
                            5,
                            (idx) => Icon(
                              idx < rating
                                  ? Icons.star_rounded
                                  : Icons.star_border_rounded,
                              size: 15,
                              color: AppColors.accent,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.accentLight,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: const Text(
                            '✓ VERIFIED BUYER',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              color: AppColors.accentDark,
                              letterSpacing: 0.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
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
                    Text(
                      author,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                    Text(
                      location,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
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
  final VoidCallback onTrackOrder;
  const _FaqSection({required this.faqs, required this.onTrackOrder});

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
          const SizedBox(height: 10),
          Center(
            child: Wrap(
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 4,
              children: [
                const Text(
                  'Already placed an order?',
                  style: TextStyle(fontSize: 13, color: AppColors.muted),
                ),
                InkWell(
                  onTap: onTrackOrder,
                  child: const Text(
                    'Track your order →',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.accentDark,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HomeSeoBlock extends StatefulWidget {
  final String title;
  final String text;
  final ValueChanged<String> onSelectCategory;

  const _HomeSeoBlock({
    required this.title,
    required this.text,
    required this.onSelectCategory,
  });

  @override
  State<_HomeSeoBlock> createState() => _HomeSeoBlockState();
}

class _HomeSeoBlockState extends State<_HomeSeoBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontFamily: 'serif',
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            widget.text,
            maxLines: _expanded ? null : 3,
            overflow: _expanded ? TextOverflow.visible : TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12.5,
              color: AppColors.muted,
              height: 1.5,
            ),
          ),
          if (_expanded) ...[
            const SizedBox(height: 14),
            const Divider(),
            const SizedBox(height: 10),
            const Text(
              'NATIONWIDE DELIVERY ACROSS GHANA',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
                color: AppColors.accentDark,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Greater Accra (East Legon, Osu, Cantonments, Tema, Spintex, Madina, Dansoman, Achimota) · Ashanti (Kumasi) · Western (Takoradi) · Central (Cape Coast) · Eastern (Koforidua) · Northern (Tamale) · Volta (Ho) · Bono (Sunyani).',
              style: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.45),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                'Body Cream',
                'Body Butter',
                'Body Oil',
                'Body Scrub',
                'Body Mask',
              ]
                  .map(
                    (cat) => ActionChip(
                      label: Text(
                        cat,
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                      backgroundColor: AppColors.blush,
                      side: const BorderSide(color: AppColors.border),
                      onPressed: () => widget.onSelectCategory(cat),
                    ),
                  )
                  .toList(),
            ),
          ],
          const SizedBox(height: 8),
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                _expanded ? 'Show Less ↑' : 'Read More ↓',
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.accentDark,
                ),
              ),
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
                  Text(
                    couponResult == 'SUBSCRIBED'
                        ? "You're subscribed! Check your inbox for updates."
                        : "You're on the list! Your first-order code will apply automatically at checkout:",
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                  ),
                  if (couponResult != 'SUBSCRIBED') ...[
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
