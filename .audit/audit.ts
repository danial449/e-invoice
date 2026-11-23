/* eslint-disable no-console */
/**
 * Full feature audit. Drives the real service code against a scratch database,
 * which is created and dropped by this script. The live `e-invoice` database is
 * never touched.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Pool } from 'pg'

import { connect, disconnect, query, queryOne } from '../src/main/db/pool'
import * as products from '../src/main/services/products'
import * as customers from '../src/main/services/customers'
import * as invoices from '../src/main/services/invoices'
import * as templates from '../src/main/services/templates'
import * as settings from '../src/main/services/settings'
import * as reports from '../src/main/services/reports'
import * as csv from '../src/main/services/csv'
import { renderInvoiceHtml } from '../src/shared/renderInvoice'
import {
  amountInWords, computeTotals, formatMoney, formatQty, lineNet, linePieces,
  reconcilePrices, round2, derivePaymentStatus
} from '../src/shared/calc'
import { TEMPLATE_PRESETS } from '../src/shared/templatePresets'
import type { DbConfig, InvoiceItem, ProductInput, CustomerInput } from '../src/shared/types'

const CFG: DbConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: 'e_invoice_audit',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? '',
  ssl: false
}

if (!CFG.password) {
  console.error(
    [
      'Set PGPASSWORD (and optionally PGHOST / PGPORT / PGUSER) before running this.',
      '  PowerShell:  $env:PGPASSWORD = "yourpassword"; npm run audit',
      '  bash:        PGPASSWORD=yourpassword npm run audit'
    ].join(String.fromCharCode(10))
  )
  process.exit(2)
}

// ─────────────────── tiny test harness ───────────────────
type Row = { status: 'PASS' | 'FAIL'; group: string; name: string; detail?: string }
const rows: Row[] = []
let group = ''
const g = (n: string): void => { group = n; console.log(`\n── ${n} ──`) }

async function check(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await fn()
    rows.push({ status: 'PASS', group, name })
    console.log(`  PASS  ${name}`)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    rows.push({ status: 'FAIL', group, name, detail })
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

function ok(c: unknown, msg: string): void { if (!c) throw new Error(msg) }
function eq<T>(a: T, b: T, msg = ''): void {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function near(a: number, b: number, msg = '', eps = 0.011): void {
  if (Math.abs(a - b) > eps) throw new Error(`${msg} expected ~${b}, got ${a}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-audit-'))
const item = (p: Partial<InvoiceItem>): InvoiceItem => ({
  product_id: null, name: 'Item', description: '', uom: 'pcs', pack_size: 1,
  qty: 1, unit_price: 0, discount_pct: 0, tax_rate: 0, line_total: 0, sort_order: 0, ...p
} as InvoiceItem)

const blankProduct = (p: Partial<ProductInput>): ProductInput => ({
  sku: null, name: 'P', description: '', category_id: null, size_text: '', material: '',
  color: '', unit: 'pcs', pack_size: 1, unit_price: 0, pack_price: 0, cost_price: 0,
  tax_rate: 0, stock_qty: 0, reorder_level: 0, is_active: true, ...p
})

const blankCustomer = (p: Partial<CustomerInput>): CustomerInput => ({
  name: 'C', company: '', phone: '', email: '', address: '', city: '', ntn: '',
  strn: '', notes: '', is_active: true, ...p
})

async function main(): Promise<void> {
  // ── scratch database ──
  const admin = new Pool({ ...CFG, database: 'postgres' })
  const q = '"' + CFG.database.replace(/"/g, '""') + '"'
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [CFG.database]
  )
  await admin.query(`DROP DATABASE IF EXISTS ${q}`)

  // ═══════════ 1. Connection, schema, seed ═══════════
  g('Database bootstrap')
  await check('connect() creates the database, applies schema and seeds', async () => {
    await connect(CFG)
    const t = await query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public'"
    )
    eq(t.length, 10, 'table count')
  })
  await check('54 categories seeded', async () => {
    const r = await queryOne<{ n: number }>('select count(*)::int n from categories')
    eq(r!.n, 54)
  })
  await check('6 invoice templates seeded', async () => {
    const r = await queryOne<{ n: number }>('select count(*)::int n from invoice_templates')
    eq(r!.n, 6)
  })
  await check('connect() is idempotent (re-running keeps one seed set)', async () => {
    await connect(CFG)
    const r = await queryOne<{ n: number }>('select count(*)::int n from categories')
    eq(r!.n, 54, 'categories after reconnect')
  })
  await check('bad password does not drop the working connection', async () => {
    try {
      await connect({ ...CFG, password: 'definitely-wrong' })
      throw new Error('connect() should have thrown')
    } catch (e) {
      if (/should have thrown/.test(String(e))) throw e
    }
    const r = await queryOne<{ n: number }>('select count(*)::int n from categories')
    eq(r!.n, 54, 'still connected after a failed reconnect')
  })

  // ═══════════ 2. Pure calculation ═══════════
  g('Money & quantity maths (shared/calc.ts)')
  await check('round2 handles binary drift (1.005 -> 1.01)', () => eq(round2(1.005), 1.01))
  await check('lineNet applies the line discount', () =>
    near(lineNet(item({ qty: 10, unit_price: 70, discount_pct: 10 })), 630))
  await check('linePieces multiplies packs by pack size', () =>
    eq(linePieces(item({ qty: 3, uom: 'pack', pack_size: 50 })), 150))
  await check('linePieces leaves pieces alone', () =>
    eq(linePieces(item({ qty: 7, uom: 'pcs', pack_size: 50 })), 7))
  await check('subtotal, percent discount, tax, shipping, round-off', () => {
    const t = computeTotals({
      discount_type: 'percent', discount_value: 10, tax_enabled: true,
      shipping: 200, round_off: -0.5, paid_amount: 0,
      items: [item({ qty: 10, unit_price: 100, tax_rate: 17 })]
    } as never)
    near(t.subtotal, 1000, 'subtotal')
    near(t.discountAmount, 100, 'discount')
    near(t.taxableBase, 900, 'taxable base')
    near(t.taxAmount, 153, 'tax on the discounted base')
    near(t.total, 900 + 153 + 200 - 0.5, 'total')
  })
  await check('header discount is apportioned across differing tax rates', () => {
    const t = computeTotals({
      discount_type: 'amount', discount_value: 100, tax_enabled: true,
      shipping: 0, round_off: 0, paid_amount: 0,
      items: [item({ qty: 1, unit_price: 500, tax_rate: 17 }), item({ qty: 1, unit_price: 500, tax_rate: 0 })]
    } as never)
    near(t.taxAmount, 500 * 0.9 * 0.17, 'only the taxed line is taxed, on its discounted share')
  })
  await check('amount discount cannot exceed the subtotal', () => {
    const t = computeTotals({
      discount_type: 'amount', discount_value: 99999, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, items: [item({ qty: 1, unit_price: 100 })]
    } as never)
    near(t.discountAmount, 100, 'clamped to subtotal')
    near(t.total, 0, 'total')
  })
  await check('percent discount above 100 does not make the total negative', () => {
    const t = computeTotals({
      discount_type: 'percent', discount_value: 150, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, items: [item({ qty: 1, unit_price: 100 })]
    } as never)
    ok(t.total >= 0, `total went negative: ${t.total}`)
  })
  await check('amountInWords uses crore / lakh', () =>
    eq(amountInWords(12345678), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight Only'))
  await check('amountInWords includes paisa', () =>
    eq(amountInWords(1500.75), 'Rupees One Thousand Five Hundred and Seventy Five Paisa Only'))
  await check('amountInWords of zero', () => eq(amountInWords(0), 'Rupees Zero Only'))
  await check('formatMoney groups thousands', () => eq(formatMoney(1234567.5), 'Rs. 1,234,567.50'))
  await check('formatQty trims trailing zeros', () => eq(formatQty(2.5), '2.5'))
  await check('formatQty keeps integers clean', () => eq(formatQty(150), '150'))
  await check('reconcilePrices derives pack price from unit price', () =>
    eq(reconcilePrices({ unit_price: 70, pack_price: 0, pack_size: 50 }).pack_price, 3500))
  await check('reconcilePrices derives unit price from pack price', () =>
    eq(reconcilePrices({ unit_price: 0, pack_price: 3500, pack_size: 50 }).unit_price, 70))
  await check('derivePaymentStatus: partial then paid', () => {
    eq(derivePaymentStatus('issued', 1000, 400), 'partial')
    eq(derivePaymentStatus('issued', 1000, 1000), 'paid')
    eq(derivePaymentStatus('draft', 1000, 1000), 'draft')
    eq(derivePaymentStatus('cancelled', 1000, 1000), 'cancelled')
  })

  // ═══════════ 3. Settings ═══════════
  g('Company settings')
  let numbering = { prefix: 'INV-', pad: 4 }
  await check('read company settings', async () => {
    const s = await settings.getCompanySettings()
    ok(s.name.length > 0, 'company name seeded')
    numbering = { prefix: s.invoice_prefix, pad: s.invoice_pad }
  })
  await check('update and read back', async () => {
    const s = await settings.updateCompanySettings({ city: 'Lahore', phone: '+92 300 1234567' })
    eq(s.city, 'Lahore')
    eq((await settings.getCompanySettings()).phone, '+92 300 1234567')
  })
  await check('invoice number formatting pads correctly', () =>
    eq(settings.formatInvoiceNo('INV-', 7, 4), 'INV-0007'))
  await check('peekNextInvoiceNo does not consume a number', async () => {
    const a = await settings.peekNextInvoiceNo()
    const b = await settings.peekNextInvoiceNo()
    eq(a, b)
  })

  // ═══════════ 4. Categories ═══════════
  g('Categories')
  let catId = 0
  await check('list returns the seeded tree', async () => {
    const c = await products.listCategories()
    eq(c.length, 54)
    ok(c.some((x) => x.parent_id !== null), 'tree has children')
  })
  await check('create a category', async () => {
    const c = await products.createCategory('Audit Boxes', null)
    catId = c.id
    eq(c.name, 'Audit Boxes')
    ok(c.slug.length > 0, 'slug generated')
  })
  await check('create a nested path with ensureCategoryPath', async () => {
    const id = await products.ensureCategoryPath('Bakery Packaging > Audit Sub')
    ok(id !== null, 'returned an id')
    const all = await products.listCategories()
    const made = all.find((c) => c.id === id)
    ok(made!.parent_id !== null, 'child was parented')
  })
  await check('a flat existing name matches instead of duplicating', async () => {
    const before = (await products.listCategories()).length
    const id = await products.ensureCategoryPath('Cake Boxes')
    const after = (await products.listCategories()).length
    eq(after, before, 'no new category created')
    ok(id !== null, 'matched the existing one')
  })
  await check('rename a category', async () => {
    const c = await products.updateCategory(catId, 'Audit Boxes Renamed', null)
    eq(c.name, 'Audit Boxes Renamed')
  })

  // ═══════════ 5. Products ═══════════
  g('Products & stock')
  let pid = 0, pid2 = 0
  await check('create with dual pricing', async () => {
    const p = await products.createProduct(blankProduct({
      sku: 'AUD-001', name: 'Audit Cake Box 6x6x3', category_id: catId,
      pack_size: 50, unit_price: 70, pack_price: 0, stock_qty: 500, reorder_level: 100, tax_rate: 17
    }))
    pid = p.id
    eq(Number(p.unit_price), 70)
    eq(Number(p.pack_price), 3500, 'pack price derived from unit price')
  })
  await check('create deriving unit price from pack price', async () => {
    const p = await products.createProduct(blankProduct({
      sku: 'AUD-002', name: 'Audit Burger Box', pack_size: 100,
      unit_price: 0, pack_price: 2500, stock_qty: 1000, reorder_level: 50
    }))
    pid2 = p.id
    eq(Number(p.unit_price), 25, 'unit price derived')
  })
  await check('duplicate SKU is rejected', async () => {
    try {
      await products.createProduct(blankProduct({ sku: 'AUD-001', name: 'Clash' }))
      throw new Error('duplicate SKU was accepted')
    } catch (e) {
      ok(!/was accepted/.test(String(e)), 'should reject duplicate SKU')
    }
  })
  await check('get by id', async () => eq((await products.getProduct(pid))!.sku, 'AUD-001'))
  await check('update a product', async () => {
    const p = await products.updateProduct(pid, blankProduct({
      sku: 'AUD-001', name: 'Audit Cake Box 6x6x3', category_id: catId,
      pack_size: 50, unit_price: 80, pack_price: 4000, stock_qty: 500, reorder_level: 100, tax_rate: 17
    }))
    eq(Number(p.unit_price), 80)
  })
  await check('search by name', async () => {
    const r = await products.searchProducts('Audit Cake')
    ok(r.some((p) => p.id === pid), 'found by name')
  })
  await check('search by SKU', async () => {
    const r = await products.searchProducts('AUD-002')
    ok(r.some((p) => p.id === pid2), 'found by sku')
  })
  await check('list filtered by category', async () => {
    const r = await products.listProducts({ categoryId: catId })
    ok(r.rows.every((p) => p.category_id === catId), 'all in category')
    ok(r.rows.length >= 1, 'found some')
  })
  await check('list sorted by price descending', async () => {
    const r = await products.listProducts({ sortBy: 'unit_price', sortDir: 'desc' })
    const prices = r.rows.map((p) => Number(p.unit_price))
    ok(prices.every((v, i) => i === 0 || prices[i - 1] >= v), 'descending order')
  })
  await check('adjustStock records a movement and moves the quantity', async () => {
    const before = Number((await products.getProduct(pid))!.stock_qty)
    await products.adjustStock({ productId: pid, changeQty: 100, kind: 'purchase', note: 'audit' })
    eq(Number((await products.getProduct(pid))!.stock_qty), before + 100)
    const mv = await products.listStockMovements(pid)
    ok(mv.some((m) => m.kind === 'purchase' && Number(m.change_qty) === 100), 'movement logged')
  })
  await check('low-stock filter finds products at or under the reorder level', async () => {
    const low = await products.createProduct(blankProduct({
      sku: 'AUD-LOW', name: 'Audit Low Stock', stock_qty: 5, reorder_level: 50, unit_price: 10
    }))
    const r = await products.listProducts({ stockFilter: 'low' })
    ok(r.rows.some((p) => p.id === low.id), 'low stock product listed')
  })
  await check('out-of-stock filter', async () => {
    const zero = await products.createProduct(blankProduct({
      sku: 'AUD-ZERO', name: 'Audit Zero Stock', stock_qty: 0, unit_price: 10
    }))
    const r = await products.listProducts({ stockFilter: 'out' })
    ok(r.rows.some((p) => p.id === zero.id), 'zero stock product listed')
  })

  // ═══════════ 6. Customers ═══════════
  g('Customers')
  let cid = 0
  await check('create', async () => {
    const c = await customers.createCustomer(blankCustomer({
      name: 'Audit Customer', company: 'Audit Foods', phone: '+92 300 9999999', city: 'Karachi'
    }))
    cid = c.id
    eq(c.company, 'Audit Foods')
  })
  await check('search by company', async () => {
    const r = await customers.listCustomers('Audit Foods')
    ok(r.some((c) => c.id === cid), 'found')
  })
  await check('update', async () => {
    const c = await customers.updateCustomer(cid, blankCustomer({
      name: 'Audit Customer', company: 'Audit Foods Pvt Ltd', city: 'Karachi'
    }))
    eq(c.company, 'Audit Foods Pvt Ltd')
  })
  await check('ledger starts empty', async () => {
    const l = await customers.customerLedger(cid)
    eq(l.invoiceCount, 0)
  })

  // ═══════════ 7. Invoices ═══════════
  g('Invoices, numbering & stock sync')
  let draftId = 0, issuedId = 0
  const stockOf = async (id: number): Promise<number> =>
    Number((await products.getProduct(id))!.stock_qty)

  await check('a draft gets a temporary number and does not touch stock', async () => {
    const before = await stockOf(pid)
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-10', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'draft', notes: '', terms: '',
      items: [item({ product_id: pid, name: 'Audit Cake Box', qty: 10, unit_price: 80 })]
    } as never)
    draftId = inv.id
    ok(inv.invoice_no.startsWith('DRAFT-'), `expected a DRAFT number, got ${inv.invoice_no}`)
    eq(await stockOf(pid), before, 'stock unchanged by a draft')
  })

  await check('issuing allocates a real number and deducts stock', async () => {
    const before = await stockOf(pid)
    const inv = await invoices.setInvoiceStatus(draftId, 'issued')
    ok(inv.invoice_no.startsWith(numbering.prefix), `expected ${numbering.prefix}…, got ${inv.invoice_no}`)
    eq(await stockOf(pid), before - 10, 'ten pieces deducted')
  })

  await check('cancelling returns the stock', async () => {
    const before = await stockOf(pid)
    await invoices.setInvoiceStatus(draftId, 'cancelled')
    eq(await stockOf(pid), before + 10, 'stock returned')
  })

  await check('re-issuing deducts again, exactly once', async () => {
    const before = await stockOf(pid)
    await invoices.setInvoiceStatus(draftId, 'issued')
    eq(await stockOf(pid), before - 10)
  })

  await check('pack lines deduct pack_size x qty pieces', async () => {
    const before = await stockOf(pid2)
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-11', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
      items: [item({ product_id: pid2, name: 'Audit Burger Box', uom: 'pack', pack_size: 100, qty: 3, unit_price: 2500 })]
    } as never)
    issuedId = inv.id
    eq(await stockOf(pid2), before - 300, '3 packs of 100 = 300 pieces')
  })

  await check('editing an issued invoice re-syncs stock rather than double counting', async () => {
    const before = await stockOf(pid2)   // already reduced by 300
    const cur = await invoices.getInvoice(issuedId)
    await invoices.saveInvoice({
      ...cur!, id: issuedId,
      items: [item({ product_id: pid2, name: 'Audit Burger Box', uom: 'pack', pack_size: 100, qty: 1, unit_price: 2500 })]
    } as never)
    eq(await stockOf(pid2), before + 200, 'going 3 packs -> 1 pack gives 200 pieces back')
  })

  await check('invoice numbers are unique and sequential', async () => {
    const made: string[] = []
    for (let i = 0; i < 3; i++) {
      const inv = await invoices.saveInvoice({
        invoice_date: '2026-01-12', due_date: null, customer_id: cid, template_id: null,
        po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
        shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
        items: [item({ name: 'Custom line', qty: 1, unit_price: 100 })]
      } as never)
      made.push(inv.invoice_no)
    }
    eq(new Set(made).size, 3, 'all distinct')
  })

  await check('custom lines without a product save fine and touch no stock', async () => {
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-13', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
      items: [item({ name: 'Design charges', description: 'One-off artwork', qty: 1, unit_price: 5000 })]
    } as never)
    eq(inv.items.length, 1)
    eq(inv.items[0].product_id, null)
    near(Number(inv.total), 5000)
  })

  await check('customer details are snapshotted onto the invoice', async () => {
    const inv = await invoices.getInvoice(issuedId)
    const snap = inv!.customer_snapshot as Record<string, unknown>
    eq(String(snap.company), 'Audit Foods Pvt Ltd')
    await customers.updateCustomer(cid, blankCustomer({ name: 'Audit Customer', company: 'RENAMED LATER' }))
    const again = await invoices.getInvoice(issuedId)
    eq(String((again!.customer_snapshot as Record<string, unknown>).company), 'Audit Foods Pvt Ltd',
      'historical invoice must not change when the customer is renamed')
  })

  await check('totals are recomputed server-side, not trusted from the client', async () => {
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-14', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'draft', notes: '', terms: '',
      subtotal: 999999, total: 999999,
      items: [item({ name: 'Ten at ten', qty: 10, unit_price: 10 })]
    } as never)
    near(Number(inv.total), 100, 'server recomputed the total')
  })

  await check('an invoice with no lines is rejected', async () => {
    try {
      await invoices.saveInvoice({
        invoice_date: '2026-01-15', due_date: null, customer_id: cid, template_id: null,
        po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
        shipping: 0, round_off: 0, paid_amount: 0, status: 'draft', notes: '', terms: '', items: []
      } as never)
      throw new Error('empty invoice was accepted')
    } catch (e) {
      ok(!/was accepted/.test(String(e)), 'should reject an empty invoice')
    }
  })

  await check('duplicate creates a fresh draft with the same lines', async () => {
    const dup = await invoices.duplicateInvoice(issuedId)
    eq(dup.status, 'draft')
    ok(dup.invoice_no.startsWith('DRAFT-'), 'duplicate is a draft')
    eq(dup.items.length, (await invoices.getInvoice(issuedId))!.items.length)
    near(Number(dup.paid_amount), 0, 'payments are not copied')
  })

  await check('list filters by status and search', async () => {
    const all = await invoices.listInvoices({ status: 'issued' })
    ok(all.rows.length > 0, 'issued invoices found')
    ok(all.rows.every((r) => r.status === 'issued'), 'only issued')
    const byNo = await invoices.listInvoices({ search: all.rows[0].invoice_no })
    ok(byNo.rows.some((r) => r.id === all.rows[0].id), 'search by number works')
  })

  await check('list filters by date range', async () => {
    const r = await invoices.listInvoices({ dateFrom: '2026-01-13', dateTo: '2026-01-13' })
    ok(r.rows.every((x) => String(x.invoice_date).slice(0, 10) === '2026-01-13'), 'range respected')
  })

  // ── payments ──
  g('Payments')
  let payInvId = 0
  await check('partial payment sets status to partial', async () => {
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-16', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
      items: [item({ name: 'Payment test', qty: 1, unit_price: 1000 })]
    } as never)
    payInvId = inv.id
    const after = await invoices.addPayment({
      invoiceId: payInvId, amount: 400, method: 'cash', paidOn: '2026-01-16'
    })
    eq(after.status, 'partial')
    near(Number(after.paid_amount), 400)
  })
  await check('settling the balance sets status to paid', async () => {
    const after = await invoices.addPayment({
      invoiceId: payInvId, amount: 600, method: 'bank', paidOn: '2026-01-17'
    })
    eq(after.status, 'paid')
    near(Number(after.paid_amount), 1000)
  })
  await check('payments are listed with their method', async () => {
    const ps = await invoices.listPayments(payInvId)
    eq(ps.length, 2)
    ok(ps.some((p) => p.method === 'bank'), 'method stored')
  })
  await check('deleting a payment reverts the status', async () => {
    const ps = await invoices.listPayments(payInvId)
    await invoices.deletePayment(ps[1].id)
    const inv = await invoices.getInvoice(payInvId)
    eq(inv!.status, 'partial')
    near(Number(inv!.paid_amount), 400)
  })
  await check('a zero or negative payment is rejected', async () => {
    try {
      await invoices.addPayment({ invoiceId: payInvId, amount: 0, method: 'cash', paidOn: '2026-01-18' })
      throw new Error('zero payment accepted')
    } catch (e) {
      ok(!/accepted/.test(String(e)), 'should reject')
    }
  })
  await check('paying a draft issues it and consumes stock', async () => {
    const before = await stockOf(pid)
    const d = await invoices.saveInvoice({
      invoice_date: '2026-01-19', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'draft', notes: '', terms: '',
      items: [item({ product_id: pid, name: 'Audit Cake Box', qty: 5, unit_price: 80 })]
    } as never)
    const after = await invoices.addPayment({
      invoiceId: d.id, amount: 100, method: 'cash', paidOn: '2026-01-19'
    })
    ok(!after.invoice_no.startsWith('DRAFT-'), 'got a real number')
    eq(after.status, 'partial')
    eq(await stockOf(pid), before - 5, 'stock consumed')
  })
  await check('customer ledger reflects billed vs paid', async () => {
    const l = await customers.customerLedger(cid)
    ok(l.invoiceCount > 0, 'invoices counted')
    ok(l.totalBilled > 0, 'billed')
    near(l.outstanding, l.totalBilled - l.totalPaid, 'outstanding = billed - paid')
  })
  await check('deleting an invoice returns its stock', async () => {
    const before = await stockOf(pid)
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-20', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
      items: [item({ product_id: pid, name: 'Audit Cake Box', qty: 7, unit_price: 80 })]
    } as never)
    eq(await stockOf(pid), before - 7, 'deducted')
    await invoices.deleteInvoice(inv.id)
    eq(await stockOf(pid), before, 'returned on delete')
  })

  // ═══════════ 8. Templates ═══════════
  g('Invoice templates')
  let tplId = 0
  await check('list and default', async () => {
    const list = await templates.listTemplates()
    eq(list.length, 6)
    const def = await templates.getDefaultTemplate()
    ok(def.id > 0, 'a default exists')
  })
  await check('create from a preset config', async () => {
    const t = await templates.createTemplate('Audit Template', TEMPLATE_PRESETS[0].config)
    tplId = t.id
    eq(t.name, 'Audit Template')
  })
  await check('update name and config', async () => {
    const t = await templates.updateTemplate(tplId, { name: 'Audit Template v2' })
    eq(t.name, 'Audit Template v2')
  })
  await check('duplicate', async () => {
    const d = await templates.duplicateTemplate(tplId)
    ok(d.id !== tplId, 'new row')
    await templates.deleteTemplate(d.id)
  })
  await check('set as default', async () => {
    await templates.setDefaultTemplate(tplId)
    eq((await templates.getDefaultTemplate()).id, tplId)
  })
  await check('restorePresets puts the six back', async () => {
    const n = await templates.restorePresets()
    ok(n >= 0, 'ran')
    const list = await templates.listTemplates()
    ok(list.length >= 6, 'presets present')
  })

  // ═══════════ 9. Rendering ═══════════
  g('Invoice rendering (shared/renderInvoice.ts)')
  await check('every preset renders to HTML', async () => {
    const inv = await invoices.getInvoice(payInvId)
    const company = await settings.getCompanySettings()
    for (const preset of TEMPLATE_PRESETS) {
      const html = renderInvoiceHtml({ invoice: inv!, company, config: preset.config, mode: 'screen' })
      ok(html.includes('<html') || html.includes('<!DOCTYPE'), `${preset.name} produced a document`)
      ok(html.length > 500, `${preset.name} produced real output`)
    }
  })
  await check('interpolated values are HTML-escaped', async () => {
    const evil = await customers.createCustomer(blankCustomer({
      name: '<script>alert(1)</script>', company: '"><img src=x onerror=alert(1)>'
    }))
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-01-21', due_date: null, customer_id: evil.id, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'draft', notes: '', terms: '',
      items: [item({ name: '<b>bold</b>', qty: 1, unit_price: 1 })]
    } as never)
    const company = await settings.getCompanySettings()
    const html = renderInvoiceHtml({
      invoice: inv, company, config: TEMPLATE_PRESETS[0].config, mode: 'screen'
    })
    ok(!html.includes('<script>alert(1)</script>'), 'script tag was escaped')
    ok(!html.includes('<img src=x'), 'img tag was escaped, so no attribute can fire')
    ok(!/<b>bold<\/b>/.test(html), 'item name markup was escaped')
  })
  await check('amount in words appears when enabled', async () => {
    const inv = await invoices.getInvoice(payInvId)
    const company = await settings.getCompanySettings()
    const cfg = JSON.parse(JSON.stringify(TEMPLATE_PRESETS[0].config))
    cfg.totals.showAmountInWords = true
    const html = renderInvoiceHtml({ invoice: inv!, company, config: cfg, mode: 'screen' })
    ok(/Rupees/i.test(html), 'words rendered')
  })

  // ═══════════ 10. CSV ═══════════
  g('CSV import / export')
  const csvPath = path.join(tmp, 'products.csv')
  await check('sampleCsv produces a parsable file', () => {
    const text = csv.sampleCsv()
    fs.writeFileSync(path.join(tmp, 'sample.csv'), text, 'utf8')
    const p = csv.previewCsv(path.join(tmp, 'sample.csv'))
    ok(p.headers.length > 3, 'headers parsed')
    ok(p.totalRows > 0, 'rows parsed')
  })
  await check('headers are auto-matched to fields', () => {
    fs.writeFileSync(csvPath,
      'Item Code,Product Title,Qty Per Pack,Price Per Piece,In Stock,Category\n' +
      'AUD-CSV-1,CSV Kraft Box,25,"₨ 3,500",120,Audit CSV Cat\n' +
      'AUD-CSV-2,CSV Pouch,10,"Rs. 1,250.50",40,"Bakery Packaging > CSV Sub"\n',
      'utf8')
    const p = csv.previewCsv(csvPath)
    const m = p.suggestedMapping as Record<string, string>
    eq(m['Item Code'], 'sku')
    eq(m['Product Title'], 'name')
    eq(m['Qty Per Pack'], 'pack_size')
    eq(m['Price Per Piece'], 'unit_price')
    eq(m['In Stock'], 'stock_qty')
  })
  await check('import creates products, cleaning currency text', async () => {
    const p = csv.previewCsv(csvPath)
    const r = await csv.importProducts(csvPath, {
      mapping: p.suggestedMapping, matchBy: 'sku', onDuplicate: 'update',
      createCategories: true, derivePrices: true, defaultPackSize: 1
    })
    eq(r.inserted, 2, `inserted (errors: ${JSON.stringify(r.errors ?? [])})`)
    const made = (await products.listProducts({ search: 'CSV Kraft Box' })).rows[0]
    near(Number(made.unit_price), 3500, 'currency symbols and commas stripped')
  })
  await check('nested category path was created', async () => {
    const cats = await products.listCategories()
    const sub = cats.find((c) => c.name === 'CSV Sub')
    ok(!!sub, 'CSV Sub created')
    ok(sub!.parent_id !== null, 'parented under Bakery Packaging')
  })
  await check('re-importing with "skip" leaves existing rows alone', async () => {
    const p = csv.previewCsv(csvPath)
    const r = await csv.importProducts(csvPath, {
      mapping: p.suggestedMapping, matchBy: 'sku', onDuplicate: 'skip',
      createCategories: false, derivePrices: true, defaultPackSize: 1
    })
    eq(r.inserted, 0, 'nothing inserted')
    ok(r.skipped >= 2, `skipped ${r.skipped}`)
  })
  await check('re-importing with "update" refreshes them', async () => {
    const p = csv.previewCsv(csvPath)
    const r = await csv.importProducts(csvPath, {
      mapping: p.suggestedMapping, matchBy: 'sku', onDuplicate: 'update',
      createCategories: false, derivePrices: true, defaultPackSize: 1
    })
    eq(r.updated, 2, 'both updated')
  })
  await check('import logs a stock movement of kind "import"', async () => {
    const mv = await products.listStockMovements(undefined, 500)
    ok(mv.some((m) => m.kind === 'import'), 'import movements recorded')
  })

  // ═══════════ 11. Reports ═══════════
  g('Reports')
  await check('dashboard returns the headline figures', async () => {
    const d = await reports.getDashboardStats()
    ok(typeof d.revenueTotal === 'number', 'revenue total')
    ok(typeof d.outstanding === 'number', 'outstanding')
    ok(typeof d.stockValue === 'number', 'stock value')
    ok(Array.isArray(d.topProducts), 'best sellers list')
    ok(Array.isArray(d.monthlyRevenue), 'twelve-month series')
    ok(Array.isArray(d.recentInvoices), 'recent invoices')
    ok(Array.isArray(d.lowStockProducts), 'low stock products')
    ok(d.lowStockCount >= 1, 'low stock counted')
  })
  await check('sales report groups by day, customer and product', async () => {
    const r = await reports.getSalesReport('2026-01-01', '2026-12-31')
    ok(r.summary.invoices > 0, 'invoices in range')
    ok(Array.isArray(r.byDay) && r.byDay.length > 0, 'by day')
    ok(Array.isArray(r.byCustomer) && r.byCustomer.length > 0, 'by customer')
    ok(Array.isArray(r.byProduct), 'by product')
  })
  await check('sales report for an empty range returns zeroes, not an error', async () => {
    const r = await reports.getSalesReport('1990-01-01', '1990-01-02')
    eq(r.summary.invoices, 0)
  })

  // ═══════════ 12. Deletion rules ═══════════
  g('Deletion & referential safety')
  await check('a product used on an invoice is deactivated, not deleted', async () => {
    const r = await products.deleteProduct(pid)
    ok(r.deactivated || r.deleted, 'returned a result')
    if (r.deleted) throw new Error('product referenced by an invoice was hard-deleted')
    eq((await products.getProduct(pid))!.is_active, false, 'deactivated')
  })
  await check('an unused product is deleted outright', async () => {
    const throwaway = await products.createProduct(blankProduct({ sku: 'AUD-TMP', name: 'Audit Temp' }))
    const r = await products.deleteProduct(throwaway.id)
    eq(r.deleted, true)
    eq(await products.getProduct(throwaway.id), null)
  })
  await check('a customer with invoices is deactivated, not deleted', async () => {
    const r = await customers.deleteCustomer(cid)
    if (r.deleted) throw new Error('customer with invoices was hard-deleted')
    eq((await customers.getCustomer(cid))!.is_active, false)
  })
  await check('deleting an invoice removes its items and payments', async () => {
    const before = await queryOne<{ n: number }>(
      'select count(*)::int n from invoice_items where invoice_id=$1', [payInvId]
    )
    ok(before!.n > 0, 'had items')
    await invoices.deleteInvoice(payInvId)
    const after = await queryOne<{ n: number }>(
      'select count(*)::int n from invoice_items where invoice_id=$1', [payInvId]
    )
    eq(after!.n, 0, 'items cascaded')
    const pays = await queryOne<{ n: number }>(
      'select count(*)::int n from payments where invoice_id=$1', [payInvId]
    )
    eq(pays!.n, 0, 'payments cascaded')
  })
  await check('a category holding products cannot silently orphan them', async () => {
    await products.deleteCategory(catId)
    const orphan = await products.getProduct(pid)
    ok(orphan === null || orphan.category_id === null, 'products un-categorised, not broken')
  })

  // ═══════════ 13. New: terms URL, payment band, spacing, round-off ═══════════
  g('Terms link, payment status band & spacing')

  const renderWith = async (
    invId: number,
    mutate: (c: Record<string, never>) => void = () => {}
  ): Promise<string> => {
    const inv = await invoices.getInvoice(invId)
    const company = await settings.getCompanySettings()
    const pays = await invoices.listPayments(invId)
    const cfg = JSON.parse(JSON.stringify(TEMPLATE_PRESETS[0].config))
    mutate(cfg)
    return renderInvoiceHtml({ invoice: inv!, company, config: cfg, payments: pays, mode: 'print' })
  }

  const newInvoice = async (status: string, amount: number): Promise<number> => {
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-02-01', due_date: null, customer_id: null, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status, notes: '',
      terms: 'Goods once sold are not returnable.',
      items: [item({ name: 'Band test', qty: 1, unit_price: amount })]
    } as never)
    return inv.id
  }

  await check('terms_url is seeded to the packagingbox.pk terms page', async () => {
    const s2 = await settings.getCompanySettings()
    ok(/packagingbox\.pk/.test(s2.terms_url), `got "${s2.terms_url}"`)
  })

  await check('terms_url is editable and persists', async () => {
    await settings.updateCompanySettings({ terms_url: 'https://packagingbox.pk/terms-and-conditions/' })
    eq((await settings.getCompanySettings()).terms_url, 'https://packagingbox.pk/terms-and-conditions/')
  })

  const unpaidId = await newInvoice('issued', 1000)
  await check('the terms link is printed under the terms block', async () => {
    const html = await renderWith(unpaidId)
    ok(html.includes('Full terms &amp; conditions:'), 'label present')
    ok(html.includes('packagingbox.pk/terms-and-conditions'), 'url present')
    ok(!/terms-link[^>]*>[^<]*https:/.test(html), 'scheme stripped so the line does not wrap badly')
  })

  await check('an unpaid invoice shows the UNPAID band with the amount due', async () => {
    const html = await renderWith(unpaidId)
    ok(html.includes('UNPAID'), 'badge')
    ok(/Full amount of .*1,000/.test(html), 'amount due stated')
  })

  const partialId = await newInvoice('issued', 1000)
  await invoices.addPayment({ invoiceId: partialId, amount: 400, method: 'easypaisa', paidOn: '2026-02-02' })
  await check('a partly paid invoice names the method and the remaining balance', async () => {
    const html = await renderWith(partialId)
    ok(html.includes('PARTIALLY PAID'), 'badge')
    ok(html.includes('Easypaisa'), 'method label')
    ok(/Balance of .*600/.test(html), 'balance stated')
  })

  const paidId = await newInvoice('issued', 500)
  await invoices.addPayment({ invoiceId: paidId, amount: 500, method: 'bank transfer', paidOn: '2026-02-03' })
  await check('a settled invoice shows PAID IN FULL and how it was paid', async () => {
    const html = await renderWith(paidId)
    ok(html.includes('PAID IN FULL'), 'badge')
    ok(html.includes('Bank Transfer'), 'method label, nicely cased')
    ok(html.includes('No balance outstanding'), 'reassurance line')
  })

  await check('two payments by different methods are both named', async () => {
    const mixId = await newInvoice('issued', 1000)
    await invoices.addPayment({ invoiceId: mixId, amount: 600, method: 'cash', paidOn: '2026-02-04' })
    await invoices.addPayment({ invoiceId: mixId, amount: 400, method: 'jazzcash', paidOn: '2026-02-05' })
    const html = await renderWith(mixId)
    ok(html.includes('Cash') && html.includes('JazzCash'), 'both methods listed')
    ok(html.includes('PAID IN FULL'), 'settled')
  })

  await check('a draft prints no payment band', async () => {
    const dId = await newInvoice('draft', 900)
    const html = await renderWith(dId)
    ok(!html.includes('<section class="pay-summary'), 'no band rendered on a draft')
    ok(!html.includes('pay-badge">'), 'no status badge on a draft')
  })

  await check('the payment band can be switched off per template', async () => {
    const html = await renderWith(paidId, (c) => {
      ;(c as Record<string, Record<string, unknown>>).totals.showPaymentSummary = false
    })
    ok(!html.includes('PAID IN FULL'), 'band hidden')
  })

  await check('space below the totals is rendered and configurable', async () => {
    const def = await renderWith(paidId)
    ok(/\.after-totals \{ height: 14px; \}/.test(def), 'default 14px spacer')
    const wide = await renderWith(paidId, (c) => {
      ;(c as Record<string, Record<string, unknown>>).totals.spaceAfter = 48
    })
    ok(/\.after-totals \{ height: 48px; \}/.test(wide), 'custom spacer honoured')
  })

  await check('a round-off is printed, so the figures add up to the total', async () => {
    const rId = await newInvoice('issued', 1000)
    const cur = await invoices.getInvoice(rId)
    await invoices.saveInvoice({ ...cur!, id: rId, round_off: -7.25 } as never)
    const html = await renderWith(rId)
    ok(html.includes('Round Off'), 'round-off row present when non-zero')
    ok(/-\s*Rs\.?\s*7\.25|7\.25/.test(html), 'the adjustment is shown')
  })

  await check('no round-off row when the adjustment is zero', async () => {
    const html = await renderWith(unpaidId)
    ok(!html.includes('Round Off'), 'row hidden when zero')
  })

  await check('round-off: "nearest 10" maths lands on a round total', () => {
    const base = computeTotals({
      discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0,
      items: [item({ qty: 3, unit_price: 1234.33 })]
    } as never)
    const step = 10
    const target = Math.round(base.total / step) * step
    const adj = round2(target - base.total)
    const after = computeTotals({
      discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: adj, paid_amount: 0,
      items: [item({ qty: 3, unit_price: 1234.33 })]
    } as never)
    eq(after.total % 10, 0, `total ${after.total} should be a multiple of 10`)
  })

  await check('round-off: "whole rupee" removes the paisa', () => {
    const items = [item({ qty: 7, unit_price: 99.99 })]
    const base = computeTotals({
      discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, items
    } as never)
    const adj = round2(Math.round(base.total) - base.total)
    const after = computeTotals({
      discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: adj, paid_amount: 0, items
    } as never)
    eq(Number.isInteger(after.total), true, `total ${after.total} should be whole`)
  })

  // ═══════════ teardown ═══════════
  await disconnect()
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [CFG.database]
  )
  await admin.query(`DROP DATABASE IF EXISTS ${q}`)
  await admin.end()
  fs.rmSync(tmp, { recursive: true, force: true })

  // ═══════════ report ═══════════
  const failed = rows.filter((r) => r.status === 'FAIL')
  console.log(`\n${'═'.repeat(64)}`)
  console.log(`  ${rows.length} checks   ${rows.length - failed.length} passed   ${failed.length} failed`)
  console.log('═'.repeat(64))
  if (failed.length) {
    console.log('\nFAILURES\n')
    for (const f of failed) console.log(`  [${f.group}] ${f.name}\n      ${f.detail}\n`)
  }
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('\nHARNESS ERROR:', e)
  process.exit(2)
})
