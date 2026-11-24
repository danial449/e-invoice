import type { PoolClient } from 'pg'
import { query, queryOne, withTransaction } from '../db/pool'
import { computeTotals, lineNet, linePieces, derivePaymentStatus, round2, round3, num } from '../../shared/calc'
import { formatInvoiceNo } from './settings'
import type {
  Invoice, InvoiceEvent, InvoiceEventKind, InvoiceInput, InvoiceItem, InvoiceStatus,
  InvoiceWithItems, Payment
} from '../../shared/types'

// ─────────────────────── History ───────────────────────

/** Customer name as it was snapshotted onto the invoice. */
function snapshotName(snapshot: unknown): string {
  const s = (snapshot ?? {}) as Record<string, unknown>
  return String(s.company || s.name || '').trim()
}

/**
 * Append one entry to the audit trail. Never throws: a history write must not
 * be able to roll back the thing it is recording.
 */
async function recordEvent(
  client: PoolClient,
  args: {
    invoiceId: number | null
    invoiceNo: string
    customerId: number | null
    customerName: string
    kind: InvoiceEventKind
    summary: string
    detail?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO invoice_events
         (invoice_id, invoice_no, customer_id, customer_name, kind, summary, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        args.invoiceId, args.invoiceNo, args.customerId, args.customerName,
        args.kind, args.summary, JSON.stringify(args.detail ?? {})
      ]
    )
  } catch (err) {
    console.error('[history] could not record event:', err)
  }
}

/**
 * A draft's entries were written against its temporary `DRAFT-xxxx` number.
 * Once a real number is allocated, bring them with it so the trail reads as one
 * story rather than two.
 */
async function renumberEvents(client: PoolClient, invoiceId: number, invoiceNo: string): Promise<void> {
  try {
    await client.query('UPDATE invoice_events SET invoice_no = $1 WHERE invoice_id = $2', [
      invoiceNo,
      invoiceId
    ])
  } catch (err) {
    console.error('[history] could not renumber events:', err)
  }
}

/** The parts of an invoice worth reporting a change to. */
interface InvoiceSnapshot {
  customerId: number | null
  customerName: string
  invoiceDate: string
  dueDate: string
  poNumber: string
  status: InvoiceStatus
  total: number
  discountType: string
  discountValue: number
  taxEnabled: boolean
  shipping: number
  roundOff: number
  notes: string
  terms: string
  templateId: number | null
  items: { name: string; qty: number; price: number; uom: string }[]
}

function money(n: unknown): string {
  return round2(num(n)).toFixed(2)
}

function itemKey(i: { name: string; qty: number; price: number; uom: string }): string {
  return `${i.name}|${i.uom}|${round3(i.qty)}|${round2(i.price)}`
}

/**
 * Plain-language description of what moved between two versions of an invoice.
 * Reporting only the total and the line count made a change of customer, date,
 * discount or wording look like nothing had happened at all.
 */
function describeChanges(a: InvoiceSnapshot, b: InvoiceSnapshot): string[] {
  const out: string[] = []

  if (a.customerName !== b.customerName) {
    out.push(`customer ${a.customerName || 'none'} to ${b.customerName || 'none'}`)
  }
  if (a.invoiceDate !== b.invoiceDate) out.push(`date ${a.invoiceDate} to ${b.invoiceDate}`)
  if (a.dueDate !== b.dueDate) {
    out.push(b.dueDate ? `due date ${a.dueDate || 'none'} to ${b.dueDate}` : 'due date cleared')
  }
  if (a.poNumber !== b.poNumber) out.push(`PO ${a.poNumber || 'none'} to ${b.poNumber || 'none'}`)
  if (a.status !== b.status) out.push(`${a.status} to ${b.status}`)

  // ── Lines ──
  const beforeKeys = a.items.map(itemKey)
  const afterKeys = b.items.map(itemKey)
  if (a.items.length !== b.items.length) {
    out.push(`${a.items.length} to ${b.items.length} lines`)
  } else if (beforeKeys.join('~') !== afterKeys.join('~')) {
    const changed = afterKeys.filter((k, i) => k !== beforeKeys[i]).length
    out.push(`${changed} line${changed === 1 ? '' : 's'} changed`)
  }

  if (round2(a.discountValue) !== round2(b.discountValue) || a.discountType !== b.discountType) {
    const fmt = (t: string, v: number): string => (t === 'percent' ? `${round2(v)}%` : money(v))
    out.push(`discount ${fmt(a.discountType, a.discountValue)} to ${fmt(b.discountType, b.discountValue)}`)
  }
  if (a.taxEnabled !== b.taxEnabled) out.push(b.taxEnabled ? 'sales tax turned on' : 'sales tax turned off')
  if (round2(a.shipping) !== round2(b.shipping)) {
    out.push(`delivery ${money(a.shipping)} to ${money(b.shipping)}`)
  }
  if (round2(a.roundOff) !== round2(b.roundOff)) {
    out.push(`round off ${money(a.roundOff)} to ${money(b.roundOff)}`)
  }
  if (round2(a.total) !== round2(b.total)) out.push(`total ${money(a.total)} to ${money(b.total)}`)

  if ((a.notes ?? '') !== (b.notes ?? '')) out.push('notes edited')
  if ((a.terms ?? '') !== (b.terms ?? '')) out.push('terms edited')
  if (a.templateId !== b.templateId) out.push('template changed')

  return out
}

