import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { ProductListFilter } from '../lib/api'
import { ConfirmDialog, Empty, Modal, Spinner, useDebounced, useToast } from '../components/ui'
import { formatMoney, formatQty, reconcilePrices, num } from '@shared/calc'
import type { Category, CompanySettings, Product, ProductInput, StockMovement } from '@shared/types'
import type { NavProps } from '../App'

const PAGE_SIZE = 50

const EMPTY_PRODUCT: ProductInput = {
  sku: null,
  name: '',
  description: '',
  category_id: null,
  size_text: '',
  material: '',
  color: '',
  unit: 'pcs',
  pack_size: 1,
  unit_price: 0,
  pack_price: 0,
  cost_price: 0,
  tax_rate: 0,
  stock_qty: 0,
  reorder_level: 0,
  is_active: true
}

/** Flatten the category tree into indented options. */
function categoryOptions(cats: Category[]): { id: number; label: string }[] {
  const byParent = new Map<number | null, Category[]>()
  for (const c of cats) {
    const k = c.parent_id ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(c)
  }
  const out: { id: number; label: string }[] = []
  const walk = (parent: number | null, depth: number): void => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ id: c.id, label: `${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${c.name}` })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export default function Products({ navigate }: NavProps): React.JSX.Element {
  const toast = useToast()
  const [rows, setRows] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [cats, setCats] = useState<Category[]>([])
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'in'>('all')
  const [showInactive, setShowInactive] = useState(false)
  const [sortBy, setSortBy] = useState<ProductListFilter['sortBy']>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [editing, setEditing] = useState<{ product: Product | null } | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [historyFor, setHistoryFor] = useState<Product | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listProducts({
        search: debouncedSearch,
        categoryId,
        includeChildren: true,
        stockFilter,
        activeOnly: !showInactive,
        sortBy,
        sortDir,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      })
      setRows(res.rows)
      setTotal(res.total)
    } catch (err) {
      toast.error(err)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, categoryId, stockFilter, showInactive, sortBy, sortDir, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const [c, s] = await Promise.all([api.listCategories(), api.getSettings()])
        setCats(c)
        setCompany(s)
      } catch (err) {
        toast.error(err)
      }
    })()
  }, [toast])

  // Filter changes should always land back on the first page.
  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [debouncedSearch, categoryId, stockFilter, showInactive])

  const sym = company?.currency_symbol ?? 'Rs.'
  const catOpts = useMemo(() => categoryOptions(cats), [cats])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const sortHeader = (key: NonNullable<ProductListFilter['sortBy']>, label: string, cls = ''): React.JSX.Element => (
    <th
      className={`sortable ${cls}`}
      onClick={() => {
        if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        else {
          setSortBy(key)
          setSortDir('asc')
        }
      }}
    >
      {label} {sortBy === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )

  const toggleSel = (id: number): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const doDelete = async (): Promise<void> => {
    if (!deleting) return
    try {
      const r = await api.deleteProduct(deleting.id)
      toast.success(
        r.deactivated
          ? `"${deleting.name}" appears on invoices, so it was deactivated instead of deleted.`
          : `Deleted "${deleting.name}".`
      )
      setDeleting(null)
      void load()
    } catch (err) {
      toast.error(err)
    }
  }

  const doBulkDelete = async (): Promise<void> => {
    try {
      const r = await api.bulkDeleteProducts([...selected])
      toast.success(`${r.deleted} deleted, ${r.deactivated} deactivated.`)
      setSelected(new Set())
      void load()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Products</h1>
          <div className="sub">
            {total} {total === 1 ? 'product' : 'products'}
            {categoryId ? ' in this category' : ''}
          </div>
        </div>
        <div className="topbar-actions">
          <button onClick={() => navigate({ name: 'import' })}>⇪ Import CSV</button>
          <button
            onClick={async () => {
              try {
                const r = await api.exportProductsCsv()
                if (r.saved) toast.success(`Exported ${r.count ?? 0} products.`)
              } catch (err) {
                toast.error(err)
              }
            }}
          >
            ⇩ Export
          </button>
          <button className="btn-primary" onClick={() => setEditing({ product: null })}>
            ＋ Add Product
          </button>
        </div>
      </div>

      <div className="content">
        <div className="toolbar">
          <div className="grow">
            <input
              placeholder="Search by name, SKU or size…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? parseInt(e.target.value, 10) : null)}
          >
            <option value="">All categories</option>
            {catOpts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}>
            <option value="all">All stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span className="small">Show inactive</span>
          </label>
          {selected.size > 0 ? (
            <button className="btn-danger btn-sm" onClick={() => void doBulkDelete()}>
              Delete {selected.size} selected
            </button>
          ) : null}
        </div>

        {loading && rows.length === 0 ? (
          <Spinner label="Loading products…" />
        ) : rows.length === 0 ? (
          <div className="table-wrap">
            <Empty
              icon="▦"
              title={search || categoryId ? 'No products match these filters' : 'No products yet'}
              hint={
                search || categoryId
                  ? 'Try clearing the search or category filter.'
                  : 'Import your product list from a CSV file, or add products one at a time.'
              }
              action={
                <div className="flex gap8" style={{ justifyContent: 'center' }}>
                  <button onClick={() => navigate({ name: 'import' })}>⇪ Import CSV</button>
                  <button className="btn-primary" onClick={() => setEditing({ product: null })}>
                    ＋ Add Product
                  </button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input
                        type="checkbox"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                        }
                      />
                    </th>
                    {sortHeader('sku', 'SKU')}
                    {sortHeader('name', 'Product')}
                    <th>Category</th>
                    <th className="num">Pack</th>
                    {sortHeader('unit_price', 'Per piece', 'num')}
                    <th className="num">Per pack</th>
                    {sortHeader('stock_qty', 'Stock', 'num')}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const out = num(p.stock_qty) <= 0
                    const low = !out && num(p.reorder_level) > 0 && num(p.stock_qty) <= num(p.reorder_level)
                    return (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggleSel(p.id)}
                          />
                        </td>
                        <td className="xsmall muted nowrap">{p.sku ?? '—'}</td>
                        <td className="clickable" onClick={() => setEditing({ product: p })}>
                          <div className="strong">{p.name}</div>
                          {p.size_text || p.material || p.color ? (
                            <div className="xsmall muted">
                              {[p.size_text, p.material, p.color].filter(Boolean).join(' · ')}
                            </div>
                          ) : null}
                          {!p.is_active ? <span className="badge cancelled">inactive</span> : null}
                        </td>
                        <td className="small dim">{p.category_name ?? '—'}</td>
                        <td className="num small">{p.pack_size > 1 ? `${p.pack_size} pcs` : '—'}</td>
                        <td className="num nowrap">{formatMoney(p.unit_price, sym)}</td>
                        <td className="num nowrap dim">
                          {p.pack_size > 1 ? formatMoney(p.pack_price, sym) : '—'}
                        </td>
                        <td className="num nowrap">
                          <span className={`badge ${out ? 'out' : low ? 'low' : 'ok'}`}>
                            {formatQty(p.stock_qty)}
                          </span>
                        </td>
                        <td className="actions">
                          <button className="btn-ghost btn-xs" title="Adjust stock" onClick={() => setAdjusting(p)}>
                            ⇅
                          </button>
                          <button
                            className="btn-ghost btn-xs"
                            title="Stock history"
                            onClick={() => setHistoryFor(p)}
                          >
                            ◴
                          </button>
                          <button className="btn-ghost btn-xs" title="Edit" onClick={() => setEditing({ product: p })}>
                            ✎
                          </button>
                          <button className="btn-ghost btn-xs" title="Delete" onClick={() => setDeleting(p)}>
                            🗑
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {pages > 1 ? (
              <div className="pager">
                <button className="btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  ← Previous
                </button>
                <span>
                  Page {page + 1} of {pages}
                </span>
                <button className="btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {editing ? (
        <ProductEditor
          product={editing.product}
          categories={cats}
          currencySymbol={sym}
          onCategoriesChanged={async () => setCats(await api.listCategories())}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}

      {adjusting ? (
        <StockAdjuster
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null)
            void load()
          }}
        />
      ) : null}

      {historyFor ? <StockHistory product={historyFor} onClose={() => setHistoryFor(null)} /> : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete product"
          message={
            <>
              Delete <strong>{deleting.name}</strong>?
              <div className="small muted mt8">
                If this product appears on any invoice it will be deactivated instead, so past
                invoices stay intact.
              </div>
            </>
          }
          onConfirm={() => void doDelete()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  )
}

// ─────────────────────── Product editor ───────────────────────

function ProductEditor({
  product,
  categories,
  currencySymbol,
  onClose,
  onSaved,
  onCategoriesChanged
}: {
  product: Product | null
  categories: Category[]
  currencySymbol: string
  onClose: () => void
  onSaved: () => void
  onCategoriesChanged: () => Promise<void>
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<ProductInput>(() =>
    product
      ? {
          sku: product.sku,
          name: product.name,
          description: product.description,
          category_id: product.category_id,
          size_text: product.size_text,
          material: product.material,
          color: product.color,
          unit: product.unit,
          pack_size: product.pack_size,
          unit_price: product.unit_price,
          pack_price: product.pack_price,
          cost_price: product.cost_price,
          tax_rate: product.tax_rate,
          stock_qty: product.stock_qty,
          reorder_level: product.reorder_level,
          is_active: product.is_active
        }
      : { ...EMPTY_PRODUCT }
  )
  const [busy, setBusy] = useState(false)
  const [newCat, setNewCat] = useState('')

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]): void =>
    setForm((f) => ({ ...f, [k]: v }))

  const catOpts = useMemo(() => categoryOptions(categories), [categories])

  /** Editing one price side recomputes the other from pack size. */
  const setUnitPrice = (v: number): void => {
    const size = Math.max(1, Math.floor(num(form.pack_size, 1)))
    setForm((f) => ({ ...f, unit_price: v, pack_price: Math.round(v * size * 100) / 100 }))
  }
  const setPackPrice = (v: number): void => {
    const size = Math.max(1, Math.floor(num(form.pack_size, 1)))
    setForm((f) => ({ ...f, pack_price: v, unit_price: Math.round((v / size) * 100) / 100 }))
  }
  const setPackSize = (v: number): void => {
    const size = Math.max(1, Math.floor(v || 1))
    setForm((f) => {
      const rec = reconcilePrices({ unit_price: num(f.unit_price), pack_price: 0, pack_size: size })
      return { ...f, pack_size: size, pack_price: rec.pack_price }
    })
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('Product name is required.')
      return
    }
    setBusy(true)
    try {
      if (product) await api.updateProduct(product.id, form)
      else await api.createProduct(form)
      toast.success(product ? 'Product updated.' : 'Product added.')
      onSaved()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const addCategory = async (): Promise<void> => {
    const name = newCat.trim()
    if (!name) return
    try {
      const c = await api.createCategory(name, null)
      await onCategoriesChanged()
      set('category_id', c.id)
      setNewCat('')
      toast.success(`Category "${name}" created.`)
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Modal
      title={product ? `Edit: ${product.name}` : 'Add product'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <span className="spinner" /> : null} {product ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      <div className="row">
        <div className="field" style={{ flex: 3 }}>
          <label>Product name *</label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. 6x6x3 Inch Cake Box with Transparent Window"
            autoFocus
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>SKU / code</label>
          <input
            value={form.sku ?? ''}
            onChange={(e) => set('sku', e.target.value || null)}
            placeholder="CB-663"
          />
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>Category</label>
          <select
            value={form.category_id ?? ''}
            onChange={(e) => set('category_id', e.target.value ? parseInt(e.target.value, 10) : null)}
          >
            <option value="">Uncategorised</option>
            {catOpts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label>Or create a new category</label>
          <div className="flex gap8">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="New category name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addCategory()
                }
              }}
            />
            <button className="btn-sm" onClick={() => void addCategory()} disabled={!newCat.trim()}>
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Size / dimensions</label>
          <input value={form.size_text} onChange={(e) => set('size_text', e.target.value)} placeholder="6x6x3 inch" />
        </div>
        <div className="field">
          <label>Material</label>
          <input
            value={form.material}
            onChange={(e) => set('material', e.target.value)}
            placeholder="White Corrugated Board"
          />
        </div>
        <div className="field">
          <label>Colour</label>
          <input value={form.color} onChange={(e) => set('color', e.target.value)} placeholder="Kraft Brown" />
        </div>
      </div>

      <div className="card" style={{ background: 'var(--bg-3)', marginBottom: 14 }}>
        <h3 className="card-title">Pricing</h3>
        <div className="row">
          <div className="field">
            <label>Unit name</label>
            <input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs" />
          </div>
          <div className="field">
            <label>Pieces per pack</label>
            <input
              type="number"
              min={1}
              step={1}
              value={form.pack_size}
              onChange={(e) => setPackSize(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div className="field">
            <label>Price per piece ({currencySymbol})</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.unit_price}
              onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>Price per pack ({currencySymbol})</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.pack_price}
              onChange={(e) => setPackPrice(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="help">
          Enter either price — the other is calculated from the pack size. Your site quotes pack
          prices (e.g. Rs. 3,500 for 50 pcs), so set pack size to 50 and pack price to 3500.
        </div>

        <div className="row mt8">
          <div className="field">
            <label>Cost price per piece ({currencySymbol})</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.cost_price}
              onChange={(e) => set('cost_price', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>Tax rate (%)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.tax_rate}
              onChange={(e) => set('tax_rate', parseFloat(e.target.value) || 0)}
            />
            <div className="help">Used when an invoice has tax enabled.</div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Stock on hand (pieces)</label>
          <input
            type="number"
            step="0.001"
            value={form.stock_qty}
            onChange={(e) => set('stock_qty', parseFloat(e.target.value) || 0)}
          />
          {product ? <div className="help">Changing this records a stock adjustment.</div> : null}
        </div>
        <div className="field">
          <label>Reorder level (pieces)</label>
          <input
            type="number"
            step="0.001"
            value={form.reorder_level}
            onChange={(e) => set('reorder_level', parseFloat(e.target.value) || 0)}
          />
          <div className="help">Flagged as low stock at or below this.</div>
        </div>
      </div>

      <div className="field">
        <label>Description / notes</label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Optional detail shown on the invoice line"
        />
      </div>

      <label className="inline-check">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        <span>Active (available when creating invoices)</span>
      </label>
    </Modal>
  )
}

// ─────────────────────── Stock adjuster ───────────────────────

function StockAdjuster({
  product,
  onClose,
  onSaved
}: {
  product: Product
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [mode, setMode] = useState<'in' | 'out' | 'set'>('in')
  const [qty, setQty] = useState('')
  const [kind, setKind] = useState<StockMovement['kind']>('purchase')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const current = num(product.stock_qty)
  const entered = num(qty)
  const delta = mode === 'in' ? entered : mode === 'out' ? -entered : entered - current
  const resulting = mode === 'set' ? entered : current + delta

  const save = async (): Promise<void> => {
    if (delta === 0) {
      toast.error('Enter a quantity that changes the stock level.')
      return
    }
    setBusy(true)
    try {
      await api.adjustStock({
        productId: product.id,
        changeQty: delta,
        kind: mode === 'set' ? 'adjustment' : kind,
        note
      })
      toast.success(`Stock updated to ${formatQty(resulting)} ${product.unit}.`)
      onSaved()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Adjust stock: ${product.name}`}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            Apply
          </button>
        </>
      }
    >
      <div className="banner info">
        Current stock: <strong>{formatQty(current)}</strong> {product.unit}
        {product.pack_size > 1 ? ` (${product.pack_size} pcs per pack)` : ''}
      </div>

      <div className="field">
        <label>Action</label>
        <div className="seg">
          <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>
            Stock in
          </button>
          <button className={mode === 'out' ? 'on' : ''} onClick={() => setMode('out')}>
            Stock out
          </button>
          <button className={mode === 'set' ? 'on' : ''} onClick={() => setMode('set')}>
            Set exact
          </button>
        </div>
      </div>

      <div className="field">
        <label>{mode === 'set' ? 'New stock level (pieces)' : 'Quantity (pieces)'}</label>
        <input
          type="number"
          step="0.001"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && !busy && void save()}
        />
        {product.pack_size > 1 && entered > 0 && mode !== 'set' ? (
          <div className="help">
            = {formatQty(entered / product.pack_size)} packs of {product.pack_size}
          </div>
        ) : null}
      </div>

      {mode !== 'set' ? (
        <div className="field">
          <label>Reason</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as StockMovement['kind'])}>
            <option value="purchase">Purchase / stock received</option>
            <option value="return">Customer return</option>
            <option value="adjustment">Correction / wastage</option>
          </select>
        </div>
      ) : null}

      <div className="field">
        <label>Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PO-1042 from supplier" />
      </div>

      {entered !== 0 ? (
        <div className={`banner ${resulting < 0 ? 'warn' : 'ok'}`}>
          New stock level will be <strong>{formatQty(resulting)}</strong> {product.unit}
          {resulting < 0 ? ' — this will go negative.' : '.'}
        </div>
      ) : null}
    </Modal>
  )
}

// ─────────────────────── Stock history ───────────────────────

function StockHistory({ product, onClose }: { product: Product; onClose: () => void }): React.JSX.Element {
  const toast = useToast()
  const [rows, setRows] = useState<StockMovement[] | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setRows(await api.listMovements(product.id, 200))
      } catch (err) {
        toast.error(err)
        setRows([])
      }
    })()
  }, [product.id, toast])

  return (
    <Modal title={`Stock history: ${product.name}`} onClose={onClose}>
      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon="◴" title="No movements recorded" hint="Stock changes will appear here." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th className="num">Change</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="nowrap small">{new Date(m.created_at).toLocaleString()}</td>
                <td className="small">{m.kind}</td>
                <td className="num" style={{ color: num(m.change_qty) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                  {num(m.change_qty) >= 0 ? '+' : ''}
                  {formatQty(m.change_qty)}
                </td>
                <td className="small muted">{m.reference || m.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
