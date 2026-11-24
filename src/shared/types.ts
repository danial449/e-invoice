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
  /**
   * False = unlimited stock. The quantity is not tracked, invoices never
   * deduct it, and it is never reported as low or out of stock.
   */
  track_stock: boolean
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

// ───────────────────────────── Brands ─────────────────────────────

/**
 * One business you invoice as. Everything identifying the seller on an invoice
 * comes from here, so several brands can share one catalogue and one customer
 * list while each keeps its own letterhead and its own number sequence.
 */
export interface Brand {
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
  default_terms: string
  default_notes: string
  terms_url: string
  terms_link_text: string
  invoice_prefix: string
  invoice_next_number: number
  invoice_pad: number
  is_default: boolean
  is_active: boolean
  sort_order: number
  created_at?: string
  updated_at?: string
}

export type BrandInput = Omit<Brand, 'id' | 'created_at' | 'updated_at'>

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
  /** The wording of that link. Falls back to "Terms & Conditions". */
  terms_link_text: string
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
  /** The brand this invoice was issued under. */
  brand_id?: number | null
  /** That brand's details as they stood when the invoice was saved. */
  brand_snapshot?: Record<string, unknown>
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
    /** Colour of the PAID IN FULL band. Default #15803d. */
    paidColor?: string
    /** Colour of the PARTIALLY PAID band. Default #b45309. */
    partialColor?: string
    /** Colour of the UNPAID band. Default #b91c1c. */
    unpaidColor?: string
    /** How strongly the band is tinted with its colour, 0-100. Default 8. */
    paymentTint?: number
    /** Blank space in px between the totals block and what follows. Default 14. */
    spaceAfter?: number
  }

  /**
   * A rubber stamp placed over the invoice - PAID, CANCELLED and so on. Unlike
   * the watermark this is small, opaque and sits in one corner, the way a
   * stamp would actually be pressed onto paper.
   */
  stamp?: {
    enabled: boolean
    /** auto = choose from the invoice status; or force one design. */
    design: 'auto' | 'paid' | 'partial' | 'unpaid' | 'cancelled' | 'draft' | 'duplicate' | 'original' | 'received' | 'custom'
    /** Used when design is `custom`: a PNG/JPG/SVG data URL. */
    imageDataUrl: string
    color: string
    width: number
    opacity: number
    rotation: number
    position: 'top-left' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-right' | 'center'
    offsetX: number
    offsetY: number
    /** Hide the stamp on drafts, which are not usually sent out. */
    hideOnDraft?: boolean
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
    /**
     * Pin the footer to the bottom of the page instead of letting it sit
     * directly under the content. Default on. In a multi-page invoice this
     * means the bottom of every page.
     */
    stickToBottom?: boolean
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
    /**
     * Signature for this template only, drawn or uploaded in the designer.
     * Empty falls back to the one in Settings - Company, the same way the logo
     * does, so most templates need nothing set here.
     */
    signatureDataUrl?: string
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
  // ── WooCommerce / WordPress export columns ──
  /** simple | variable | variation | grouped | external */
  | 'wc_type'
  /** WooCommerce product ID, used to link a variation to its parent */
  | 'wc_id'
  /** "id:123" or a parent SKU */
  | 'wc_parent'
  /** "1"/"0" — whether WooCommerce considers it in stock */
  | 'in_stock'
  /** discounted price; used in place of the regular price when present */
  | 'sale_price'
  /** published / draft, mapped to the active flag */
  | 'published'
  | 'weight'
  | 'length'
  | 'width'
  | 'height'

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

  /**
   * What to do when the sheet gives no usable stock figure.
   * - `unlimited`         blank stock means unlimited (WooCommerce's
   *                       "stock management off"), a number is used as-is
   * - `unlimited-if-zero` blank *or* zero means unlimited
   * - `zero`              blank means zero, and everything is tracked
   */
  unknownStock?: 'unlimited' | 'unlimited-if-zero' | 'zero'

  /**
   * WooCommerce variable products are containers — the sellable items are
   * their variations, which carry the real SKU, price and stock.
   * - `skip`   import only the variations (default)
   * - `import` import the parent as a product too
   * A parent with no variations in the file is always imported, otherwise it
   * would vanish.
   */
  variableParents?: 'skip' | 'import'

  /** Append the variation's attribute values to its name, e.g. "Box — Red, Large". */
  nameVariationsFromAttributes?: boolean
}

export interface ImportResult {
  inserted: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
  /** Set when the file was recognised as a WooCommerce product export. */
  woocommerce?: {
    detected: boolean
    simple: number
    variations: number
    variableParents: number
    other: number
    /** Variable parents skipped because their variations were imported instead. */
    parentsSkipped: number
  }
  /** Products brought in with stock not tracked. */
  unlimitedStock?: number
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
/** One entry in an invoice's audit trail. */
export type InvoiceEventKind =
  | 'created'
  | 'updated'
  | 'status'
  | 'payment'
  | 'payment_removed'
  | 'duplicated'
  | 'deleted'

export interface InvoiceEvent {
  id: number
  invoice_id: number | null
  invoice_no: string
  customer_id: number | null
  customer_name: string
  kind: InvoiceEventKind
  summary: string
  detail: Record<string, unknown>
  created_at: string
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
