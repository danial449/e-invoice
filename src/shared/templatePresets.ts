import type { TemplateConfig, TemplateColumn } from './types'

export const DEFAULT_COLUMNS: TemplateColumn[] = [
  { key: 'sno', label: '#', enabled: true, width: 5, align: 'center' },
  { key: 'name', label: 'Description', enabled: true, width: 32, align: 'left' },
  { key: 'description', label: 'Details', enabled: false, width: 14, align: 'left' },
  { key: 'size', label: 'Size', enabled: false, width: 10, align: 'left' },
  { key: 'uom', label: 'Unit', enabled: true, width: 10, align: 'center' },
  { key: 'qty', label: 'Qty', enabled: true, width: 9, align: 'right' },
  { key: 'unit_price', label: 'Rate', enabled: true, width: 14, align: 'right' },
  { key: 'discount', label: 'Disc %', enabled: false, width: 8, align: 'right' },
  { key: 'tax', label: 'Tax %', enabled: false, width: 8, align: 'right' },
  { key: 'total', label: 'Amount', enabled: true, width: 16, align: 'right' }
]

export const BASE_CONFIG: TemplateConfig = {
  page: {
    size: 'A4',
    orientation: 'portrait',
    marginTop: 10,
    marginRight: 12,
    marginBottom: 10,
    marginLeft: 12,
    background: '#ffffff'
  },
  font: {
    family: "'Inter', 'Segoe UI', Arial, sans-serif",
    baseSize: 10,
    titleSize: 18,
    headingSize: 12,
    tableHeaderSize: 9.5,
    tableBodySize: 9.5,
    totalsSize: 10.5,
    footerSize: 8.5,
    lineHeight: 1.45,
    letterSpacing: 0,
    color: '#1a1a1a',
    mutedColor: '#6b7280'
  },
  colors: {
    accent: '#0f766e',
    tableHeaderBg: '#0f766e',
    tableHeaderText: '#ffffff',
    rowAltBg: '#f6f8f8',
    border: '#d8dee2',
    totalsHighlight: '#0f766e'
  },
  logo: {
    enabled: true,
    dataUrl: '',
    width: 150,
    height: 0,
    align: 'left',
    position: 'header-left',
    opacity: 1,
    marginBottom: 6
  },
  header: {
    enabled: true,
    showOnAllPages: false,
    title: '{{company_name}}',
    subtitle: '{{company_address}}',
    align: 'left',
    background: '#ffffff',
    textColor: '#1a1a1a',
    paddingY: 6,
    showCompanyBlock: true,
    showContactBlock: true,
    borderBottom: true,
    borderBottomWidth: 2
  },
  docTitle: {
    enabled: true,
    text: 'INVOICE',
    align: 'right',
    color: '#0f766e',
    size: 22,
    uppercase: true,
    letterSpacing: 2
  },
  parties: {
    showBillTo: true,
    showShipTo: false,
    billToLabel: 'Bill To',
    shipToLabel: 'Ship To',
    showMeta: true,
    showPoNumber: false,
    showCustomerTaxIds: false
  },
  table: {
    columns: DEFAULT_COLUMNS,
    zebra: true,
    borders: 'horizontal',
    borderWidth: 1,
    cellPaddingY: 5,
    cellPaddingX: 8,
    headerUppercase: true,
    headerBold: true,
    minRows: 0
  },
  totals: {
    align: 'right',
    width: 42,
    showSubtotal: true,
    showDiscount: true,
    showTax: true,
    showShipping: true,
    // On whenever a round-off is applied, otherwise the printed figures do
    // not add up to the total and the invoice looks wrong to the customer.
    // The row is skipped automatically when the adjustment is zero.
    showRoundOff: true,
    showPaid: false,
    showBalance: false,
    showAmountInWords: true,
    boldGrandTotal: true,
    grandTotalBg: '#f0fdfa',
    showPaymentSummary: true,
    spaceAfter: 14
  },
  footer: {
    enabled: true,
    showOnAllPages: true,
    text: '{{company_name}}  ·  {{company_phone}}  ·  {{company_email}}  ·  {{company_website}}',
    align: 'center',
    background: '#ffffff',
    textColor: '#6b7280',
    paddingY: 8,
    borderTop: true,
    showPageNumbers: true,
    pageNumberFormat: 'Page {{page}} of {{pages}}'
  },
  blocks: {
    showNotes: true,
    notesLabel: 'Notes',
    showTerms: true,
    termsLabel: 'Terms & Conditions',
    showBankDetails: true,
    bankLabel: 'Payment Details',
    showSignature: true,
    signatureLabel: 'Authorised Signature',
    signatureWidth: 160,
    showThankYou: true,
    thankYouText: 'Thank you for your business!'
  },
  watermark: {
    enabled: false,
    type: 'text',
    text: 'PACKAGING BOX',
    imageDataUrl: '',
    useStatusText: true,
    fontSize: 72,
    color: '#0f766e',
    opacity: 0.07,
    rotation: -30,
    width: 400,
    repeat: false,
    position: 'center'
  }
}

