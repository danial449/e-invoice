import type {
  Align, CompanySettings, InvoiceWithItems, Payment, TemplateConfig, TemplateColumn
} from './types'
import { amountInWords, computeTotals, formatMoney, formatQty, num, round2 } from './calc'
import { isRichText, richTextHasContent, sanitizeRichText } from './richText'

const PAGE_MM: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
  A5: { w: 148, h: 210 }
}

export function pageDimensions(cfg: TemplateConfig): { w: number; h: number } {
  const base = PAGE_MM[cfg.page.size] ?? PAGE_MM.A4
  return cfg.page.orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h }
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape, then turn newlines into <br> so multi-line fields keep their shape. */
/**
 * Wording typed in the editor. Stored rich text is sanitised and used as
 * markup; anything older, typed as plain text, keeps its line breaks.
 */
function richBody(value: unknown): string {
  return isRichText(value) ? sanitizeRichText(value) : multiline(value)
}

function multiline(s: unknown): string {
  return escapeHtml(s).replace(/\r?\n/g, '<br>')
}

/**
 * A translucent version of a colour, for tinting a band's background.
 * Falls back to the colour itself if it is not a plain hex value, so a named
 * or rgb() colour still renders rather than breaking the stylesheet.
 */
function tint(color: string, percent: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color ?? '').trim())
  if (!m) return color
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const a = Math.min(1, Math.max(0, percent / 100))
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
}

/**
 * Only http(s) links are ever emitted. Anything else - javascript:, data:, a
 * stray word - becomes no link at all rather than a clickable surprise in the
 * PDF. A bare domain is upgraded to https.
 */
function safeUrl(raw: unknown): string {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`
  return ''
}

function formatDate(d: string | null | undefined): string {
  if (!d) return ''
  // Values arrive as YYYY-MM-DD; format without constructing a Date so the
  // day never shifts across timezones.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d))
  if (!m) return String(d)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${m[3]}-${months[parseInt(m[2], 10) - 1]}-${m[1]}`
}

export interface RenderContext {
  invoice: InvoiceWithItems
  company: CompanySettings
  config: TemplateConfig
  /**
   * Payments recorded against this invoice, newest last. Used to print how the
   * money actually arrived ("Paid in full by Bank Transfer"). Omitted for an
   * unsaved draft, where no payment can exist yet.
   */
  payments?: Payment[]
  /** screen = preview inside the app; print = headless window for PDF */
  mode?: 'screen' | 'print'
  /**
   * Screen preview only: shrink the sheet so a full page fits the preview pane.
   * Uses CSS `zoom`, which (unlike `transform`) also shrinks the layout box, so
   * the preview never scrolls sideways.
   */
  scale?: number
  page?: number
  pages?: number
}

function substitute(text: string, ctx: RenderContext): string {
  const { invoice, company } = ctx
  const cust = invoice.customer_snapshot ?? {}
  const totals = computeTotals(invoice)
  const map: Record<string, string> = {
    company_name: company.name,
    company_legal_name: company.legal_name || company.name,
    company_address: company.address,
    company_full_address: [company.address, company.city, company.country].filter(Boolean).join(', '),
    company_city: company.city,
    company_country: company.country,
    company_phone: [company.phone, company.phone_alt].filter(Boolean).join(' / '),
    company_email: company.email,
    company_website: company.website,
    company_ntn: company.ntn,
    company_strn: company.strn,
    invoice_no: invoice.invoice_no,
    invoice_date: formatDate(invoice.invoice_date),
    due_date: formatDate(invoice.due_date),
    po_number: invoice.po_number,
    status: invoice.status,
    customer_name: String(cust.name ?? ''),
    customer_company: String(cust.company ?? ''),
    customer_phone: String(cust.phone ?? ''),
    total: formatMoney(totals.total, company.currency_symbol),
    balance: formatMoney(totals.balance, company.currency_symbol),
    year: String(new Date().getFullYear()),
    page: String(ctx.page ?? 1),
    pages: String(ctx.pages ?? 1)
  }
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const v = map[key.toLowerCase()]
    return v === undefined ? whole : escapeHtml(v)
  })
}

function alignCss(a: Align): string {
  return a === 'center' ? 'center' : a === 'right' ? 'right' : 'left'
}

function flexAlign(a: Align): string {
  return a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start'
}

// ─────────────────────── Sections ───────────────────────

function renderLogo(ctx: RenderContext): string {
  const { config, company } = ctx
  const L = config.logo
  if (!L.enabled) return ''
  const src = L.dataUrl || company.logo_data_url
  if (!src) return ''
  const h = L.height > 0 ? `height:${L.height}px;object-fit:contain;` : 'height:auto;'
  return `<img class="logo" src="${escapeHtml(src)}" alt="" style="width:${L.width}px;${h}opacity:${L.opacity};margin-bottom:${L.marginBottom}px;">`
}

function renderCompanyBlock(ctx: RenderContext): string {
  const { config, company } = ctx
  const H = config.header
  const out: string[] = []

  if (H.showCompanyBlock) {
    const title = substitute(H.title, ctx)
    const subtitle = substitute(H.subtitle, ctx)
    if (title) out.push(`<div class="co-name">${title}</div>`)
    if (subtitle) out.push(`<div class="co-sub">${subtitle}</div>`)
  }

  if (H.showContactBlock) {
    const bits: string[] = []
    const phones = [company.phone, company.phone_alt].filter(Boolean).join(' · ')
    if (phones) bits.push(escapeHtml(phones))
    if (company.email) bits.push(escapeHtml(company.email))
    if (company.website) bits.push(escapeHtml(company.website))
    if (bits.length) out.push(`<div class="co-contact">${bits.join(' &nbsp;|&nbsp; ')}</div>`)

    const tax: string[] = []
    if (company.ntn) tax.push(`NTN: ${escapeHtml(company.ntn)}`)
    if (company.strn) tax.push(`STRN: ${escapeHtml(company.strn)}`)
    if (tax.length) out.push(`<div class="co-tax">${tax.join(' &nbsp;|&nbsp; ')}</div>`)
  }

  return out.join('')
}

