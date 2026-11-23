import type { Pool } from 'pg'
import { TEMPLATE_PRESETS } from '../../shared/templatePresets'

/**
 * Category tree mirrored from packagingbox.pk's mega menu.
 * [slug, name, parentSlug | null]
 */
const CATEGORIES: [string, string, string | null][] = [
  // ── Top level ──
  ['food-packaging', 'Food Packaging', null],
  ['bakery-packaging', 'Bakery Packaging', null],
  ['pouches-bags', 'Pouches & Bags', null],
  ['boxes-tins', 'Boxes & Tins', null],
  ['disposables-eco', 'Disposables & ECO', null],
  ['plastic-products', 'Plastic Products', null],

  // ── Food ──
  ['kraft-food-boxes', 'Kraft Food Boxes', 'food-packaging'],
  ['kraft-bowls', 'Kraft Bowls', 'food-packaging'],
  ['burger-boxes', 'Burger Boxes', 'food-packaging'],
  ['pizza-box', 'Pizza Boxes', 'food-packaging'],
  ['sandwich-boxes', 'Sandwich Boxes', 'food-packaging'],
  ['fries-pockets', 'Fries Pockets', 'food-packaging'],
  ['kraft-trays', 'Kraft Trays', 'food-packaging'],
  ['dip-sauce-cups', 'Dip Sauce Cups', 'food-packaging'],
  ['egg-trays', 'Egg Trays', 'food-packaging'],
  ['aluminum-foil-container', 'Aluminium Foil Containers', 'food-packaging'],

  // ── Bakery ──
  ['cake-boxes', 'Cake Boxes', 'bakery-packaging'],
  ['brownie-boxes', 'Brownie Boxes', 'bakery-packaging'],
  ['cavity-choc-boxes', 'Cavity / Choc Boxes', 'bakery-packaging'],
  ['cake-boards', 'Cake Boards', 'bakery-packaging'],
  ['cake-drum-boards', 'Cake Drum Boards', 'bakery-packaging'],
  ['clear-lid-boxes', 'Clear Lid Boxes', 'bakery-packaging'],
  ['heart-shape-chocolate-box', 'Heart Choc Boxes', 'bakery-packaging'],
  ['custom-napkins', 'Custom Napkins', 'bakery-packaging'],

  // ── Pouches & bags ──
  ['kraft-standup-pouches', 'Kraft Standup Pouches', 'pouches-bags'],
  ['clear-standup-pouches', 'Clear Standup Pouches', 'pouches-bags'],
  ['foil-pouches', 'Foil Pouches', 'pouches-bags'],
  ['retort-pouches', 'Retort Pouches', 'pouches-bags'],
  ['spout-pouches', 'Spout Pouches', 'pouches-bags'],
  ['pickle-pouches', 'Pickle Pouches', 'pouches-bags'],
  ['golden-pouches', 'Golden Pouches', 'pouches-bags'],
  ['black-coffee-bags', 'Black Coffee Bags', 'pouches-bags'],
  ['kraft-paper-bags', 'Kraft Paper Bags', 'pouches-bags'],
  ['coffee-transparent-handle-bag', 'Coffee Handle Bags', 'pouches-bags'],

  // ── Boxes & tins ──
  ['corrugated-boxes', 'Corrugated Boxes', 'boxes-tins'],
  ['e-commerce-boxes', 'E-Commerce Boxes', 'boxes-tins'],
  ['tin-boxes', 'Tin Boxes', 'boxes-tins'],
  ['round-tin-boxes', 'Round Tin Boxes', 'tin-boxes'],
  ['square-tin-boxes', 'Square Tin Boxes', 'tin-boxes'],
  ['acrylic-boxes', 'Acrylic Boxes', 'boxes-tins'],
  ['home-shifting-boxes', 'Home Shifting Boxes', 'boxes-tins'],

  // ── Disposables & ECO ──
  ['eco-products', 'ECO Products', 'disposables-eco'],
  ['coffee-cups', 'Coffee Cups', 'disposables-eco'],
  ['disposable-glasses', 'Disposable Glasses', 'disposables-eco'],
  ['straws', 'Straws', 'disposables-eco'],
  ['ice-cream-cups', 'Ice Cream Cups', 'disposables-eco'],
  ['wooden-boat-trays', 'Wooden Boat Trays', 'disposables-eco'],
  ['eco-cutlery', 'Eco Cutlery', 'disposables-eco'],
  ['natural-loofah', 'Natural Loofah', 'disposables-eco'],
  ['zam-zam-packaging', 'Zam Zam Packaging', 'disposables-eco'],

  // ── Plastic ──
  ['hinged-deli-box', 'Hinged Deli Box', 'plastic-products'],
  ['round-plastic-jar', 'Plastic Jars', 'plastic-products'],
  ['salt-bottles', 'Salt Bottles', 'plastic-products'],
  ['coffee-cup-carrier', 'Cup Carriers', 'plastic-products']
]

