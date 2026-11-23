/** Preview of an invoice number, matching the main-process formatter. */
export function formatInvoiceNoPreview(prefix: string, n: number, pad: number): string {
  const body = pad > 0 ? String(n).padStart(pad, '0') : String(n)
  return `${prefix ?? ''}${body}`
}
