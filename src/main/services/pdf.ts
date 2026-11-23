import { BrowserWindow, dialog, shell, app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { renderInvoiceHtml, pageDimensions, escapeHtml } from '../../shared/renderInvoice'
import { getInvoice, listPayments } from './invoices'
import { getCompanySettings } from './settings'
import { getTemplate, getDefaultTemplate } from './templates'
import type { CompanySettings, InvoiceWithItems, Payment, TemplateConfig } from '../../shared/types'

const MM_PER_INCH = 25.4

// ───────────────────────── Render window ─────────────────────────
//
// Creating a fresh BrowserWindow for every render fails from the second call
// onwards (file loads return ERR_FAILED and the process can die), so a single
// hidden window is created once and reused for every PDF and print job.

let renderWindow: BrowserWindow | null = null
let workDir: string | null = null
let loadCounter = 0

/** Serialises jobs so two renders never share the window at the same time. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  // Keep the chain alive even when a job rejects.
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function getRenderWindow(): BrowserWindow {
  if (renderWindow && !renderWindow.isDestroyed()) return renderWindow
  renderWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      // No scripts run in the invoice document, and it is fully sandboxed.
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  renderWindow.on('closed', () => {
    renderWindow = null
  })
  return renderWindow
}

export function destroyRenderWindow(): void {
  if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy()
  renderWindow = null
  if (workDir) {
    void fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
    workDir = null
  }
}

async function getWorkDir(): Promise<string> {
  if (workDir) return workDir
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pbx-invoice-'))
  return workDir
}

/** Write the document and load it into the shared window. */
async function loadHtml(html: string): Promise<BrowserWindow> {
  const dir = await getWorkDir()
  const file = path.join(dir, 'invoice.html')
  await fs.writeFile(file, html, 'utf8')

  const win = getRenderWindow()
  // A changing query string defeats any caching of the previous document.
  const url = pathToFileURL(file)
  url.search = `?v=${++loadCounter}`
  await win.loadURL(url.toString())
  // Let fonts and images settle before capture.
  await new Promise((r) => setTimeout(r, 220))
  return win
}

// ───────────────────────── Helpers ─────────────────────────

function footerTemplate(cfg: TemplateConfig, text: string): string {
  const color = cfg.footer.textColor || '#6b7280'
  const size = Math.max(6, cfg.font.footerSize)
  const align = cfg.footer.align === 'left' ? 'flex-start' : cfg.footer.align === 'right' ? 'flex-end' : 'center'
  // Chromium substitutes these spans with the real page numbers.
  const body = escapeHtml(text)
    .replace(/\{\{\s*page\s*\}\}/gi, '<span class="pageNumber"></span>')
    .replace(/\{\{\s*pages\s*\}\}/gi, '<span class="totalPages"></span>')
  return `<div style="width:100%;display:flex;justify-content:${align};font-size:${size}pt;color:${color};
    font-family:${cfg.font.family.replace(/"/g, "'")};padding:0 ${cfg.page.marginLeft}mm;">${body}</div>`
}

function safeFileName(s: string): string {
  return (s || 'invoice').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)
}

interface Resolved {
  invoice: InvoiceWithItems
  company: CompanySettings
  config: TemplateConfig
  payments: Payment[]
}

async function resolve(invoiceId: number, templateId?: number | null): Promise<Resolved> {
  const invoice = await getInvoice(invoiceId)
  if (!invoice) throw new Error('Invoice not found.')
  const company = await getCompanySettings()
  const template =
    (templateId ? await getTemplate(templateId) : null) ??
    (invoice.template_id ? await getTemplate(invoice.template_id) : null) ??
    (await getDefaultTemplate())
  const payments = await listPayments(invoiceId)
  return { invoice, company, config: template.config, payments }
}

function invoiceFileName(invoice: InvoiceWithItems): string {
  const customer = String(invoice.customer_snapshot?.company ?? invoice.customer_snapshot?.name ?? '').trim()
  return safeFileName([invoice.invoice_no, customer].filter(Boolean).join(' - ') || `invoice-${invoice.id}`)
}

// ───────────────────────── PDF ─────────────────────────

/** Render one invoice to PDF bytes. */
export async function renderInvoicePdf(invoiceId: number, templateId?: number | null): Promise<Buffer> {
  const { invoice, company, config: cfg, payments } = await resolve(invoiceId, templateId)
  return enqueue(async () => {
    const html = renderInvoiceHtml({ invoice, company, config: cfg, payments, mode: 'print' })
    const win = await loadHtml(html)

    const dim = pageDimensions(cfg)
    const showNums = cfg.footer.enabled && cfg.footer.showPageNumbers

    return win.webContents.printToPDF({
      // The page size is baked into the CSS @page rule; this matches it so the
      // two never disagree.
      pageSize: { width: dim.w / MM_PER_INCH, height: dim.h / MM_PER_INCH },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: showNums,
      headerTemplate: '<div></div>',
      footerTemplate: showNums ? footerTemplate(cfg, cfg.footer.pageNumberFormat) : '<div></div>',
      margins: showNums
        ? {
            top: cfg.page.marginTop / MM_PER_INCH,
            bottom: Math.max(cfg.page.marginBottom, 14) / MM_PER_INCH,
            left: cfg.page.marginLeft / MM_PER_INCH,
            right: cfg.page.marginRight / MM_PER_INCH
          }
        : undefined
    })
  })
}

export async function saveInvoicePdf(
  invoiceId: number,
  templateId?: number | null,
  openAfter = true
): Promise<{ saved: boolean; filePath?: string }> {
  const invoice = await getInvoice(invoiceId)
  if (!invoice) throw new Error('Invoice not found.')

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Invoice PDF',
    defaultPath: path.join(app.getPath('documents'), `${invoiceFileName(invoice)}.pdf`),
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { saved: false }

  const pdf = await renderInvoicePdf(invoiceId, templateId)
  await fs.writeFile(filePath, pdf)
  if (openAfter) shell.openPath(filePath).catch(() => {})
  return { saved: true, filePath }
}

/** Export several invoices into a chosen folder. */
export async function exportInvoicesPdf(
  invoiceIds: number[],
  templateId?: number | null
): Promise<{ saved: number; folder?: string; errors: { id: number; message: string }[] }> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a folder for the PDF files',
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || filePaths.length === 0) return { saved: 0, errors: [] }

  const folder = filePaths[0]
  const errors: { id: number; message: string }[] = []
  let saved = 0

  for (const id of invoiceIds) {
    try {
      const inv = await getInvoice(id)
      if (!inv) throw new Error('Invoice not found.')
      const pdf = await renderInvoicePdf(id, templateId)
      await fs.writeFile(path.join(folder, `${invoiceFileName(inv)}.pdf`), pdf)
      saved++
    } catch (err) {
      errors.push({ id, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { saved, folder, errors }
}

/** Open the operating system print dialog for an invoice. */
export async function printInvoice(invoiceId: number, templateId?: number | null): Promise<{ printed: boolean }> {
  const { invoice, company, config: cfg, payments } = await resolve(invoiceId, templateId)

  return enqueue(async () => {
    const html = renderInvoiceHtml({ invoice, company, config: cfg, payments, mode: 'print' })
    const win = await loadHtml(html)

    return new Promise<{ printed: boolean }>((resolvePrint, reject) => {
      win.webContents.print({ silent: false, printBackground: true, color: true }, (success, failureReason) => {
        // Cancelling the dialog reports failure; that is not an error.
        if (!success && failureReason && failureReason !== 'cancelled') {
          reject(new Error(failureReason))
        } else {
          resolvePrint({ printed: success })
        }
      })
    })
  })
}