function renderDocTitle(ctx: RenderContext): string {
  const T = ctx.config.docTitle
  if (!T.enabled) return ''
  const text = substitute(T.text, ctx)
  return `<div class="doc-title">${T.uppercase ? text.toUpperCase() : text}</div>`
}

function renderHeader(ctx: RenderContext): string {
  const { config } = ctx
  const H = config.header
  if (!H.enabled) return renderDocTitle(ctx) ? `<div class="title-only">${renderDocTitle(ctx)}</div>` : ''

  const logoAbove = config.logo.position === 'above-title'
  const logoHtml = renderLogo(ctx)
  const left = config.logo.position === 'header-left' ? logoHtml : ''
  const center = config.logo.position === 'header-center' ? logoHtml : ''
  const right = config.logo.position === 'header-right' ? logoHtml : ''

  return `
  <header class="doc-header">
    ${logoAbove ? `<div class="logo-above">${logoHtml}</div>` : ''}
    <div class="header-grid">
      <div class="header-left">
        ${left}
        ${center ? `<div class="logo-center">${center}</div>` : ''}
        ${renderCompanyBlock(ctx)}
      </div>
      <div class="header-right">
        ${right}
        ${renderDocTitle(ctx)}
      </div>
    </div>
  </header>`
}

function renderParties(ctx: RenderContext): string {
  const { invoice, config } = ctx
  const P = config.parties
  const c = invoice.customer_snapshot ?? {}

  const partyCard = (label: string): string => {
    const lines: string[] = []
    const display = String(c.company ?? '').trim() || String(c.name ?? '').trim()
    const second = String(c.company ?? '').trim() && String(c.name ?? '').trim() !== String(c.company ?? '').trim()
      ? String(c.name ?? '')
      : ''
    if (display) lines.push(`<div class="party-name">${escapeHtml(display)}</div>`)
    if (second) lines.push(`<div>${escapeHtml(second)}</div>`)
    if (c.address) lines.push(`<div>${multiline(c.address)}</div>`)
    if (c.city) lines.push(`<div>${escapeHtml(c.city)}</div>`)
    if (c.phone) lines.push(`<div>${escapeHtml(c.phone)}</div>`)
    if (c.email) lines.push(`<div>${escapeHtml(c.email)}</div>`)
    if (P.showCustomerTaxIds) {
      const t: string[] = []
      if (c.ntn) t.push(`NTN: ${escapeHtml(c.ntn)}`)
      if (c.strn) t.push(`STRN: ${escapeHtml(c.strn)}`)
      if (t.length) lines.push(`<div class="muted">${t.join(' | ')}</div>`)
    }
    if (lines.length === 0) lines.push('<div class="muted">Walk-in customer</div>')
    return `<div class="party"><div class="party-label">${escapeHtml(label)}</div>${lines.join('')}</div>`
  }

  const metaRows: string[] = []
  if (P.showMeta) {
    metaRows.push(`<tr><td>Invoice #</td><td class="strong">${escapeHtml(invoice.invoice_no)}</td></tr>`)
    metaRows.push(`<tr><td>Date</td><td>${escapeHtml(formatDate(invoice.invoice_date))}</td></tr>`)
    if (invoice.due_date) metaRows.push(`<tr><td>Due Date</td><td>${escapeHtml(formatDate(invoice.due_date))}</td></tr>`)
  }
  if (P.showPoNumber && invoice.po_number) {
    metaRows.push(`<tr><td>P.O. #</td><td>${escapeHtml(invoice.po_number)}</td></tr>`)
  }

  const cols: string[] = []
  if (P.showBillTo) cols.push(partyCard(P.billToLabel))
  if (P.showShipTo) cols.push(partyCard(P.shipToLabel))
  if (metaRows.length) cols.push(`<div class="meta"><table>${metaRows.join('')}</table></div>`)

  if (cols.length === 0) return ''
  return `<section class="parties cols-${cols.length}">${cols.join('')}</section>`
}

function visibleColumns(config: TemplateConfig): TemplateColumn[] {
  return config.table.columns.filter((c) => c.enabled)
}

function renderTable(ctx: RenderContext): string {
  const { invoice, company, config } = ctx
  const cols = visibleColumns(config)
  if (cols.length === 0) return '<p class="muted">No table columns are enabled for this template.</p>'

  const totalWidth = cols.reduce((a, c) => a + (c.width || 0), 0) || 100

  const head = cols
    .map((c) => `<th style="width:${((c.width || 0) / totalWidth) * 100}%;text-align:${alignCss(c.align)}">${escapeHtml(c.label)}</th>`)
    .join('')

  const cell = (col: TemplateColumn, item: InvoiceWithItems['items'][number], index: number): string => {
    const sym = company.currency_symbol
    switch (col.key) {
      case 'sno':
        return String(index + 1)
      case 'name': {
        const extra = item.description && !config.table.columns.find((c) => c.key === 'description' && c.enabled)
          ? `<div class="item-desc">${multiline(item.description)}</div>`
          : ''
        return `<span class="item-name">${escapeHtml(item.name)}</span>${extra}`
      }
      case 'description':
        return multiline(item.description)
      case 'size':
        return item.uom === 'pack'
          ? `<span class="nb">Pack of ${escapeHtml(String(item.pack_size))}</span>`
          : ''
      case 'uom':
        // Two short lines, so a narrow column never breaks mid-value.
        return item.uom === 'pack'
          ? `<span class="nb">Pack</span><div class="uom-sub nb">${escapeHtml(String(item.pack_size))} pcs</div>`
          : '<span class="nb">Pcs</span>'
      case 'qty':
        return escapeHtml(formatQty(item.qty))
      case 'unit_price':
        return escapeHtml(formatMoney(item.unit_price, sym))
      case 'discount':
        return num(item.discount_pct) ? `${escapeHtml(formatQty(item.discount_pct))}%` : '&ndash;'
      case 'tax':
        return invoice.tax_enabled && num(item.tax_rate) ? `${escapeHtml(formatQty(item.tax_rate))}%` : '&ndash;'
      case 'total':
        return escapeHtml(formatMoney(item.line_total, sym))
      default:
        return ''
    }
  }

  const body = invoice.items
    .map(
      (item, i) =>
        `<tr>${cols.map((c) => `<td style="text-align:${alignCss(c.align)}">${cell(c, item, i)}</td>`).join('')}</tr>`
    )
    .join('')

  const padCount = Math.max(0, config.table.minRows - invoice.items.length)
  const padding = Array.from({ length: padCount })
    .map(() => `<tr class="pad-row">${cols.map(() => '<td>&nbsp;</td>').join('')}</tr>`)
    .join('')

  return `<table class="items"><thead><tr>${head}</tr></thead><tbody>${body}${padding}</tbody></table>`
}

