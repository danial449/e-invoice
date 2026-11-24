import fs from 'node:fs'
import Papa from 'papaparse'
import { withTransaction } from '../db/pool'
import { ensureCategoryPath } from './products'
import { reconcilePrices, round3, num } from '../../shared/calc'
import type { CsvField, CsvMapping, ImportOptions, ImportResult } from '../../shared/types'

export interface CsvPreview {
  headers: string[]
  rows: Record<string, string>[]
  totalRows: number
  suggestedMapping: CsvMapping
  delimiter: string
}

/** Header aliases, lower-cased and stripped of non-alphanumerics. */
const FIELD_ALIASES: Record<Exclude<CsvField, 'ignore'>, string[]> = {
  sku: ['sku', 'code', 'productcode', 'itemcode', 'articleno', 'barcode', 'gtinupceanisbn'],
  name: ['name', 'productname', 'product', 'title', 'item', 'itemname', 'description1', 'producttitle'],
  description: ['description', 'desc', 'details', 'longdescription', 'shortdescription', 'notes'],
  // NOTE: 'type' is deliberately absent — in a WooCommerce export that column
  // holds simple/variable/variation and must not be read as a category.
  category: ['category', 'categories', 'productcategory', 'cat', 'group', 'productcategories'],
  size_text: ['size', 'sizetext', 'dimension', 'dimensions', 'measurement', 'variation', 'variant'],
  material: ['material', 'materialtype', 'paper'],
  color: ['color', 'colour'],
  unit: ['unit', 'uom', 'unitofmeasure', 'measure'],
  pack_size: ['packsize', 'pack', 'piecesperpack', 'qtyperpack', 'packqty', 'packingsize', 'pcsperpack', 'unitsperpack', 'perpack', 'packof'],
  unit_price: ['unitprice', 'priceperpiece', 'perpieceprice', 'pricepiece', 'rate', 'price', 'sellingprice', 'regularprice', 'mrp', 'retailprice', 'pricepcs', 'perpcprice'],
  pack_price: ['packprice', 'pricepack', 'bulkprice', 'wholesaleprice', 'packrate', 'cartonprice', 'boxprice'],
  cost_price: ['costprice', 'cost', 'purchaseprice', 'buyingprice', 'landedcost'],
  tax_rate: ['taxrate', 'tax', 'gst', 'vat', 'salestax', 'taxpercent'],
  stock_qty: ['stock', 'stockqty', 'quantity', 'qty', 'instock', 'onhand', 'available', 'inventory', 'stockquantity'],
  reorder_level: ['reorderlevel', 'reorder', 'minstock', 'minimumstock', 'lowstock', 'lowstockamount', 'reorderpoint', 'threshold'],

  // ── WooCommerce / WordPress export columns ──
  wc_type: ['type', 'producttype'],
  wc_id: ['id', 'productid', 'postid'],
  wc_parent: ['parent', 'parentid', 'parentsku', 'parentproduct'],
  in_stock: ['isinstock', 'stockstatus'],
  sale_price: ['saleprice', 'discountprice', 'specialprice'],
  published: ['published', 'status', 'poststatus'],
  weight: ['weight', 'weightkg', 'weightg'],
  length: ['length', 'lengthcm'],
  width: ['width', 'widthcm'],
  height: ['height', 'heightcm']
}

/**
 * Fields that must only ever be matched by an exact header name. Loose
 * substring matching turns "Regular price" into `sale_price` and "Stock"
 * into `in_stock`, which silently corrupts a WooCommerce import.
 */
/**
 * WooCommerce exports around forty columns. These carry no product data this
 * app can use, and several of them look like fields they are not — "Tax
 * status" holds `taxable`, not a rate, and "Attribute 1 name" would otherwise
 * be matched as the product name.
 */
const NEVER_MATCH: RegExp[] = [
  /^taxstatus$/, /^taxclass$/,
  /^isfeatured$/, /^visibilityincatalogu?e?$/, /^soldindividually$/,
  /^backordersallowed$/, /^allowcustomerreviews$/, /^purchasenote$/,
  /^images?$/, /^tags$/, /^shippingclass$/, /^position$/,
  /^download(limit|expirydays)$/, /^groupedproducts$/, /^upsells$/, /^crosssells$/,
  /^external(url)?$/, /^buttontext$/, /^datesaleprice(starts|ends)$/,
  /^attribute\d+/, /^meta/
]

