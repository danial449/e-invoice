import { query, queryOne, withTransaction } from '../db/pool'
import { reconcilePrices, round3, num } from '../../shared/calc'
import type { Category, Product, ProductInput, StockMovement } from '../../shared/types'

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`

export interface ProductListFilter {
  search?: string
  categoryId?: number | null
  /** include descendants of categoryId */
  includeChildren?: boolean
  stockFilter?: 'all' | 'low' | 'out' | 'in'
  activeOnly?: boolean
  sortBy?: 'name' | 'sku' | 'unit_price' | 'stock_qty' | 'updated_at'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export async function listProducts(
  f: ProductListFilter = {}
): Promise<{ rows: Product[]; total: number }> {
  const where: string[] = []
  const params: unknown[] = []

  if (f.activeOnly !== false) where.push('p.is_active = TRUE')

  if (f.search && f.search.trim()) {
    params.push(`%${f.search.trim().toLowerCase()}%`)
    const i = params.length
    where.push(
      `(lower(p.name) LIKE $${i} OR lower(coalesce(p.sku,'')) LIKE $${i} OR lower(p.size_text) LIKE $${i} OR lower(p.description) LIKE $${i})`
    )
  }

  if (f.categoryId) {
    if (f.includeChildren) {
      params.push(f.categoryId)
      where.push(`p.category_id IN (
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = $${params.length}
          UNION ALL
          SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
        ) SELECT id FROM tree
      )`)
    } else {
      params.push(f.categoryId)
      where.push(`p.category_id = $${params.length}`)
    }
  }

  switch (f.stockFilter) {
    // Unlimited-stock products have no quantity worth filtering on, so they
    // are never "low" or "out", and always count as available.
    case 'out':
      where.push('p.track_stock AND p.stock_qty <= 0')
      break
    case 'low':
      where.push('p.track_stock AND p.stock_qty > 0 AND p.reorder_level > 0 AND p.stock_qty <= p.reorder_level')
      break
    case 'in':
      where.push('(NOT p.track_stock OR p.stock_qty > 0)')
      break
    default:
      break
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const sortCol =
    ({
      name: 'p.name',
      sku: 'p.sku',
      unit_price: 'p.unit_price',
      stock_qty: 'p.stock_qty',
      updated_at: 'p.updated_at'
    } as Record<string, string>)[f.sortBy ?? 'name'] ?? 'p.name'
  const sortDir = f.sortDir === 'desc' ? 'DESC' : 'ASC'

  const countRow = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM products p ${whereSql}`,
    params
  )

  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000)
  const offset = Math.max(f.offset ?? 0, 0)
  params.push(limit, offset)

  const rows = await query<Product>(
    `${PRODUCT_SELECT} ${whereSql} ORDER BY ${sortCol} ${sortDir} NULLS LAST, p.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )

  return { rows, total: countRow?.n ?? 0 }
}

export async function getProduct(id: number): Promise<Product | null> {
  return queryOne<Product>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id])
}

/** Fast lookup used by the invoice product picker. */
export async function searchProducts(term: string, limit = 25): Promise<Product[]> {
  const t = `%${(term ?? '').trim().toLowerCase()}%`
  return query<Product>(
    `${PRODUCT_SELECT}
     WHERE p.is_active = TRUE
       AND (lower(p.name) LIKE $1 OR lower(coalesce(p.sku,'')) LIKE $1 OR lower(p.size_text) LIKE $1)
     ORDER BY
       CASE WHEN lower(p.name) LIKE $2 THEN 0 ELSE 1 END,
       p.name
     LIMIT $3`,
    [t, `${(term ?? '').trim().toLowerCase()}%`, limit]
  )
}

function normalizeInput(input: ProductInput): ProductInput {
  const pack_size = Math.max(1, Math.floor(num(input.pack_size, 1)))
  const prices = reconcilePrices({
    unit_price: num(input.unit_price),
    pack_price: num(input.pack_price),
    pack_size
  })
  return {
    ...input,
    name: (input.name ?? '').trim(),
    sku: input.sku && String(input.sku).trim() !== '' ? String(input.sku).trim() : null,
    pack_size,
    unit_price: prices.unit_price,
    pack_price: prices.pack_price,
    cost_price: num(input.cost_price),
    tax_rate: num(input.tax_rate),
    // Unlimited stock keeps no quantity at all, so zero it rather than leaving
    // a stale figure that would reappear if tracking is turned back on.
    track_stock: input.track_stock !== false,
    stock_qty: input.track_stock === false ? 0 : round3(num(input.stock_qty)),
    reorder_level: input.track_stock === false ? 0 : round3(num(input.reorder_level))
  }
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const p = normalizeInput(input)
  if (!p.name) throw new Error('Product name is required.')

  return withTransaction(async (client) => {
    const { rows } = await client.query<Product>(
      `INSERT INTO products
         (sku, name, description, category_id, size_text, material, color, unit,
          pack_size, unit_price, pack_price, cost_price, tax_rate, stock_qty, reorder_level,
          track_stock, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        p.sku, p.name, p.description ?? '', p.category_id, p.size_text ?? '', p.material ?? '',
        p.color ?? '', p.unit || 'pcs', p.pack_size, p.unit_price, p.pack_price, p.cost_price,
        p.tax_rate, p.stock_qty, p.reorder_level, p.track_stock !== false, p.is_active !== false
      ]
    )
    const created = rows[0]
    if (p.stock_qty !== 0 && p.track_stock !== false) {
      await client.query(
        `INSERT INTO stock_movements (product_id, change_qty, kind, reference, note)
         VALUES ($1,$2,'opening','', 'Opening stock on product creation')`,
        [created.id, p.stock_qty]
      )
    }
    return created
  })
}

