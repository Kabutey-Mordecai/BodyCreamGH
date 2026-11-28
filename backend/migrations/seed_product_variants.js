/**
 * Seed realistic Size & Shade variants for flagship curated products.
 * Run: node migrations/seed_product_variants.js
 * Safe to re-run — skips products that already have variants.
 */
require('dotenv').config();
if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.log('[seed] Skipping demo variant seed in production (set ALLOW_DEMO_SEED=true to run explicitly).');
  process.exit(0);
}
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const VARIANT_SETS = [
  {
    sku: 'CRV-CLN-236',
    optionName: 'Size',
    variants: [
      { value: '88ml (Travel)',      sku: 'CRV-CLN-088', price: 95.00,  stock: 20 },
      { value: '236ml (Standard)',   sku: 'CRV-CLN-236-V', price: 185.00, stock: 34 },
      { value: '473ml (Value Pump)', sku: 'CRV-CLN-473', price: 295.00, stock: 18 },
    ],
  },
  {
    sku: 'ORD-NIA-030',
    optionName: 'Size',
    variants: [
      { value: '30ml',            sku: 'ORD-NIA-030-V', price: 145.00, stock: 28 },
      { value: '60ml (Supersize)', sku: 'ORD-NIA-060',   price: 245.00, stock: 16 },
    ],
  },
  {
    sku: 'NIV-EVG-400',
    optionName: 'Size',
    variants: [
      { value: '200ml', sku: 'NIV-EVG-200',   price: 70.00,  stock: 30 },
      { value: '400ml', sku: 'NIV-EVG-400-V', price: 115.00, stock: 55 },
    ],
  },
  {
    sku: 'LTF-KHM-100',
    optionName: 'Size',
    variants: [
      { value: '30ml Decant',       sku: 'LTF-KHM-030',   price: 160.00, stock: 15 },
      { value: '100ml Full Bottle', sku: 'LTF-KHM-100-V', price: 420.00, stock: 18 },
    ],
  },
  {
    sku: 'MIE-RSM-059',
    optionName: 'Size',
    variants: [
      { value: '59ml (2 fl oz)',  sku: 'MIE-RSM-059-V', price: 165.00, stock: 45 },
      { value: '118ml (4 fl oz)', sku: 'MIE-RSM-118',   price: 290.00, stock: 20 },
    ],
  },
  {
    sku: 'MAY-FIT-355',
    optionName: 'Shade',
    variants: [
      { value: '355 Coconut',     sku: 'MAY-FIT-355-V', price: 165.00, stock: 15 },
      { value: '360 Mocha',       sku: 'MAY-FIT-360',   price: 165.00, stock: 12 },
      { value: '370 Deep Bronze', sku: 'MAY-FIT-370',   price: 165.00, stock: 9  },
    ],
  },
  {
    sku: 'CRV-SA-236',
    optionName: 'Size',
    variants: [
      { value: '236ml', sku: 'CRV-SA-236-V', price: 210.00, stock: 26 },
      { value: '473ml', sku: 'CRV-SA-473',   price: 340.00, stock: 14 },
    ],
  },
  {
    sku: 'ORD-GLY-240',
    optionName: 'Size',
    variants: [
      { value: '100ml', sku: 'ORD-GLY-100',   price: 115.00, stock: 20 },
      { value: '240ml', sku: 'ORD-GLY-240-V', price: 195.00, stock: 32 },
    ],
  },
  {
    sku: 'VAS-COC-400',
    optionName: 'Size',
    variants: [
      { value: '200ml', sku: 'VAS-COC-200',   price: 62.00,  stock: 25 },
      { value: '400ml', sku: 'VAS-COC-400-V', price: 98.00,  stock: 50 },
      { value: '725ml', sku: 'VAS-COC-725',   price: 155.00, stock: 18 },
    ],
  },
  {
    sku: 'TRH-SHS-510',
    optionName: 'Scent',
    variants: [
      { value: 'Moroccan Rose',   sku: 'TRH-SHS-510-R', price: 190.00, stock: 24 },
      { value: 'Vitamin C',       sku: 'TRH-SHS-510-V', price: 190.00, stock: 18 },
      { value: 'Vanilla Bean',    sku: 'TRH-SHS-510-B', price: 190.00, stock: 16 },
    ],
  },
  {
    sku: 'FNT-GLS-009',
    optionName: 'Shade',
    variants: [
      { value: 'Fenty Glow',   sku: 'FNT-GLS-FG', price: 320.00, stock: 20 },
      { value: 'Fu$$y',        sku: 'FNT-GLS-FS', price: 320.00, stock: 15 },
      { value: 'Hot Chocolit', sku: 'FNT-GLS-HC', price: 320.00, stock: 18 },
    ],
  },
  {
    sku: 'LAG-PRO-008',
    optionName: 'Shade',
    variants: [
      { value: 'Fawn',          sku: 'LAG-PRO-FWN', price: 65.00, stock: 30 },
      { value: 'Warm Honey',    sku: 'LAG-PRO-WHN', price: 65.00, stock: 28 },
      { value: 'Espresso',      sku: 'LAG-PRO-ESP', price: 65.00, stock: 24 },
      { value: 'Chestnut',      sku: 'LAG-PRO-CHS', price: 65.00, stock: 22 },
    ],
  },
  {
    sku: 'LTF-YAR-100',
    optionName: 'Size',
    variants: [
      { value: '50ml',  sku: 'LTF-YAR-050',   price: 220.00, stock: 14 },
      { value: '100ml', sku: 'LTF-YAR-100-V', price: 390.00, stock: 24 },
    ],
  },
  {
    sku: 'LTF-ASD-100',
    optionName: 'Size',
    variants: [
      { value: '30ml Decant', sku: 'LTF-ASD-030',   price: 150.00, stock: 12 },
      { value: '100ml',       sku: 'LTF-ASD-100-V', price: 410.00, stock: 20 },
    ],
  },
];