const EXACT_ONLY: Set<CsvField> = new Set([
  'wc_type', 'wc_id', 'wc_parent', 'in_stock', 'sale_price', 'published',
  'weight', 'length', 'width', 'height'
])

/**
 * WooCommerce writes a fixed set of column names. Matching them exactly, before
 * any alias guessing, removes ambiguity that stripping punctuation would create
 * — "In stock?" and "In Stock" both normalise to `instock`, but in a
 * WooCommerce file the first is a yes/no flag and the second does not exist,
 * while in a hand-made sheet "In Stock" is a quantity.
 */
const WOOCOMMERCE_HEADERS: Record<string, CsvField> = {
  'id': 'wc_id',
  'type': 'wc_type',
  'parent': 'wc_parent',
  'sku': 'sku',
  'name': 'name',
  'published': 'published',
  'in stock?': 'in_stock',
  'stock': 'stock_qty',
  'low stock amount': 'reorder_level',
  'regular price': 'unit_price',
  'sale price': 'sale_price',
  'categories': 'category',
  'short description': 'description',
  'weight (kg)': 'weight',
  'length (cm)': 'length',
  'width (cm)': 'width',
  'height (cm)': 'height'
}

/** True when the sheet is recognisably a WooCommerce product export. */
function looksLikeWooCommerce(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()))
  const hasType = set.has('type')
  return hasType && (set.has('parent') || set.has('regular price') || set.has('in stock?'))
}

function normalizeHeader(h: string): string {
  return (h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function suggestMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {}
  const taken = new Set<CsvField>()

  // A WooCommerce export is matched by exact column name, which is both more
  // accurate and immune to two different columns normalising to the same text.
  if (looksLikeWooCommerce(headers)) {
    for (const header of headers) {
      const field = WOOCOMMERCE_HEADERS[header.trim().toLowerCase()]
      if (field && !taken.has(field)) {
        mapping[header] = field
        taken.add(field)
      }
    }
  }

  // Exact alias matches first, so "price" does not steal the slot that
  // "unit price" should win.
  for (const pass of [0, 1]) {
    for (const header of headers) {
      if (mapping[header] && mapping[header] !== 'ignore') continue
      const n = normalizeHeader(header)
      if (NEVER_MATCH.some((re) => re.test(n))) {
        mapping[header] = 'ignore'
        continue
      }
      let best: CsvField = 'ignore'

      for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Exclude<CsvField, 'ignore'>, string[]][]) {
        if (taken.has(field)) continue
        const hit =
          pass === 0
            ? aliases.includes(n)
            : EXACT_ONLY.has(field)
              ? false
              : aliases.some((a) => n.includes(a) || a.includes(n))
        if (hit) {
          best = field
          break
        }
      }

      if (best !== 'ignore') {
        mapping[header] = best
        taken.add(best)
      } else if (pass === 1) {
        mapping[header] = 'ignore'
      }
    }
  }

  for (const header of headers) if (!mapping[header]) mapping[header] = 'ignore'
  return mapping
}

export function previewCsv(filePath: string, sampleSize = 20): CsvPreview {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false
  })

  const headers = (parsed.meta.fields ?? []).filter((h) => h !== undefined && h !== null)
  const rows = (parsed.data ?? []).filter((r) => r && Object.values(r).some((v) => String(v ?? '').trim() !== ''))

  return {
    headers,
    rows: rows.slice(0, sampleSize),
    totalRows: rows.length,
    suggestedMapping: suggestMapping(headers),
    delimiter: parsed.meta.delimiter ?? ','
  }
}

/** Strip currency symbols, thousands separators and stray text: "₨ 3,500" -> 3500 */
function parseMoney(v: unknown): number {
  if (v === null || v === undefined) return 0
  const s = String(v).trim()
  if (s === '') return 0
  // Keep the last numeric run so "Rs 3,500 - Rs 32,000" yields the first value.
  const match = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return match ? num(match[0]) : 0
}

function parseInt1(v: unknown, fallback = 1): number {
  const n = Math.floor(parseMoney(v))
  return n > 0 ? n : fallback
}

// ─────────────────── WooCommerce helpers ───────────────────

type Row = Record<string, string>

/** `Attribute 1 name` / `Attribute 1 value(s)` column pairs, in order. */
interface AttrColumn {
  index: number
  nameHeader: string
  valueHeader: string
}

