import type { InvoiceItem, Invoice } from './types'

/** Round to 2 decimal places, avoiding binary float drift (1.005 -> 1.01). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round3(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.\-]/g, '')
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

/** Line amount before tax, after the line's own discount. */
export function lineNet(item: Pick<InvoiceItem, 'qty' | 'unit_price' | 'discount_pct'>): number {
  const gross = num(item.qty) * num(item.unit_price)
  const disc = gross * (num(item.discount_pct) / 100)
  return round2(gross - disc)
}

/** Pieces represented by a line, used for stock movements. */
export function linePieces(item: Pick<InvoiceItem, 'qty' | 'uom' | 'pack_size'>): number {
  const q = num(item.qty)
  if (item.uom === 'pack') return round3(q * Math.max(1, num(item.pack_size, 1)))
  return round3(q)
}

export interface Totals {
  subtotal: number
  discountAmount: number
  taxableBase: number
  taxAmount: number
  shipping: number
  roundOff: number
  total: number
  paid: number
  balance: number
}

type TotalsInput = Pick<
  Invoice,
  'discount_type' | 'discount_value' | 'tax_enabled' | 'shipping' | 'round_off' | 'paid_amount'
> & { items: InvoiceItem[] }

/**
 * Invoice totals.
 *
 * Order of operations: line discounts -> subtotal -> invoice-level discount
 * (apportioned across lines so per-line tax rates stay correct) -> tax ->
 * shipping -> round-off.
 */
export function computeTotals(inv: TotalsInput): Totals {
  const items = inv.items ?? []
  const nets = items.map((i) => lineNet(i))
  const subtotal = round2(nets.reduce((a, b) => a + b, 0))

  // A discount can never exceed the subtotal, however it is expressed — a
  // mistyped "150" in the percent box must not produce a negative invoice.
  const rawDiscount =
    inv.discount_type === 'percent'
      ? subtotal * (Math.max(0, num(inv.discount_value)) / 100)
      : Math.max(0, num(inv.discount_value))
  const discountAmount = round2(Math.min(rawDiscount, subtotal))

  const taxableBase = round2(subtotal - discountAmount)

  let taxAmount = 0
  if (inv.tax_enabled && subtotal > 0) {
    // Apportion the header discount pro-rata so each line is taxed on its own
    // discounted share at its own rate.
    const ratio = taxableBase / subtotal
    taxAmount = round2(
      items.reduce((acc, item, idx) => acc + nets[idx] * ratio * (num(item.tax_rate) / 100), 0)
    )
  }

  const shipping = round2(num(inv.shipping))
  const roundOff = round2(num(inv.round_off))
  const total = round2(taxableBase + taxAmount + shipping + roundOff)
  const paid = round2(num(inv.paid_amount))

  return {
    subtotal,
    discountAmount,
    taxableBase,
    taxAmount,
    shipping,
    roundOff,
    total,
    paid,
    balance: round2(total - paid)
  }
}

/** Status derived from what has actually been paid. */
export function derivePaymentStatus(
  current: Invoice['status'],
  total: number,
  paid: number
): Invoice['status'] {
  if (current === 'draft' || current === 'cancelled') return current
  if (paid <= 0) return 'issued'
  if (round2(paid) >= round2(total)) return 'paid'
  return 'partial'
}

// ─────────────────────── Formatting ───────────────────────

export function formatMoney(n: number, symbol = 'Rs.', decimals = 2): string {
  const v = round2(num(n))
  const s = Math.abs(v)
    .toFixed(decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${v < 0 ? '-' : ''}${symbol}${symbol ? ' ' : ''}${s}`
}

export function formatQty(n: number): string {
  const v = round3(num(n))
  return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '').replace(/\.$/, '')
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function under1000(n: number): string {
  if (n === 0) return ''
  if (n < 20) return ONES[n]
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]
    const o = ONES[n % 10]
    return o ? `${t} ${o}` : t
  }
  const h = `${ONES[Math.floor(n / 100)]} Hundred`
  const rest = n % 100
  return rest ? `${h} and ${under1000(rest)}` : h
}

/**
 * Amount in words using the South Asian numbering system
 * (crore / lakh / thousand), which is what Pakistani invoices use.
 */
export function amountInWords(amount: number, currency = 'Rupees', subunit = 'Paisa'): string {
  const v = round2(Math.abs(num(amount)))
  const whole = Math.floor(v)
  const frac = Math.round((v - whole) * 100)

  if (whole === 0 && frac === 0) return `${currency} Zero Only`

  const parts: string[] = []
  let rest = whole

  const crore = Math.floor(rest / 10_000_000)
  rest %= 10_000_000
  const lakh = Math.floor(rest / 100_000)
  rest %= 100_000
  const thousand = Math.floor(rest / 1_000)
  rest %= 1_000

  if (crore) parts.push(`${under1000(crore)} Crore`)
  if (lakh) parts.push(`${under1000(lakh)} Lakh`)
  if (thousand) parts.push(`${under1000(thousand)} Thousand`)
  if (rest) parts.push(under1000(rest))

  let out = `${currency} ${parts.join(' ')}`.replace(/\s+/g, ' ').trim()
  if (frac > 0) out += ` and ${under1000(frac)} ${subunit}`
  return `${out} Only`
}

/** Derive whichever of unit/pack price is missing, given a pack size. */
export function reconcilePrices(opts: {
  unit_price: number
  pack_price: number
  pack_size: number
}): { unit_price: number; pack_price: number } {
  const size = Math.max(1, Math.floor(num(opts.pack_size, 1)))
  const unit = num(opts.unit_price)
  const pack = num(opts.pack_price)

  if (unit > 0 && pack <= 0) return { unit_price: round2(unit), pack_price: round2(unit * size) }
  if (pack > 0 && unit <= 0) return { unit_price: round2(pack / size), pack_price: round2(pack) }
  return { unit_price: round2(unit), pack_price: round2(pack) }
}
