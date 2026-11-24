import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  connect, disconnect, isConnected, loadDbConfig, saveDbConfig, clearDbConfig,
  testConnection, getActiveConfig, DEFAULT_DB_CONFIG, query
} from '../db/pool'
import * as products from '../services/products'
import * as customers from '../services/customers'
import * as invoices from '../services/invoices'
import * as templates from '../services/templates'
import * as settings from '../services/settings'
import * as reports from '../services/reports'
import * as csv from '../services/csv'
import * as pdf from '../services/pdf'
import * as backup from '../services/backup'
import * as brands from '../services/brands'
import { renderInvoiceHtml } from '../../shared/renderInvoice'
import type { ApiResult, BrandInput, DbConfig, InvoiceWithItems, TemplateConfig } from '../../shared/types'

/** Wrap a handler so the renderer always receives {ok,data} or {ok,error}. */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<ApiResult<R>> => {
    try {
      const data = await fn(...(args as A))
      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error: message }
    }
  })
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024

export function registerIpc(): void {
  // ─────────────── Database connection ───────────────
  handle('db:status', async () => {
    const cfg = getActiveConfig() ?? loadDbConfig()
    return {
      connected: isConnected(),
      config: cfg ? { ...cfg, password: cfg.password ? '********' : '' } : DEFAULT_DB_CONFIG,
      hasSavedConfig: loadDbConfig() !== null
    }
  })

  handle('db:test', async (cfg: DbConfig) => testConnection(cfg))

  handle('db:connect', async (cfg: DbConfig, remember: boolean) => {
    await connect(cfg)
    if (remember) saveDbConfig(cfg)
    return { connected: true }
  })

  handle('db:disconnect', async () => {
    await disconnect()
    return { connected: false }
  })

  handle('db:forget', async () => {
    await disconnect()
    clearDbConfig()
    return { connected: false }
  })

  // ─────────────── Products & categories ───────────────
  handle('products:list', (f: products.ProductListFilter) => products.listProducts(f))
  handle('products:get', (id: number) => products.getProduct(id))
  handle('products:search', (term: string, limit?: number) => products.searchProducts(term, limit))
  handle('products:create', (input: Parameters<typeof products.createProduct>[0]) => products.createProduct(input))
  handle('products:update', (id: number, input: Parameters<typeof products.updateProduct>[1]) =>
    products.updateProduct(id, input)
  )
  handle('products:delete', (id: number) => products.deleteProduct(id))
  handle('products:bulkDelete', (ids: number[]) => products.bulkDeleteProducts(ids))
  handle('products:adjustStock', (args: Parameters<typeof products.adjustStock>[0]) => products.adjustStock(args))
  handle('products:movements', (productId?: number, limit?: number) =>
    products.listStockMovements(productId, limit)
  )

  handle('categories:list', () => products.listCategories())
  handle('categories:create', (name: string, parentId: number | null) => products.createCategory(name, parentId))
  handle('categories:update', (id: number, name: string, parentId: number | null) =>
    products.updateCategory(id, name, parentId)
  )
  handle('categories:delete', (id: number) => products.deleteCategory(id))

  // ─────────────── Customers ───────────────
  handle('customers:list', (search?: string, activeOnly?: boolean) =>
    customers.listCustomers(search ?? '', activeOnly !== false)
  )
  handle('customers:get', (id: number) => customers.getCustomer(id))
  handle('customers:create', (input: Parameters<typeof customers.createCustomer>[0]) =>
    customers.createCustomer(input)
  )
  handle('customers:update', (id: number, input: Parameters<typeof customers.updateCustomer>[1]) =>
    customers.updateCustomer(id, input)
  )
  handle('customers:delete', (id: number) => customers.deleteCustomer(id))
  handle('customers:ledger', (id: number) => customers.customerLedger(id))

  // ─────────────── Invoices ───────────────
  handle('invoices:list', (f: invoices.InvoiceListFilter) => invoices.listInvoices(f))
  handle('invoices:get', (id: number) => invoices.getInvoice(id))
  handle('invoices:save', (input: Parameters<typeof invoices.saveInvoice>[0]) => invoices.saveInvoice(input))
  handle('invoices:setStatus', (id: number, status: Parameters<typeof invoices.setInvoiceStatus>[1]) =>
    invoices.setInvoiceStatus(id, status)
  )
  handle('invoices:delete', (id: number) => invoices.deleteInvoice(id))
  handle('invoices:duplicate', (id: number) => invoices.duplicateInvoice(id))
  handle('invoices:nextNo', () => settings.peekNextInvoiceNo())
  handle('invoices:payments', (id: number) => invoices.listPayments(id))
  handle('invoices:history', (id: number, limit?: number) => invoices.listInvoiceHistory(id, limit))
  handle('invoices:recentHistory', (limit?: number) => invoices.listRecentHistory(limit))
  handle('customers:history', (id: number, limit?: number) => invoices.listCustomerHistory(id, limit))
  handle('invoices:addPayment', (args: Parameters<typeof invoices.addPayment>[0]) => invoices.addPayment(args))
  handle('invoices:deletePayment', (id: number) => invoices.deletePayment(id))

  // ─────────────── Templates ───────────────
  handle('templates:list', () => templates.listTemplates())
  handle('templates:get', (id: number) => templates.getTemplate(id))
  handle('templates:default', () => templates.getDefaultTemplate())
  handle('templates:create', (name: string, config: TemplateConfig) => templates.createTemplate(name, config))
  handle('templates:update', (id: number, patch: { name?: string; config?: TemplateConfig }) =>
    templates.updateTemplate(id, patch)
  )
  handle('templates:duplicate', (id: number, name?: string) => templates.duplicateTemplate(id, name))
  handle('templates:setDefault', (id: number) => templates.setDefaultTemplate(id))
  handle('templates:delete', (id: number) => templates.deleteTemplate(id))
  handle('templates:restorePresets', () => templates.restorePresets())

  // ─────────────── Settings ───────────────
  // ─────────────── Brands ───────────────
  handle('brands:list', (activeOnly?: boolean) => brands.listBrands(activeOnly))
  handle('brands:get', (id: number) => brands.getBrand(id))
  handle('brands:default', () => brands.getDefaultBrand())
  handle('brands:create', (input: Partial<BrandInput>) => brands.createBrand(input))
  handle('brands:update', (id: number, input: Partial<BrandInput>) => brands.updateBrand(id, input))
  handle('brands:duplicate', (id: number, name?: string) => brands.duplicateBrand(id, name))
  handle('brands:setDefault', (id: number) => brands.setDefaultBrand(id))
  handle('brands:delete', (id: number) => brands.deleteBrand(id))
  handle('brands:nextNo', (id: number) => brands.peekNextNumber(id))

  handle('settings:get', () => settings.getCompanySettings())
  handle('settings:update', (patch: Parameters<typeof settings.updateCompanySettings>[0]) =>
    settings.updateCompanySettings(patch)
  )

  // ─────────────── Reports ───────────────
  handle('reports:dashboard', () => reports.getDashboardStats())
  handle('reports:sales', (from: string, to: string) => reports.getSalesReport(from, to))

  // ─────────────── CSV ───────────────
  handle('csv:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose a product CSV file',
      filters: [{ name: 'CSV / Text', extensions: ['csv', 'txt', 'tsv'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })
  handle('csv:preview', (filePath: string) => csv.previewCsv(filePath))
  handle('csv:import', (filePath: string, options: Parameters<typeof csv.importProducts>[1]) =>
    csv.importProducts(filePath, options)
  )
  handle('csv:saveSample', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save sample CSV',
      defaultPath: path.join(app.getPath('documents'), 'e-invoice-products-sample.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { saved: false }
    await fs.writeFile(filePath, csv.sampleCsv(), 'utf8')
    shell.showItemInFolder(filePath)
    return { saved: true, filePath }
  })

  // Export the current product list as CSV.
  handle('csv:exportProducts', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export products to CSV',
      defaultPath: path.join(app.getPath('documents'), 'products-export.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { saved: false }

    const rows = await query<Record<string, unknown>>(
      `SELECT p.sku AS "SKU", p.name AS "Product Name", coalesce(c.name,'') AS "Category",
              p.size_text AS "Size", p.material AS "Material", p.color AS "Color", p.unit AS "Unit",
              p.pack_size AS "Pack Size", p.unit_price AS "Unit Price", p.pack_price AS "Pack Price",
              p.cost_price AS "Cost Price", p.tax_rate AS "Tax Rate", p.stock_qty AS "Stock Qty",
              p.reorder_level AS "Reorder Level"
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.name`
    )
    const headers = rows.length
      ? Object.keys(rows[0])
      : ['SKU', 'Product Name', 'Category', 'Size', 'Material', 'Color', 'Unit', 'Pack Size',
         'Unit Price', 'Pack Price', 'Cost Price', 'Tax Rate', 'Stock Qty', 'Reorder Level']
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const body = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
    await fs.writeFile(filePath, body, 'utf8')
    shell.showItemInFolder(filePath)
    return { saved: true, filePath, count: rows.length }
  })

  // ─────────────── PDF / print ───────────────
  handle('pdf:save', (invoiceId: number, templateId?: number | null) => pdf.saveInvoicePdf(invoiceId, templateId))
  handle('pdf:exportMany', (ids: number[], templateId?: number | null) => pdf.exportInvoicesPdf(ids, templateId))
  handle('pdf:print', (invoiceId: number, templateId?: number | null) => pdf.printInvoice(invoiceId, templateId))

  /** Full standalone HTML, used by the preview iframe. */
  handle('invoices:html', async (invoiceId: number, templateId?: number | null) => {
    const invoice = await invoices.getInvoice(invoiceId)
    if (!invoice) throw new Error('Invoice not found.')
    const appSettings = await settings.getCompanySettings()
    const company = await brands.companyForInvoice(invoice.brand_id, invoice.brand_snapshot, appSettings)
    const template =
      (templateId ? await templates.getTemplate(templateId) : null) ??
      (invoice.template_id ? await templates.getTemplate(invoice.template_id) : null) ??
      (await templates.getDefaultTemplate())
    const payments = await invoices.listPayments(invoiceId)
    return renderInvoiceHtml({ invoice, company, config: template.config, payments, mode: 'screen' })
  })

  /** Preview an unsaved invoice (used by the editor and the designer). */
  handle('invoices:previewHtml', async (invoice: InvoiceWithItems, config: TemplateConfig, scale?: number) => {
    const appSettings = await settings.getCompanySettings()
    // Preview under the brand chosen in the editor right now, not the one the
    // invoice was last saved with, so switching brand updates the letterhead.
    const company = await brands.companyForInvoice(invoice.brand_id, undefined, appSettings)
    // A saved invoice may already have payments; an unsaved draft cannot.
    const payments = invoice.id ? await invoices.listPayments(invoice.id) : []
    return renderInvoiceHtml({ invoice, company, config, payments, mode: 'screen', scale })
  })

  // ─────────────── Images ───────────────
  handle('image:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose an image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null

    const file = filePaths[0]
    const stat = await fs.stat(file)
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `That image is ${(stat.size / 1024 / 1024).toFixed(1)} MB. Please use one under 3 MB so invoices stay small.`
      )
    }

    const ext = path.extname(file).toLowerCase().replace('.', '')
    const mime =
      ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`
    const buf = await fs.readFile(file)
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, name: path.basename(file), size: stat.size }
  })

  // ─────────────── Backup & restore ───────────────
  handle('backup:settings', () => backup.getBackupSettings())
  handle('backup:saveSettings', (patch: Partial<backup.BackupSettings>) =>
    backup.saveBackupSettings(patch)
  )
  handle('backup:toolStatus', () => backup.toolStatus())
  handle('backup:list', () => backup.listBackups())
  handle('backup:run', () => backup.runBackup())
  handle('backup:restore', (file: string) => backup.restoreBackup(file))
  handle('backup:delete', (file: string) => backup.deleteBackup(file))
  handle('backup:reveal', (file?: string) => backup.revealBackup(file))
  handle('backup:pickFolder', () => backup.pickBackupFolder())
  handle('backup:pickToolDir', () => backup.pickToolDir())
  handle('backup:pickFile', () => backup.pickBackupFile())

  // ─────────────── Misc ───────────────
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    userData: app.getPath('userData')
  }))

  handle('app:openExternal', async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened.')
    await shell.openExternal(url)
    return true
  })

  handle('app:reload', () => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.reload())
    return true
  })
}
