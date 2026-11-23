/**
 * Seed script — inserts sample products so the storefront has content.
 * Run once: node migrations/seed.js
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

const products = [
  {
    sku:          'SHEA-001',
    name:         'Raw Shea Butter Body Cream',
    description:  'Our flagship cream — unrefined shea butter cold-pressed from nuts harvested by women cooperatives in the Northern Region. Deeply moisturising, absorbs quickly, and leaves skin silky without greasiness.',
    price:        89.00,
    cost:         28.00,
    category:     'Body Cream',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1619451334792-150fd785ee74?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 48,
    ingredients:  'Raw shea butter, jojoba oil, vitamin E',
    usage_instructions: 'Apply generously to clean skin morning and night.',
  },
  {
    sku:          'RGOL-002',
    name:         'Rose Gold Radiance Body Oil',
    description:  'A lightweight dry oil infused with rosehip, argan, and 24k gold flakes. Gives skin a luminous, dewy finish that lasts all day. Ideal for special occasions or everyday confidence.',
    price:        120.00,
    cost:         40.00,
    category:     'Body Oil',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 32,
    ingredients:  'Rosehip oil, argan oil, jojoba beads, 24k gold flakes, vitamin C',
    usage_instructions: 'Apply 4-6 drops to arms, legs, and décolletage after showering.',
  },
  {
    sku:          'VSCR-003',
    name:         'Vanilla Sugar Body Scrub',
    description:  'An exfoliating sugar scrub blended with raw cane sugar, coconut oil, and Ghanaian vanilla extract. Buffs away dead skin cells while the coconut oil leaves skin impossibly soft.',
    price:        75.00,
    cost:         22.00,
    category:     'Body Scrub',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 26,
    ingredients:  'Raw cane sugar, coconut oil, vanilla extract, almond oil',
    usage_instructions: 'Use in the shower 2-3x per week. Massage in circular motions, rinse well.',
  },
  {
    sku:          'TURC-004',
    name:         'Turmeric Glow Brightening Cream',
    description:  'Harnesses the anti-inflammatory power of Ghanaian turmeric to even skin tone and reduce hyperpigmentation. Formulated with niacinamide for an accelerated brightening effect.',
    price:        95.00,
    cost:         32.00,
    category:     'Body Cream',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 19,
    ingredients:  'Shea butter, turmeric extract, niacinamide, kojic acid, vitamin C',
    usage_instructions: 'Apply to clean skin morning and evening. Use SPF during the day.',
  },
  {
    sku:          'CBUT-005',
    name:         'Pure Cocoa Butter Stick',
    description:  'Our most concentrated moisturiser — 100% pure cocoa butter from Brong-Ahafo farms pressed into a convenient stick format. Targets stretch marks, dry elbows, and cracked heels.',
    price:        45.00,
    cost:         12.00,
    category:     'Body Butter',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 55,
    ingredients:  '100% pure cocoa butter',
    usage_instructions: 'Apply directly to skin. Works best on warm, slightly damp skin.',
  },
  {
    sku:          'LAVL-006',
    name:         'Lavender Calm Night Butter',
    description:  'A rich whipped body butter infused with lavender essential oil to ease you into sleep while it repairs and regenerates skin overnight. Wake up to visibly smoother, softer skin.',
    price:        110.00,
    cost:         35.00,
    category:     'Body Butter',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 22,
    ingredients:  'Shea butter, cocoa butter, lavender essential oil, chamomile extract',
    usage_instructions: 'Apply generously at bedtime. Allow to absorb before sleeping.',
  },
  {
    sku:          'CNMG-007',
    name:         'Cinnamon & Honey Glow Mask',
    description:  'A warming body mask that draws out impurities while the raw honey deeply hydrates. Cinnamon boosts circulation for an immediate post-mask glow. Leave on for 10 minutes, rinse off.',
    price:        65.00,
    cost:         18.00,
    category:     'Body Mask',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 15,
    ingredients:  'Raw honey, cinnamon powder, kaolin clay, jojoba oil',
    usage_instructions: 'Apply thick layer to clean, dry skin. Leave 10-15 min, rinse with warm water.',
  },
  {
    sku:          'CGRP-008',
    name:         'Citrus & Grapefruit Energising Oil',
    description:  'A zingy, uplifting body oil perfect for morning rituals. Cold-pressed grapefruit, sweet orange, and lemon oils in a base of sunflower oil to hydrate and awaken the skin.',
    price:        85.00,
    cost:         26.00,
    category:     'Body Oil',
    brand:        'BodyCream GH',
    image_url:    'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 0,
    ingredients:  'Sunflower oil, grapefruit essential oil, sweet orange oil, lemon oil, vitamin E',
    usage_instructions: 'Apply to body after shower. Avoid direct sun for 12 hours after use.',
  },
  {
    sku:          'CRV-CLN-236',
    name:         'Foaming Facial Cleanser 236ml',
    description:  'Gentle gel-to-foam cleanser with 3 essential ceramides, niacinamide, and hyaluronic acid to cleanse without disrupting the skin barrier.',
    price:        185.00,
    cost:         115.00,
    category:     'Skincare',
    brand:        'CeraVe',
    image_url:    'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 34,
    ingredients:  'Ceramides 1, 3, 6-II, Niacinamide, Hyaluronic Acid',
    usage_instructions: 'Massage onto wet skin morning and evening, then rinse thoroughly.',
  },
  {
    sku:          'ORD-NIA-030',
    name:         'Niacinamide 10% + Zinc 1% Serum',
    description:  'High-strength vitamin and mineral blemish formula that visibly tightens pores, smooths skin texture, and balances excess oil.',
    price:        145.00,
    cost:         85.00,
    category:     'Skincare',
    brand:        'The Ordinary',
    image_url:    'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 28,
    ingredients:  'Niacinamide (10%), Zinc PCA (1%), Tamarindus Indica Seed Gum',
    usage_instructions: 'Apply a few drops to face morning and evening before heavier creams.',
  },
  {
    sku:          'FNT-LIP-001',
    name:         'Gloss Bomb Universal Lip Luminizer',
    description:  'Stop-everything shine with conditioning shea butter. Non-sticky, ultra-glossy finish that flatters every skin tone.',
    price:        260.00,
    cost:         170.00,
    category:     'Makeup',
    brand:        'Fenty Beauty',
    image_url:    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 18,
    ingredients:  'Polybutene, Shea Butter, Vitamin E',
    usage_instructions: 'Wear alone or layer over lipstick for instant shine.',
  },
  {
    sku:          'SHM-MSK-326',
    name:         'Manuka Honey & Mafura Oil Hair Masque',
    description:  'Intensive conditioning treatment that infuses dry, brittle curls and coils with deep moisture, shine, and manageability.',
    price:        195.00,
    cost:         120.00,
    category:     'Haircare',
    brand:        'SheaMoisture',
    image_url:    'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 20,
    ingredients:  'Raw Shea Butter, Manuka Honey, Mafura Oil, Fig Extract',
    usage_instructions: 'Apply generously from root to ends, leave 15-30 minutes, then rinse.',
  },
  {
    sku:          'LTF-YAR-100',
    name:         'Yara Eau de Parfum 100ml',
    description:  'Creamy vanilla, orchid, and tropical heliotrope blended into a long-lasting, feminine signature fragrance.',
    price:        320.00,
    cost:         200.00,
    category:     'Fragrances',
    brand:        'Lattafa',
    image_url:    'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?auto=format&fit=crop&w=600&q=80',
    stock_quantity: 14,
    ingredients:  'Heliotrope, Orchid, Tangerine, Vanilla, Musk, Sandalwood',
    usage_instructions: 'Spray onto pulse points: wrists, neck, and behind ears.',
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
      console.log(`  skip  ${p.sku} — already exists`);
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
    console.log(`  added  ${p.sku} — ${p.name}`);
    inserted++;
  }

  await pool.end();
  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
