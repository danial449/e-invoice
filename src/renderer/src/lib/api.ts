import type {
  ApiResult, Brand, BrandInput, Category, CompanySettings, Customer, CustomerInput,
  DashboardStats, DbConfig,
  ImportOptions, ImportResult, Invoice, InvoiceEvent, InvoiceStatus, InvoiceTemplate, InvoiceWithItems,
  Payment, Product, ProductInput, StockMovement, TemplateConfig
} from '@shared/types'

type Channel = string

/**
 * Fired when the main process reports it has no database connection, so the
 * shell can drop back to the connect screen instead of rendering a UI whose
 * every request fails.
 */
export const DB_DISCONNECTED_EVENT = 'db-disconnected'

let lastDisconnectSignal = 0

function noteDisconnected(): void {
  // One signal per 2s, however many requests fail together.
  const now = Date.now()
  if (now - lastDisconnectSignal < 2000) return
  lastDisconnectSignal = now
  window.dispatchEvent(new Event(DB_DISCONNECTED_EVENT))
}

async function call<T>(channel: Channel, ...args: unknown[]): Promise<T> {
  const res = (await window.api.invoke(channel as never, ...args)) as ApiResult<T> | undefined
  if (!res) throw new Error(`No response from ${channel}.`)
  if (!res.ok) {
    if (res.error.startsWith('Not connected to the database')) noteDisconnected()
    throw new Error(res.error)
  }
  return res.data
}

export interface DbStatus {
  connected: boolean
  config: DbConfig
  hasSavedConfig: boolean
}

export interface BackupSettings {
  folder: string
  autoEnabled: boolean
  autoEveryHours: number
  keepCount: number
  toolDir: string
  lastRunAt: string | null
}

export interface BackupFile {
  file: string
  name: string
  size: number
  createdAt: string
  auto: boolean
}

export interface BackupToolStatus {
  ok: boolean
  dir: string
  toolVersion: number
  serverVersion: number
  message: string
}

export interface CsvPreview {
  headers: string[]
  rows: Record<string, string>[]
  totalRows: number
  suggestedMapping: Record<string, ImportOptions['mapping'][string]>
  delimiter: string
}