/**
 * Entries written before the invoice had a customer, or under a previous one,
 * belong with the customer it has now - otherwise the customer's history is
 * missing its own beginning.
 */
async function reassignEventCustomer(
  client: PoolClient,
  invoiceId: number,
  customerId: number | null,
  customerName: string
): Promise<void> {
  try {
    await client.query(
      `UPDATE invoice_events SET customer_id = $1, customer_name = $2
       WHERE invoice_id = $3 AND (customer_id IS DISTINCT FROM $1 OR customer_name <> $2)`,
      [customerId, customerName, invoiceId]
    )
  } catch (err) {
    console.error('[history] could not reassign events to the customer:', err)
  }
}

export async function listInvoiceHistory(invoiceId: number, limit = 200): Promise<InvoiceEvent[]> {
  return query<InvoiceEvent>(
    `SELECT * FROM invoice_events WHERE invoice_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [invoiceId, Math.min(Math.max(limit, 1), 1000)]
  )
}

/**
 * Everything that has happened to this customer's invoices, newest first.
 * Matched on the customer id, and also on the name copied onto the entry so
 * the trail of a since-deleted invoice is still found.
 */
export async function listCustomerHistory(customerId: number, limit = 300): Promise<InvoiceEvent[]> {
  return query<InvoiceEvent>(
    `SELECT * FROM invoice_events WHERE customer_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [customerId, Math.min(Math.max(limit, 1), 1000)]
  )
}

/** The most recent activity across every invoice. */
export async function listRecentHistory(limit = 200): Promise<InvoiceEvent[]> {
  return query<InvoiceEvent>(
    'SELECT * FROM invoice_events ORDER BY created_at DESC, id DESC LIMIT $1',
    [Math.min(Math.max(limit, 1), 1000)]
  )
}

// ─────────────────────── Numbering ───────────────────────

/**
 * Consume the next invoice number inside the caller's transaction.
 * Locks the settings row so two windows cannot take the same number.
 */
async function nextInvoiceNo(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{
    invoice_prefix: string
    invoice_next_number: number
    invoice_pad: number
  }>('SELECT invoice_prefix, invoice_next_number, invoice_pad FROM company_settings WHERE id = 1 FOR UPDATE')
  if (rows.length === 0) throw new Error('Company settings row is missing.')

  const { invoice_prefix, invoice_pad } = rows[0]
  let n = rows[0].invoice_next_number

  // Skip numbers already taken (e.g. after a manual edit or restore).
  for (let guard = 0; guard < 10_000; guard++) {
    const candidate = formatInvoiceNo(invoice_prefix, n, invoice_pad)
    const clash = await client.query('SELECT 1 FROM invoices WHERE invoice_no = $1', [candidate])
    if (clash.rowCount === 0) {
      await client.query('UPDATE company_settings SET invoice_next_number = $1 WHERE id = 1', [n + 1])
      return candidate
    }
    n++
  }
  throw new Error('Could not allocate an invoice number.')
}

// ─────────────────────── Reading ───────────────────────

export interface InvoiceListFilter {
  search?: string
  status?: InvoiceStatus | 'all'
  customerId?: number | null
  dateFrom?: string | null
  dateTo?: string | null
  limit?: number
  offset?: number
}

