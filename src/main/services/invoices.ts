import type { PoolClient } from 'pg'
import { query, queryOne, withTransaction } from '../db/pool'
import { computeTotals, lineNet, linePieces, derivePaymentStatus, round2, round3, num } from '../../shared/calc'
import { formatInvoiceNo } from './settings'
import type { Invoice, InvoiceInput, InvoiceItem, InvoiceStatus, InvoiceWithItems, Payment } from '../../shared/types'

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

    if (input.id) {
      const prev = await client.query<{ status: InvoiceStatus; stock_applied: boolean; invoice_no: string }>(
        'SELECT status, stock_applied, invoice_no FROM invoices WHERE id = $1 FOR UPDATE',
        [input.id]
      )
      if (prev.rowCount === 0) throw new Error('Invoice not found.')
      prevStatus = prev.rows[0].status
      prevStockApplied = prev.rows[0].stock_applied
      invoiceId = input.id
      invoiceNo = prev.rows[0].invoice_no

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
    }

    await client.query('UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2', [status, id])

    const shouldApply = CONSUMES_STOCK.includes(status)
    if (shouldApply && !applied) await applyStock(client, id, invoiceNo, 1)
    if (!shouldApply && applied) await applyStock(client, id, invoiceNo, -1)
  })

  const out = await getInvoice(id)
  if (!out) throw new Error('Invoice not found.')
  return out
}

export async function deleteInvoice(id: number): Promise<void> {
  await withTransaction(async (client) => {
    const prev = await client.query<{ stock_applied: boolean; invoice_no: string }>(
      'SELECT stock_applied, invoice_no FROM invoices WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (prev.rowCount === 0) return
    if (prev.rows[0].stock_applied) await applyStock(client, id, prev.rows[0].invoice_no, -1)
    await client.query('DELETE FROM invoices WHERE id = $1', [id]) // items + payments cascade
  })
}

export async function duplicateInvoice(id: number): Promise<InvoiceWithItems> {
  const src = await getInvoice(id)
  if (!src) throw new Error('Invoice not found.')
  return saveInvoice({
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
      }
      if (!inv.rows[0].stock_applied) await applyStock(client, args.invoiceId, invoiceNo, 1)
    }

    const nextStatus = derivePaymentStatus(status, Number(inv.rows[0].total), paid)
    await client.query(
      'UPDATE invoices SET paid_amount = $1, status = $2, updated_at = now() WHERE id = $3',
      [paid, nextStatus, args.invoiceId]
    )
  })

  const out = await getInvoice(args.invoiceId)
  if (!out) throw new Error('Invoice not found.')
  return out
}

export async function deletePayment(paymentId: number): Promise<void> {
  await withTransaction(async (client) => {
    const p = await client.query<{ invoice_id: number }>(
      'SELECT invoice_id FROM payments WHERE id = $1',
      [paymentId]
    )
    if (p.rowCount === 0) return
    const invoiceId = p.rows[0].invoice_id

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
  })
}
