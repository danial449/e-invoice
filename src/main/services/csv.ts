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
  sku: ['sku', 'code', 'productcode', 'itemcode', 'id', 'productid', 'articleno', 'barcode'],
  name: ['name', 'productname', 'product', 'title', 'item', 'itemname', 'description1', 'producttitle'],
  description: ['description', 'desc', 'details', 'longdescription', 'shortdescription', 'notes'],
  category: ['category', 'categories', 'productcategory', 'cat', 'group', 'productcategories', 'type'],
  size_text: ['size', 'sizetext', 'dimension', 'dimensions', 'measurement', 'variation', 'variant'],
  material: ['material', 'materialtype', 'paper', 'stock'],
  color: ['color', 'colour'],
  unit: ['unit', 'uom', 'unitofmeasure', 'measure'],
  pack_size: ['packsize', 'pack', 'piecesperpack', 'qtyperpack', 'packqty', 'packingsize', 'pcsperpack', 'unitsperpack', 'perpack', 'packof'],
  unit_price: ['unitprice', 'priceperpiece', 'perpieceprice', 'pricepiece', 'rate', 'price', 'sellingprice', 'saleprice', 'regularprice', 'mrp', 'retailprice', 'pricepcs', 'perpcprice'],
  pack_price: ['packprice', 'pricepack', 'bulkprice', 'wholesaleprice', 'pricePerPack', 'packrate', 'cartonprice', 'boxprice'],
  cost_price: ['costprice', 'cost', 'purchaseprice', 'buyingprice', 'landedcost'],
  tax_rate: ['taxrate', 'tax', 'gst', 'vat', 'salestax', 'taxpercent'],
  stock_qty: ['stock', 'stockqty', 'quantity', 'qty', 'instock', 'onhand', 'available', 'inventory', 'stockquantity'],
  reorder_level: ['reorderlevel', 'reorder', 'minstock', 'minimumstock', 'lowstock', 'reorderpoint', 'threshold']
}

