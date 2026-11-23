/**
 * Comprehensive Ghana Cosmetics Market Seed — 100 Popular Brands
 * Run: node migrations/seed_ghana_100_brands.js
 * Safe to re-run — skips products that already exist by SKU.
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const IMG = {
  cream:   'https://images.unsplash.com/photo-1619451334792-150fd785ee74?auto=format&fit=crop&w=600&q=80',
  serum:   'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=600&q=80',
  oil:     'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?auto=format&fit=crop&w=600&q=80',
  makeup:  'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80',
  wash:    'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80',
  hair:    'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=600&q=80',
  scrub:   'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=600&q=80',
  fragr:   'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80',
};

const products = [
  // ══════════════════════════════════════════════════════════════════════════
  // 1. SKINCARE BRANDS (1–20)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sku: 'GH-CRV-001', brand: 'CeraVe', category: 'Skincare',
    name: 'Moisturising Cream 340g',
    description: 'Rich, non-greasy barrier-repair cream with 3 essential ceramides and hyaluronic acid for dry to very dry skin.',
    price: 265.00, cost: 170.00, stock_quantity: 32, image_url: IMG.cream,
    ingredients: 'Ceramides 1, 3, 6-II, Hyaluronic Acid, Petrolatum, Glycerin',
    usage_instructions: 'Apply liberally to face and body as often as needed.',
  },
  {
    sku: 'GH-CET-001', brand: 'Cetaphil', category: 'Skincare',
    name: 'Gentle Skin Cleanser 473ml',
    description: 'Soap-free, fragrance-free dermatologist-recommended facial cleanser that hydrates while lifting dirt and makeup.',
    price: 210.00, cost: 135.00, stock_quantity: 35, image_url: IMG.wash,
    ingredients: 'Niacinamide, Panthenol (Pro-Vitamin B5), Hydrating Glycerin',
    usage_instructions: 'Massage gently onto damp skin and rinse, or wipe off with a soft cloth.',
  },
  {
    sku: 'GH-CET-002', brand: 'Cetaphil', category: 'Skincare',
    name: 'Daily Facial Cleanser 236ml',
    description: 'Deep-cleansing low-lather gel wash formulated for combination-to-oily sensitive skin to remove excess oil without stripping.',
    price: 185.00, cost: 118.00, stock_quantity: 28, image_url: IMG.wash,
    ingredients: 'Niacinamide, Panthenol, Glycerin',
    usage_instructions: 'Lather onto wet face morning and night, then rinse thoroughly.',
  },
  {
    sku: 'GH-ORD-001', brand: 'The Ordinary', category: 'Skincare',
    name: 'Hyaluronic Acid 2% + B5 Hydrating Serum 30ml',
    description: 'Multi-molecular hyaluronic acid serum that draws deep moisture into the skin for a plump, smooth, hydrated complexion.',
    price: 155.00, cost: 95.00, stock_quantity: 40, image_url: IMG.serum,
    ingredients: 'Hyaluronic Acid (2%), Vitamin B5 (Panthenol), Ceramides',
    usage_instructions: 'Apply a few drops to damp skin morning and evening before creams.',
  },
  {
    sku: 'GH-NTG-001', brand: 'Neutrogena', category: 'Skincare',
    name: 'Oil-Free Acne Wash Salicylic Acid Cleanser 269ml',
    description: 'Dermatologist-recommended 2% salicylic acid facial wash that clears breakouts and prevents new blemishes without over-drying.',
    price: 175.00, cost: 112.00, stock_quantity: 30, image_url: IMG.wash,
    ingredients: 'Salicylic Acid (2%), Chamomile Extract, Aloe Vera',
    usage_instructions: 'Wet face, massage gently avoiding eye area, and rinse thoroughly twice daily.',
  },
  {
    sku: 'GH-NIV-001', brand: 'Nivea', category: 'Skincare',
    name: 'Nivea Soft Refreshing Moisturising Cream 200ml',
    description: 'Light, fast-absorbing everyday moisturising cream enriched with Jojoba Oil and Vitamin E for face, hands, and body.',
    price: 85.00, cost: 50.00, stock_quantity: 55, image_url: IMG.cream,
    ingredients: 'Jojoba Oil, Vitamin E, Glycerin',
    usage_instructions: 'Apply daily to face, hands, or body for fresh, supple skin.',
  },
  {
    sku: 'GH-OLY-001', brand: 'Olay', category: 'Skincare',
    name: 'Regenerist Micro-Sculpting Cream 50ml',
    description: 'Anti-aging powerhouse moisturiser with Amino-Peptide Complex II, Niacinamide, and Hyaluronic Acid to visibly firm skin.',
    price: 340.00, cost: 225.00, stock_quantity: 18, image_url: IMG.cream,
    ingredients: 'Niacinamide (Vitamin B3), Amino-Peptides, Hyaluronic Acid, Vitamin E',
    usage_instructions: 'Smooth evenly over cleansed face and neck morning and night.',
  },
  {
    sku: 'GH-AVE-001', brand: 'Aveeno', category: 'Skincare',
    name: 'Daily Moisturising Body Lotion 354ml',
    description: 'Fragrance-free colloidal oatmeal lotion clinically proven to soothe dry, sensitive skin and lock in moisture for 24 hours.',
    price: 185.00, cost: 118.00, stock_quantity: 34, image_url: IMG.cream,
    ingredients: 'Prebiotic Colloidal Oatmeal, Glycerin, Dimethicone',
    usage_instructions: 'Apply daily after showering to lock in hydration.',
  },
  {
    sku: 'GH-LRP-001', brand: 'La Roche-Posay', category: 'Skincare',
    name: 'Cicaplast Baume B5+ Soothing Repair Balm 40ml',
    description: 'Multi-purpose soothing balm with Madecassoside and 5% Panthenol to calm irritation, dry patches, and compromised skin barriers.',
    price: 235.00, cost: 152.00, stock_quantity: 25, image_url: IMG.cream,
    ingredients: 'Panthenol (5%), Madecassoside, Shea Butter, Tribioma',
    usage_instructions: 'Apply twice daily to clean, dry skin on face, lips, or body.',
  },
  {
    sku: 'GH-EUC-001', brand: 'Eucerin', category: 'Skincare',
    name: 'UreaRepair PLUS 5% Urea Body Lotion 400ml',
    description: 'Dermatological intensive lotion with 5% Urea and Ceramides for immediate 48-hour relief from rough, tight, very dry skin.',
    price: 290.00, cost: 190.00, stock_quantity: 22, image_url: IMG.cream,
    ingredients: 'Urea (5%), Ceramides, Natural Moisturizing Factors (NMF)',
    usage_instructions: 'Massage gently into skin daily until fully absorbed.',
  },
  {
    sku: 'GH-BIO-001', brand: 'Bioderma', category: 'Skincare',
    name: 'Sensibio H2O Micellar Water 500ml',
    description: 'Iconic French dermatological micellar water that removes waterproof makeup and pollution while respecting sensitive skin.',
    price: 240.00, cost: 155.00, stock_quantity: 27, image_url: IMG.wash,
    ingredients: 'Micellar Esters, Cucumber Fruit Extract, Purified Water',
    usage_instructions: 'Soak a cotton pad and gently cleanse face and eyes morning and evening.',
  },
  {
    sku: 'GH-BOJ-001', brand: 'Beauty of Joseon', category: 'Skincare',
    name: 'Relief Sun: Rice + Probiotics SPF 50+ PA++++ 50ml',
    description: 'Viral Korean organic sunscreen with 30% rice extract that melts seamlessly into melanin-rich skin with zero white cast.',
    price: 235.00, cost: 150.00, stock_quantity: 38, image_url: IMG.serum,
    ingredients: 'Rice Extract (30%), Grain Fermented Extracts, Niacinamide, Vitamin E',
    usage_instructions: 'Apply two finger-lengths evenly over face and neck as the last step of morning skincare.',
  },
  {
    sku: 'GH-ANU-001', brand: 'ANUA', category: 'Skincare',
    name: 'Heartleaf 77% Soothing Toner 250ml',
    description: 'Calming K-beauty cult toner infused with 77% Houttuynia Cordata extract to soothe redness, balance oil, and calm acne-prone skin.',
    price: 255.00, cost: 165.00, stock_quantity: 30, image_url: IMG.wash,
    ingredients: 'Houttuynia Cordata Extract (77%), Panthenol, Centella Asiatica',
    usage_instructions: 'Pat gently onto cleansed face with hands or a cotton pad morning and night.',
  },
  {
    sku: 'GH-SBM-001', brand: 'Some By Mi', category: 'Skincare',
    name: 'AHA BHA PHA 30 Days Miracle Toner 150ml',
    description: 'Gentle daily exfoliating toner with tea tree and three gentle acids to clear dead skin cells, blackheads, and uneven texture.',
    price: 215.00, cost: 138.00, stock_quantity: 26, image_url: IMG.serum,
    ingredients: 'Tea Tree Water (10,000ppm), Niacinamide (2%), AHA, BHA, PHA',
    usage_instructions: 'Apply with a cotton pad after cleansing; follow with moisturiser and morning SPF.',
  },
  {
    sku: 'GH-STV-001', brand: 'St. Ives', category: 'Skincare',
    name: 'Fresh Skin Apricot Face Scrub 170g',
    description: '100% natural walnut shell powder and apricot extract deep-exfoliating scrub for instantly smooth, glowing skin.',
    price: 95.00, cost: 58.00, stock_quantity: 45, image_url: IMG.scrub,
    ingredients: 'Walnut Shell Powder, Apricot Fruit Extract, Corn Kernel Meal',
    usage_instructions: 'Massage gently onto damp skin in circular motions 2–3 times weekly, then rinse.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2. MAKEUP & BEAUTY BRANDS (21–40)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sku: 'GH-MAC-001', brand: 'MAC Cosmetics', category: 'Makeup',
    name: 'Studio Fix Fluid SPF 15 Foundation 30ml',
    description: 'Iconic 24-hour matte liquid foundation offering buildable medium-to-full coverage and shine control for all undertones.',
    price: 540.00, cost: 375.00, stock_quantity: 16, image_url: IMG.makeup,
    ingredients: 'Oil-Controlling Silica, Vitamin E, SPF 15 Mineral Filters',
    usage_instructions: 'Blend onto moisturised, primed skin using a foundation brush or sponge.',
  },
  {
    sku: 'GH-LOR-001', brand: "L'Oréal Paris", category: 'Makeup',
    name: 'Infallible 32H Fresh Wear Foundation 30ml',
    description: 'Breathable, waterproof, transfer-resistant foundation with Vitamin C for luminous, fresh full coverage all day.',
    price: 245.00, cost: 158.00, stock_quantity: 24, image_url: IMG.makeup,
    ingredients: 'Vitamin C, Micro-Pearls, Oxygen Technology',
    usage_instructions: 'Apply starting from the centre of the face and blend outward.',
  },
  {
    sku: 'GH-ELF-001', brand: 'e.l.f. Cosmetics', category: 'Makeup',
    name: 'Power Grip Primer 24ml',
    description: 'Viral hydrating gel face primer enriched with Hyaluronic Acid that grips makeup for long-lasting, smooth wear.',
    price: 165.00, cost: 102.00, stock_quantity: 42, image_url: IMG.serum,
    ingredients: 'Hyaluronic Acid, Glycerin, Vegan Gel Base',
    usage_instructions: 'Pat evenly onto clean skin and wait 30 seconds before applying foundation.',
  },
  {
    sku: 'GH-JUV-001', brand: "Juvia's Place", category: 'Makeup',
    name: 'The Nubian Eyeshadow Palette (12 Shades)',
    description: 'Ultra-pigmented warm neutral mattes and rich metallic shimmers crafted to pop brilliantly on deep and rich complexions.',
    price: 310.00, cost: 205.00, stock_quantity: 20, image_url: IMG.makeup,
    ingredients: 'Rich Mineral Pigments, Silk-Touch Mica',
    usage_instructions: 'Sweep matte shades into crease and pack shimmers onto lids with a flat brush.',
  },
  {
    sku: 'GH-REV-001', brand: 'Revlon', category: 'Makeup',
    name: 'ColorStay Longwear Makeup Foundation 30ml',
    description: '24-hour matte-wear foundation for combination/oily skin with Vitamin E to resist heat, sweat, and humidity.',
    price: 220.00, cost: 140.00, stock_quantity: 22, image_url: IMG.makeup,
    ingredients: 'Vitamin E, Oil-Absorbing Complex, Broad Spectrum SPF 15',
    usage_instructions: 'Shake well and blend smoothly across face in sections.',
  },
  {
    sku: 'GH-RIM-001', brand: 'Rimmel London', category: 'Makeup',
    name: 'Stay Matte Pressed Powder 14g',
    description: 'Natural mineral shine-control pressed powder that minimizes pores and keeps skin matte for up to 5 hours.',
    price: 115.00, cost: 70.00, stock_quantity: 38, image_url: IMG.scrub,
    ingredients: 'Natural Minerals, Oil-Absorbing Mica',
    usage_instructions: 'Dust across T-zone or entire face with a fluffy powder brush.',
  },
  {
    sku: 'GH-BOP-001', brand: 'Black Opal', category: 'Makeup',
    name: 'True Color Skin Perfecting Stick Foundation SPF 15',
    description: 'Classic melanin-rich stick foundation offering velvety, crease-free full coverage with built-in sun protection.',
    price: 195.00, cost: 125.00, stock_quantity: 30, image_url: IMG.makeup,
    ingredients: 'Shade ID Color-Adjusting Pigments, Vitamin E, Sunflower Seed Oil',
    usage_instructions: 'Swipe onto forehead, cheeks, and chin, then buff seamlessly with a brush or sponge.',
  },
  {
    sku: 'GH-SAC-001', brand: 'Sacha Cosmetics', category: 'Makeup',
    name: 'Buttercup Loose Setting Powder 28g',
    description: 'Flashback-free golden setting powder famous across Ghana for brightening under-eyes and locking makeup in place all day.',
    price: 260.00, cost: 170.00, stock_quantity: 26, image_url: IMG.scrub,
    ingredients: 'Finely Milled Silica, Warm Golden Mineral Pigments',
    usage_instructions: 'Press under eyes and T-zone with a damp sponge, let bake 3 minutes, then dust off.',
  },
  {
    sku: 'GH-HUD-001', brand: 'Huda Beauty', category: 'Makeup',
    name: 'Easy Bake Loose Baking & Setting Powder 20g',
    description: 'Silky, airbrushed setting powder with Vitamin E that blurs pores, controls shine, and sets makeup for up to 10 hours.',
    price: 580.00, cost: 405.00, stock_quantity: 14, image_url: IMG.makeup,
    ingredients: 'Vitamin E, Rice Starch Powder, Micronized Pigments',
    usage_instructions: 'Apply generously under eyes and T-zone, wait 3–5 minutes, and sweep away excess.',
  },
  {
    sku: 'GH-NAR-001', brand: 'NARS', category: 'Makeup',
    name: 'Radiant Creamy Concealer 6ml',
    description: 'Award-winning luminous medium-to-full coverage concealer that brightens dark circles and blurs imperfections for 16 hours.',
    price: 495.00, cost: 340.00, stock_quantity: 15, image_url: IMG.makeup,
    ingredients: 'Multi-Active Botanical Blend, Light-Diffusing Mineral Powder, Vitamin E',
    usage_instructions: 'Dot under eyes or blemishes and tap gently with fingertips or sponge.',
  },
  {
    sku: 'GH-BOB-001', brand: 'Bobbi Brown', category: 'Makeup',
    name: 'Vitamin Enriched Face Base Primer & Moisturiser 50ml',
    description: 'Cult-favourite cushiony primer + moisturiser with Shea Butter and Vitamins B, C, and E for smooth makeup prep.',
    price: 780.00, cost: 540.00, stock_quantity: 10, image_url: IMG.cream,
    ingredients: 'Shea Butter, Vitamins B, C & E, Hyaluronic Acid, Grapefruit & Geranium Oils',
    usage_instructions: 'Massage onto clean skin before foundation, avoiding eye area.',
  },
  {
    sku: 'GH-KIK-001', brand: 'KIKO Milano', category: 'Makeup',
    name: '3D Hydra Lipgloss 6.5ml',
    description: 'Softening high-shine lip gloss with Bidens extract that leaves lips visibly fuller, smooth, and luminous without stickiness.',
    price: 185.00, cost: 118.00, stock_quantity: 28, image_url: IMG.makeup,
    ingredients: 'Bidens Pilosa Extract, Conditioning Emollients, Shimmer Pearls',
    usage_instructions: 'Glide applicator from centre of lips outward.',
  },
  {
    sku: 'GH-ESS-001', brand: 'Essence', category: 'Makeup',
    name: 'Lash Princess False Lash Effect Mascara 12ml',
    description: 'Viral budget-friendly mascara with conic-shaped fiber brush for dramatic false-lash volume and length.',
    price: 95.00, cost: 56.00, stock_quantity: 50, image_url: IMG.makeup,
    ingredients: 'Carnauba Wax, Jojoba Esters, Intense Black Pigments',
    usage_instructions: 'Wiggle wand at base of lashes and sweep upward in 1–2 coats.',
  },
  {
    sku: 'GH-CAT-001', brand: 'Catrice', category: 'Makeup',
    name: 'HD Liquid Coverage Foundation 30ml',
    description: 'Ultra-lightweight dropper foundation delivering second-skin, high-definition matte coverage for up to 24 hours.',
    price: 170.00, cost: 106.00, stock_quantity: 27, image_url: IMG.makeup,
    ingredients: 'Niacinamide, Waterproof Mattifying Complex',
    usage_instructions: 'Shake well, dispense 3–4 drops, and blend quickly across face.',
  },
  {
    sku: 'GH-MKR-001', brand: 'Makeup Revolution', category: 'Makeup',
    name: 'Reloaded Velvet Rose Eyeshadow Palette (15 Shades)',
    description: 'Richly pigmented mix of warm beiges, browns, burgundy mattes, and gleaming golds for day-to-night glam.',
    price: 145.00, cost: 88.00, stock_quantity: 32, image_url: IMG.makeup,
    ingredients: 'Pressed Mineral Pigments, Cruelty-Free Vegan Formula',
    usage_instructions: 'Blend transition shades in the crease and layer metallic shades on the lid.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 3. HAIRCARE BRANDS (41–60)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sku: 'GH-AJK-001', brand: "Aunt Jackie's", category: 'Haircare',
    name: 'Curl La La Defining Curl Custard 426g',
    description: 'Shea butter and olive oil curl custard that defines bouncy coils, twist-outs, and braid-outs without crunch or flaking.',
    price: 135.00, cost: 82.00, stock_quantity: 34, image_url: IMG.hair,
    ingredients: 'Shea Butter, Extra Virgin Olive Oil, Conditioning Polymers',
    usage_instructions: 'Smooth onto damp sectioned hair and twist, braid, or finger-coil.',
  },
  {
    sku: 'GH-DNL-001', brand: 'Dark and Lovely', category: 'Haircare',
    name: 'Healthy-Gloss 5 Shea Moisture No-Lye Relaxer Kit',
    description: 'Trusted African haircare relaxer infused with Shea Butter and conditioning oils for silky, healthy-looking straight hair.',
    price: 145.00, cost: 88.00, stock_quantity: 36, image_url: IMG.hair,
    ingredients: 'Shea Butter, Argan Oil, Avocado Oil, Silk Amino Acids',
    usage_instructions: 'Follow enclosed strand test and timing instructions carefully.',
  },
  {
    sku: 'GH-DOV-001', brand: 'Dove', category: 'Haircare',
    name: 'Intensive Repair Shampoo 400ml',
    description: 'Nutri-Keratin Repair Actives shampoo that visibly repairs surface damage and strengthens brittle strands from within.',
    price: 110.00, cost: 66.00, stock_quantity: 40, image_url: IMG.wash,
    ingredients: 'Nutri-Keratin Repair Actives, Glycerin, Gentle Cleansers',
    usage_instructions: 'Apply to wet hair, lather gently into scalp, and rinse thoroughly.',
  },
  {
    sku: 'GH-PNT-001', brand: 'Pantene', category: 'Haircare',
    name: 'Pro-V Smooth & Sleek Shampoo 400ml',
    description: 'Pro-Vitamin B5 nourishing shampoo with Argan Oil that tames frizz and leaves hair silky, shiny, and manageable.',
    price: 105.00, cost: 62.00, stock_quantity: 42, image_url: IMG.wash,
    ingredients: 'Pro-Vitamin B5, Argan Oil, Antioxidants, Conditioning Lipids',
    usage_instructions: 'Massage into wet hair to create a rich lather, then rinse.',
  },
  {
    sku: 'GH-HNS-001', brand: 'Head & Shoulders', category: 'Haircare',
    name: 'Classic Clean Anti-Dandruff Shampoo 400ml',
    description: 'Clinically proven anti-dandruff shampoo that relieves itchy, flaky scalp while leaving hair fresh and clean.',
    price: 115.00, cost: 68.00, stock_quantity: 44, image_url: IMG.wash,
    ingredients: 'Piroctone Olamine, Moisturising Cleansers',
    usage_instructions: 'Massage into wet scalp and hair, rinse well, and repeat if desired.',
  },
  {
    sku: 'GH-TRE-001', brand: 'TRESemmé', category: 'Haircare',
    name: 'Keratin Smooth Shampoo 400ml',
    description: 'Salon-grade keratin and Marula Oil shampoo offering 5 smoothing benefits for up to 72 hours of frizz control.',
    price: 130.00, cost: 78.00, stock_quantity: 35, image_url: IMG.wash,
    ingredients: 'Hydrolyzed Keratin, Marula Oil, Gentle Sulphate-Balanced Cleansers',
    usage_instructions: 'Apply generously to wet hair, massage scalp, and rinse thoroughly.',
  },
  {
    sku: 'GH-AUS-001', brand: 'Aussie', category: 'Haircare',
    name: '3 Minute Miracle Moist Deep Conditioner 236ml',
    description: 'Fast-acting deep conditioning treatment with Australian Aloe and Jojoba Oil that revives parched curls in 3 minutes.',
    price: 125.00, cost: 76.00, stock_quantity: 30, image_url: IMG.hair,
    ingredients: 'Avocado Oil, Australian Jojoba Seed Oil, Aloe Barbadensis',
    usage_instructions: 'Work through clean wet hair, leave for 3 minutes, then rinse.',
  },
  {
    sku: 'GH-CON-001', brand: 'Creme of Nature', category: 'Haircare',
    name: 'Argan Oil Moisture & Shine Shampoo 354ml',
    description: 'Sulphate-free hydrating shampoo infused with Moroccan Argan Oil that gently cleanses, detangles, and adds exotic shine.',
    price: 120.00, cost: 72.00, stock_quantity: 38, image_url: IMG.hair,
    ingredients: 'Certified Organic Moroccan Argan Oil, Honey, Shea Butter',
    usage_instructions: 'Apply to wet hair, lather gently, detangle with fingers, and rinse.',
  },
  {
    sku: 'GH-AVL-001', brand: 'Avlon', category: 'Haircare',
    name: 'KeraCare Hydrating Detangling Shampoo 240ml',
    description: 'Salon-favourite pH-balanced moisturising shampoo that detangles tightly coiled or relaxed hair while repairing dry cuticles.',
    price: 195.00, cost: 125.00, stock_quantity: 20, image_url: IMG.wash,
    ingredients: 'Natural Botanical Extracts, Conditioning Humectants',
    usage_instructions: 'Rub ample amount between palms, distribute through wet hair, lather, and rinse.',
  },
  {
    sku: 'GH-MOT-001', brand: 'Motions', category: 'Haircare',
    name: 'Classic Formula Conditioning Hair Lotion 354ml',
    description: 'Lightweight daily hair moisturiser enriched with Shea Butter and Coconut Oil to restore softness and protect against heat.',
    price: 110.00, cost: 65.00, stock_quantity: 32, image_url: IMG.hair,
    ingredients: 'Shea Butter, Coconut Oil, Argan Oil, Silk Protein',
    usage_instructions: 'Pour a small amount into palms, rub together, and smooth through hair daily.',
  },
  {
    sku: 'GH-AFP-001', brand: 'African Pride', category: 'Haircare',
    name: 'Moisture Miracle Aloe & Coconut Water Detangle Leave-In 237ml',
    description: 'Ultra-slip detangling leave-in conditioner that melts knots, hydrates coils, and leaves protective styles soft and glossy.',
    price: 115.00, cost: 68.00, stock_quantity: 36, image_url: IMG.hair,
    ingredients: 'Aloe Vera, Coconut Water, Conditioning Botanical Oils',
    usage_instructions: 'Spray onto damp or dry hair and finger-detangle from ends to roots.',
  },
  {
    sku: 'GH-OOV-001', brand: 'ORS Olive Oil', category: 'Haircare',
    name: 'Replenishing Pak & Hair Mayonnaise Treatment 454g',
    description: 'Intensive protein and botanical oil treatment with Olive Oil, Egg Protein, and Nettle to strengthen weak, damaged hair.',
    price: 135.00, cost: 82.00, stock_quantity: 33, image_url: IMG.hair,
    ingredients: 'Olive Oil, Egg Protein, Wheat Germ Oil, Nettle Extract',
    usage_instructions: 'Comb through clean damp hair, cover with plastic cap for 15 min, then rinse.',
  },
  {
    sku: 'GH-APH-001', brand: 'Aphogee', category: 'Haircare',
    name: 'Two-Step Protein Treatment & Balancing Moisturizer',
    description: 'Salon-strength protein reconstructor that stops severe hair breakage and restores elasticity to heat- or chemically-damaged hair.',
    price: 215.00, cost: 138.00, stock_quantity: 22, image_url: IMG.hair,
    ingredients: 'Magnesium, Modified Hydrolyzed Proteins, Emollient Moisturisers',
    usage_instructions: 'Apply to clean hair, dry under hooded dryer until hard, rinse gently, and moisturise.',
  },
  {
    sku: 'GH-SNI-001', brand: 'Sunny Isle', category: 'Haircare',
    name: 'Authentic Jamaican Black Castor Oil 118ml',
    description: '100% pure roasted Jamaican Black Castor Oil formulated to thicken edges, nourish eyebrows, and stimulate healthy hair growth.',
    price: 145.00, cost: 88.00, stock_quantity: 40, image_url: IMG.oil,
    ingredients: '100% Pure Organic Ricinus Communis (Jamaican Black Castor) Seed Oil',
    usage_instructions: 'Massage a few drops into scalp and edges 3–4 times weekly.',
  },
  {
    sku: 'GH-DIF-001', brand: 'Difeel', category: 'Haircare',
    name: 'Rosemary & Mint Premium Hair Oil 75ml',
    description: 'Biotin-enriched botanical hair growth oil with invigorating rosemary and mint to strengthen strands and soothe dry scalp.',
    price: 95.00, cost: 55.00, stock_quantity: 48, image_url: IMG.oil,
    ingredients: 'Rosemary Oil, Peppermint Oil, Biotin, Sweet Almond Oil',
    usage_instructions: 'Apply directly to scalp and hair lengths; massage gently.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 4. BODY CARE, SOAP & PERSONAL HYGIENE (61–80)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sku: 'GH-NOK-001', brand: 'Nokware', category: 'Body Care',
    name: 'Whipped Raw Shea Butter — Lemongrass & Mint 200g',
    description: 'Proudly Ghanaian artisanal whipped shea butter handcrafted with Northern Region shea nuts and refreshing essential oils.',
    price: 155.00, cost: 95.00, stock_quantity: 28, image_url: IMG.cream,
    ingredients: 'Unrefined Ghanaian Shea Butter, Coconut Oil, Lemongrass & Peppermint Oils',
    usage_instructions: 'Melt a small scoop between palms and massage onto damp skin.',
  },
  {
    sku: 'GH-SKG-001', brand: 'Skin Gourmet', category: 'Body Care',
    name: 'Wild Northern Baobab & Sugar Body Scrub 250g',
    description: 'Edible-grade, 100% raw handmade Ghanaian skincare scrub crafted with wild-harvested baobab, raw shea, and cane sugar.',
    price: 165.00, cost: 102.00, stock_quantity: 24, image_url: IMG.scrub,
    ingredients: 'Raw Cane Sugar, Wild Baobab Oil, Raw Ghanaian Shea Butter, Raw Honey',
    usage_instructions: 'Buff gently onto damp skin in the shower and rinse clean.',
  },
  {
    sku: 'GH-DET-001', brand: 'Dettol', category: 'Body Care',
    name: 'Cool Menthol Antibacterial Body Wash 500ml',
    description: 'Trusted 100% better germ protection shower gel with crisp menthol for long-lasting freshness and odour defence.',
    price: 95.00, cost: 58.00, stock_quantity: 55, image_url: IMG.wash,
    ingredients: 'Antibacterial Cleansing Agents, Cooling Menthol, Glycerin',
    usage_instructions: 'Pour onto wet sponge, lather over body, and rinse thoroughly.',
  },
  {
    sku: 'GH-LUX-001', brand: 'Lux', category: 'Body Care',
    name: 'Magical Orchid Perfumed Body Wash 500ml',
    description: 'Luxurious fragrant shower gel infused with Black Orchid and Juniper Oil for 24-hour fine fragrance on skin.',
    price: 90.00, cost: 54.00, stock_quantity: 48, image_url: IMG.wash,
    ingredients: 'Black Orchid Fragrance Oils, Juniper Oil, Silk Essence',
    usage_instructions: 'Lather onto a loofah, massage across body, and rinse.',
  },
  {
    sku: 'GH-PLV-001', brand: 'Palmolive', category: 'Body Care',
    name: 'Naturals Milk & Honey Nourishing Shower Gel 500ml',
    description: 'Creamy, pH-balanced moisturising shower milk enriched with natural honey and milk proteins for velvety-soft skin.',
    price: 95.00, cost: 56.00, stock_quantity: 44, image_url: IMG.wash,
    ingredients: 'Natural Honey Extract, Milk Protein, Glycerin',
    usage_instructions: 'Apply to wet skin in shower, lather gently, and rinse.',
  },
  {
    sku: 'GH-IMP-001', brand: 'Imperial Leather', category: 'Body Care',
    name: 'Classic Original Bath Soap (4-Pack)',
    description: 'Timeless creamy lathering bar soap with signature classic fragrance, gentle enough for the whole family.',
    price: 65.00, cost: 38.00, stock_quantity: 60, image_url: IMG.scrub,
    ingredients: 'Sodium Palmate, Glycerin, Signature Classic Fragrance',
    usage_instructions: 'Lather with water and cleanse body daily.',
  },
  {
    sku: 'GH-DUR-001', brand: 'Duru', category: 'Body Care',
    name: 'Hydro Pure Aloe Vera Beauty Bar Soap (4-Pack)',
    description: 'Pure, vegetable-based transparent beauty soap enriched with Aloe Vera for soft, clean, refreshed skin.',
    price: 60.00, cost: 35.00, stock_quantity: 55, image_url: IMG.scrub,
    ingredients: '100% Vegetable Base, Aloe Vera Extract, Glycerin',
    usage_instructions: 'Work into a rich lather and rinse thoroughly.',
  },
  {
    sku: 'GH-DRT-001', brand: "Dr. Teal's", category: 'Body Care',
    name: 'Pure Epsom Salt Soaking Solution — Lavender 1.36kg',
    description: 'Soothing pure Epsom Salt (Magnesium Sulfate) blended with Lavender Essential Oil to relax tired muscles and calm the mind.',
    price: 155.00, cost: 95.00, stock_quantity: 30, image_url: IMG.scrub,
    ingredients: 'Pure Magnesium Sulfate (Epsom Salt), Lavender Essential Oil',
    usage_instructions: 'Pour 2 cups under warm running bath water and soak for 20 minutes.',
  },
  {
    sku: 'GH-TRH-001', brand: 'Tree Hut', category: 'Body Care',
    name: 'Tropic Glow Shea Sugar Body Scrub 510g',
    description: 'Viral exfoliating sugar body scrub with Cupuaçu Butter, Guarana, and Certified Shea Butter for firm, glowing skin.',
    price: 195.00, cost: 125.00, stock_quantity: 32, image_url: IMG.scrub,
    ingredients: 'Real Sugar, Shea Butter, Cupuaçu Butter, Guarana Extract, Pistachio Oil',
    usage_instructions: 'Apply generously to damp skin, polish in circular motions, and rinse.',
  },
  {
    sku: 'GH-DMC-001', brand: 'Dove Men+Care', category: 'Body Care',
    name: 'Extra Fresh Body & Face Wash 400ml',
    description: 'MicroMoisture gel wash specially engineered for men’s skin to hydrate, cool, and fight dryness all day.',
    price: 115.00, cost: 70.00, stock_quantity: 42, image_url: IMG.wash,
    ingredients: 'MicroMoisture Technology, Menthol, Hydrating Glycerin',
    usage_instructions: 'Lather onto wet face and body in the shower, then rinse.',
  },
  {
    sku: 'GH-REX-001', brand: 'Rexona', category: 'Body Care',
    name: 'MotionSense Invisible Dry Roll-On Deodorant 50ml',
    description: '48-hour anti-perspirant protection with MotionSense micro-capsules and anti-white-mark formula for hot Ghana days.',
    price: 55.00, cost: 32.00, stock_quantity: 70, image_url: IMG.fragr,
    ingredients: 'MotionSense Micro-Capsules, Anti-Stain Formula',
    usage_instructions: 'Roll evenly onto clean, dry underarms daily.',
  },
  {
    sku: 'GH-NVM-001', brand: 'NIVEA Men', category: 'Body Care',
    name: 'Sensitive Post Shave Balm 100ml',
    description: '0% alcohol soothing after-shave balm with Chamomile and Vitamin E that instantly calms razor burn and redness.',
    price: 135.00, cost: 82.00, stock_quantity: 34, image_url: IMG.cream,
    ingredients: 'Chamomile Extract, Vitamin E, Witch Hazel',
    usage_instructions: 'Apply liberally to shaved face and neck after shaving.',
  },
  {
    sku: 'GH-OSP-001', brand: 'Old Spice', category: 'Body Care',
    name: 'Captain Deodorant Stick 50ml',
    description: '0% aluminium salts long-lasting solid deodorant stick with crisp bergamot and ocean freshness that prevents yellow stains.',
    price: 85.00, cost: 50.00, stock_quantity: 48, image_url: IMG.fragr,
    ingredients: 'Fade-Resistant Fragrance Technology, Alcohol-Free Formula',
    usage_instructions: 'Twist base and glide smoothly across clean underarms.',
  },
  {
    sku: 'GH-GIL-001', brand: 'Gillette', category: 'Body Care',
    name: 'Series Sensitive Shave Gel with Aloe 200ml',
    description: 'Triple-protection lubricating shave gel with Aloe Vera that cushions skin against nicks, irritation, and razor bumps.',
    price: 95.00, cost: 56.00, stock_quantity: 38, image_url: IMG.wash,
    ingredients: 'Aloe Vera, Triple-Lubricant Polymer Blend',
    usage_instructions: 'Rub gel onto wet facial hair to build rich lather, shave, and rinse.',
  },
  {
    sku: 'GH-VET-001', brand: 'Veet', category: 'Body Care',
    name: 'Silk & Fresh Hair Removal Cream — Sensitive 200ml',
    description: 'Fast 5-minute depilatory cream enriched with Aloe Vera and Vitamin E for silky-smooth hair-free skin without nicks.',
    price: 125.00, cost: 76.00, stock_quantity: 35, image_url: IMG.cream,
    ingredients: 'Aloe Vera, Vitamin E, Silk & Fresh Fragrance Technology',
    usage_instructions: 'Spread evenly with spatula, wait 5 minutes (max 10), remove, and rinse thoroughly.',
  },
  {
    sku: 'GH-FNW-001', brand: 'Fair & White', category: 'Body Care',
    name: 'Exclusive Whitenizer Vitamin C Body Lotion 500ml',
    description: 'Iconic Parisian brightening body milk infused with Vitamin C to clarify uneven tone and restore a radiant glow.',
    price: 295.00, cost: 192.00, stock_quantity: 22, image_url: IMG.cream,
    ingredients: 'Vitamin C, Glycerin, Botanical Brightening Complex',
    usage_instructions: 'Apply evenly to clean skin once daily; always pair with daytime SPF.',
  },
  {
    sku: 'GH-MAK-001', brand: 'Makari', category: 'Body Care',
    name: 'Exclusive Active Intense Tone Boosting Body Milk 500ml',
    description: 'Luxury Swiss botanical clarifying body lotion formulated with Organiclarine to soften skin and target dark spots.',
    price: 490.00, cost: 335.00, stock_quantity: 14, image_url: IMG.cream,
    ingredients: 'Organiclarine, Mulberry Root Extract, Vitamin C, Vitamin E',
    usage_instructions: 'Apply thinly to clean body 3 times weekly at night and use sunscreen daily.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 5. OTHER BEAUTY, SKINCARE & SPECIALIST BRANDS (81–100)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sku: 'GH-E45-001', brand: 'E45', category: 'Skincare',
    name: 'Dermatological Moisturising Cream 350g',
    description: 'Clinically proven perfume-free emollient cream that soothes dry, flaky, itchy, and eczema-prone skin for all ages.',
    price: 185.00, cost: 118.00, stock_quantity: 30, image_url: IMG.cream,
    ingredients: 'White Soft Paraffin, Light Liquid Paraffin, Hypoallergenic Lanolin',
    usage_instructions: 'Apply liberally 2–3 times daily to dry or irritated areas.',
  },
  {
    sku: 'GH-ACN-001', brand: 'Acnecide', category: 'Skincare',
    name: '5% w/w Benzoyl Peroxide Acne Treatment Gel 30g',
    description: 'Pharmacy-grade 5% Benzoyl Peroxide gel that targets acne-causing bacteria and unclogs stubborn pores.',
    price: 210.00, cost: 138.00, stock_quantity: 24, image_url: IMG.serum,
    ingredients: 'Hydrous Benzoyl Peroxide (5% w/w), Acrylates Copolymer',
    usage_instructions: 'Apply a thin layer to affected areas once daily, increasing to twice daily if tolerated.',
  },
  {
    sku: 'GH-CNC-001', brand: 'Clean & Clear', category: 'Skincare',
    name: 'Morning Energy Shine Control Facial Wash 150ml',
    description: 'Zesty lemongrass and fruit extract bursting-bead face wash that removes oil and wakes up tired skin.',
    price: 85.00, cost: 50.00, stock_quantity: 45, image_url: IMG.wash,
    ingredients: 'Lemongrass Extract, Fruit Extracts, Oil-Control Cleansers',
    usage_instructions: 'Massage gently onto wet face every morning and rinse well.',
  },
  {
    sku: 'GH-PIX-001', brand: 'Pixi', category: 'Skincare',
    name: 'Glow Tonic 5% Glycolic Acid Exfoliating Toner 250ml',
    description: 'Alcohol-free botanical brightening toner with 5% Glycolic Acid, Ginseng, and Aloe Vera for radiant, smooth skin.',
    price: 295.00, cost: 195.00, stock_quantity: 20, image_url: IMG.serum,
    ingredients: 'Glycolic Acid (5%), Ginseng Root, Aloe Vera, Fructose',
    usage_instructions: 'Saturate a cotton pad and sweep across face and neck after cleansing.',
  },
  {
    sku: 'GH-CLN-001', brand: 'Clinique', category: 'Skincare',
    name: 'Dramatically Different Moisturizing Lotion+ 125ml',
    description: 'Dermatologist-developed silky yellow moisturiser that strengthens the skin’s moisture barrier for 8-hour hydration.',
    price: 495.00, cost: 340.00, stock_quantity: 14, image_url: IMG.cream,
    ingredients: 'Sunflower Seed Cake, Barley Extract, Cucumber Fruit Extract, Hyaluronic Acid',
    usage_instructions: 'Smooth onto face and throat twice daily after cleansing.',
  },
  {
    sku: 'GH-CLR-001', brand: 'Clarins', category: 'Skincare',
    name: 'Double Serum Complete Age Control Concentrate 50ml',
    description: 'Iconic dual-phase botanical serum with 21 potent plant extracts including Turmeric to visibly firm, smooth, and boost radiance.',
    price: 1350.00, cost: 940.00, stock_quantity: 8, image_url: IMG.oil,
    ingredients: 'Organic Turmeric Extract, Oat Sugars, Avocado, Goji Berry, 21 Plant Extracts',
    usage_instructions: 'Warm 1 pump between palms and press gently onto face and neck morning and night.',
  },
  {
    sku: 'GH-VIC-001', brand: 'Vichy', category: 'Skincare',
    name: 'Minéral 89 Hyaluronic Acid Booster Serum 50ml',
    description: 'Minimalist 11-ingredient plumping booster powered by 89% Vichy Volcanic Water and pure Hyaluronic Acid.',
    price: 390.00, cost: 260.00, stock_quantity: 18, image_url: IMG.serum,
    ingredients: 'Vichy Volcanic Water (89%), Natural-Origin Hyaluronic Acid',
    usage_instructions: 'Apply 2 drops onto clean skin morning and evening as the first step of your routine.',
  },
  {
    sku: 'GH-ISD-001', brand: 'ISDIN', category: 'Skincare',
    name: 'Fusion Water Magic SPF 50 Ultra-Light Sunscreen 50ml',
    description: 'Feather-light water-based Spanish facial sunscreen that absorbs instantly with zero eye stinging and zero white cast.',
    price: 360.00, cost: 240.00, stock_quantity: 20, image_url: IMG.serum,
    ingredients: 'Hyaluronic Acid, Mediterranean Alga Extract, Vitamin E, SPF 50 Filters',
    usage_instructions: 'Apply generously to dry or wet skin 30 minutes before sun exposure.',
  },
  {
    sku: 'GH-URI-001', brand: 'Uriage', category: 'Skincare',
    name: 'Eau Thermale Thermal Water Mist Spray 150ml',
    description: 'Isotonic French Alpine mineral water spray that hydrates, soothes redness, and refreshes skin throughout the day.',
    price: 150.00, cost: 95.00, stock_quantity: 26, image_url: IMG.wash,
    ingredients: '100% Pure Uriage Thermal Water rich in Trace Elements and Minerals',
    usage_instructions: 'Spray onto face as needed and let absorb naturally without blotting.',
  },
  {
    sku: 'GH-S14-001', brand: 'Skin1004', category: 'Skincare',
    name: 'Madagascar Centella Asiatica 100 Ampoule 100ml',
    description: 'Pure single-ingredient Centella Asiatica calming ampoule that soothes sensitive, acne-prone skin and restores barrier health.',
    price: 250.00, cost: 162.00, stock_quantity: 28, image_url: IMG.oil,
    ingredients: '100% Madagascar Centella Asiatica Extract',
    usage_instructions: 'Drop an appropriate amount onto skin after toning and pat gently until absorbed.',
  },
  {
    sku: 'GH-MDC-001', brand: 'Medicube', category: 'Skincare',
    name: 'Zero Pore Pad 2.0 Exfoliating Toner Pads (70 Pads)',
    description: 'Dual-textured Korean pore-tightening pads soaked in AHA/BHA and botanical extracts for visibly refined, smooth skin.',
    price: 310.00, cost: 205.00, stock_quantity: 22, image_url: IMG.scrub,
    ingredients: 'Natural AHA & BHA, White Willow Bark, Citric Acid, Camellia Extract',
    usage_instructions: 'Wipe embossed side over clean face, then pat gently with the smooth side.',
  },
  {
    sku: 'GH-INK-001', brand: 'The Inkey List', category: 'Skincare',
    name: 'Retinol Anti-Aging Night Serum 30ml',
    description: 'Slow-release 1% RetiStar stabilised retinol serum with Squalane to smooth texture and fine lines with minimal irritation.',
    price: 175.00, cost: 112.00, stock_quantity: 26, image_url: IMG.serum,
    ingredients: '1% RetiStar Stabilised Retinol, 0.5% Granactive Retinoid, Squalane',
    usage_instructions: 'Apply a pea-sized amount at night 2–3 times per week; wear SPF every morning.',
  },
  {
    sku: 'GH-BFR-001', brand: 'Beauty Formulas', category: 'Skincare',
    name: 'Australian Tea Tree Deep Cleansing Facial Wash 150ml',
    description: 'Affordable everyday blemish-fighting gel wash infused with Australian Tea Tree Oil to clear excess oil and impurities.',
    price: 55.00, cost: 32.00, stock_quantity: 62, image_url: IMG.wash,
    ingredients: 'Australian Tea Tree Oil, Peppermint Oil, Soap-Free Cleansers',
    usage_instructions: 'Lather onto wet face morning and night and rinse with warm water.',
  },
  {
    sku: 'GH-DRR-001', brand: 'Dr. Rashel', category: 'Skincare',
    name: 'Vitamin C Brightening & Anti-Aging Face Serum 50ml',
    description: 'Popular Ghana market brightening serum combining Vitamin C and Hyaluronic Acid to boost glow and soften dull skin.',
    price: 95.00, cost: 55.00, stock_quantity: 58, image_url: IMG.serum,
    ingredients: 'Vitamin C, Hyaluronic Acid, Collagen, Vitamin E',
    usage_instructions: 'Apply 3–4 drops to clean face and neck morning and night.',
  },
  {
    sku: 'GH-BQA-001', brand: 'Bioaqua', category: 'Skincare',
    name: '24K Gold Hyaluronic Acid Hydrating Sheet Mask Set (5-Pack)',
    description: 'Essence-drenched soothing sheet masks infused with Hyaluronic Acid and 24K Gold for an instant spa-like glow.',
    price: 75.00, cost: 42.00, stock_quantity: 50, image_url: IMG.scrub,
    ingredients: 'Hyaluronic Acid, 24K Gold Extract, Glycerin, Botanical Extracts',
    usage_instructions: 'Place mask on clean face for 15–20 minutes, remove, and massage remaining serum in.',
  },
  {
    sku: 'GH-HEM-001', brand: 'Hemani', category: 'Haircare',
    name: '100% Natural Cold-Pressed Black Seed Oil 125ml',
    description: 'Pure Nigella Sativa herbal oil prized for nourishing scalp, strengthening hair, and soothing dry skin.',
    price: 110.00, cost: 65.00, stock_quantity: 36, image_url: IMG.oil,
    ingredients: '100% Pure Cold-Pressed Black Seed (Nigella Sativa) Oil',
    usage_instructions: 'Massage into scalp as a pre-shampoo oil or apply sparingly to dry skin.',
  },
  {
    sku: 'GH-ADC-001', brand: 'Advanced Clinicals', category: 'Skincare',
    name: 'Retinol Advanced Firming Cream 454g',
    description: 'Spa-size tub of encapsulated Retinol, Green Tea, Aloe Vera, and Chamomile cream for smoother, firmer face and body skin.',
    price: 195.00, cost: 122.00, stock_quantity: 34, image_url: IMG.cream,
    ingredients: 'Encapsulated Retinol, Green Tea Extract, Aloe Vera, Chamomile, Vitamin E',
    usage_instructions: 'Apply nightly to face, neck, and body. Always wear sunscreen during the day.',
  },
];

async function seed() {
  let inserted = 0;
  let skipped  = 0;

  for (const p of products) {
    const { rows: existing } = await pool.query(
      'SELECT id FROM products WHERE sku = $1', [p.sku]
    );

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await pool.query(
      `INSERT INTO products
         (name, description, price, cost, category, brand, image_url,
          stock_quantity, sku, ingredients, usage_instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        p.name, p.description, p.price, p.cost, p.category, p.brand,
        p.image_url, p.stock_quantity, p.sku, p.ingredients, p.usage_instructions,
      ]
    );
    inserted++;
  }

  await pool.end();
  console.log(`Done. ${inserted} inserted, ${skipped} skipped.`);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
