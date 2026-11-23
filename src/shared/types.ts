// ───────────────────────────── Catalogue ─────────────────────────────

export interface Category {
  id: number
  name: string
  slug: string
  parent_id: number | null
  sort_order: number
}

export interface Product {
  id: number
  sku: string | null
  name: string
  description: string
  category_id: number | null
  category_name?: string | null
  size_text: string
  material: string
  color: string
  unit: string
  pack_size: number
  unit_price: number
  pack_price: number
  cost_price: number
  tax_rate: number
  stock_qty: number
  reorder_level: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export type ProductInput = Omit<Product, 'id' | 'category_name' | 'created_at' | 'updated_at'>

export interface StockMovement {
  id: number
  product_id: number
  product_name?: string
  change_qty: number
  kind: 'purchase' | 'sale' | 'adjustment' | 'return' | 'import' | 'opening'
  reference: string
  note: string
  created_at: string
}

// ───────────────────────────── Customers ─────────────────────────────

export interface Customer {
  id: number
  name: string
  company: string
  phone: string
  email: string
  address: string
  city: string
  ntn: string
  strn: string
  notes: string
  is_active: boolean
  created_at?: string
}

export type CustomerInput = Omit<Customer, 'id' | 'created_at'>

// ───────────────────────────── Company ─────────────────────────────

export interface CompanySettings {
  id: number
  name: string
  legal_name: string
  address: string
  city: string
  country: string
  phone: string
  phone_alt: string
  email: string
  website: string
  ntn: string
  strn: string
  logo_data_url: string
  signature_data_url: string
  bank_details: string
  currency_symbol: string
  currency_code: string
  default_tax_rate: number
  tax_enabled_default: boolean
  invoice_prefix: string
  invoice_next_number: number
  invoice_pad: number
  default_terms: string
  default_notes: string
  /** Shown under the terms block on every invoice, e.g. the published T&Cs page. */
  terms_url: string
}

// ───────────────────────────── Invoices ─────────────────────────────

export type Uom = 'pcs' | 'pack'
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'partial' | 'cancelled'

export interface InvoiceItem {
  id?: number
  invoice_id?: number
  product_id: number | null
  name: string
  description: string
  uom: Uom
  pack_size: number
  qty: number
  unit_price: number
  discount_pct: number
  tax_rate: number
  line_total: number
  sort_order: number
}

export interface Invoice {
  id: number
  invoice_no: string
  invoice_date: string
  due_date: string | null
  customer_id: number | null
  customer_snapshot: Partial<Customer>
  template_id: number | null
  po_number: string
  subtotal: number
  discount_type: 'amount' | 'percent'
  discount_value: number
  discount_amount: number
  tax_enabled: boolean
  tax_amount: number
  shipping: number
  round_off: number
  total: number
  paid_amount: number
  status: InvoiceStatus
  stock_applied: boolean
  notes: string
  terms: string
  created_at?: string
  updated_at?: string
}

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[]
}

export type InvoiceInput = Omit<
  Invoice,
  'id' | 'invoice_no' | 'created_at' | 'updated_at' | 'subtotal' | 'discount_amount' | 'tax_amount' | 'total'
> & {
  id?: number
  invoice_no?: string
  items: InvoiceItem[]
}

export interface Payment {
  id: number
  invoice_id: number
  amount: number
  method: string
  paid_on: string
  note: string
}

// ─────────────────────── Invoice template config ───────────────────────

export type Align = 'left' | 'center' | 'right'
export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A5'

export interface TemplateColumn {
  key: 'sno' | 'name' | 'description' | 'size' | 'uom' | 'qty' | 'unit_price' | 'discount' | 'tax' | 'total'
  label: string
  enabled: boolean
  width: number // percent of table width
  align: Align
}

export interface TemplateConfig {
  // ── Page ──
  page: {
    size: PageSize
    orientation: 'portrait' | 'landscape'
    marginTop: number // mm
    marginRight: number
    marginBottom: number
    marginLeft: number
    background: string
  }

  // ── Typography ──
  font: {
    family: string
    baseSize: number // pt
    titleSize: number
    headingSize: number
    tableHeaderSize: number
    tableBodySize: number
    totalsSize: number
    footerSize: number
    lineHeight: number
    letterSpacing: number
    color: string
    mutedColor: string
  }

  // ── Colours ──
  colors: {
    accent: string
    tableHeaderBg: string
    tableHeaderText: string
    rowAltBg: string
    border: string
    totalsHighlight: string
  }

  // ── Logo ──
  logo: {
    enabled: boolean
    /** empty = fall back to company settings logo */
    dataUrl: string
    width: number // px
    height: number // px, 0 = auto
    align: Align
    position: 'header-left' | 'header-center' | 'header-right' | 'above-title'
    opacity: number
    marginBottom: number
  }