function renderTotals(ctx: RenderContext): string {
  const { invoice, company, config } = ctx
  const T = config.totals
  const t = computeTotals(invoice)
  const sym = company.currency_symbol
  const rows: string[] = []

  const row = (label: string, value: string, cls = ''): string =>
    `<tr class="${cls}"><td class="t-label">${escapeHtml(label)}</td><td class="t-value">${escapeHtml(value)}</td></tr>`

  if (T.showSubtotal) rows.push(row('Subtotal', formatMoney(t.subtotal, sym)))
  if (T.showDiscount && t.discountAmount > 0) {
    const label = invoice.discount_type === 'percent' ? `Discount (${formatQty(invoice.discount_value)}%)` : 'Discount'
    rows.push(row(label, `- ${formatMoney(t.discountAmount, sym)}`))
  }
  if (T.showTax && invoice.tax_enabled && t.taxAmount > 0) {
    rows.push(row(`Sales Tax`, formatMoney(t.taxAmount, sym)))
  }
  if (T.showShipping && t.shipping !== 0) rows.push(row('Delivery / Courier', formatMoney(t.shipping, sym)))
  if (T.showRoundOff && t.roundOff !== 0) rows.push(row('Round Off', formatMoney(t.roundOff, sym)))

  rows.push(
    `<tr class="grand"><td class="t-label">Total</td><td class="t-value">${escapeHtml(formatMoney(t.total, sym))}</td></tr>`
  )

  if (T.showPaid) rows.push(row('Paid', formatMoney(t.paid, sym)))
  if (T.showBalance) rows.push(row('Balance Due', formatMoney(t.balance, sym), 'balance'))

  const words = T.showAmountInWords
    ? `<div class="in-words"><span class="in-words-label">Amount in words:</span> ${escapeHtml(
        amountInWords(t.total, company.currency_code === 'PKR' ? 'Rupees' : company.currency_code)
      )}</div>`
    : ''

  return `
  <section class="totals-wrap">
    <div class="totals-spacer"></div>
    <div class="totals"><table>${rows.join('')}</table></div>
  </section>
  ${words}
  ${renderPaymentSummary(ctx, t.paid, t.balance)}
  <div class="after-totals"></div>`
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  'bank transfer': 'Bank Transfer',
  bank: 'Bank Transfer',
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  card: 'Card',
  cheque: 'Cheque',
  other: 'Other'
}

function methodLabel(m: string): string {
  const key = String(m ?? '').trim().toLowerCase()
  return METHOD_LABELS[key] ?? (key ? key.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other')
}

/**
 * A plain-language line about how the money actually arrived, so whoever
 * receives the invoice can see at a glance whether anything is still owed.
 */
function renderPaymentSummary(ctx: RenderContext, paid: number, balance: number): string {
  const { invoice, company, config } = ctx
  if (config.totals.showPaymentSummary === false) return ''
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return ''

  const sym = company.currency_symbol
  const payments = (ctx.payments ?? []).slice().sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)))

  // Distinct methods, in the order they were used.
  const methods: string[] = []
  for (const p of payments) {
    const label = methodLabel(p.method)
    if (!methods.includes(label)) methods.push(label)
  }
  const via = methods.length
    ? ` by ${methods.length === 1 ? methods[0] : `${methods.slice(0, -1).join(', ')} and ${methods[methods.length - 1]}`}`
    : ''
  const last = payments[payments.length - 1]
  const on = last?.paid_on ? ` on ${formatDate(String(last.paid_on))}` : ''

  let cls: string
  let title: string
  let detail: string

  // Settled either because it was paid off, or because it was marked Paid.
  const settled = invoice.status === 'paid' || (paid > 0 && balance <= 0)
  const partly = !settled && (invoice.status === 'partial' || paid > 0)

  if (settled) {
    cls = 'pay-paid'
    title = 'PAID IN FULL'
    detail =
      paid > 0
        ? `${formatMoney(paid, sym)} received${via}${on}. No balance outstanding — thank you.`
        : `No balance outstanding — thank you.`
  } else if (partly) {
    cls = 'pay-partial'
    title = 'PARTIALLY PAID'
    detail =
      paid > 0
        ? `${formatMoney(paid, sym)} received${via}${on}. ` +
          `Balance of ${formatMoney(balance, sym)} is still due.`
        : `Balance of ${formatMoney(balance, sym)} is still due.`
  } else {
    cls = 'pay-unpaid'
    title = 'UNPAID'
    detail = `Full amount of ${formatMoney(balance, sym)} is due.`
  }

  const lines = payments.length
    ? `<table class="pay-lines">${payments
        .map(
          (p) =>
            `<tr><td>${escapeHtml(formatDate(String(p.paid_on)))}</td>` +
            `<td>${escapeHtml(methodLabel(p.method))}</td>` +
            `<td>${escapeHtml(p.note ?? '')}</td>` +
            `<td class="pay-amt">${escapeHtml(formatMoney(num(p.amount), sym))}</td></tr>`
        )
        .join('')}</table>`
    : ''

  return `
  <section class="pay-summary ${cls}">
    <div class="pay-head"><span class="pay-badge">${escapeHtml(title)}</span>
      <span class="pay-detail">${escapeHtml(detail)}</span></div>
    ${lines}
  </section>`
}

