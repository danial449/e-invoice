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
    eq(t.length, 11, 'table count')
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
    ok(/class="terms-link"><a href="/.test(html), 'rendered as a link')
    ok(html.includes('packagingbox.pk/terms-and-conditions'), 'pointing at the terms page')
    ok(/>[^<]*Terms &amp; Conditions<\/a>/.test(html), 'the wording is the link text, not the address')
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

  // ----------- 14. WooCommerce import & unlimited stock -----------
  g('WooCommerce export import')

  // A realistic WooCommerce product export: simple rows, a variable parent and
  // its variations, plus the dozens of columns WooCommerce always writes.
  const WOO_HEADERS = [
    'ID', 'Type', 'SKU', 'Name', 'Published', 'Is featured?', 'Visibility in catalogue',
    'Short description', 'Description', 'Tax status', 'Tax class', 'In stock?', 'Stock',
    'Low stock amount', 'Backorders allowed?', 'Sold individually?', 'Weight (kg)',
    'Length (cm)', 'Width (cm)', 'Height (cm)', 'Allow customer reviews?', 'Purchase note',
    'Sale price', 'Regular price', 'Categories', 'Tags', 'Shipping class', 'Images', 'Parent',
    'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global'
  ]
  const wooRow = (v: Record<string, string>): string[] => WOO_HEADERS.map((h) => v[h] ?? '')

  const wooPath = path.join(tmp, 'woo.csv')
  const wooRows: string[][] = [
    WOO_HEADERS,
    wooRow({ ID: '10', Type: 'simple', SKU: 'WOO-SIMPLE', Name: 'Woo Kraft Bowl', Published: '1',
      'In stock?': '1', Stock: '250', 'Low stock amount': '40', 'Regular price': '45',
      Categories: 'Food Packaging > Kraft Bowls', 'Tax status': 'taxable', Description: 'A bowl' }),
    wooRow({ ID: '11', Type: 'simple', SKU: 'WOO-UNLIM', Name: 'Woo Printed Sticker Roll',
      Published: '1', 'In stock?': '1', Stock: '', 'Regular price': '1200',
      Categories: 'Food Packaging', 'Tax status': 'taxable' }),
    wooRow({ ID: '12', Type: 'simple', SKU: 'WOO-OOS', Name: 'Woo Discontinued Tray',
      Published: '1', 'In stock?': '0', Stock: '', 'Regular price': '300' }),
    wooRow({ ID: '13', Type: 'simple', SKU: 'WOO-SALE', Name: 'Woo Sale Pouch', Published: '1',
      'In stock?': '1', Stock: '60', 'Regular price': '500', 'Sale price': '399' }),
    wooRow({ ID: '14', Type: 'simple', SKU: 'WOO-DRAFT', Name: 'Woo Draft Item', Published: '-1',
      'In stock?': '1', Stock: '5', 'Regular price': '10' }),
    wooRow({ ID: '100', Type: 'variable', SKU: 'WOO-BOX', Name: 'Woo Cake Box', Published: '1',
      'In stock?': '1', Categories: 'Bakery Packaging > Cake Boxes',
      'Attribute 1 name': 'Colour', 'Attribute 1 value(s)': 'Red | Blue' }),
    wooRow({ ID: '101', Type: 'variation', SKU: 'WOO-BOX-RED', Name: 'Woo Cake Box',
      Published: '1', 'In stock?': '1', Stock: '80', 'Regular price': '90', Parent: 'id:100',
      'Attribute 1 name': 'Colour', 'Attribute 1 value(s)': 'Red' }),
    wooRow({ ID: '102', Type: 'variation', SKU: 'WOO-BOX-BLUE', Name: '',
      Published: '1', 'In stock?': '1', Stock: '', 'Regular price': '95', Parent: 'id:100',
      'Attribute 1 name': 'Colour', 'Attribute 1 value(s)': 'Blue' }),
    wooRow({ ID: '200', Type: 'variable', SKU: 'WOO-LONELY', Name: 'Woo Lonely Variable',
      Published: '1', 'In stock?': '1', 'Regular price': '700' })
  ]
  const csvEscape = (c: string): string =>
    /["',\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c
  fs.writeFileSync(wooPath, wooRows.map((r) => r.map(csvEscape).join(',')).join('\n'), 'utf8')

  let wooMapping: Record<string, string> = {}
  const wooOpts = (extra: Record<string, unknown>): never =>
    ({
      mapping: wooMapping, matchBy: 'sku', onDuplicate: 'update',
      createCategories: false, derivePrices: false, defaultPackSize: 1,
      unknownStock: 'unlimited', variableParents: 'skip', ...extra
    }) as never
  const findBySku = async (sku: string): Promise<Record<string, never> | undefined> => {
    const rows = (await products.listProducts({ search: sku, activeOnly: false })).rows
    return rows.find((r) => r.sku === sku) as never
  }

  await check('WooCommerce headers are mapped to the right fields', () => {
    const pv = csv.previewCsv(wooPath)
    wooMapping = pv.suggestedMapping as Record<string, string>
    eq(wooMapping['Type'], 'wc_type', 'Type must not be read as a category')
    eq(wooMapping['ID'], 'wc_id')
    eq(wooMapping['Parent'], 'wc_parent')
    eq(wooMapping['SKU'], 'sku')
    eq(wooMapping['Name'], 'name')
    eq(wooMapping['Regular price'], 'unit_price')
    eq(wooMapping['Sale price'], 'sale_price')
    eq(wooMapping['Stock'], 'stock_qty')
    eq(wooMapping['In stock?'], 'in_stock')
    eq(wooMapping['Categories'], 'category')
    eq(wooMapping['Published'], 'published')
  })

  await check('WooCommerce noise columns are ignored, not mis-matched', () => {
    for (const h of ['Tax status', 'Tax class', 'Is featured?', 'Images', 'Tags',
      'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible',
      'Shipping class', 'Purchase note', 'Backorders allowed?']) {
      eq(wooMapping[h], 'ignore', h + ' should be ignored')
    }
  })

  await check('the export is recognised and its row types counted', async () => {
    const r = await csv.importProducts(wooPath, wooOpts({ createCategories: true }))
    ok(r.errors.length === 0, 'errors: ' + JSON.stringify(r.errors))
    ok(!!r.woocommerce?.detected, 'detected as WooCommerce')
    eq(r.woocommerce!.simple, 5, 'simple rows')
    eq(r.woocommerce!.variations, 2, 'variation rows')
    eq(r.woocommerce!.variableParents, 2, 'variable parents seen')
    eq(r.woocommerce!.parentsSkipped, 1, 'the parent with variations was skipped')
  })

  await check('the variable parent that had variations was not imported', async () => {
    ok(!(await findBySku('WOO-BOX')), 'container product not created')
  })

  await check('a variable parent with no variations is still imported', async () => {
    ok(!!(await findBySku('WOO-LONELY')), 'lonely parent kept, not lost')
  })

  await check('variations are named from their attributes', async () => {
    const red = await findBySku('WOO-BOX-RED')
    ok(!!red, 'red variation imported')
    ok(/Red/.test(String(red!.name)), 'name should mention Red, got ' + String(red!.name))
    eq(String(red!.color), 'Red', 'colour attribute captured')
    const blue = await findBySku('WOO-BOX-BLUE')
    ok(/Blue/.test(String(blue!.name)), 'blank name inherited parent, got ' + String(blue!.name))
  })

  await check('a variation inherits its parent category', async () => {
    const red = await findBySku('WOO-BOX-RED')
    ok(red!.category_id !== null, 'category inherited from the variable parent')
  })

  await check('blank stock with stock management off becomes unlimited', async () => {
    eq((await findBySku('WOO-UNLIM'))!.track_stock as unknown as boolean, false, 'unlimited')
    eq((await findBySku('WOO-BOX-BLUE'))!.track_stock as unknown as boolean, false, 'variation too')
  })

  await check('a row marked out of stock imports as zero, still tracked', async () => {
    const p2 = await findBySku('WOO-OOS')
    eq(p2!.track_stock as unknown as boolean, true, 'tracked')
    eq(Number(p2!.stock_qty), 0, 'zero')
  })

  await check('a real stock figure is kept, with the low-stock amount as reorder level', async () => {
    const p2 = await findBySku('WOO-SIMPLE')
    eq(p2!.track_stock as unknown as boolean, true)
    eq(Number(p2!.stock_qty), 250)
    eq(Number(p2!.reorder_level), 40)
  })

  await check('a sale price overrides the regular price', async () => {
    near(Number((await findBySku('WOO-SALE'))!.unit_price), 399, 'sale price used')
  })

  await check('an unpublished product imports as inactive', async () => {
    eq((await findBySku('WOO-DRAFT'))!.is_active as unknown as boolean, false)
  })

  await check('"unlimited when blank or zero" turns a zero into unlimited', async () => {
    const r = await csv.importProducts(wooPath, wooOpts({ unknownStock: 'unlimited-if-zero' }))
    ok(r.errors.length === 0, 'errors: ' + JSON.stringify(r.errors))
    eq((await findBySku('WOO-OOS'))!.track_stock as unknown as boolean, false, 'zero became unlimited')
  })

  await check('"set to 0" keeps everything tracked', async () => {
    await csv.importProducts(wooPath, wooOpts({ unknownStock: 'zero' }))
    const p2 = await findBySku('WOO-UNLIM')
    eq(p2!.track_stock as unknown as boolean, true, 'tracked')
    eq(Number(p2!.stock_qty), 0)
  })

  await check('the variable parent can be imported too when asked', async () => {
    const r = await csv.importProducts(wooPath, wooOpts({ variableParents: 'import' }))
    eq(r.woocommerce!.parentsSkipped, 0, 'nothing skipped')
    ok(!!(await findBySku('WOO-BOX')), 'parent imported on request')
  })

  // ----------- unlimited stock behaviour -----------
  g('Unlimited stock')

  let unlimitedId = 0
  await check('a product can be created with unlimited stock', async () => {
    const pr = await products.createProduct(blankProduct({
      sku: 'AUD-UNLIM', name: 'Audit Made To Order', unit_price: 250,
      track_stock: false, stock_qty: 999, reorder_level: 50
    }))
    unlimitedId = pr.id
    eq(pr.track_stock, false)
    eq(Number(pr.stock_qty), 0, 'no quantity is kept')
  })

  await check('an invoice does not deduct unlimited stock', async () => {
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-03-01', due_date: null, customer_id: null, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
      items: [item({ product_id: unlimitedId, name: 'Audit Made To Order', qty: 40, unit_price: 250 })]
    } as never)
    eq(Number((await products.getProduct(unlimitedId))!.stock_qty), 0, 'still zero, not -40')
    eq((await products.listStockMovements(unlimitedId)).length, 0, 'no misleading movement written')
    await invoices.deleteInvoice(inv.id)
  })

  await check('adjusting stock on an unlimited product is refused clearly', async () => {
    try {
      await products.adjustStock({ productId: unlimitedId, changeQty: 10, kind: 'purchase' })
      throw new Error('adjustment was accepted')
    } catch (e) {
      const m = String(e)
      ok(!/was accepted/.test(m), 'should refuse')
      ok(/unlimited/i.test(m), 'message should explain why, got: ' + m)
    }
  })

  await check('unlimited products are never low or out of stock', async () => {
    const low = await products.listProducts({ stockFilter: 'low' })
    const out = await products.listProducts({ stockFilter: 'out' })
    ok(!low.rows.some((x) => x.id === unlimitedId), 'not low')
    ok(!out.rows.some((x) => x.id === unlimitedId), 'not out')
    const inStock = await products.listProducts({ stockFilter: 'in' })
    ok(inStock.rows.some((x) => x.id === unlimitedId), 'counts as available')
  })

  await check('the dashboard leaves unlimited products out of alerts', async () => {
    const d = await reports.getDashboardStats()
    ok(!d.lowStockProducts.some((x) => x.id === unlimitedId), 'not listed as low')
    ok(Number.isFinite(d.stockValue), 'stock value still computes')
  })

  await check('turning tracking back on uses the figure entered then', async () => {
    const pr = await products.updateProduct(unlimitedId, blankProduct({
      sku: 'AUD-UNLIM', name: 'Audit Made To Order', unit_price: 250,
      track_stock: true, stock_qty: 15, reorder_level: 5
    }))
    eq(pr.track_stock, true)
    eq(Number(pr.stock_qty), 15)
  })

  // ----------- payment band colours -----------
  g('Payment band colours')

  await check('band colours come from the template, not hardcoded', async () => {
    const html = await renderWith(partialId, (c) => {
      const t = (c as Record<string, Record<string, unknown>>).totals
      t.paidColor = '#123456'
      t.partialColor = '#abcdef'
      t.unpaidColor = '#654321'
      t.paymentTint = 20
    })
    ok(html.includes('#abcdef'), 'the chosen partial colour is used')
    ok(/\.pay-partial \.pay-badge \{ color: #abcdef; \}/.test(html), 'badge text colour')
    ok(/rgba\(171, 205, 239, 0\.200\)/.test(html), 'background tinted from the same colour')
  })

  await check('a template without colours still renders the defaults', async () => {
    const html = await renderWith(partialId, (c) => {
      const t = (c as Record<string, Record<string, unknown>>).totals
      delete t.paidColor
      delete t.partialColor
      delete t.unpaidColor
      delete t.paymentTint
    })
    ok(html.includes('#b45309'), 'default partial colour')
    ok(html.includes('PARTIALLY PAID'), 'band still renders')
  })

  // ----------- 15. Footer, terms anchor, stamps, history -----------
  g('Footer position & terms link')

  await check('the footer is pinned to the foot of the page by default', async () => {
    const html = await renderWith(paidId)
    ok(/\.doc-footer \{[^}]*margin-top: auto/.test(html), 'footer pushed to the bottom')
    ok(/\.doc-footer\.repeat \{[\s\S]*?position: fixed/.test(html), 'and fixed for print')
  })

  await check('pinning can be turned off, and then it flows under the content', async () => {
    const html = await renderWith(paidId, (c) => {
      ;(c as Record<string, Record<string, unknown>>).footer.stickToBottom = false
      ;(c as Record<string, Record<string, unknown>>).footer.showOnAllPages = false
    })
    ok(/\.doc-footer \{[^}]*margin-top: 12px/.test(html), 'normal flow')
    ok(!/\.sheet \{ display: flex/.test(html), 'no flex push-down')
  })

  await check('the terms link is wording, not a bare address', async () => {
    await settings.updateCompanySettings({
      terms_url: 'https://packagingbox.pk/terms-and-conditions/',
      terms_link_text: 'Our Terms & Conditions'
    })
    const html = await renderWith(unpaidId)
    ok(html.includes('Our Terms &amp; Conditions</a>'), 'the wording is the link text')
    ok(html.includes('href="https://packagingbox.pk/terms-and-conditions/"'), 'still clickable')
    ok(!/terms-link[^>]*>\s*Full terms &amp; conditions: packagingbox/.test(html),
      'the raw address is no longer printed as text')
  })

  await check('the link falls back to sensible wording when none is set', async () => {
    await settings.updateCompanySettings({ terms_link_text: '' })
    const html = await renderWith(unpaidId)
    ok(html.includes('>Terms &amp; Conditions</a>'), 'default wording used')
  })

  await check('a non-http address is never turned into a link', async () => {
    await settings.updateCompanySettings({ terms_url: 'javascript:alert(1)' })
    const html = await renderWith(unpaidId)
    ok(!html.includes('javascript:'), 'refused')
    ok(!/class="terms-link"/.test(html), 'no link rendered at all')
    await settings.updateCompanySettings({ terms_url: 'packagingbox.pk/terms-and-conditions/' })
    const html2 = await renderWith(unpaidId)
    ok(html2.includes('href="https://packagingbox.pk/terms-and-conditions/"'), 'bare domain upgraded to https')
  })

  g('Stamps')

  const withStamp = (over: Record<string, unknown>) => (c: Record<string, never>): void => {
    ;(c as unknown as Record<string, unknown>).stamp = {
      enabled: true, design: 'auto', imageDataUrl: '', color: '#000000', width: 150,
      opacity: 0.9, rotation: -12, position: 'bottom-right', offsetX: 0, offsetY: 0,
      hideOnDraft: true, ...over
    }
  }

  await check('no stamp unless the template asks for one', async () => {
    const html = await renderWith(paidId)
    ok(!html.includes('class="stamp'), 'nothing stamped by default')
  })

  await check('the automatic stamp follows the invoice status', async () => {
    const paidHtml = await renderWith(paidId, withStamp({}))
    ok(/stamp-text"[^>]*>PAID</.test(paidHtml), 'a settled invoice gets PAID')

    const partHtml = await renderWith(partialId, withStamp({}))
    ok(/stamp-text"[^>]*>PART PAID</.test(partHtml), 'a part-paid invoice says so')

    const unpaidHtml = await renderWith(unpaidId, withStamp({}))
    ok(/stamp-text"[^>]*>UNPAID</.test(unpaidHtml), 'an unpaid invoice gets UNPAID')
  })

  await check('a chosen stamp overrides the status', async () => {
    const html = await renderWith(unpaidId, withStamp({ design: 'duplicate' }))
    ok(/stamp-text"[^>]*>DUPLICATE</.test(html), 'DUPLICATE used on an unpaid invoice')
    ok(!/stamp-text"[^>]*>UNPAID</.test(html), 'status ignored')
  })

  await check('each design carries its own ink colour unless one is chosen', async () => {
    const auto = await renderWith(paidId, withStamp({}))
    ok(auto.includes('#15803d'), 'PAID is green')
    const custom = await renderWith(paidId, withStamp({ color: '#7c3aed' }))
    ok(custom.includes('#7c3aed'), 'a chosen colour wins')
  })

  await check('position, size, rotation and opacity reach the markup', async () => {
    const html = await renderWith(paidId, withStamp({
      position: 'top-left', width: 220, rotation: 25, opacity: 0.5, offsetX: 10, offsetY: -20
    }))
    ok(html.includes('stamp-top-left'), 'position class')
    ok(html.includes('font-size:25.9pt'), 'the width setting scales the lettering')
    ok(html.includes('rotate(25deg)'), 'rotation')
    ok(html.includes('translate(10px, -20px)'), 'nudge')
    ok(html.includes('opacity:0.5'), 'opacity')
  })

  await check('a custom stamp image is used when supplied', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const html = await renderWith(paidId, withStamp({ design: 'custom', imageDataUrl: dataUrl }))
    ok(html.includes(dataUrl), 'image rendered')
    ok(!/<div class="stamp-text/.test(html), 'no text stamp as well')
  })

  await check('a custom stamp with no image renders nothing rather than an empty box', async () => {
    const html = await renderWith(paidId, withStamp({ design: 'custom', imageDataUrl: '' }))
    ok(!html.includes('<div class="stamp'), 'nothing drawn')
  })

  await check('the automatic stamp is hidden on drafts', async () => {
    const dId = await newInvoice('draft', 400)
    const html = await renderWith(dId, withStamp({}))
    ok(!html.includes('<div class="stamp'), 'drafts are not stamped')
    const forced = await renderWith(dId, withStamp({ design: 'draft' }))
    ok(/stamp-text"[^>]*>DRAFT</.test(forced), 'but an explicit DRAFT stamp still prints')
  })

  g('Invoice history')

  let histId = 0
  await check('creating an invoice records it', async () => {
    const inv = await invoices.saveInvoice({
      invoice_date: '2026-04-01', due_date: null, customer_id: cid, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'draft', notes: '', terms: '',
      items: [item({ name: 'History line', qty: 2, unit_price: 500 })]
    } as never)
    histId = inv.id
    const h = await invoices.listInvoiceHistory(histId)
    eq(h.length, 1, 'one entry')
    eq(h[0].kind, 'created')
    ok(/Draft created/.test(h[0].summary), 'reads sensibly: ' + h[0].summary)
  })

  await check('an edit records what actually changed', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({
      ...cur!, id: histId,
      items: [
        item({ name: 'History line', qty: 2, unit_price: 500 }),
        item({ name: 'Second line', qty: 1, unit_price: 250 })
      ]
    } as never)
    const h = await invoices.listInvoiceHistory(histId)
    eq(h[0].kind, 'updated')
    ok(/1 to 2 lines/.test(h[0].summary), 'the line count change is named: ' + h[0].summary)
    ok(/total 1000\.00 to 1250\.00/.test(h[0].summary), 'the total change is named')
  })

  await check('an edit to the customer, dates or PO is reported, not called "no change"', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({
      ...cur!, id: histId, customer_id: cid, po_number: 'PO-9981', due_date: '2026-05-15'
    } as never)
    const h = await invoices.listInvoiceHistory(histId)
    eq(h[0].kind, 'updated')
    ok(!/no changes/.test(h[0].summary), 'should not claim nothing happened: ' + h[0].summary)
    ok(/PO/.test(h[0].summary), 'the PO change is named: ' + h[0].summary)
    ok(/due date/.test(h[0].summary), 'the due date change is named: ' + h[0].summary)
  })

  await check('a change to the money fields is reported', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({
      ...cur!, id: histId, discount_type: 'amount', discount_value: 100, shipping: 350, round_off: -0.5
    } as never)
    const h = await invoices.listInvoiceHistory(histId)
    ok(/discount/.test(h[0].summary), 'discount named: ' + h[0].summary)
    ok(/delivery/.test(h[0].summary), 'delivery named')
    ok(/round off/.test(h[0].summary), 'round off named')
    ok(/total/.test(h[0].summary), 'total named')
  })

  await check('editing the wording is reported', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({
      ...cur!, id: histId, notes: 'Deliver to the back gate', terms: 'Payment within 7 days'
    } as never)
    const h = await invoices.listInvoiceHistory(histId)
    ok(/notes edited/.test(h[0].summary), 'notes: ' + h[0].summary)
    ok(/terms edited/.test(h[0].summary), 'terms: ' + h[0].summary)
  })

  await check('changing a line price is reported as a changed line', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({
      ...cur!, id: histId,
      items: cur!.items.map((i, n) => (n === 0 ? { ...i, unit_price: 777 } : i))
    } as never)
    const h = await invoices.listInvoiceHistory(histId)
    ok(/1 line changed/.test(h[0].summary), 'got: ' + h[0].summary)
  })

  await check('re-saving an untouched invoice says so plainly', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({ ...cur!, id: histId } as never)
    const h = await invoices.listInvoiceHistory(histId)
    eq(h[0].summary, 'Saved with no changes')
  })

  await check('tax being switched on is reported', async () => {
    const cur = await invoices.getInvoice(histId)
    await invoices.saveInvoice({ ...cur!, id: histId, tax_enabled: true } as never)
    const h = await invoices.listInvoiceHistory(histId)
    ok(/sales tax turned on/.test(h[0].summary), 'got: ' + h[0].summary)
  })

  await check('issuing records a status change', async () => {
    await invoices.setInvoiceStatus(histId, 'issued')
    const h = await invoices.listInvoiceHistory(histId)
    eq(h[0].kind, 'status')
    ok(/draft to issued/.test(h[0].summary), 'got: ' + h[0].summary)
  })

  await check('a payment is recorded with its method and the balance left', async () => {
    const inv = await invoices.getInvoice(histId)
    const expected = (Number(inv!.total) - 250).toFixed(2)
    await invoices.addPayment({ invoiceId: histId, amount: 250, method: 'easypaisa', paidOn: '2026-04-02' })
    const h = await invoices.listInvoiceHistory(histId)
    eq(h[0].kind, 'payment')
    ok(/easypaisa/i.test(h[0].summary), 'method named: ' + h[0].summary)
    ok(h[0].summary.includes(expected + ' still due'), `balance ${expected} named: ` + h[0].summary)
  })

  await check('removing a payment is recorded too', async () => {
    const ps = await invoices.listPayments(histId)
    await invoices.deletePayment(ps[0].id)
    const h = await invoices.listInvoiceHistory(histId)
    eq(h[0].kind, 'payment_removed')
    ok(/250\.00 removed/.test(h[0].summary), 'got: ' + h[0].summary)
  })

  await check('the trail is newest first and complete', async () => {
    const h = await invoices.listInvoiceHistory(histId)
    ok(h.length >= 5, 'every step kept, got ' + h.length)
    const times = h.map((e) => Date.parse(e.created_at))
    ok(times.every((t, i) => i === 0 || times[i - 1] >= t), 'newest first')
    const kinds = h.map((e) => e.kind)
    for (const k of ['created', 'updated', 'status', 'payment', 'payment_removed']) {
      ok(kinds.includes(k as never), 'missing a ' + k + ' entry')
    }
  })

  await check('a duplicate records where it came from', async () => {
    const dup = await invoices.duplicateInvoice(histId)
    const h = await invoices.listInvoiceHistory(dup.id)
    ok(h.some((e) => e.kind === 'duplicated'), 'duplication recorded')
    const d = h.find((e) => e.kind === 'duplicated')!
    ok(d.summary.includes('Copied from'), 'says so: ' + d.summary)
    await invoices.deleteInvoice(dup.id)
  })

  await check('customer history spans every invoice of that customer', async () => {
    const h = await invoices.listCustomerHistory(cid)
    ok(h.length >= 5, 'entries found: ' + h.length)
    const nos = new Set(h.map((e) => e.invoice_no))
    ok(nos.size >= 1, 'invoice numbers carried on each entry')
    ok(h.every((e) => e.customer_id === cid), 'all belong to this customer')
  })

  await check('entries from before a customer was set move to that customer', async () => {
    // An invoice raised for a walk-in, then assigned to a customer.
    const walkIn = await invoices.saveInvoice({
      invoice_date: '2026-05-01', due_date: null, customer_id: null, template_id: null,
      po_number: '', discount_type: 'amount', discount_value: 0, tax_enabled: false,
      shipping: 0, round_off: 0, paid_amount: 0, status: 'issued', notes: '', terms: '',
      items: [item({ name: 'Counter sale', qty: 1, unit_price: 300 })]
    } as never)
    await invoices.addPayment({
      invoiceId: walkIn.id, amount: 100, method: 'cash', paidOn: '2026-05-01'
    })

    const orphaned = await invoices.listInvoiceHistory(walkIn.id)
    ok(orphaned.every((e) => e.customer_id === null), 'no customer on them yet')

    const cur = await invoices.getInvoice(walkIn.id)
    await invoices.saveInvoice({ ...cur!, id: walkIn.id, customer_id: cid } as never)

    const mine = await invoices.listCustomerHistory(cid)
    ok(mine.some((e) => e.invoice_id === walkIn.id && e.kind === 'created'),
      'the original creation now shows under the customer')
    ok(mine.some((e) => e.invoice_id === walkIn.id && e.kind === 'payment'),
      'and so does the payment taken before they were assigned')
    await invoices.deleteInvoice(walkIn.id)
  })

  await check('deleting an invoice keeps its history, with the number intact', async () => {
    const before = (await invoices.listCustomerHistory(cid)).length
    const no = (await invoices.getInvoice(histId))!.invoice_no
    await invoices.deleteInvoice(histId)

    const after = await invoices.listCustomerHistory(cid)
    ok(after.length > before, 'a deletion entry was added, not a wipe')
    const del = after.find((e) => e.kind === 'deleted' && e.invoice_no === no)
    ok(!!del, 'the deletion itself is recorded against the right number')
    ok(after.some((e) => e.invoice_no === no && e.kind === 'created'),
      'the earlier trail of the deleted invoice survived')
  })

  await check('recent history covers every invoice', async () => {
    const r = await invoices.listRecentHistory(50)
    ok(r.length > 0, 'entries returned')
    ok(r.length <= 50, 'limit respected')
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