async function run() {
  let addedProducts = 0;
  let addedVariants = 0;

  for (const set of VARIANT_SETS) {
    const { rows: prodRows } = await pool.query(
      'SELECT id, name FROM products WHERE sku = $1',
      [set.sku]
    );
    if (prodRows.length === 0) {
      console.log(`  skip  ${set.sku} — product not found`);
      continue;
    }
    const product = prodRows[0];

    const { rows: existingVars } = await pool.query(
      'SELECT id FROM product_variants WHERE product_id = $1 LIMIT 1',
      [product.id]
    );
    if (existingVars.length > 0) {
      console.log(`  skip  ${set.sku} — already has variants`);
      continue;
    }

    const { rows: [optType] } = await pool.query(
      `INSERT INTO product_option_types (product_id, name, position)
       VALUES ($1, $2, 0) RETURNING id`,
      [product.id, set.optionName]
    );

    for (let i = 0; i < set.variants.length; i++) {
      const v = set.variants[i];
      const { rows: [optVal] } = await pool.query(
        `INSERT INTO product_option_values (option_type_id, product_id, value, position)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [optType.id, product.id, v.value, i]
      );

      const { rows: [variant] } = await pool.query(
        `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active, position)
         VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
        [product.id, v.sku, v.price, v.stock, i]
      );

      await pool.query(
        `INSERT INTO product_variant_option_values (variant_id, option_value_id)
         VALUES ($1, $2)`,
        [variant.id, optVal.id]
      );
      addedVariants++;
    }

    console.log(`  added ${set.variants.length} ${set.optionName} variants -> ${product.name}`);
    addedProducts++;
  }

  await pool.end();
  console.log(`\nDone. Added ${addedVariants} variants across ${addedProducts} products.`);
}

run().catch(err => {
  console.error('Variant seed failed:', err.message);
  process.exit(1);
});