export interface ProductListFilter {
  search?: string
  categoryId?: number | null
  includeChildren?: boolean
  stockFilter?: 'all' | 'low' | 'out' | 'in'
  activeOnly?: boolean
  sortBy?: 'name' | 'sku' | 'unit_price' | 'stock_qty' | 'updated_at'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface InvoiceListFilter {
  search?: string
  status?: InvoiceStatus | 'all'
  customerId?: number | null
  dateFrom?: string | null
  dateTo?: string | null
  limit?: number
  offset?: number
}

export const api = {
  // ── Database ──
  dbStatus: () => call<DbStatus>('db:status'),
  dbTest: (cfg: DbConfig) => call<{ serverVersion: string; databaseExists: boolean }>('db:test', cfg),
  dbConnect: (cfg: DbConfig, remember: boolean) => call<{ connected: boolean }>('db:connect', cfg, remember),
  dbDisconnect: () => call<{ connected: boolean }>('db:disconnect'),
  dbForget: () => call<{ connected: boolean }>('db:forget'),

  // ── Products ──
  listProducts: (f: ProductListFilter = {}) => call<{ rows: Product[]; total: number }>('products:list', f),
  getProduct: (id: number) => call<Product | null>('products:get', id),
  searchProducts: (term: string, limit = 25) => call<Product[]>('products:search', term, limit),
  createProduct: (input: ProductInput) => call<Product>('products:create', input),
  updateProduct: (id: number, input: ProductInput) => call<Product>('products:update', id, input),
  deleteProduct: (id: number) => call<{ deleted: boolean; deactivated: boolean }>('products:delete', id),
  bulkDeleteProducts: (ids: number[]) =>
    call<{ deleted: number; deactivated: number }>('products:bulkDelete', ids),
  adjustStock: (args: {
    productId: number
    changeQty: number
    kind: StockMovement['kind']
    reference?: string
    note?: string
  }) => call<Product>('products:adjustStock', args),
  listMovements: (productId?: number, limit = 200) =>
    call<StockMovement[]>('products:movements', productId, limit),

  // ── Categories ──
  listCategories: () => call<Category[]>('categories:list'),
  createCategory: (name: string, parentId: number | null = null) =>
    call<Category>('categories:create', name, parentId),
  updateCategory: (id: number, name: string, parentId: number | null) =>
    call<Category>('categories:update', id, name, parentId),
  deleteCategory: (id: number) => call<void>('categories:delete', id),

  // ── Customers ──
  listCustomers: (search = '', activeOnly = true) => call<Customer[]>('customers:list', search, activeOnly),
  getCustomer: (id: number) => call<Customer | null>('customers:get', id),
  createCustomer: (input: CustomerInput) => call<Customer>('customers:create', input),
  updateCustomer: (id: number, input: CustomerInput) => call<Customer>('customers:update', id, input),
  deleteCustomer: (id: number) => call<{ deleted: boolean; deactivated: boolean }>('customers:delete', id),
  customerLedger: (id: number) =>
    call<{ invoiceCount: number; totalBilled: number; totalPaid: number; outstanding: number }>(
      'customers:ledger',
      id
    ),

  // ── Invoices ──
  listInvoices: (f: InvoiceListFilter = {}) =>
    call<{ rows: (Invoice & { customer_name: string | null })[]; total: number }>('invoices:list', f),
  getInvoice: (id: number) => call<InvoiceWithItems | null>('invoices:get', id),
  saveInvoice: (input: unknown) => call<InvoiceWithItems>('invoices:save', input),
  setInvoiceStatus: (id: number, status: InvoiceStatus) =>
    call<InvoiceWithItems>('invoices:setStatus', id, status),
  deleteInvoice: (id: number) => call<void>('invoices:delete', id),
  duplicateInvoice: (id: number) => call<InvoiceWithItems>('invoices:duplicate', id),
  nextInvoiceNo: () => call<string>('invoices:nextNo'),
  listPayments: (id: number) => call<Payment[]>('invoices:payments', id),
  invoiceHistory: (id: number, limit?: number) => call<InvoiceEvent[]>('invoices:history', id, limit),
  recentHistory: (limit?: number) => call<InvoiceEvent[]>('invoices:recentHistory', limit),
  customerHistory: (id: number, limit?: number) => call<InvoiceEvent[]>('customers:history', id, limit),
  addPayment: (args: { invoiceId: number; amount: number; method: string; paidOn: string; note?: string }) =>
    call<InvoiceWithItems>('invoices:addPayment', args),
  deletePayment: (id: number) => call<void>('invoices:deletePayment', id),
  invoiceHtml: (id: number, templateId?: number | null) => call<string>('invoices:html', id, templateId),
  previewHtml: (invoice: InvoiceWithItems, config: TemplateConfig, scale?: number) =>
    call<string>('invoices:previewHtml', invoice, config, scale),

  // ── Templates ──
  listTemplates: () => call<InvoiceTemplate[]>('templates:list'),
  getTemplate: (id: number) => call<InvoiceTemplate | null>('templates:get', id),
  defaultTemplate: () => call<InvoiceTemplate>('templates:default'),
  createTemplate: (name: string, config: TemplateConfig) =>
    call<InvoiceTemplate>('templates:create', name, config),
  updateTemplate: (id: number, patch: { name?: string; config?: TemplateConfig }) =>
    call<InvoiceTemplate>('templates:update', id, patch),
  duplicateTemplate: (id: number, name?: string) => call<InvoiceTemplate>('templates:duplicate', id, name),
  setDefaultTemplate: (id: number) => call<void>('templates:setDefault', id),
  deleteTemplate: (id: number) => call<void>('templates:delete', id),
  restorePresets: () => call<number>('templates:restorePresets'),

  // ── Brands ──
  listBrands: (activeOnly = false) => call<Brand[]>('brands:list', activeOnly),
  getBrand: (id: number) => call<Brand | null>('brands:get', id),
  defaultBrand: () => call<Brand | null>('brands:default'),
  createBrand: (input: Partial<BrandInput>) => call<Brand>('brands:create', input),
  updateBrand: (id: number, input: Partial<BrandInput>) => call<Brand>('brands:update', id, input),
  duplicateBrand: (id: number, name?: string) => call<Brand>('brands:duplicate', id, name),
  setDefaultBrand: (id: number) => call<void>('brands:setDefault', id),
  deleteBrand: (id: number) => call<{ deleted: boolean; deactivated: boolean }>('brands:delete', id),
  brandNextNo: (id: number) => call<string>('brands:nextNo', id),

  // ── Settings ──
  getSettings: () => call<CompanySettings>('settings:get'),
  updateSettings: (patch: Partial<CompanySettings>) => call<CompanySettings>('settings:update', patch),

  // ── Reports ──
  dashboard: () => call<DashboardStats>('reports:dashboard'),
  salesReport: (from: string, to: string) =>
    call<{
      summary: { invoices: number; subtotal: number; discount: number; tax: number; total: number; paid: number }
      byCustomer: { name: string; invoices: number; total: number }[]
      byProduct: { name: string; qty: number; total: number }[]
      byDay: { day: string; total: number }[]
    }>('reports:sales', from, to),

  // ── CSV ──
  pickCsv: () => call<string | null>('csv:pick'),
  previewCsv: (filePath: string) => call<CsvPreview>('csv:preview', filePath),
  importCsv: (filePath: string, options: ImportOptions) =>
    call<ImportResult>('csv:import', filePath, options),
  saveSampleCsv: () => call<{ saved: boolean; filePath?: string }>('csv:saveSample'),
  exportProductsCsv: () =>
    call<{ saved: boolean; filePath?: string; count?: number }>('csv:exportProducts'),

  // ── PDF ──
  savePdf: (invoiceId: number, templateId?: number | null) =>
    call<{ saved: boolean; filePath?: string }>('pdf:save', invoiceId, templateId),
  exportManyPdf: (ids: number[], templateId?: number | null) =>
    call<{ saved: number; folder?: string; errors: { id: number; message: string }[] }>(
      'pdf:exportMany',
      ids,
      templateId
    ),
  printInvoice: (invoiceId: number, templateId?: number | null) =>
    call<{ printed: boolean }>('pdf:print', invoiceId, templateId),

  // ── Backup & restore ──
  backupSettings: () => call<BackupSettings>('backup:settings'),
  saveBackupSettings: (patch: Partial<BackupSettings>) =>
    call<BackupSettings>('backup:saveSettings', patch),
  backupToolStatus: () => call<BackupToolStatus>('backup:toolStatus'),
  listBackups: () => call<BackupFile[]>('backup:list'),
  runBackup: () =>
    call<{ file: string; name: string; size: number; durationMs: number; pruned: number }>('backup:run'),
  restoreBackup: (file: string) =>
    call<{ restored: string; safetyCopy: string | null }>('backup:restore', file),
  deleteBackup: (file: string) => call<void>('backup:delete', file),
  revealBackup: (file?: string) => call<void>('backup:reveal', file),
  pickBackupFolder: () => call<string | null>('backup:pickFolder'),
  pickToolDir: () => call<string | null>('backup:pickToolDir'),
  pickBackupFile: () => call<string | null>('backup:pickFile'),

  // ── Misc ──
  pickImage: () => call<{ dataUrl: string; name: string; size: number } | null>('image:pick'),
  appInfo: () =>
    call<{
      version: string
      electron: string
      node: string
      chrome: string
      platform: string
      userData: string
    }>('app:info'),
  openExternal: (url: string) => call<boolean>('app:openExternal', url)
}