function renderBlocks(ctx: RenderContext): string {
  const { invoice, company, config } = ctx
  const B = config.blocks
  const leftParts: string[] = []

  if (B.showNotes && invoice.notes) {
    leftParts.push(`<div class="block"><div class="block-label">${escapeHtml(B.notesLabel)}</div><div>${richBody(invoice.notes)}</div></div>`)
  }
  // When the terms have a page of their own, they are not repeated here -
  // that is the whole point of moving them off the first page.
  const termsOnOwnPage = config.termsPage?.enabled === true && richTextHasContent(invoice.terms)

  if (B.showTerms && !termsOnOwnPage && (invoice.terms || company.terms_url)) {
    // The published T&Cs are the authority; the printed list is a summary.
    // Shown as wording, not a raw address: "Full terms & conditions: Terms &
    // Conditions" reads badly, so the label alone is the link. The href is kept
    // so it stays clickable in the PDF.
    const label = (company.terms_link_text ?? '').trim() || 'Terms & Conditions'
    const href = safeUrl(company.terms_url)
    const link = href
      ? `<div class="terms-link"><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></div>`
      : ''
    leftParts.push(
      `<div class="block"><div class="block-label">${escapeHtml(B.termsLabel)}</div>` +
        `<div>${richBody(invoice.terms)}</div>${link}</div>`
    )
  }
  if (B.showBankDetails && company.bank_details) {
    leftParts.push(`<div class="block"><div class="block-label">${escapeHtml(B.bankLabel)}</div><div>${multiline(company.bank_details)}</div></div>`)
  }

  const sig = B.showSignature
    ? `<div class="signature" style="width:${B.signatureWidth}px">
         ${(() => {
           // This template's own signature, or the company-wide one.
           const sig = (B.signatureDataUrl ?? '').trim() || company.signature_data_url
           return sig ? `<img src="${escapeHtml(sig)}" alt="" class="sig-img">` : '<div class="sig-space"></div>'
         })()}
         <div class="sig-line"></div>
         <div class="sig-label">${escapeHtml(B.signatureLabel)}</div>
       </div>`
    : ''

  if (leftParts.length === 0 && !sig && !B.showThankYou) return ''

  // Lay the text blocks out side by side rather than stacked, so a normal
  // invoice still fits on a single page.
  const cols = leftParts.map((p) => `<div class="blocks-col">${p}</div>`).join('')

  return `
  <section class="blocks">
    ${cols}
    ${sig ? `<div class="blocks-right">${sig}</div>` : ''}
  </section>
  ${B.showThankYou && B.thankYouText ? `<div class="thanks">${substitute(B.thankYouText, ctx)}</div>` : ''}`
}

/** The built-in stamp designs, as plain text with an optional sub-line. */
const STAMP_PRESETS: Record<string, { text: string; sub?: string; color: string }> = {
  paid: { text: 'PAID', color: '#15803d' },
  partial: { text: 'PART PAID', color: '#b45309' },
  unpaid: { text: 'UNPAID', color: '#b91c1c' },
  cancelled: { text: 'CANCELLED', color: '#b91c1c' },
  draft: { text: 'DRAFT', color: '#64748b' },
  duplicate: { text: 'DUPLICATE', color: '#64748b' },
  original: { text: 'ORIGINAL', color: '#1d4ed8' },
  received: { text: 'RECEIVED', color: '#15803d' }
}

/**
 * Which preset an `auto` stamp resolves to.
 *
 * The status the user set wins. Deriving it purely from the amount paid meant
 * an invoice marked Paid, but with no payment recorded against it, was stamped
 * UNPAID - the opposite of what was asked for. Only `issued`, which says
 * nothing about money by itself, falls back to the figures.
 */
function autoStampKey(ctx: RenderContext): string {
  const { invoice } = ctx
  switch (invoice.status) {
    case 'cancelled':
      return 'cancelled'
    case 'draft':
      return 'draft'
    case 'paid':
      return 'paid'
    case 'partial':
      return 'partial'
    default:
      break
  }
  const t = computeTotals(invoice)
  if (t.paid > 0 && t.balance <= 0) return 'paid'
  if (t.paid > 0) return 'partial'
  return 'unpaid'
}

function renderStamp(ctx: RenderContext): string {
  const S = ctx.config.stamp
  if (!S || !S.enabled) return ''
  if (S.hideOnDraft !== false && ctx.invoice.status === 'draft' && S.design === 'auto') return ''

  const key = S.design === 'auto' ? autoStampKey(ctx) : S.design

  if (key === 'custom') {
    if (!S.imageDataUrl) return ''
    return `<div class="stamp stamp-${escapeHtml(S.position)}" style="opacity:${S.opacity};transform:${stampTransform(S)};width:${S.width}px">
      <img src="${escapeHtml(S.imageDataUrl)}" alt="">
    </div>`
  }

  const preset = STAMP_PRESETS[key] ?? STAMP_PRESETS.unpaid
  // A template colour of its own wins; otherwise each design has a sensible one.
  const color = S.color && S.color.toLowerCase() !== '#000000' ? S.color : preset.color
  const dateLine = formatDate(ctx.invoice.invoice_date)
  // The box hugs its wording rather than clamping it, so a long word like
  // CANCELLED keeps to one line; `width` scales the lettering instead.
  const textPt = Math.max(8, S.width / 8.5)

  return `<div class="stamp stamp-ink stamp-${escapeHtml(S.position)}"
    style="opacity:${S.opacity};transform:${stampTransform(S)};color:${escapeHtml(color)};border-color:${escapeHtml(color)}">
    <div class="stamp-text" style="font-size:${textPt.toFixed(1)}pt">${escapeHtml(preset.text)}</div>
    <div class="stamp-sub" style="font-size:${Math.max(5, textPt / 2.6).toFixed(1)}pt">${escapeHtml(dateLine)}</div>
  </div>`
}