function findAttributeColumns(headers: string[]): AttrColumn[] {
  const names = new Map<number, string>()
  const values = new Map<number, string>()

  for (const h of headers) {
    const n = /^attribute\s*(\d+)\s*name$/i.exec(h.trim())
    if (n) names.set(parseInt(n[1], 10), h)
    const v = /^attribute\s*(\d+)\s*value\(?s?\)?$/i.exec(h.trim())
    if (v) values.set(parseInt(v[1], 10), h)
  }

  return [...names.keys()]
    .filter((i) => values.has(i))
    .sort((a, b) => a - b)
    .map((i) => ({ index: i, nameHeader: names.get(i)!, valueHeader: values.get(i)! }))
}

/** The attribute name/value pairs actually filled in on one row. */
function readAttributes(row: Row, cols: AttrColumn[]): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const c of cols) {
    const name = String(row[c.nameHeader] ?? '').trim()
    const value = String(row[c.valueHeader] ?? '').trim()
    // A variable parent lists every option ("Red | Blue"); only a variation
    // pins one down, and only a single value is useful in a product name.
    if (!value || value.includes('|')) continue
    out.push({ name, value })
  }
  return out
}

type WcType = 'simple' | 'variable' | 'variation' | 'grouped' | 'external' | ''

function normalizeWcType(v: string): WcType {
  const t = v.trim().toLowerCase()
  if (t.startsWith('variable')) return 'variable'
  if (t.startsWith('variation')) return 'variation'
  if (t.startsWith('simple')) return 'simple'
  if (t.startsWith('grouped')) return 'grouped'
  if (t.startsWith('external') || t.startsWith('affiliate')) return 'external'
  return ''
}

/** WooCommerce writes `id:123` for a variation's parent, or the parent SKU. */
function parentKeys(parentRaw: string): string[] {
  const p = parentRaw.trim()
  if (!p) return []
  const m = /^id:\s*(\d+)$/i.exec(p)
  return m ? [`id:${m[1]}`] : [`sku:${p}`, `id:${p}`]
}

/** "1" / "yes" / "true" / "publish" are all truthy in a WordPress export. */
function isTruthy(v: string): boolean {
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'yes' || s === 'true' || s === 'y' || s === 'instock' || s === 'publish'
}

function isFalsy(v: string): boolean {
  const s = v.trim().toLowerCase()
  return s === '0' || s === 'no' || s === 'false' || s === 'n' || s === 'outofstock'
}

/** Compose "30 x 20 x 10 cm" from separate dimension columns. */
function composeDimensions(l: string, w: string, h: string): string {
  const parts = [l, w, h].map((x) => String(x ?? '').trim()).filter((x) => x !== '' && parseMoney(x) > 0)
  return parts.length >= 2 ? `${parts.join(' x ')} cm` : ''
}