function normalizeHeader(h: string): string {
  return (h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function suggestMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {}
  const taken = new Set<CsvField>()

  // Exact alias matches first, so "price" does not steal the slot that
  // "unit price" should win.
  for (const pass of [0, 1]) {
    for (const header of headers) {
      if (mapping[header] && mapping[header] !== 'ignore') continue
      const n = normalizeHeader(header)
      let best: CsvField = 'ignore'

      for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Exclude<CsvField, 'ignore'>, string[]][]) {
        if (taken.has(field)) continue
        const hit = pass === 0 ? aliases.includes(n) : aliases.some((a) => n.includes(a) || a.includes(n))
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

export async function importProducts(filePath: string, options: ImportOptions): Promise<ImportResult> {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false
  })

  const dataRows = (parsed.data ?? []).filter(
    (r) => r && Object.values(r).some((v) => String(v ?? '').trim() !== '')
  )

  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, errors: [] }

  // Invert the mapping: field -> csv header.
  const fieldToHeader = new Map<CsvField, string>()
  for (const [header, field] of Object.entries(options.mapping)) {
    if (field && field !== 'ignore' && !fieldToHeader.has(field)) fieldToHeader.set(field, header)
  }

  const get = (row: Record<string, string>, field: CsvField): string => {
    const header = fieldToHeader.get(field)
    if (!header) return ''
    return String(row[header] ?? '').trim()
  }

  if (!fieldToHeader.has('name') && !fieldToHeader.has('sku')) {
    throw new Error('Map at least a Product Name or SKU column before importing.')
  }

  const categoryCache = new Map<string, number | null>()

  await withTransaction(async (client) => {
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNo = i + 2 // +1 for header, +1 for 1-based

      try {
        const name = get(row, 'name')
        const skuRaw = get(row, 'sku')
        const sku = skuRaw === '' ? null : skuRaw

        if (!name && !sku) {
          result.skipped++
          continue
        }

        // ── Category ──
        let categoryId: number | null = null
        const catText = get(row, 'category')
        if (catText) {
          if (categoryCache.has(catText)) {
            categoryId = categoryCache.get(catText)!
          } else if (options.createCategories) {
            categoryId = await ensureCategoryPath(catText)
            categoryCache.set(catText, categoryId)
          } else {
            const found = await client.query<{ id: number }>(
              'SELECT id FROM categories WHERE lower(name) = lower($1) LIMIT 1',
              [catText.split(/[>/|]/).pop()!.trim()]
            )
            categoryId = found.rows[0]?.id ?? null
            categoryCache.set(catText, categoryId)
          }
        }

        // ── Prices & pack size ──
        const packSize = fieldToHeader.has('pack_size')
          ? parseInt1(get(row, 'pack_size'), options.defaultPackSize)
          : Math.max(1, Math.floor(options.defaultPackSize || 1))

        let unitPrice = parseMoney(get(row, 'unit_price'))
        let packPrice = parseMoney(get(row, 'pack_price'))

        if (options.derivePrices) {
          const rec = reconcilePrices({ unit_price: unitPrice, pack_price: packPrice, pack_size: packSize })
          unitPrice = rec.unit_price
          packPrice = rec.pack_price
        }

        const values = {
          sku,
          name: name || sku || 'Unnamed product',
          description: get(row, 'description'),
          category_id: categoryId,
          size_text: get(row, 'size_text'),
          material: get(row, 'material'),
          color: get(row, 'color'),
          unit: get(row, 'unit') || 'pcs',
          pack_size: packSize,
          unit_price: unitPrice,
          pack_price: packPrice,
          cost_price: parseMoney(get(row, 'cost_price')),
          tax_rate: parseMoney(get(row, 'tax_rate')),
          stock_qty: round3(parseMoney(get(row, 'stock_qty'))),
          reorder_level: round3(parseMoney(get(row, 'reorder_level')))
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

          if (fieldToHeader.has('name') && name) push('name', values.name)
          if (fieldToHeader.has('sku')) push('sku', values.sku)
          if (fieldToHeader.has('description')) push('description', values.description)
          if (catText) push('category_id', values.category_id)
          if (fieldToHeader.has('size_text')) push('size_text', values.size_text)
          if (fieldToHeader.has('material')) push('material', values.material)
          if (fieldToHeader.has('color')) push('color', values.color)
          if (fieldToHeader.has('unit')) push('unit', values.unit)
          if (fieldToHeader.has('pack_size') || options.derivePrices) push('pack_size', values.pack_size)
          if (fieldToHeader.has('unit_price') || options.derivePrices) push('unit_price', values.unit_price)
          if (fieldToHeader.has('pack_price') || options.derivePrices) push('pack_price', values.pack_price)
          if (fieldToHeader.has('cost_price')) push('cost_price', values.cost_price)
          if (fieldToHeader.has('tax_rate')) push('tax_rate', values.tax_rate)
          if (fieldToHeader.has('reorder_level')) push('reorder_level', values.reorder_level)

          if (sets.length > 0) {
            params.push(existingId)
            await client.query(
              `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
              params
            )
          }

          // Stock is a movement, not an overwrite, so history stays truthful.
          if (fieldToHeader.has('stock_qty')) {
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
          }

          result.updated++
        } else {
          const ins = await client.query<{ id: number }>(
            `INSERT INTO products
               (sku, name, description, category_id, size_text, material, color, unit, pack_size,
                unit_price, pack_price, cost_price, tax_rate, stock_qty, reorder_level, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE)
             RETURNING id`,
            [
              values.sku, values.name, values.description, values.category_id, values.size_text,
              values.material, values.color, values.unit, values.pack_size, values.unit_price,
              values.pack_price, values.cost_price, values.tax_rate, values.stock_qty, values.reorder_level
            ]
          )
          if (values.stock_qty !== 0) {
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