/** Centre needs its own half-width shift, which has to live in the transform. */
function stampTransform(S: NonNullable<TemplateConfig['stamp']>): string {
  const x = S.position === 'center' ? `calc(-50% + ${S.offsetX}px)` : `${S.offsetX}px`
  return `translate(${x}, ${S.offsetY}px) rotate(${S.rotation}deg)`
}

/**
 * The terms, on a page of their own after the invoice.
 *
 * Kept deliberately plain: a heading, the wording, optionally the invoice it
 * belongs to and a signature strip. The page break is `always` so it never
 * shares a sheet with the totals.
 */
function renderTermsPage(ctx: RenderContext): string {
  const { invoice, company, config } = ctx
  const T = config.termsPage
  if (!T || !T.enabled) return ''
  if (!richTextHasContent(invoice.terms)) return ''

  const ref = T.showInvoiceRef
    ? `<div class="tp-ref">${escapeHtml(invoice.invoice_no)} &middot; ${escapeHtml(formatDate(invoice.invoice_date))}` +
      `${invoice.customer_snapshot && (invoice.customer_snapshot as Record<string, unknown>).name
        ? ` &middot; ${escapeHtml(String((invoice.customer_snapshot as Record<string, unknown>).company || (invoice.customer_snapshot as Record<string, unknown>).name))}`
        : ''}</div>`
    : ''

  const href = T.showTermsLink ? safeUrl(company.terms_url) : ''
  const label = (company.terms_link_text ?? '').trim() || 'Terms & Conditions'
  const link = href
    ? `<div class="tp-link">Full terms &amp; conditions: <a href="${escapeHtml(href)}">${escapeHtml(label)}</a></div>`
    : ''

  const acceptance = T.showAcceptance
    ? `<div class="tp-accept">
         <div class="tp-accept-box">
           <div class="tp-accept-line"></div>
           <div class="tp-accept-label">${escapeHtml(T.acceptanceLabel)}</div>
         </div>
         <div class="tp-accept-box">
           <div class="tp-accept-line"></div>
           <div class="tp-accept-label">Date</div>
         </div>
       </div>`
    : ''

  return `
  <section class="terms-page">
    ${T.showHeader ? renderHeader(ctx) : ''}
    <h2 class="tp-heading">${escapeHtml(T.heading || 'Terms & Conditions')}</h2>
    ${ref}
    <div class="tp-body">${richBody(invoice.terms)}</div>
    ${link}
    ${acceptance}
    ${T.showFooter ? renderFooter(ctx) : ''}
  </section>`
}

function renderFooter(ctx: RenderContext): string {
  const F = ctx.config.footer
  if (!F.enabled) return ''
  const text = substitute(F.text, ctx)
  // In print mode Chromium renders page numbers into the page margin via the
  // PDF footer template, so the in-flow copy is omitted to avoid duplicates.
  const nums =
    F.showPageNumbers && ctx.mode !== 'print'
      ? `<div class="page-num">${substitute(F.pageNumberFormat, ctx)}</div>`
      : ''
  if (!text && !nums) return ''
  return `<footer class="doc-footer ${F.showOnAllPages ? 'repeat' : ''}"><div class="footer-text">${text}</div>${nums}</footer>`
}

function renderWatermark(ctx: RenderContext): string {
  const { invoice, config } = ctx
  const W = config.watermark
  if (!W.enabled) return ''

  let text = W.text
  if (W.useStatusText && (invoice.status === 'draft' || invoice.status === 'cancelled' || invoice.status === 'paid')) {
    text = invoice.status.toUpperCase()
  }

  const inner =
    W.type === 'image' && W.imageDataUrl
      ? `<img src="${escapeHtml(W.imageDataUrl)}" style="width:${W.width}px" alt="">`
      : `<span style="font-size:${W.fontSize}px;color:${escapeHtml(W.color)};">${escapeHtml(text)}</span>`

  if (W.repeat) {
    const tiles = Array.from({ length: 15 })
      .map(() => `<div class="wm-tile">${inner}</div>`)
      .join('')
    return `<div class="watermark repeat" style="opacity:${W.opacity}"><div class="wm-grid" style="transform:rotate(${W.rotation}deg)">${tiles}</div></div>`
  }

  const posClass = `wm-${W.position}`
  return `<div class="watermark ${posClass}" style="opacity:${W.opacity}"><div style="transform:rotate(${W.rotation}deg)">${inner}</div></div>`
}

// ─────────────────────── Stylesheet ───────────────────────