const COMPANY_DEFAULTS = {
  name: 'Packaging Box Pakistan',
  address: 'P No 11- Ali Town, R-W- Road Lahore, 54000',
  city: 'Lahore',
  country: 'Pakistan',
  phone: '+92 327-419-2519',
  phone_alt: '+92 327-419-2523',
  email: 'info@packagingbox.pk',
  website: 'packagingbox.pk',
  bank_details: 'We Accept: Bank Transfer · Easypaisa · JazzCash · VISA · Mastercard',
  default_terms:
    '1. Prices are quoted in PKR and valid for 15 days.\n' +
    '2. Courier charges are adjusted based on parcel size, weight and delivery location.\n' +
    '3. Custom printed orders require 50% advance payment.\n' +
    '4. Goods once sold are not returnable unless defective.',
  default_notes: 'For bulk and wholesale pricing, please contact us on WhatsApp.',
  terms_url: 'https://packagingbox.pk/terms-and-conditions/'
}

export async function seedDefaults(pool: Pool): Promise<void> {
  // ── Templates ──
  const { rows: tplRows } = await pool.query<{ n: string }>('SELECT count(*)::int AS n FROM invoice_templates')
  if (Number(tplRows[0]?.n ?? 0) === 0) {
    for (let i = 0; i < TEMPLATE_PRESETS.length; i++) {
      const t = TEMPLATE_PRESETS[i]
      await pool.query(
        `INSERT INTO invoice_templates (name, base, is_default, config)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [t.name, t.name.toLowerCase().replace(/\s+/g, '-'), i === 0, JSON.stringify(t.config)]
      )
    }
  }

  // ── Categories ──
  const { rows: catRows } = await pool.query<{ n: string }>('SELECT count(*)::int AS n FROM categories')
  if (Number(catRows[0]?.n ?? 0) === 0) {
    const ids = new Map<string, number>()
    let order = 0
    // Two passes so parents always exist first.
    for (const [slug, name, parent] of CATEGORIES) {
      if (parent !== null) continue
      const r = await pool.query<{ id: number }>(
        'INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1,$2,NULL,$3) RETURNING id',
        [name, slug, order++]
      )
      ids.set(slug, r.rows[0].id)
    }
    for (const [slug, name, parent] of CATEGORIES) {
      if (parent === null) continue
      let parentId = ids.get(parent) ?? null
      if (parentId === null) {
        // Nested child whose parent is itself a child (e.g. tin-boxes) - resolve from DB.
        const p = await pool.query<{ id: number }>('SELECT id FROM categories WHERE slug = $1', [parent])
        parentId = p.rows[0]?.id ?? null
      }
      const r = await pool.query<{ id: number }>(
        'INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
        [name, slug, parentId, order++]
      )
      ids.set(slug, r.rows[0].id)
    }
  }

  // ── Company details (only fill in while still untouched) ──
  const { rows: coRows } = await pool.query<{ name: string; address: string }>(
    'SELECT name, address FROM company_settings WHERE id = 1'
  )
  const co = coRows[0]
  if (co && (!co.address || co.address.trim() === '')) {
    await pool.query(
      `UPDATE company_settings SET
         name = $1, address = $2, city = $3, country = $4, phone = $5, phone_alt = $6,
         email = $7, website = $8, bank_details = $9, default_terms = $10, default_notes = $11,
         terms_url = $12
       WHERE id = 1`,
      [
        COMPANY_DEFAULTS.name,
        COMPANY_DEFAULTS.address,
        COMPANY_DEFAULTS.city,
        COMPANY_DEFAULTS.country,
        COMPANY_DEFAULTS.phone,
        COMPANY_DEFAULTS.phone_alt,
        COMPANY_DEFAULTS.email,
        COMPANY_DEFAULTS.website,
        COMPANY_DEFAULTS.bank_details,
        COMPANY_DEFAULTS.default_terms,
        COMPANY_DEFAULTS.default_notes,
        COMPANY_DEFAULTS.terms_url
      ]
    )
  }

  // Existing installations predate terms_url, so fill it in once if it is blank.
  await pool.query(
    `UPDATE company_settings SET terms_url = $1 WHERE id = 1 AND coalesce(terms_url,'') = ''`,
    [COMPANY_DEFAULTS.terms_url]
  )
}