export async function listInvoices(
  f: InvoiceListFilter = {}
): Promise<{ rows: (Invoice & { customer_name: string | null })[]; total: number }> {
  const where: string[] = []
  const params: unknown[] = []

  if (f.status && f.status !== 'all') {
    params.push(f.status)
    where.push(`i.status = $${params.length}`)
  }
  if (f.customerId) {
    params.push(f.customerId)
    where.push(`i.customer_id = $${params.length}`)
  }
  if (f.dateFrom) {
    params.push(f.dateFrom)
    where.push(`i.invoice_date >= $${params.length}`)
  }
  if (f.dateTo) {
    params.push(f.dateTo)
    where.push(`i.invoice_date <= $${params.length}`)
  }
  if (f.search && f.search.trim()) {
    params.push(`%${f.search.trim().toLowerCase()}%`)
    const i = params.length
    where.push(
      `(lower(i.invoice_no) LIKE $${i} OR lower(coalesce(c.name,'')) LIKE $${i}
        OR lower(coalesce(i.customer_snapshot->>'name','')) LIKE $${i} OR lower(i.po_number) LIKE $${i})`
    )
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const countRow = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id ${whereSql}`,
    params
  )

  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000)
  const offset = Math.max(f.offset ?? 0, 0)
  params.push(limit, offset)

  const rows = await query<Invoice & { customer_name: string | null }>(
    `SELECT i.*, c.name AS customer_name
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
     ${whereSql}
     ORDER BY i.invoice_date DESC, i.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )

  return { rows, total: countRow?.n ?? 0 }
}

export async function getInvoice(id: number): Promise<InvoiceWithItems | null> {
  const inv = await queryOne<Invoice>('SELECT * FROM invoices WHERE id = $1', [id])
  if (!inv) return null
  const items = await query<InvoiceItem>(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id',
    [id]
  )
  return { ...inv, items }
}

// ─────────────────────── Stock sync ───────────────────────

const CONSUMES_STOCK: InvoiceStatus[] = ['issued', 'paid', 'partial']