export async function updateProduct(id: number, input: ProductInput): Promise<Product> {
  const p = normalizeInput(input)
  if (!p.name) throw new Error('Product name is required.')

  return withTransaction(async (client) => {
    const prev = await client.query<{ stock_qty: number }>(
      'SELECT stock_qty FROM products WHERE id = $1',
      [id]
    )
    if (prev.rowCount === 0) throw new Error('Product not found.')

    const { rows } = await client.query<Product>(
      `UPDATE products SET
         sku=$1, name=$2, description=$3, category_id=$4, size_text=$5, material=$6, color=$7,
         unit=$8, pack_size=$9, unit_price=$10, pack_price=$11, cost_price=$12, tax_rate=$13,
         stock_qty=$14, reorder_level=$15, track_stock=$16, is_active=$17, updated_at=now()
       WHERE id=$18 RETURNING *`,
      [
        p.sku, p.name, p.description ?? '', p.category_id, p.size_text ?? '', p.material ?? '',
        p.color ?? '', p.unit || 'pcs', p.pack_size, p.unit_price, p.pack_price, p.cost_price,
        p.tax_rate, p.stock_qty, p.reorder_level, p.track_stock !== false, p.is_active !== false, id
      ]
    )

    const delta = round3(p.stock_qty - num(prev.rows[0].stock_qty))
    if (delta !== 0 && p.track_stock !== false) {
      await client.query(
        `INSERT INTO stock_movements (product_id, change_qty, kind, reference, note)
         VALUES ($1,$2,'adjustment','','Stock edited on product form')`,
        [id, delta]
      )
    }
    return rows[0]
  })
}

export async function deleteProduct(id: number): Promise<{ deleted: boolean; deactivated: boolean }> {
  // Keep history intact: if the product appears on any invoice, deactivate instead.
  const used = await queryOne<{ n: number }>(
    'SELECT count(*)::int AS n FROM invoice_items WHERE product_id = $1',
    [id]
  )
  if ((used?.n ?? 0) > 0) {
    await query('UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = $1', [id])
    return { deleted: false, deactivated: true }
  }
  await query('DELETE FROM products WHERE id = $1', [id])
  return { deleted: true, deactivated: false }
}

export async function bulkDeleteProducts(ids: number[]): Promise<{ deleted: number; deactivated: number }> {
  let deleted = 0
  let deactivated = 0
  for (const id of ids) {
    const r = await deleteProduct(id)
    if (r.deleted) deleted++
    if (r.deactivated) deactivated++
  }
  return { deleted, deactivated }
}

