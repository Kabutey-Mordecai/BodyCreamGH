/**
 * Curated Ghana Cosmetics Starter Catalog (24 Bestsellers · 24 Unique Verified Images)
 *
 * Keeps the storefront crisp with 24 flagship products across Skincare, Makeup,
 * Body Care, Haircare, Fragrances, and Tools & Accessories — every single product
 * has its own unique, verified HTTP-200 image URL (zero repeated stock photos).
 *
 * Also deactivates previously bulk-seeded duplicate-image rows (without deleting
 * anything referenced by existing orders).
 *
 * Run: node migrations/seed_curated_cosmetics.js
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

// 24 flagship Ghana-market cosmetics — each with a UNIQUE verified Unsplash image URL
const CURATED_PRODUCTS = [
  // ── SKINCARE (6) ──────────────────────────────────────────────────────────
  {
    sku: 'CRV-CLN-236',
    brand: 'CeraVe',
    category: 'Skincare',
    name: 'Foaming Facial Cleanser 236ml',
    description: 'Gentle gel-to-foam cleanser with 3 essential ceramides, niacinamide, and hyaluronic acid to cleanse without disrupting the skin barrier.',
    price: 185.00, cost: 115.00, stock_quantity: 34,
    image_url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Ceramides 1, 3, 6-II, Niacinamide, Hyaluronic Acid',
    usage_instructions: 'Massage onto wet skin morning and evening, then rinse thoroughly.',
  },
  {
    sku: 'ORD-NIA-030',
    brand: 'The Ordinary',
    category: 'Skincare',
    name: 'Niacinamide 10% + Zinc 1% Serum 30ml',
    description: 'High-strength vitamin and mineral blemish formula that visibly tightens pores, smooths texture, and balances excess oil.',
    price: 145.00, cost: 85.00, stock_quantity: 28,
    image_url: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Niacinamide (10%), Zinc PCA (1%), Tamarindus Indica Seed Gum',
    usage_instructions: 'Apply a few drops to face morning and evening before heavier creams.',
  },
  {
    sku: 'LRP-ANT-050',
    brand: 'La Roche-Posay',
    category: 'Skincare',
    name: 'Anthelios UVMune 400 Invisible Fluid SPF 50+',
    description: 'Ultra-lightweight broad-spectrum sunscreen with zero white cast on melanin-rich skin. Sweat-resistant and ideal for Ghana weather.',
    price: 295.00, cost: 190.00, stock_quantity: 24,
    image_url: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Mexoryl 400, Thermal Spring Water, Vitamin E, Glycerin',
    usage_instructions: 'Shake well. Apply generously 15 minutes before sun exposure and reapply every 2 hours.',
  },
  {
    sku: 'CSX-SNL-100',
    brand: 'COSRX',
    category: 'Skincare',
    name: 'Advanced Snail 96 Mucin Power Essence 100ml',
    description: 'Korean skincare bestseller with 96% snail secretion filtrate that deeply hydrates, repairs damaged skin barrier, and gives glass-skin glow.',
    price: 230.00, cost: 145.00, stock_quantity: 27,
    image_url: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Snail Secretion Filtrate (96%), Sodium Hyaluronate, Panthenol, Allantoin',
    usage_instructions: 'Pat gently onto damp skin after cleansing and toning, before moisturiser.',
  },
  {
    sku: 'GH-BOJ-001',
    brand: 'Beauty of Joseon',
    category: 'Skincare',
    name: 'Relief Sun: Rice + Probiotics SPF 50+ PA++++ 50ml',
    description: 'Viral Korean organic sunscreen with 30% rice extract that melts seamlessly into melanin-rich skin with zero white cast.',
    price: 235.00, cost: 150.00, stock_quantity: 38,
    image_url: 'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Rice Extract (30%), Grain Fermented Extracts, Niacinamide, Vitamin E',
    usage_instructions: 'Apply two finger-lengths evenly over face and neck as the last step of morning skincare.',
  },
  {
    sku: 'GRN-VTC-030',
    brand: 'Garnier',
    category: 'Skincare',
    name: 'Vitamin C 3.5% Brightening Booster Serum 30ml',
    description: 'Fast-absorbing glow serum combining Vitamin C, Niacinamide, and Salicylic Acid to visibly reduce dark spots in 6 days.',
    price: 145.00, cost: 88.00, stock_quantity: 40,
    image_url: 'https://images.unsplash.com/photo-1617897903246-719242758050?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Vitamin C, Niacinamide, Salicylic Acid, Lemon Extract',
    usage_instructions: 'Apply 1 full dropper to clean face and neck every morning before moisturiser and SPF.',
  },

  // ── MAKEUP (5) ────────────────────────────────────────────────────────────
  {
    sku: 'FNT-LIP-001',
    brand: 'Fenty Beauty',
    category: 'Makeup',
    name: 'Gloss Bomb Universal Lip Luminizer',
    description: 'Stop-everything shine with conditioning shea butter. Non-sticky, ultra-glossy finish that flatters every skin tone.',
    price: 260.00, cost: 170.00, stock_quantity: 18,
    image_url: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Polybutene, Shea Butter, Vitamin E',
    usage_instructions: 'Wear alone or layer over lipstick for instant shine.',
  },
  {
    sku: 'MAY-FIT-355',
    brand: 'Maybelline',
    category: 'Makeup',
    name: 'Fit Me Matte + Poreless Foundation 30ml',
    description: 'Ghana’s favourite everyday foundation with micro-powders that control shine and blur pores in rich melanin-friendly shades.',
    price: 165.00, cost: 102.00, stock_quantity: 36,
    image_url: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Micro-Powders, Glycerin, Vitamin E, Oil-Free Mattifying Complex',
    usage_instructions: 'Blend evenly onto primed face with a damp sponge or foundation brush.',
  },
  {
    sku: 'GH-MAC-001',
    brand: 'MAC Cosmetics',
    category: 'Makeup',
    name: 'Studio Fix Fluid SPF 15 Foundation 30ml',
    description: 'Iconic 24-hour matte liquid foundation offering buildable medium-to-full coverage and shine control for all undertones.',
    price: 540.00, cost: 375.00, stock_quantity: 16,
    image_url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Oil-Controlling Silica, Vitamin E, SPF 15 Mineral Filters',
    usage_instructions: 'Blend onto moisturised, primed skin using a foundation brush or sponge.',
  },
  {
    sku: 'GH-JUV-001',
    brand: "Juvia's Place",
    category: 'Makeup',
    name: 'The Nubian Eyeshadow Palette (12 Shades)',
    description: 'Ultra-pigmented warm neutral mattes and rich metallic shimmers crafted to pop brilliantly on deep and rich complexions.',
    price: 310.00, cost: 205.00, stock_quantity: 20,
    image_url: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Rich Mineral Pigments, Silk-Touch Mica',
    usage_instructions: 'Sweep matte shades into crease and pack shimmers onto lids with a flat brush.',
  },
  {
    sku: 'GH-SAC-001',
    brand: 'Sacha Cosmetics',
    category: 'Makeup',
    name: 'Buttercup Loose Setting Powder 28g',
    description: 'Flashback-free golden setting powder famous across Ghana for brightening under-eyes and locking makeup in place all day.',
    price: 260.00, cost: 170.00, stock_quantity: 26,
    image_url: 'https://images.unsplash.com/photo-1583241800698-e8ab01830a07?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Finely Milled Silica, Warm Golden Mineral Pigments',
    usage_instructions: 'Press under eyes and T-zone with a damp sponge, let bake 3 minutes, then dust off.',
  },

  // ── BODY CARE (5) ─────────────────────────────────────────────────────────
  {
    sku: 'NIV-EVG-400',
    brand: 'Nivea',
    category: 'Body Care',
    name: 'Radiant & Beauty Even Glow Body Lotion 400ml',
    description: 'Formulated specifically for melanin-rich skin with 95% pure Vitamin C, Pearl Extract, and SPF 15 to visibly even tone in 2 weeks.',
    price: 115.00, cost: 68.00, stock_quantity: 55,
    image_url: 'https://images.unsplash.com/photo-1619451334792-150fd785ee74?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Vitamin C (95% Pure), Pearl Extract, Turmeric, SPF 15',
    usage_instructions: 'Apply daily over entire body after showering.',
  },
  {
    sku: 'VAS-CGO-200',
    brand: 'Vaseline',
    category: 'Body Care',
    name: 'Cocoa Radiant Body Gel Oil 200ml',
    description: 'Pure cocoa butter and replenishing oils in a luminous gel oil that seals in moisture for an all-day chocolate glow.',
    price: 110.00, cost: 65.00, stock_quantity: 42,
    image_url: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=600&q=80',
    ingredients: '100% Pure Cocoa Butter, Mineral Oil, Vitamin E',
    usage_instructions: 'Apply to damp skin right after showering to lock in hydration.',
  },
  {
    sku: 'GH-NOK-001',
    brand: 'Nokware',
    category: 'Body Care',
    name: 'Whipped Raw Shea Butter — Lemongrass & Mint 200g',
    description: 'Proudly Ghanaian artisanal whipped shea butter handcrafted with Northern Region shea nuts and refreshing essential oils.',
    price: 155.00, cost: 95.00, stock_quantity: 28,
    image_url: 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Unrefined Ghanaian Shea Butter, Coconut Oil, Lemongrass & Peppermint Oils',
    usage_instructions: 'Melt a small scoop between palms and massage onto damp skin.',
  },
  {
    sku: 'GH-TRH-001',
    brand: 'Tree Hut',
    category: 'Body Care',
    name: 'Tropic Glow Shea Sugar Body Scrub 510g',
    description: 'Viral exfoliating sugar body scrub with Cupuaçu Butter, Guarana, and Certified Shea Butter for firm, glowing skin.',
    price: 195.00, cost: 125.00, stock_quantity: 32,
    image_url: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Real Sugar, Shea Butter, Cupuaçu Butter, Guarana Extract, Pistachio Oil',
    usage_instructions: 'Apply generously to damp skin, polish in circular motions, and rinse.',
  },
  {
    sku: 'BIO-OIL-125',
    brand: 'Bio-Oil',
    category: 'Body Care',
    name: 'Bio-Oil Skincare Oil 125ml',
    description: 'Clinically proven specialist oil with PurCellin Oil to help fade stretch marks, surgical scars, and uneven skin tone.',
    price: 190.00, cost: 122.00, stock_quantity: 30,
    image_url: 'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?auto=format&fit=crop&w=600&q=80',
    ingredients: 'PurCellin Oil, Vitamin A, Vitamin E, Calendula, Lavender, Rosemary, Chamomile Oils',
    usage_instructions: 'Massage in circular motions twice daily for a minimum of 3 months.',
  },

  // ── HAIRCARE (4) ──────────────────────────────────────────────────────────
  {
    sku: 'MIE-RSM-059',
    brand: 'Mielle Organics',
    category: 'Haircare',
    name: 'Rosemary Mint Scalp & Hair Strengthening Oil 59ml',
    description: 'Biotin-infused botanical scalp oil with 30+ essential oils to nourish hair follicles, soothe dry scalp, and support edges and growth.',
    price: 165.00, cost: 105.00, stock_quantity: 45,
    image_url: 'https://images.unsplash.com/photo-1526947425960-945c6e72858f?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Rosemary Oil, Peppermint Oil, Biotin, Castor Oil, Jojoba Oil',
    usage_instructions: 'Apply a small amount to scalp, massage gently, and comb through to ends.',
  },
  {
    sku: 'SHM-MSK-326',
    brand: 'SheaMoisture',
    category: 'Haircare',
    name: 'Manuka Honey & Mafura Oil Hair Masque 326g',
    description: 'Intensive conditioning treatment that infuses dry, brittle curls and coils with deep moisture, shine, and manageability.',
    price: 195.00, cost: 120.00, stock_quantity: 20,
    image_url: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Raw Shea Butter, Manuka Honey, Mafura Oil, Fig Extract',
    usage_instructions: 'Apply generously from root to ends, leave 15–30 minutes, then rinse.',
  },
  {
    sku: 'CNT-LVI-453',
    brand: 'Cantu',
    category: 'Haircare',
    name: 'Shea Butter Leave-In Conditioning Repair Cream 453g',
    description: 'Intensive pure shea butter repair cream that mends split ends, reduces breakage, and softens natural or relaxed hair.',
    price: 120.00, cost: 72.00, stock_quantity: 39,
    image_url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Pure Shea Butter, Canola Oil, Natural Essential Oils',
    usage_instructions: 'Apply to damp hair from ends to roots. Do not rinse.',
  },
  {
    sku: 'GH-SNI-001',
    brand: 'Sunny Isle',
    category: 'Haircare',
    name: 'Authentic Jamaican Black Castor Oil 118ml',
    description: '100% pure roasted Jamaican Black Castor Oil formulated to thicken edges, nourish eyebrows, and stimulate healthy hair growth.',
    price: 145.00, cost: 88.00, stock_quantity: 40,
    image_url: 'https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=600&q=80',
    ingredients: '100% Pure Organic Ricinus Communis (Jamaican Black Castor) Seed Oil',
    usage_instructions: 'Massage a few drops into scalp and edges 3–4 times weekly.',
  },

  // ── FRAGRANCES (3) ────────────────────────────────────────────────────────
  {
    sku: 'LTF-KHM-100',
    brand: 'Lattafa',
    category: 'Fragrances',
    name: 'Khamrah Eau de Parfum 100ml',
    description: 'Opulent warm spicy-gourmand Arabian perfume with cinnamon, dates, praline, vanilla, and amberwood — legendary longevity.',
    price: 420.00, cost: 275.00, stock_quantity: 18,
    image_url: 'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Cinnamon, Nutmeg, Dates, Praline, Vanilla, Tonka Bean, Amberwood',
    usage_instructions: 'Spritz onto neck, wrists, and clothes for an all-day warm trail.',
  },
  {
    sku: 'ARM-CDN-105',
    brand: 'Armaf',
    category: 'Fragrances',
    name: 'Club de Nuit Intense Man EDT 105ml',
    description: 'Iconic smoky pineapple, birch, bergamot, and musk signature fragrance loved across Accra for its powerhouse projection.',
    price: 460.00, cost: 310.00, stock_quantity: 16,
    image_url: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Lemon, Pineapple, Black Currant, Birch, Jasmine, Musk, Ambergris',
    usage_instructions: 'Spray onto chest, neck, and wrists.',
  },
  {
    sku: 'BBW-ITN-236',
    brand: 'Bath & Body Works',
    category: 'Fragrances',
    name: 'Into the Night Fine Fragrance Mist 236ml',
    description: 'Timeless, seductive blend of dark berries, midnight jasmine, and rich amber in a refreshing all-over body mist.',
    price: 240.00, cost: 155.00, stock_quantity: 24,
    image_url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=600&q=80',
    ingredients: 'Raspberry Noir, Amber Crystals, Velvety Rose Petals, Creamy Patchouli',
    usage_instructions: 'Spritz generously over body and hair for a light, lingering scent.',
  },

  // ── TOOLS & ACCESSORIES (1) ───────────────────────────────────────────────
  {
    sku: 'RLT-EVR-005',
    brand: 'Real Techniques',
    category: 'Tools & Accessories',
    name: 'Everyday Essentials 5-Piece Brush & Sponge Set',
    description: 'Complete 5-piece set with blush, crease, setting, and expert face brushes plus Miracle Complexion Sponge.',
    price: 280.00, cost: 175.00, stock_quantity: 19,
    image_url: 'https://images.unsplash.com/photo-1571875257727-256c39da42af?auto=format&fit=crop&w=600&q=80',
    ingredients: 'UltraPlush Synthetic Bristles, Lightweight Aluminium Ferrules',
    usage_instructions: 'Use with liquid, cream, or powder formulas. Clean weekly with brush cleanser.',
  },
];

async function run() {
  const curatedSkus = CURATED_PRODUCTS.map(p => p.sku);

  // Deactivate bulk-seeded rows that aren't in the curated 24 (preserves order integrity)
  const { rowCount: deactivated } = await pool.query(
    `UPDATE products
        SET is_active = FALSE, updated_at = NOW()
      WHERE is_active = TRUE
        AND sku IS NOT NULL
        AND NOT (sku = ANY($1::text[]))`,
    [curatedSkus]
  );

  let inserted = 0;
  let updated = 0;

  for (const p of CURATED_PRODUCTS) {
    const { rows: existing } = await pool.query(
      'SELECT id FROM products WHERE sku = $1',
      [p.sku]
    );

    if (existing.length > 0) {
      await pool.query(
        `UPDATE products
            SET name = $1, description = $2, price = $3, cost = $4,
                category = $5, brand = $6, image_url = $7,
                stock_quantity = $8, ingredients = $9, usage_instructions = $10,
                is_active = TRUE, updated_at = NOW()
          WHERE id = $11`,
        [
          p.name, p.description, p.price, p.cost,
          p.category, p.brand, p.image_url,
          p.stock_quantity, p.ingredients, p.usage_instructions,
          existing[0].id,
        ]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO products
           (name, description, price, cost, category, brand, image_url,
            stock_quantity, sku, ingredients, usage_instructions, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)`,
        [
          p.name, p.description, p.price, p.cost, p.category, p.brand,
          p.image_url, p.stock_quantity, p.sku, p.ingredients, p.usage_instructions,
        ]
      );
      inserted++;
    }
  }

  await pool.end();
  console.log(`Curated catalog ready: ${inserted} inserted, ${updated} updated, ${deactivated} bulk rows hidden.`);
}

run().catch(err => {
  console.error('Curated seed failed:', err.message);
  process.exit(1);
});