  // ── Header band ──
  header: {
    enabled: boolean
    showOnAllPages: boolean
    title: string // supports {{company_name}} etc.
    subtitle: string
    align: Align
    background: string
    textColor: string
    paddingY: number
    showCompanyBlock: boolean
    showContactBlock: boolean
    borderBottom: boolean
    borderBottomWidth: number
  }

  // ── Document title (INVOICE) ──
  docTitle: {
    enabled: boolean
    text: string
    align: Align
    color: string
    size: number
    uppercase: boolean
    letterSpacing: number
  }

  // ── Parties block ──
  parties: {
    showBillTo: boolean
    showShipTo: boolean
    billToLabel: string
    shipToLabel: string
    showMeta: boolean // invoice no / date / due date
    showPoNumber: boolean
    showCustomerTaxIds: boolean
  }

  // ── Items table ──
  table: {
    columns: TemplateColumn[]
    zebra: boolean
    borders: 'all' | 'horizontal' | 'none'
    borderWidth: number
    cellPaddingY: number
    cellPaddingX: number
    headerUppercase: boolean
    headerBold: boolean
    minRows: number // pad short invoices with blank rows
  }

  // ── Totals ──
  totals: {
    align: 'left' | 'right'
    width: number // percent
    showSubtotal: boolean
    showDiscount: boolean
    showTax: boolean
    showShipping: boolean
    showRoundOff: boolean
    showPaid: boolean
    showBalance: boolean
    showAmountInWords: boolean
    boldGrandTotal: boolean
    grandTotalBg: string
    /** Print the "PAID IN FULL / PARTIALLY PAID / UNPAID" band. Default on. */
    showPaymentSummary?: boolean
    /** Blank space in px between the totals block and what follows. Default 14. */
    spaceAfter?: number
  }

  // ── Footer ──
  footer: {
    enabled: boolean
    showOnAllPages: boolean
    text: string
    align: Align
    background: string
    textColor: string
    paddingY: number
    borderTop: boolean
    showPageNumbers: boolean
    pageNumberFormat: string // e.g. "Page {{page}} of {{pages}}"
  }

  // ── Notes / terms / signature ──
  blocks: {
    showNotes: boolean
    notesLabel: string
    showTerms: boolean
    termsLabel: string
    showBankDetails: boolean
    bankLabel: string
    showSignature: boolean
    signatureLabel: string
    signatureWidth: number
    showThankYou: boolean
    thankYouText: string
  }

  // ── Watermark ──
  watermark: {
    enabled: boolean
    type: 'text' | 'image'
    text: string
    imageDataUrl: string
    /** when true and status is draft/cancelled, text is replaced by the status */
    useStatusText: boolean
    fontSize: number
    color: string
    opacity: number
    rotation: number
    width: number // px, for image
    repeat: boolean
    position: 'center' | 'diagonal' | 'top' | 'bottom'
  }
}

export interface InvoiceTemplate {
  id: number
  name: string
  base: string
  is_default: boolean
  config: TemplateConfig
  created_at?: string
  updated_at?: string
}

// ───────────────────────────── CSV import ─────────────────────────────

export type CsvField =
  | 'ignore'
  | 'sku'
  | 'name'
  | 'description'
  | 'category'
  | 'size_text'
  | 'material'
  | 'color'
  | 'unit'
  | 'pack_size'
  | 'unit_price'
  | 'pack_price'
  | 'cost_price'
  | 'tax_rate'
  | 'stock_qty'
  | 'reorder_level'

export interface CsvMapping {
  [csvHeader: string]: CsvField
}

export interface ImportOptions {
  mapping: CsvMapping
  matchBy: 'sku' | 'name'
  onDuplicate: 'update' | 'skip'
  createCategories: boolean
  /** if the sheet has a pack price but no per-piece price, derive it */
  derivePrices: boolean
  defaultPackSize: number
}

export interface ImportResult {
  inserted: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

// ───────────────────────────── Reports ─────────────────────────────

export interface DashboardStats {
  productCount: number
  activeProductCount: number
  customerCount: number
  invoiceCount: number
  lowStockCount: number
  outOfStockCount: number
  stockValue: number
  revenueThisMonth: number
  revenueTotal: number
  outstanding: number
  recentInvoices: Invoice[]
  lowStockProducts: Product[]
  topProducts: { name: string; qty: number; revenue: number }[]
  monthlyRevenue: { month: string; revenue: number }[]
}

export interface ApiOk<T> {
  ok: true
  data: T
}
export interface ApiErr {
  ok: false
  error: string
}
export type ApiResult<T> = ApiOk<T> | ApiErr

export interface DbConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
}