/** Deep clone helper so presets are never mutated. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function preset(name: string, patch: (c: TemplateConfig) => void): { name: string; config: TemplateConfig } {
  const c = clone(BASE_CONFIG)
  patch(c)
  return { name, config: c }
}

export const TEMPLATE_PRESETS = [
  preset('Classic Teal', () => {
    /* base config as-is */
  }),

  preset('Modern Blue', (c) => {
    c.colors.accent = '#1d4ed8'
    c.colors.tableHeaderBg = '#1d4ed8'
    c.colors.rowAltBg = '#f1f5ff'
    c.colors.totalsHighlight = '#1d4ed8'
    c.docTitle.color = '#1d4ed8'
    c.totals.grandTotalBg = '#eff6ff'
    c.table.borders = 'none'
    c.table.cellPaddingY = 9
    c.font.family = "'Segoe UI', Roboto, Arial, sans-serif"
  }),

  preset('Minimal Mono', (c) => {
    c.colors.accent = '#111111'
    c.colors.tableHeaderBg = '#ffffff'
    c.colors.tableHeaderText = '#111111'
    c.colors.rowAltBg = '#ffffff'
    c.colors.border = '#111111'
    c.colors.totalsHighlight = '#111111'
    c.docTitle.color = '#111111'
    c.docTitle.size = 20
    c.table.zebra = false
    c.table.borders = 'horizontal'
    c.table.headerBold = true
    c.totals.grandTotalBg = '#f4f4f4'
    c.header.borderBottomWidth = 1
    c.logo.width = 120
  }),

  preset('Bold Header', (c) => {
    c.colors.accent = '#b45309'
    c.colors.tableHeaderBg = '#b45309'
    c.colors.rowAltBg = '#fffbeb'
    c.colors.totalsHighlight = '#b45309'
    c.header.background = '#b45309'
    c.header.textColor = '#ffffff'
    c.header.paddingY = 18
    c.header.borderBottom = false
    c.docTitle.color = '#ffffff'
    c.docTitle.align = 'right'
    c.logo.position = 'header-left'
    c.totals.grandTotalBg = '#fef3c7'
    c.footer.background = '#fffbeb'
  }),

  preset('Compact Dense', (c) => {
    c.font.baseSize = 8.5
    c.font.tableBodySize = 8
    c.font.tableHeaderSize = 8
    c.font.totalsSize = 9
    c.docTitle.size = 18
    c.table.cellPaddingY = 4
    c.table.cellPaddingX = 5
    c.page.marginTop = 8
    c.page.marginBottom = 8
    c.page.marginLeft = 10
    c.page.marginRight = 10
    c.logo.width = 110
    c.blocks.showThankYou = false
    c.totals.showAmountInWords = false
  }),

  preset('Thermal 80mm', (c) => {
    c.page.size = 'A5'
    c.page.marginTop = 4
    c.page.marginBottom = 4
    c.page.marginLeft = 4
    c.page.marginRight = 4
    c.font.family = "'Consolas', 'Courier New', monospace"
    c.font.baseSize = 9
    c.font.tableBodySize = 8.5
    c.font.tableHeaderSize = 8.5
    c.docTitle.size = 14
    c.docTitle.align = 'center'
    c.docTitle.color = '#000000'
    c.colors.accent = '#000000'
    c.colors.tableHeaderBg = '#ffffff'
    c.colors.tableHeaderText = '#000000'
    c.colors.border = '#000000'
    c.colors.totalsHighlight = '#000000'
    c.table.zebra = false
    c.table.borders = 'horizontal'
    c.table.cellPaddingY = 3
    c.table.columns = c.table.columns.map((col) =>
      ['description', 'size', 'discount', 'tax', 'uom'].includes(col.key)
        ? { ...col, enabled: false }
        : col
    )
    c.header.align = 'center'
    c.header.title = '{{company_name}}'
    c.logo.align = 'center'
    c.logo.position = 'above-title'
    c.logo.width = 120
    c.totals.width = 100
    c.totals.showAmountInWords = false
    c.blocks.showSignature = false
    c.blocks.showBankDetails = false
    c.footer.showPageNumbers = false
  })
]

export const DEFAULT_TEMPLATE_CONFIG = BASE_CONFIG

/**
 * Merge a stored (possibly older / partial) config onto the current defaults so
 * newly added options never come back undefined.
 */
export function normalizeConfig(stored: unknown): TemplateConfig {
  const base = clone(BASE_CONFIG)
  if (!stored || typeof stored !== 'object') return base
  const s = stored as Record<string, unknown>

  const merge = (target: Record<string, unknown>, src: unknown): void => {
    if (!src || typeof src !== 'object') return
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) {
        target[k] = v
      } else if (typeof v === 'object' && typeof target[k] === 'object' && target[k] !== null) {
        merge(target[k] as Record<string, unknown>, v)
      } else {
        target[k] = v
      }
    }
  }
  merge(base as unknown as Record<string, unknown>, s)

  // Guarantee every known column exists exactly once, preserving saved order.
  const saved = Array.isArray(base.table.columns) ? base.table.columns : []
  const byKey = new Map(saved.filter((c) => c && c.key).map((c) => [c.key, c]))
  const ordered: TemplateColumn[] = []
  for (const c of saved) {
    if (c && c.key && byKey.get(c.key) === c) ordered.push({ ...DEFAULT_COLUMNS.find((d) => d.key === c.key)!, ...c })
  }
  for (const d of DEFAULT_COLUMNS) {
    if (!ordered.some((c) => c.key === d.key)) ordered.push({ ...d })
  }
  base.table.columns = ordered
  return base
}