export async function importProducts(filePath: string, options: ImportOptions): Promise<ImportResult> {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')
  const parsed = Papa.parse<Row>(raw, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false
  })

  const headers = (parsed.meta.fields ?? []).filter((h) => h !== undefined && h !== null)
  const dataRows = (parsed.data ?? []).filter(
    (r) => r && Object.values(r).some((v) => String(v ?? '').trim() !== '')
  )

  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, errors: [] }

  // Invert the mapping: field -> csv header.
  const fieldToHeader = new Map<CsvField, string>()
  for (const [header, field] of Object.entries(options.mapping)) {
    if (field && field !== 'ignore' && !fieldToHeader.has(field)) fieldToHeader.set(field, header)
  }

  const read = (row: Row, field: CsvField): string => {
    const header = fieldToHeader.get(field)
    if (!header) return ''
    return String(row[header] ?? '').trim()
  }

  if (!fieldToHeader.has('name') && !fieldToHeader.has('sku')) {
    throw new Error('Map at least a Product Name or SKU column before importing.')
  }

  // ── WooCommerce shape ──
  const attrCols = findAttributeColumns(headers)
  const isWoo = fieldToHeader.has('wc_type') || fieldToHeader.has('wc_parent') || attrCols.length > 0
  const unknownStock = options.unknownStock ?? 'unlimited'
  const nameFromAttrs = options.nameVariationsFromAttributes !== false

  const wc = { detected: isWoo, simple: 0, variations: 0, variableParents: 0, other: 0, parentsSkipped: 0 }
  let unlimitedCount = 0

  const rowType = (row: Row): WcType => normalizeWcType(read(row, 'wc_type'))

  // Index rows so a variation can borrow from its parent, and so a parent
  // knows whether any variations of it are present in this file.
  const rowsByKey = new Map<string, Row>()
  const childCount = new Map<string, number>()

  if (isWoo) {
    for (const row of dataRows) {
      const id = read(row, 'wc_id')
      const sku = read(row, 'sku')
      if (id) rowsByKey.set(`id:${id}`, row)
      if (sku) rowsByKey.set(`sku:${sku}`, row)
    }
    for (const row of dataRows) {
      if (rowType(row) !== 'variation') continue
      for (const key of parentKeys(read(row, 'wc_parent'))) {
        if (rowsByKey.has(key)) {
          childCount.set(key, (childCount.get(key) ?? 0) + 1)
          break
        }
      }
    }
  }

  const findParent = (row: Row): Row | undefined => {
    for (const key of parentKeys(read(row, 'wc_parent'))) {
      const hit = rowsByKey.get(key)
      if (hit) return hit
    }
    return undefined
  }

  const hasVariations = (row: Row): boolean => {
    const id = read(row, 'wc_id')
    const sku = read(row, 'sku')
    return (
      (id ? (childCount.get(`id:${id}`) ?? 0) : 0) + (sku ? (childCount.get(`sku:${sku}`) ?? 0) : 0) > 0
    )
  }

  const categoryCache = new Map<string, number | null>()

  await withTransaction(async (client) => {
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNo = i + 2 // +1 for header, +1 for 1-based

      try {
        const type = rowType(row)
        const parentRow = type === 'variation' ? findParent(row) : undefined

        // Reading a field from the row, falling back to the parent product —
        // WooCommerce leaves description, category and image blank on a
        // variation because it inherits them.
        const get = (field: CsvField): string => {
          const own = read(row, field)
          if (own !== '') return own
          return parentRow ? read(parentRow, field) : ''
        }

        // ── Which rows become products ──
        if (type === 'variable') {
          wc.variableParents++
          // The sellable items are the variations; importing the container as
          // well would create a priceless, stockless duplicate. A parent whose
          // variations are missing from the file is kept, or it would vanish.
          if (options.variableParents !== 'import' && hasVariations(row)) {
            wc.parentsSkipped++
            result.skipped++
            continue
          }
        } else if (type === 'variation') {
          wc.variations++
        } else if (type === 'simple') {
          wc.simple++
        } else if (type !== '') {
          wc.other++
        }

        const skuRaw = read(row, 'sku')
        const sku = skuRaw === '' ? null : skuRaw

        // ── Name, with the variation's own attributes appended ──
        let name = read(row, 'name') || (parentRow ? read(parentRow, 'name') : '')
        const attrs = isWoo ? readAttributes(row, attrCols) : []

        if (type === 'variation' && nameFromAttrs && attrs.length > 0) {
          const suffix = attrs.map((a) => a.value).filter(Boolean).join(', ')
          if (suffix && !name.toLowerCase().includes(suffix.toLowerCase())) {
            name = name ? `${name} - ${suffix}` : suffix
          }
        }

        if (!name && !sku) {
          result.skipped++
          continue
        }

        // ── Category ──
        let categoryId: number | null = null
        const catText = get('category')
        if (catText) {
          // WooCommerce separates several categories with commas; the first is
          // the one to file the product under.
          const primary = catText.split(',')[0].trim() || catText
          if (categoryCache.has(primary)) {
            categoryId = categoryCache.get(primary)!
          } else if (options.createCategories) {
            categoryId = await ensureCategoryPath(primary)
            categoryCache.set(primary, categoryId)
          } else {
            const found = await client.query<{ id: number }>(
              'SELECT id FROM categories WHERE lower(name) = lower($1) LIMIT 1',
              [primary.split(/[>/|]/).pop()!.trim()]
            )
            categoryId = found.rows[0]?.id ?? null
            categoryCache.set(primary, categoryId)
          }
        }

        // ── Prices & pack size ──
        const packSize = fieldToHeader.has('pack_size')
          ? parseInt1(get('pack_size'), options.defaultPackSize)
          : Math.max(1, Math.floor(options.defaultPackSize || 1))

        let unitPrice = parseMoney(get('unit_price'))
        let packPrice = parseMoney(get('pack_price'))

        // A sale price is what the customer actually pays, so it wins.
        const salePrice = parseMoney(read(row, 'sale_price'))
        if (salePrice > 0) unitPrice = salePrice

        if (options.derivePrices) {
          const rec = reconcilePrices({ unit_price: unitPrice, pack_price: packPrice, pack_size: packSize })
          unitPrice = rec.unit_price
          packPrice = rec.pack_price
        }

        // ── Size / colour / material, from attributes then dimensions ──
        let sizeText = get('size_text')
        let color = get('color')
        let material = get('material')

        for (const a of attrs) {
          const an = normalizeHeader(a.name)
          if (!sizeText && /(size|dimension|length|inch|cm|mm)/.test(an)) sizeText = a.value
          else if (!color && /colou?r/.test(an)) color = a.value
          else if (!material && /(material|paper|board|finish)/.test(an)) material = a.value
        }

        if (!sizeText) {
          sizeText = composeDimensions(read(row, 'length'), read(row, 'width'), read(row, 'height'))
        }

        // ── Stock ──
        // WooCommerce leaves Stock blank when stock management is off, which
        // means "always available", not "none left".
        const stockRaw = get('stock_qty')
        const inStockRaw = read(row, 'in_stock')
        const stockGiven = stockRaw !== '' && /\d/.test(stockRaw)
        const stockValue = stockGiven ? round3(parseMoney(stockRaw)) : 0

        let trackStock = true
        let stockQty = stockValue

        if (unknownStock === 'unlimited-if-zero' && (!stockGiven || stockValue === 0)) {
          // The user has said they do not keep a count for these, so an
          // out-of-stock flag is not treated as a quantity of zero.
          trackStock = false
          stockQty = 0
        } else if (!stockGiven) {
          // No figure at all. WooCommerce leaves Stock blank when stock
          // management is off, which means always available — unless it also
          // says the product is out of stock, which is a real zero.
          trackStock = unknownStock === 'zero' || isFalsy(inStockRaw)
          stockQty = 0
        }

        if (!trackStock) unlimitedCount++

        // ── Published / active ──
        const publishedRaw = read(row, 'published')
        const isActive = publishedRaw === '' ? true : !(isFalsy(publishedRaw) || /^-1$/.test(publishedRaw.trim()))

        const values = {
          sku,
          name: name || sku || 'Unnamed product',
          description: get('description'),
          category_id: categoryId,
          size_text: sizeText,
          material,
          color,
          unit: get('unit') || 'pcs',
          pack_size: packSize,
          unit_price: unitPrice,
          pack_price: packPrice,
          cost_price: parseMoney(get('cost_price')),
          tax_rate: parseMoney(get('tax_rate')),
          stock_qty: stockQty,
          reorder_level: round3(parseMoney(get('reorder_level'))),
          track_stock: trackStock,
          is_active: isActive
        }

        // ── Find an existing product ──
        let existingId: number | null = null
        if (options.matchBy === 'sku' && sku) {
          const f = await client.query<{ id: number }>('SELECT id FROM products WHERE sku = $1', [sku])
          existingId = f.rows[0]?.id ?? null
        } else if (values.name) {
          const f = await client.query<{ id: number }>(
            'SELECT id FROM products WHERE lower(name) = lower($1) LIMIT 1',
            [values.name]
          )
          existingId = f.rows[0]?.id ?? null
        }

        if (existingId !== null) {
          if (options.onDuplicate === 'skip') {
            result.skipped++
            continue
          }
          // Only overwrite columns the sheet actually provides.
          const sets: string[] = []
          const params: unknown[] = []
          const push = (col: string, val: unknown): void => {
            params.push(val)
            sets.push(`${col} = $${params.length}`)
          }

          if (name) push('name', values.name)
          if (fieldToHeader.has('sku')) push('sku', values.sku)
          if (values.description) push('description', values.description)
          if (catText) push('category_id', values.category_id)
          if (values.size_text) push('size_text', values.size_text)
          if (values.material) push('material', values.material)
          if (values.color) push('color', values.color)
          if (fieldToHeader.has('unit')) push('unit', values.unit)
          if (fieldToHeader.has('pack_size') || options.derivePrices) push('pack_size', values.pack_size)
          if (fieldToHeader.has('unit_price') || fieldToHeader.has('sale_price') || options.derivePrices) {
            push('unit_price', values.unit_price)
          }
          if (fieldToHeader.has('pack_price') || options.derivePrices) push('pack_price', values.pack_price)
          if (fieldToHeader.has('cost_price')) push('cost_price', values.cost_price)
          if (fieldToHeader.has('tax_rate')) push('tax_rate', values.tax_rate)
          if (fieldToHeader.has('reorder_level')) push('reorder_level', values.reorder_level)
          if (fieldToHeader.has('published')) push('is_active', values.is_active)
          if (fieldToHeader.has('stock_qty') || fieldToHeader.has('in_stock')) {
            push('track_stock', values.track_stock)
          }

          if (sets.length > 0) {
            params.push(existingId)
            await client.query(
              `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
              params
            )
          }

          // Stock is a movement, not an overwrite, so history stays truthful.
          // An unlimited product has no quantity to move.
          if ((fieldToHeader.has('stock_qty') || fieldToHeader.has('in_stock')) && values.track_stock) {
            const cur = await client.query<{ stock_qty: number }>(
              'SELECT stock_qty FROM products WHERE id = $1',
              [existingId]
            )
            const delta = round3(values.stock_qty - num(cur.rows[0]?.stock_qty))
            if (delta !== 0) {
              await client.query('UPDATE products SET stock_qty = $1 WHERE id = $2', [values.stock_qty, existingId])
              await client.query(
                `INSERT INTO stock_movements (product_id, change_qty, kind, reference, note)
                 VALUES ($1,$2,'import',$3,'Stock set by CSV import')`,
                [existingId, delta, `row ${rowNo}`]
              )
            }
          } else if (!values.track_stock) {
            await client.query('UPDATE products SET stock_qty = 0 WHERE id = $1', [existingId])
          }

          result.updated++
        } else {
          const ins = await client.query<{ id: number }>(
            `INSERT INTO products
               (sku, name, description, category_id, size_text, material, color, unit, pack_size,
                unit_price, pack_price, cost_price, tax_rate, stock_qty, reorder_level,
                track_stock, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING id`,
            [
              values.sku, values.name, values.description, values.category_id, values.size_text,
              values.material, values.color, values.unit, values.pack_size, values.unit_price,
              values.pack_price, values.cost_price, values.tax_rate, values.stock_qty,
              values.reorder_level, values.track_stock, values.is_active
            ]
          )
          if (values.stock_qty !== 0 && values.track_stock) {
            await client.query(
              `INSERT INTO stock_movements (product_id, change_qty, kind, reference, note)
               VALUES ($1,$2,'import',$3,'Opening stock from CSV import')`,
              [ins.rows[0].id, values.stock_qty, `row ${rowNo}`]
            )
          }
          result.inserted++
        }
      } catch (err) {
        result.errors.push({ row: rowNo, message: err instanceof Error ? err.message : String(err) })
        // Abort if the sheet is systematically broken rather than filling the log.
        if (result.errors.length > 200) {
          throw new Error(
            `Import aborted after 200 errors. First error (row ${result.errors[0].row}): ${result.errors[0].message}`
          )
        }
      }
    }
  })

  if (isWoo) result.woocommerce = wc
  if (unlimitedCount > 0) result.unlimitedStock = unlimitedCount
  return result
}

/** A ready-to-fill CSV so the user knows exactly which columns are understood. */
export function sampleCsv(): string {
  const headers = [
    'SKU', 'Product Name', 'Category', 'Size', 'Material', 'Color', 'Unit',
    'Pack Size', 'Unit Price', 'Pack Price', 'Cost Price', 'Tax Rate', 'Stock Qty', 'Reorder Level'
  ]
  const rows = [
    ['CB-663', '6x6x3 Inch Cake Box with Transparent Window', 'Bakery Packaging > Cake Boxes', '6x6x3 inch', 'White Corrugated Board', 'White', 'pcs', '50', '70', '3500', '55', '0', '500', '100'],
    ['CB-1003', '10x10x3 inch Cake Box', 'Bakery Packaging > Cake Boxes', '10x10x3 inch', 'White Corrugated Board', 'White', 'pcs', '50', '100', '5000', '78', '0', '300', '100'],
    ['PZ-KRAFT', 'Kraft Pizza Box', 'Food Packaging > Pizza Boxes', '12 inch', 'Kraft Corrugated', 'Kraft Brown', 'pcs', '100', '75', '7500', '60', '0', '400', '150'],
    ['PCH-BLK-2613', 'Black Stand Up Pouch With Valve (26x13cm)', 'Pouches & Bags > Kraft Standup Pouches', '26x13 cm', 'Foil Laminate', 'Black', 'pcs', '100', '100', '10000', '82', '0', '250', '100'],
    ['TIN-SQ-BLUE', 'Blue Square Tin Boxes', 'Boxes & Tins > Square Tin Boxes', 'Square', 'Tinplate', 'Blue', 'pcs', '50', '300', '15000', '240', '0', '80', '25']
  ]
  return [headers, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
}