function renderStyles(ctx: RenderContext): string {
  const { config: c, mode } = ctx
  const dim = pageDimensions(c)
  const f = c.font
  const col = c.colors

  // Payment status band colours, with sensible defaults when a template
  // predates them.
  const payPaid = c.totals.paidColor || '#15803d'
  const payPartial = c.totals.partialColor || '#b45309'
  const payUnpaid = c.totals.unpaidColor || '#b91c1c'
  const payTint = Math.min(100, Math.max(0, c.totals.paymentTint ?? 8))

  // Pinned by default: an invoice footer belongs at the foot of the page, not
  // floating directly under a short item list.
  const footerSticky = c.footer.enabled && c.footer.stickToBottom !== false
  const footerRepeats = c.footer.showOnAllPages || footerSticky

  const T = c.termsPage
  const termsSize = Math.max(6, T?.fontSize ?? 8.5)
  const termsLead = Math.max(1, T?.lineHeight ?? 1.5)
  const termsCols = T?.columns === 2 ? 2 : 1

  const borderAll = c.table.borders === 'all'
  const borderH = c.table.borders === 'horizontal'

  return `
  @page {
    size: ${dim.w}mm ${dim.h}mm;
    margin: ${c.page.marginTop}mm ${c.page.marginRight}mm ${c.page.marginBottom}mm ${c.page.marginLeft}mm;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: ${mode === 'screen' ? '#5a6472' : c.page.background};
    font-family: ${c.font.family};
    font-size: ${f.baseSize}pt;
    line-height: ${f.lineHeight};
    letter-spacing: ${f.letterSpacing}px;
    color: ${f.color};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .sheet {
    position: relative;
    ${mode === 'screen' && ctx.scale && ctx.scale < 1 ? `zoom: ${ctx.scale};` : ''}
    background: ${c.page.background};
    width: ${dim.w}mm;
    min-height: ${dim.h}mm;
    padding: ${c.page.marginTop}mm ${c.page.marginRight}mm ${c.page.marginBottom}mm ${c.page.marginLeft}mm;
    margin: ${mode === 'screen' ? '16px auto' : '0'};
    box-shadow: ${mode === 'screen' ? '0 6px 24px rgba(0,0,0,.35)' : 'none'};
    overflow: hidden;
  }

  @media print {
    html, body { background: ${c.page.background}; }
    .sheet {
      width: auto; min-height: 0; padding: 0; margin: 0;
      box-shadow: none; overflow: visible;
    }
  }

  .muted { color: ${f.mutedColor}; }
  .strong { font-weight: 700; }

  /* ── Header ── */
  .doc-header {
    background: ${col.tableHeaderBg === 'transparent' ? 'transparent' : c.header.background};
    color: ${c.header.textColor};
    padding: ${c.header.paddingY}px 0;
    ${c.header.borderBottom ? `border-bottom: ${c.header.borderBottomWidth}px solid ${col.accent};` : ''}
    margin-bottom: 8px;
    ${c.header.background !== '#ffffff' && c.header.background !== 'transparent'
      ? `padding-left:10px;padding-right:10px;margin-left:-10px;margin-right:-10px;width:calc(100% + 20px);`
      : ''}
  }
  .header-grid {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    text-align: ${alignCss(c.header.align)};
  }
  .header-left { flex: 1 1 66%; display: flex; flex-direction: column; align-items: ${flexAlign(c.header.align)}; }
  .header-right { flex: 0 0 32%; text-align: ${alignCss(c.docTitle.align)}; }
  .logo-above { text-align: ${alignCss(c.logo.align)}; }
  .logo-center { text-align: center; width: 100%; }
  .logo { display: block; max-width: 100%; }
  .header-left .logo { margin-left: ${c.logo.align === 'center' ? 'auto' : c.logo.align === 'right' ? 'auto' : '0'}; margin-right: ${c.logo.align === 'center' ? 'auto' : c.logo.align === 'left' ? 'auto' : '0'}; }
  .header-right .logo { margin-left: auto; }

  .co-name { font-size: ${f.titleSize}pt; font-weight: 700; line-height: 1.2; }
  .co-sub { font-size: ${f.baseSize}pt; color: ${f.mutedColor}; margin-top: 2px; }
  .co-contact, .co-tax { font-size: ${Math.max(6, f.baseSize - 1)}pt; color: ${f.mutedColor}; margin-top: 2px; }
  .doc-header .co-sub, .doc-header .co-contact, .doc-header .co-tax {
    color: ${c.header.textColor === '#ffffff' ? 'rgba(255,255,255,.85)' : f.mutedColor};
  }

  .doc-title {
    font-size: ${c.docTitle.size}pt;
    font-weight: 800;
    color: ${c.docTitle.color};
    letter-spacing: ${c.docTitle.letterSpacing}px;
    line-height: 1.1;
  }
  .title-only { text-align: ${alignCss(c.docTitle.align)}; margin-bottom: 14px; }

  /* ── Parties ── */
  .parties { display: flex; gap: 16px; margin-bottom: 9px; }
  .parties > * { flex: 1; }
  .parties .meta { flex: 0 0 34%; }
  .party-label, .block-label {
    font-size: ${Math.max(6, f.baseSize - 1)}pt;
    text-transform: uppercase;
    letter-spacing: .6px;
    font-weight: 700;
    color: ${col.accent};
    margin-bottom: 3px;
  }
  .party-name { font-weight: 700; font-size: ${f.headingSize}pt; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 2px 0; font-size: ${f.baseSize}pt; }
  .meta td:first-child { color: ${f.mutedColor}; }
  .meta td:last-child { text-align: right; font-weight: 600; }

  /* ── Items table ── */
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: fixed; }
  table.items th {
    background: ${col.tableHeaderBg};
    color: ${col.tableHeaderText};
    font-size: ${f.tableHeaderSize}pt;
    font-weight: ${c.table.headerBold ? 700 : 500};
    text-transform: ${c.table.headerUppercase ? 'uppercase' : 'none'};
    letter-spacing: .3px;
    padding: ${c.table.cellPaddingY}px ${c.table.cellPaddingX}px;
    ${borderAll ? `border: ${c.table.borderWidth}px solid ${col.border};` : ''}
    ${borderH ? `border-bottom: ${Math.max(1, c.table.borderWidth)}px solid ${col.accent};` : ''}
  }
  table.items td {
    font-size: ${f.tableBodySize}pt;
    padding: ${c.table.cellPaddingY}px ${c.table.cellPaddingX}px;
    vertical-align: top;
    word-wrap: break-word;
    ${borderAll ? `border: ${c.table.borderWidth}px solid ${col.border};` : ''}
    ${borderH ? `border-bottom: ${c.table.borderWidth}px solid ${col.border};` : ''}
  }
  ${c.table.zebra ? `table.items tbody tr:nth-child(even) td { background: ${col.rowAltBg}; }` : ''}
  table.items tbody tr { page-break-inside: avoid; }
  table.items thead { display: table-header-group; }
  .item-name { font-weight: 600; }
  .item-desc { font-size: ${Math.max(6, f.tableBodySize - 1)}pt; color: ${f.mutedColor}; margin-top: 2px; }
  .uom-sub { font-size: ${Math.max(5.5, f.tableBodySize - 1.5)}pt; color: ${f.mutedColor}; }
  .nb { white-space: nowrap; }
  .pad-row td { height: ${c.table.cellPaddingY * 2 + 10}px; }

  /* ── Totals ── */
  .totals-wrap { display: flex; page-break-inside: avoid; ${c.totals.align === 'left' ? 'flex-direction: row-reverse;' : ''} }
  .totals-spacer { flex: 1 1 auto; }
  .totals { flex: 0 0 ${c.totals.width}%; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 3px 8px; font-size: ${f.totalsSize}pt; }
  .totals .t-label { color: ${f.mutedColor}; }
  .totals .t-value { text-align: right; font-weight: 600; white-space: nowrap; }
  .totals tr.grand td {
    background: ${c.totals.grandTotalBg};
    border-top: 2px solid ${col.totalsHighlight};
    border-bottom: 2px solid ${col.totalsHighlight};
    font-weight: ${c.totals.boldGrandTotal ? 800 : 600};
    font-size: ${f.totalsSize + 1.5}pt;
    color: ${col.totalsHighlight};
  }
  .totals tr.grand .t-label { color: ${col.totalsHighlight}; }
  .totals tr.balance td { font-weight: 700; }
  .in-words {
    margin: 7px 0 9px;
    font-size: ${Math.max(6, f.baseSize - 0.5)}pt;
    padding: 6px 8px;
    background: ${col.rowAltBg};
    border-left: 3px solid ${col.accent};
    page-break-inside: avoid;
  }
  .in-words-label { color: ${f.mutedColor}; }

  /* Breathing room between the money and whatever follows it. */
  .after-totals { height: ${c.totals.spaceAfter ?? 14}px; }

  /* ── Payment summary ── */
  .pay-summary {
    margin-top: 9px;
    padding: 7px 10px;
    border-radius: 3px;
    border-left: 3px solid ${col.accent};
    background: ${col.rowAltBg};
    font-size: ${Math.max(6, f.baseSize - 0.5)}pt;
    page-break-inside: avoid;
  }
  .pay-summary.pay-paid {
    border-left-color: ${payPaid};
    background: ${tint(payPaid, payTint)};
  }
  .pay-summary.pay-partial {
    border-left-color: ${payPartial};
    background: ${tint(payPartial, payTint)};
  }
  .pay-summary.pay-unpaid {
    border-left-color: ${payUnpaid};
    background: ${tint(payUnpaid, payTint)};
  }
  .pay-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .pay-badge {
    font-weight: 800;
    letter-spacing: 0.06em;
    font-size: ${Math.max(6, f.baseSize - 1)}pt;
    white-space: nowrap;
  }
  .pay-paid .pay-badge { color: ${payPaid}; }
  .pay-partial .pay-badge { color: ${payPartial}; }
  .pay-unpaid .pay-badge { color: ${payUnpaid}; }
  .pay-detail { color: ${f.color}; }
  .pay-lines { width: 100%; border-collapse: collapse; margin-top: 5px; }
  .pay-lines td {
    padding: 2px 6px;
    font-size: ${Math.max(5.5, f.baseSize - 1)}pt;
    color: ${f.mutedColor};
    border-top: 1px solid ${col.border};
  }
  .pay-lines .pay-amt { text-align: right; white-space: nowrap; font-weight: 600; color: ${f.color}; }
  .terms-link a { color: inherit; text-decoration: underline; }
  .terms-link {
    margin-top: 4px;
    font-size: ${Math.max(5.5, f.baseSize - 1)}pt;
    color: ${col.accent};
    overflow-wrap: anywhere;
  }

  /* ── Blocks ── */
  .blocks { display: flex; gap: 16px; margin-top: 9px; page-break-inside: avoid; align-items: flex-start; }
  .blocks-col { flex: 1 1 0; min-width: 0; }
  .blocks-right { flex: 0 0 ${Math.min(34, Math.round(c.blocks.signatureWidth / 7))}%; display: flex; justify-content: flex-end; align-items: flex-end; align-self: flex-end; }
  .block { margin-bottom: 8px; font-size: ${Math.max(6, f.baseSize - 0.5)}pt; }
  .block:last-child { margin-bottom: 0; }
  .signature { text-align: center; }
  .sig-img { max-width: 100%; height: 48px; object-fit: contain; display: block; margin: 0 auto 2px; }
  .sig-space { height: 42px; }
  .sig-line { border-top: 1px solid ${f.color}; margin-bottom: 3px; }
  .sig-label { font-size: ${Math.max(6, f.baseSize - 1)}pt; color: ${f.mutedColor}; }
  .thanks {
    text-align: center;
    margin-top: 10px;
    font-size: ${f.baseSize}pt;
    color: ${col.accent};
    font-weight: 600;
    page-break-inside: avoid;
  }

  /* ── Footer ── */
  .doc-footer {
    margin-top: ${footerSticky ? 'auto' : '12px'};
    padding-top: ${footerSticky ? '12px' : '0'};
    padding: ${c.footer.paddingY}px 0;
    background: ${c.footer.background};
    color: ${c.footer.textColor};
    text-align: ${alignCss(c.footer.align)};
    font-size: ${f.footerSize}pt;
    ${c.footer.borderTop ? `border-top: 1px solid ${col.border};` : ''}
  }
  .doc-footer .page-num { margin-top: 2px; opacity: .8; }

  /* On screen the sheet is a column so the footer can be pushed to the foot of
     the page; in print a fixed footer sits at the bottom of every page, which
     is what Chromium gives us for paged media. */
  ${footerSticky ? `
  .sheet { display: flex; flex-direction: column; }
  .content { flex: 1 1 auto; display: flex; flex-direction: column; }
  .content > .blocks, .content > section:last-of-type { flex: 0 0 auto; }
  ` : ''}

  @media print {
    ${footerSticky ? `
    .sheet { display: block; }
    .content { display: block; }` : ''}
    .doc-footer.repeat {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      margin-top: 0;
    }
    .content-pad { padding-bottom: ${c.footer.enabled && footerRepeats ? 28 : 0}px; }
  }

  /* ── Terms page ── */
  .terms-page {
    page-break-before: always;
    break-before: page;
    padding-top: 4mm;
  }
  /* On screen the preview shows it as a second sheet of paper. */
  ${mode === 'screen' ? `
  .terms-page {
    margin-top: 18px;
    padding: ${c.page.marginTop}mm ${c.page.marginRight}mm ${c.page.marginBottom}mm ${c.page.marginLeft}mm;
    background: ${c.page.background};
    box-shadow: 0 6px 24px rgba(0,0,0,.35);
    min-height: ${dim.h}mm;
    width: ${dim.w}mm;
    margin-left: -${c.page.marginLeft}mm;
    margin-right: -${c.page.marginRight}mm;
    box-sizing: border-box;
  }` : ''}
  .tp-heading {
    margin: 0 0 4px;
    font-size: ${Math.max(10, f.headingSize + 3)}pt;
    color: ${c.docTitle.color};
    letter-spacing: .4px;
  }
  .tp-ref {
    font-size: ${Math.max(6, f.baseSize - 1)}pt;
    color: ${f.mutedColor};
    margin-bottom: 9px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${col.border};
  }
  .tp-body {
    font-size: ${termsSize}pt;
    line-height: ${termsLead};
    ${termsCols > 1 ? `column-count: ${termsCols}; column-gap: 9mm;` : ''}
  }
  .tp-body p { margin: 0 0 ${Math.round(termsLead * 3)}px; }
  .tp-body ul, .tp-body ol { margin: 0 0 ${Math.round(termsLead * 3)}px; padding-left: 16px; }
  .tp-body li { margin-bottom: ${Math.round(termsLead * 1.6)}px; break-inside: avoid; }
  .tp-body h1, .tp-body h2, .tp-body h3, .tp-body h4 {
    font-size: ${Math.max(7.5, termsSize + 1)}pt;
    margin: ${Math.round(termsLead * 5)}px 0 ${Math.round(termsLead * 2)}px;
    break-after: avoid;
  }
  .tp-body blockquote {
    margin: 0 0 ${Math.round(termsLead * 3)}px;
    padding-left: 8px;
    border-left: 2px solid ${col.border};
    color: ${f.mutedColor};
  }
  .tp-body a { color: inherit; text-decoration: underline; }
  .tp-body table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .tp-body th, .tp-body td { border: 1px solid ${col.border}; padding: 3px 5px; text-align: left; }
  .tp-link {
    margin-top: 10px;
    font-size: ${Math.max(6, termsSize - 0.5)}pt;
    color: ${f.mutedColor};
  }
  .tp-link a { color: inherit; text-decoration: underline; }
  .tp-accept { display: flex; gap: 18px; margin-top: 16mm; break-inside: avoid; }
  .tp-accept-box { flex: 1; }
  .tp-accept-line { border-bottom: 1px solid ${f.color}; height: 16px; }
  .tp-accept-label {
    font-size: ${Math.max(6, f.baseSize - 1)}pt;
    color: ${f.mutedColor};
    margin-top: 3px;
  }

  /* ── Stamp ── */
  /* Positioned against the invoice itself, so a terms page following it is
     never stamped and never has its heading covered. */
  .content { position: relative; }
  .stamp {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    transform-origin: center;
  }
  .stamp img { width: 100%; height: auto; display: block; }
  .stamp-ink {
    border: 3px solid currentColor;
    border-radius: 6px;
    padding: 7px 14px 9px;
    text-align: center;
    font-weight: 800;
    white-space: nowrap;
    background: ${c.page.background};
  }
  .stamp-ink .stamp-text {
    letter-spacing: 2px;
    line-height: 1.05;
  }
  .stamp-ink .stamp-sub {
    letter-spacing: 1px;
    font-weight: 700;
    margin-top: 3px;
    line-height: 1;
  }
  .stamp-top-left     { top: 12%;  left: 6%; }
  .stamp-top-right    { top: 12%;  right: 6%; }
  .stamp-middle-left  { top: 46%;  left: 6%; }
  .stamp-middle-right { top: 46%;  right: 6%; }
  .stamp-bottom-left  { bottom: 16%; left: 6%; }
  .stamp-bottom-right { bottom: 16%; right: 6%; }
  .stamp-center       { top: 42%; left: 50%; }
  @media print { .stamp { position: absolute; } }

  /* ── Watermark ── */
  .watermark {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }
  @media print { .watermark { position: fixed; } }
  .watermark > div { font-weight: 800; letter-spacing: 6px; white-space: nowrap; }
  .wm-top { align-items: flex-start; padding-top: 18%; }
  .wm-bottom { align-items: flex-end; padding-bottom: 18%; }
  .wm-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 40px 24px;
    width: 160%;
    height: 160%;
    align-content: center;
    justify-items: center;
    align-items: center;
  }
  .wm-tile { font-weight: 800; white-space: nowrap; }
  .sheet > .content { position: relative; z-index: 1; }
  `
}

// ─────────────────────── Document ───────────────────────

/** Body markup only - used by the in-app live preview inside an iframe. */
export function renderInvoiceBody(ctx: RenderContext): string {
  return `
  ${renderWatermark(ctx)}
  <div class="content content-pad">
    ${renderStamp(ctx)}
    ${renderHeader(ctx)}
    ${renderParties(ctx)}
    ${renderTable(ctx)}
    ${renderTotals(ctx)}
    ${renderBlocks(ctx)}
    ${renderFooter(ctx)}
  </div>
  ${renderTermsPage(ctx)}`
}

/** Complete standalone HTML document. */
export function renderInvoiceHtml(ctx: RenderContext): string {
  const title = `${ctx.invoice.invoice_no} - ${ctx.company.name}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${renderStyles(ctx)}</style>
</head>
<body>
<div class="sheet">${renderInvoiceBody(ctx)}</div>
</body>
</html>`
}

/** Totals helper re-exported so the UI and the renderer never diverge. */
export function invoiceTotals(invoice: InvoiceWithItems): ReturnType<typeof computeTotals> {
  return computeTotals(invoice)
}

export { round2 }