async function applyStock(client: PoolClient, invoiceId: number, invoiceNo: string, direction: 1 | -1): Promise<void> {
  const { rows } = await client.query<InvoiceItem>(
    'SELECT * FROM invoice_items WHERE invoice_id = $1',
    [invoiceId]
  )
  for (const item of rows) {
    if (!item.product_id) continue
    const pieces = linePieces(item)
    if (pieces === 0) continue

    // Unlimited-stock products keep no quantity, so an invoice must not move
    // one — and must not write a movement implying it did.
    const tracked = await client.query<{ track_stock: boolean }>(
      'SELECT track_stock FROM products WHERE id = $1',
      [item.product_id]
    )
    if (tracked.rows[0] && tracked.rows[0].track_stock === false) continue

    const delta = round3(-direction * pieces) // direction 1 = sale (stock down)
    await client.query('UPDATE products SET stock_qty = stock_qty + $1, updated_at = now() WHERE id = $2', [
      delta,
      item.product_id
    ])
    await client.query(
      `INSERT INTO stock_movements (product_id, change_qty, kind, reference, note)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        item.product_id,
        delta,
        direction === 1 ? 'sale' : 'return',
        invoiceNo,
        direction === 1 ? 'Invoice issued' : 'Invoice reverted / cancelled'
      ]
    )
  }
  await client.query('UPDATE invoices SET stock_applied = $1 WHERE id = $2', [direction === 1, invoiceId])
}

// ─────────────────────── Writing ───────────────────────

function normalizeItems(items: InvoiceItem[]): InvoiceItem[] {
  return (items ?? [])
    .filter((i) => (i.name ?? '').trim() !== '' || num(i.qty) !== 0)
    .map((i, idx) => {
      const uom: InvoiceItem['uom'] = i.uom === 'pack' ? 'pack' : 'pcs'
      const pack_size = Math.max(1, Math.floor(num(i.pack_size, 1)))
      const clean: InvoiceItem = {
        product_id: i.product_id ?? null,
        name: (i.name ?? '').trim() || 'Item',
        description: i.description ?? '',
        uom,
        pack_size,
        qty: round3(num(i.qty)),
        unit_price: round2(num(i.unit_price)),
        discount_pct: Math.min(100, Math.max(0, num(i.discount_pct))),
        tax_rate: Math.max(0, num(i.tax_rate)),
        line_total: 0,
        sort_order: idx
      }
      clean.line_total = lineNet(clean)
      return clean
    })
}

export async function saveInvoice(input: InvoiceInput): Promise<InvoiceWithItems> {
  const items = normalizeItems(input.items)
  if (items.length === 0) throw new Error('Add at least one line item to the invoice.')

  const status: InvoiceStatus = input.status ?? 'draft'
  const totals = computeTotals({
    discount_type: input.discount_type ?? 'amount',
    discount_value: num(input.discount_value),
    tax_enabled: !!input.tax_enabled,
    shipping: num(input.shipping),
    round_off: num(input.round_off),
    paid_amount: num(input.paid_amount),
    items
  })

  return withTransaction(async (client) => {
    // Snapshot the customer so historical invoices never change when a
    // customer record is later edited.
    let snapshot = input.customer_snapshot ?? {}
    if (input.customer_id) {
      const c = await client.query('SELECT * FROM customers WHERE id = $1', [input.customer_id])
      if (c.rows[0]) snapshot = c.rows[0]
    }

    let invoiceId: number
    let invoiceNo: string
    let prevStatus: InvoiceStatus = 'draft'
    let prevStockApplied = false
    let before: InvoiceSnapshot | null = null

    if (input.id) {
      const prev = await client.query<Invoice>(
        'SELECT * FROM invoices WHERE id = $1 FOR UPDATE',
        [input.id]
      )
      if (prev.rowCount === 0) throw new Error('Invoice not found.')
      prevStatus = prev.rows[0].status
      prevStockApplied = prev.rows[0].stock_applied
      invoiceId = input.id
      invoiceNo = prev.rows[0].invoice_no
      const prevItems = await client.query<InvoiceItem>(
        'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id',
        [input.id]
      )
      const r = prev.rows[0]
      before = {
        customerId: r.customer_id ?? null,
        customerName: snapshotName(r.customer_snapshot),
        invoiceDate: String(r.invoice_date ?? '').slice(0, 10),
        dueDate: String(r.due_date ?? '').slice(0, 10),
        poNumber: r.po_number ?? '',
        status: r.status,
        total: num(r.total),
        discountType: r.discount_type ?? 'amount',
        discountValue: num(r.discount_value),
        taxEnabled: !!r.tax_enabled,
        shipping: num(r.shipping),
        roundOff: num(r.round_off),
        notes: r.notes ?? '',
        terms: r.terms ?? '',
        templateId: r.template_id ?? null,
        items: prevItems.rows.map((i) => ({
          name: i.name, qty: num(i.qty), price: num(i.unit_price), uom: i.uom
        }))
      }

      // Reverse any previously applied stock before rewriting the lines.
      if (prevStockApplied) await applyStock(client, invoiceId, invoiceNo, -1)

      await client.query(
        `UPDATE invoices SET
           invoice_date=$1, due_date=$2, customer_id=$3, customer_snapshot=$4::jsonb, template_id=$5,
           po_number=$6, subtotal=$7, discount_type=$8, discount_value=$9, discount_amount=$10,
           tax_enabled=$11, tax_amount=$12, shipping=$13, round_off=$14, total=$15, paid_amount=$16,
           status=$17, notes=$18, terms=$19, updated_at=now()
         WHERE id=$20`,
        [
          input.invoice_date, input.due_date || null, input.customer_id ?? null, JSON.stringify(snapshot),
          input.template_id ?? null, input.po_number ?? '', totals.subtotal, input.discount_type ?? 'amount',
          num(input.discount_value), totals.discountAmount, !!input.tax_enabled, totals.taxAmount,
          totals.shipping, totals.roundOff, totals.total, totals.paid, status, input.notes ?? '',
          input.terms ?? '', invoiceId
        ]
      )
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId])
    } else {
      // Drafts do not burn a number; they get a temporary one.
      invoiceNo =
        status === 'draft'
          ? `DRAFT-${Date.now().toString(36).toUpperCase()}`
          : await nextInvoiceNo(client)

      const ins = await client.query<{ id: number }>(
        `INSERT INTO invoices
           (invoice_no, invoice_date, due_date, customer_id, customer_snapshot, template_id, po_number,
            subtotal, discount_type, discount_value, discount_amount, tax_enabled, tax_amount,
            shipping, round_off, total, paid_amount, status, notes, terms)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          invoiceNo, input.invoice_date, input.due_date || null, input.customer_id ?? null,
          JSON.stringify(snapshot), input.template_id ?? null, input.po_number ?? '', totals.subtotal,
          input.discount_type ?? 'amount', num(input.discount_value), totals.discountAmount,
          !!input.tax_enabled, totals.taxAmount, totals.shipping, totals.roundOff, totals.total,
          totals.paid, status, input.notes ?? '', input.terms ?? ''
        ]
      )
      invoiceId = ins.rows[0].id
    }

    // A draft being issued for the first time gets a real number now.
    if (input.id && prevStatus === 'draft' && status !== 'draft' && invoiceNo.startsWith('DRAFT-')) {
      invoiceNo = await nextInvoiceNo(client)
      await client.query('UPDATE invoices SET invoice_no = $1 WHERE id = $2', [invoiceNo, invoiceId])
      await renumberEvents(client, invoiceId, invoiceNo)
    }

    for (const item of items) {
      await client.query(
        `INSERT INTO invoice_items
           (invoice_id, product_id, name, description, uom, pack_size, qty, unit_price,
            discount_pct, tax_rate, line_total, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          invoiceId, item.product_id, item.name, item.description, item.uom, item.pack_size,
          item.qty, item.unit_price, item.discount_pct, item.tax_rate, item.line_total, item.sort_order
        ]
      )
    }

    if (CONSUMES_STOCK.includes(status)) await applyStock(client, invoiceId, invoiceNo, 1)

    const inv = await client.query<Invoice>('SELECT * FROM invoices WHERE id = $1', [invoiceId])
    const its = await client.query<InvoiceItem>(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id',
      [invoiceId]
    )

    const custName = snapshotName(snapshot)
    const evBase = {
      invoiceId,
      invoiceNo,
      customerId: input.customer_id ?? null,
      customerName: custName
    }

    if (before === null) {
      await recordEvent(client, {
        ...evBase,
        kind: 'created',
        summary:
          status === 'draft'
            ? `Draft created with ${items.length} line${items.length === 1 ? '' : 's'}`
            : `Invoice created and issued as ${invoiceNo}`,
        detail: { status, total: totals.total, items: items.length }
      })
    } else {
      const after: InvoiceSnapshot = {
        customerId: input.customer_id ?? null,
        customerName: custName,
        invoiceDate: String(input.invoice_date ?? '').slice(0, 10),
        dueDate: String(input.due_date ?? '').slice(0, 10),
        poNumber: input.po_number ?? '',
        status,
        total: totals.total,
        discountType: input.discount_type ?? 'amount',
        discountValue: num(input.discount_value),
        taxEnabled: !!input.tax_enabled,
        shipping: totals.shipping,
        roundOff: totals.roundOff,
        notes: input.notes ?? '',
        terms: input.terms ?? '',
        templateId: input.template_id ?? null,
        items: items.map((i) => ({
          name: i.name, qty: num(i.qty), price: num(i.unit_price), uom: i.uom
        }))
      }
      const changes = describeChanges(before, after)

      await recordEvent(client, {
        ...evBase,
        kind: before.status !== status ? 'status' : 'updated',
        summary: changes.length ? `Edited: ${changes.join(', ')}` : 'Saved with no changes',
        detail: { changes, from: { status: before.status, total: before.total }, to: { status, total: totals.total } }
      })
    }

    // Keep the whole trail with whoever the invoice now belongs to.
    await reassignEventCustomer(client, invoiceId, input.customer_id ?? null, custName)

    return { ...inv.rows[0], items: its.rows }
  })
}

export async function setInvoiceStatus(id: number, status: InvoiceStatus): Promise<InvoiceWithItems> {
  await withTransaction(async (client) => {
    const prev = await client.query<{ status: InvoiceStatus; stock_applied: boolean; invoice_no: string }>(
      'SELECT status, stock_applied, invoice_no FROM invoices WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (prev.rowCount === 0) throw new Error('Invoice not found.')

    let { invoice_no: invoiceNo } = prev.rows[0]
    const { stock_applied: applied, status: prevStatus } = prev.rows[0]

    if (prevStatus === status) return

    if (status !== 'draft' && invoiceNo.startsWith('DRAFT-')) {
      invoiceNo = await nextInvoiceNo(client)
      await client.query('UPDATE invoices SET invoice_no = $1 WHERE id = $2', [invoiceNo, id])
      await renumberEvents(client, id, invoiceNo)
    }

    await client.query('UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2', [status, id])

    const shouldApply = CONSUMES_STOCK.includes(status)
    if (shouldApply && !applied) await applyStock(client, id, invoiceNo, 1)
    if (!shouldApply && applied) await applyStock(client, id, invoiceNo, -1)

    const who = await client.query<{ customer_id: number | null; customer_snapshot: unknown }>(
      'SELECT customer_id, customer_snapshot FROM invoices WHERE id = $1',
      [id]
    )
    await recordEvent(client, {
      invoiceId: id,
      invoiceNo,
      customerId: who.rows[0]?.customer_id ?? null,
      customerName: snapshotName(who.rows[0]?.customer_snapshot),
      kind: 'status',
      summary: `Status changed from ${prevStatus} to ${status}`,
      detail: { from: prevStatus, to: status }
    })
  })

  const out = await getInvoice(id)
  if (!out) throw new Error('Invoice not found.')
  return out
}

export async function deleteInvoice(id: number): Promise<void> {
  await withTransaction(async (client) => {
    const prev = await client.query<{
      stock_applied: boolean
      invoice_no: string
      customer_id: number | null
      customer_snapshot: unknown
      total: number
      status: InvoiceStatus
    }>(
      `SELECT stock_applied, invoice_no, customer_id, customer_snapshot, total, status
       FROM invoices WHERE id = $1 FOR UPDATE`,
      [id]
    )
    if (prev.rowCount === 0) return
    if (prev.rows[0].stock_applied) await applyStock(client, id, prev.rows[0].invoice_no, -1)

    // Recorded before the row goes, so the trail keeps the number and customer.
    await recordEvent(client, {
      invoiceId: id,
      invoiceNo: prev.rows[0].invoice_no,
      customerId: prev.rows[0].customer_id,
      customerName: snapshotName(prev.rows[0].customer_snapshot),
      kind: 'deleted',
      summary: `Invoice ${prev.rows[0].invoice_no} deleted`,
      detail: { total: num(prev.rows[0].total), status: prev.rows[0].status }
    })

    await client.query('DELETE FROM invoices WHERE id = $1', [id]) // items + payments cascade
  })
}

export async function duplicateInvoice(id: number): Promise<InvoiceWithItems> {
  const src = await getInvoice(id)
  if (!src) throw new Error('Invoice not found.')
  const copy = await saveInvoice({
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: null,
    customer_id: src.customer_id,
    customer_snapshot: src.customer_snapshot,
    template_id: src.template_id,
    po_number: src.po_number,
    discount_type: src.discount_type,
    discount_value: src.discount_value,
    tax_enabled: src.tax_enabled,
    shipping: src.shipping,
    round_off: src.round_off,
    paid_amount: 0,
    status: 'draft',
    stock_applied: false,
    notes: src.notes,
    terms: src.terms,
    items: src.items.map((i) => ({ ...i, id: undefined, invoice_id: undefined }))
  })

  await withTransaction((client) =>
    recordEvent(client, {
      invoiceId: copy.id,
      invoiceNo: copy.invoice_no,
      customerId: copy.customer_id ?? null,
      customerName: snapshotName(copy.customer_snapshot),
      kind: 'duplicated',
      summary: `Copied from ${src.invoice_no}`,
      detail: { fromInvoiceId: src.id, fromInvoiceNo: src.invoice_no }
    })
  )

  return copy
}

// ─────────────────────── Payments ───────────────────────

export async function listPayments(invoiceId: number): Promise<Payment[]> {
  return query<Payment>('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_on, id', [invoiceId])
}

export async function addPayment(args: {
  invoiceId: number
  amount: number
  method: string
  paidOn: string
  note?: string
}): Promise<InvoiceWithItems> {
  const amount = round2(num(args.amount))
  if (amount <= 0) throw new Error('Payment amount must be greater than zero.')

  await withTransaction(async (client) => {
    const inv = await client.query<{ total: number; status: InvoiceStatus; invoice_no: string; stock_applied: boolean }>(
      'SELECT total, status, invoice_no, stock_applied FROM invoices WHERE id = $1 FOR UPDATE',
      [args.invoiceId]
    )
    if (inv.rowCount === 0) throw new Error('Invoice not found.')

    await client.query(
      'INSERT INTO payments (invoice_id, amount, method, paid_on, note) VALUES ($1,$2,$3,$4,$5)',
      [args.invoiceId, amount, args.method || 'cash', args.paidOn, args.note ?? '']
    )

    const sum = await client.query<{ paid: number }>(
      'SELECT coalesce(sum(amount),0)::numeric AS paid FROM payments WHERE invoice_id = $1',
      [args.invoiceId]
    )
    const paid = round2(Number(sum.rows[0].paid))

    // Recording a payment on a draft issues it (and consumes stock).
    let status = inv.rows[0].status
    let invoiceNo = inv.rows[0].invoice_no
    if (status === 'draft') {
      status = 'issued'
      if (invoiceNo.startsWith('DRAFT-')) {
        invoiceNo = await nextInvoiceNo(client)
        await client.query('UPDATE invoices SET invoice_no = $1 WHERE id = $2', [invoiceNo, args.invoiceId])
        await renumberEvents(client, args.invoiceId, invoiceNo)
      }
      if (!inv.rows[0].stock_applied) await applyStock(client, args.invoiceId, invoiceNo, 1)
    }

    const nextStatus = derivePaymentStatus(status, Number(inv.rows[0].total), paid)
    await client.query(
      'UPDATE invoices SET paid_amount = $1, status = $2, updated_at = now() WHERE id = $3',
      [paid, nextStatus, args.invoiceId]
    )

    const who = await client.query<{ customer_id: number | null; customer_snapshot: unknown }>(
      'SELECT customer_id, customer_snapshot FROM invoices WHERE id = $1',
      [args.invoiceId]
    )
    const balance = round2(Number(inv.rows[0].total) - paid)
    await recordEvent(client, {
      invoiceId: args.invoiceId,
      invoiceNo,
      customerId: who.rows[0]?.customer_id ?? null,
      customerName: snapshotName(who.rows[0]?.customer_snapshot),
      kind: 'payment',
      summary:
        `Payment of ${amount.toFixed(2)} by ${args.method || 'cash'}` +
        (balance > 0 ? `, ${balance.toFixed(2)} still due` : ', paid in full'),
      detail: { amount, method: args.method || 'cash', paidOn: args.paidOn, paid, balance, status: nextStatus }
    })
  })

  const out = await getInvoice(args.invoiceId)
  if (!out) throw new Error('Invoice not found.')
  return out
}

export async function deletePayment(paymentId: number): Promise<void> {
  await withTransaction(async (client) => {
    const p = await client.query<{ invoice_id: number; amount: number }>(
      'SELECT invoice_id, amount FROM payments WHERE id = $1',
      [paymentId]
    )
    if (p.rowCount === 0) return
    const invoiceId = p.rows[0].invoice_id
    const removed = round2(num(p.rows[0].amount))

    await client.query('DELETE FROM payments WHERE id = $1', [paymentId])

    const inv = await client.query<{ total: number; status: InvoiceStatus }>(
      'SELECT total, status FROM invoices WHERE id = $1 FOR UPDATE',
      [invoiceId]
    )
    const sum = await client.query<{ paid: number }>(
      'SELECT coalesce(sum(amount),0)::numeric AS paid FROM payments WHERE invoice_id = $1',
      [invoiceId]
    )
    const paid = round2(Number(sum.rows[0].paid))
    const nextStatus = derivePaymentStatus(inv.rows[0].status, Number(inv.rows[0].total), paid)
    await client.query('UPDATE invoices SET paid_amount = $1, status = $2, updated_at = now() WHERE id = $3', [
      paid,
      nextStatus,
      invoiceId
    ])

    const who = await client.query<{
      customer_id: number | null
      customer_snapshot: unknown
      invoice_no: string
    }>('SELECT customer_id, customer_snapshot, invoice_no FROM invoices WHERE id = $1', [invoiceId])
    await recordEvent(client, {
      invoiceId,
      invoiceNo: who.rows[0]?.invoice_no ?? '',
      customerId: who.rows[0]?.customer_id ?? null,
      customerName: snapshotName(who.rows[0]?.customer_snapshot),
      kind: 'payment_removed',
      summary: `Payment of ${removed.toFixed(2)} removed, ${paid.toFixed(2)} now recorded as paid`,
      detail: { removed, paid, status: nextStatus }
    })
  })
}