export async function adjustStock(args: {
  productId: number
  changeQty: number
  kind: StockMovement['kind']
  reference?: string
  note?: string
}): Promise<Product> {
  const delta = round3(num(args.changeQty))
  if (delta === 0) throw new Error('Enter a non-zero quantity.')

  return withTransaction(async (client) => {
    const check = await client.query<{ track_stock: boolean; name: string }>(
      'SELECT track_stock, name FROM products WHERE id = $1',
      [args.productId]
    )
    if (check.rowCount === 0) throw new Error('Product not found.')
    if (check.rows[0].track_stock === false) {
      throw new Error(
        `"${check.rows[0].name}" is set to unlimited stock, so there is no quantity to adjust. ` +
          'Turn off unlimited stock on the product first.'
      )
    }

    const { rows } = await client.query<Product>(
      'UPDATE products SET stock_qty = stock_qty + $1, updated_at = now() WHERE id = $2 RETURNING *',
      [delta, args.productId]
    )
    if (rows.length === 0) throw new Error('Product not found.')
    await client.query(
      `INSERT INTO stock_movements (product_id, change_qty, kind, reference, note)
       VALUES ($1,$2,$3,$4,$5)`,
      [args.productId, delta, args.kind, args.reference ?? '', args.note ?? '']
    )
    return rows[0]
  })
}

export async function listStockMovements(productId?: number, limit = 200): Promise<StockMovement[]> {
  if (productId) {
    return query<StockMovement>(
      `SELECT m.*, p.name AS product_name FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.product_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
      [productId, limit]
    )
  }
  return query<StockMovement>(
    `SELECT m.*, p.name AS product_name FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     ORDER BY m.created_at DESC, m.id DESC LIMIT $1`,
    [limit]
  )
}

// ─────────────────────── Categories ───────────────────────

export async function listCategories(): Promise<Category[]> {
  return query<Category>('SELECT * FROM categories ORDER BY sort_order, name')
}

export function slugify(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'category'
}

export async function createCategory(name: string, parentId: number | null = null): Promise<Category> {
  const clean = (name ?? '').trim()
  if (!clean) throw new Error('Category name is required.')

  let slug = slugify(clean)
  const existing = await queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = $1', [slug])
  if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

  const row = await queryOne<Category>(
    'INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1,$2,$3, (SELECT coalesce(max(sort_order),0)+1 FROM categories)) RETURNING *',
    [clean, slug, parentId]
  )
  return row!
}

export async function updateCategory(id: number, name: string, parentId: number | null): Promise<Category> {
  if (id === parentId) throw new Error('A category cannot be its own parent.')
  const row = await queryOne<Category>(
    'UPDATE categories SET name = $1, parent_id = $2 WHERE id = $3 RETURNING *',
    [(name ?? '').trim(), parentId, id]
  )
  if (!row) throw new Error('Category not found.')
  return row
}

export async function deleteCategory(id: number): Promise<void> {
  await query('DELETE FROM categories WHERE id = $1', [id])
}

/**
 * Find-or-create, used by the CSV importer. Accepts "Parent > Child" paths.
 *
 * Resolution order, so imported sheets reuse the existing tree instead of
 * fragmenting it into near-duplicates:
 *   1. Match the whole path exactly, segment under segment.
 *   2. Otherwise, if the last segment names exactly one existing category
 *      anywhere in the tree, use that. This covers sheets that give a flat
 *      name ("Cake Boxes") or skip an intermediate level
 *      ("Boxes & Tins > Square Tin Boxes", where the real parent is "Tin Boxes").
 *   3. Otherwise create the missing segments.
 */
export async function ensureCategoryPath(pathText: string): Promise<number | null> {
  const parts = (pathText ?? '')
    .split(/[>/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  // ── 1. Strict path match ──
  let parentId: number | null = null
  let strictOk = true
  for (const part of parts) {
    const found: { id: number } | null = await queryOne<{ id: number }>(
      `SELECT id FROM categories
       WHERE lower(name) = lower($1) AND (parent_id IS NOT DISTINCT FROM $2) LIMIT 1`,
      [part, parentId]
    )
    if (!found) {
      strictOk = false
      break
    }
    parentId = found.id
  }
  if (strictOk) return parentId

  // ── 2. Unique leaf match anywhere ──
  const leaf = parts[parts.length - 1]
  const sameName = await query<{ id: number }>(
    'SELECT id FROM categories WHERE lower(name) = lower($1)',
    [leaf]
  )
  if (sameName.length === 1) return sameName[0].id

  // ── 3. Create what is missing ──
  parentId = null
  for (const part of parts) {
    const found: { id: number } | null = await queryOne<{ id: number }>(
      `SELECT id FROM categories
       WHERE lower(name) = lower($1) AND (parent_id IS NOT DISTINCT FROM $2) LIMIT 1`,
      [part, parentId]
    )
    if (found) {
      parentId = found.id
    } else {
      const created: Category = await createCategory(part, parentId)
      parentId = created.id
    }
  }
  return parentId
}
