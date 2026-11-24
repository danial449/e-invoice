/* eslint-disable no-console */
/** Renders one representative invoice to HTML so it can be eyeballed. */
import fs from 'node:fs'
import { Pool } from 'pg'
import { connect, disconnect } from '../src/main/db/pool'
import * as products from '../src/main/services/products'
import * as customers from '../src/main/services/customers'
import * as invoices from '../src/main/services/invoices'
import * as settings from '../src/main/services/settings'
import { renderInvoiceHtml } from '../src/shared/renderInvoice'
import { TEMPLATE_PRESETS } from '../src/shared/templatePresets'
import type { DbConfig, InvoiceItem } from '../src/shared/types'

const CFG: DbConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: 'e_invoice_sample',
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
const OUT = process.argv[2]

const item = (p: Partial<InvoiceItem>): InvoiceItem => ({
  product_id: null, name: 'Item', description: '', uom: 'pcs', pack_size: 1,
  qty: 1, unit_price: 0, discount_pct: 0, tax_rate: 0, line_total: 0, sort_order: 0, ...p
} as InvoiceItem)

;(async () => {
  const admin = new Pool({ ...CFG, database: 'postgres' })
  const q = '"' + CFG.database.replace(/"/g, '""') + '"'
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [CFG.database]
  )
  await admin.query(`DROP DATABASE IF EXISTS ${q}`)
  await connect(CFG)

  const cust = await customers.createCustomer({
    name: 'Ahmed Raza', company: 'Lahore Sweets & Bakers', phone: '+92 300 4455667',
    email: 'orders@lahoresweets.pk', address: '14-A Gulberg III', city: 'Lahore',
    ntn: '3456789-1', strn: '', notes: '', is_active: true
  })

  const p1 = await products.createProduct({
    sku: 'CB-663', name: 'Cake Box 6x6x3 Inch with Window', description: '',
    category_id: null, size_text: '6x6x3 inch', material: 'White Corrugated Board',
    color: 'White', unit: 'pcs', pack_size: 50, unit_price: 70, pack_price: 3500,
    cost_price: 0, tax_rate: 18, stock_qty: 5000, reorder_level: 200, is_active: true
  })
  const p2 = await products.createProduct({
    sku: 'BB-110', name: 'Kraft Burger Box Large', description: '',
    category_id: null, size_text: '5x5x3 inch', material: 'Kraft', color: 'Brown',
    unit: 'pcs', pack_size: 100, unit_price: 25, pack_price: 2500,
    cost_price: 0, tax_rate: 18, stock_qty: 8000, reorder_level: 500, is_active: true
  })

  const inv = await invoices.saveInvoice({
    invoice_date: '2026-11-23', due_date: '2026-12-07', customer_id: cust.id,
    template_id: null, po_number: 'PO-20466', discount_type: 'percent', discount_value: 5,
    tax_enabled: true, shipping: 850, round_off: 0, paid_amount: 0, status: 'issued',
    notes: 'Artwork approved on 20-Nov-2026. Delivery in two batches.',
    terms:
      '1. Prices are quoted in PKR and valid for 15 days.\n' +
      '2. Courier charges are adjusted on parcel size, weight and location.\n' +
      '3. Custom printed orders require 50% advance payment.',
    items: [
      item({ product_id: p1.id, name: 'Cake Box 6x6x3 Inch with Window', description: 'White corrugated, clear window', uom: 'pack', pack_size: 50, qty: 20, unit_price: 3500, tax_rate: 18 }),
      item({ product_id: p2.id, name: 'Kraft Burger Box Large', description: '2-colour print', uom: 'pack', pack_size: 100, qty: 12, unit_price: 2500, discount_pct: 5, tax_rate: 18 }),
      item({ name: 'Printing plate / die charges', description: 'One-off setup', qty: 1, unit_price: 6500, tax_rate: 18 })
    ]
  } as never)

  // Round the total down to a clean figure, then pay part of it.
  const cur = await invoices.getInvoice(inv.id)
  const adj = Math.round(Number(cur!.total) / 100) * 100 - Number(cur!.total)
  await invoices.saveInvoice({ ...cur!, id: inv.id, round_off: Number(adj.toFixed(2)) } as never)
  await invoices.addPayment({
    invoiceId: inv.id, amount: 50000, method: 'bank transfer',
    paidOn: '2026-11-23', note: 'HBL ref 884210'
  })

  const final = await invoices.getInvoice(inv.id)
  const company = await settings.getCompanySettings()
  const pays = await invoices.listPayments(inv.id)
  const cfg = JSON.parse(JSON.stringify(TEMPLATE_PRESETS[0].config))
  cfg.totals.showAmountInWords = true
  cfg.stamp = {
    enabled: true, design: 'auto', imageDataUrl: '', color: '#000000', width: 160,
    opacity: 0.9, rotation: -12, position: (process.env.STAMP_POS as never) || 'middle-left', offsetX: 0, offsetY: 0,
    hideOnDraft: true
  }
  // Prove the payment band colour is taken from the template.
  cfg.totals.partialColor = process.env.PARTIAL_COLOR || cfg.totals.partialColor
  cfg.totals.paymentTint = Number(process.env.PARTIAL_TINT || cfg.totals.paymentTint || 8)

  fs.writeFileSync(
    OUT,
    renderInvoiceHtml({ invoice: final!, company, config: cfg, payments: pays, mode: 'screen' }),
    'utf8'
  )
  console.log(`wrote ${OUT}  (total ${final!.total}, paid ${final!.paid_amount}, status ${final!.status})`)

  await disconnect()
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [CFG.database]
  )
  await admin.query(`DROP DATABASE IF EXISTS ${q}`)
  await admin.end()
})().catch((e) => { console.error(e); process.exit(1) })
