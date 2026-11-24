import { query, queryOne } from '../db/pool'
import type { CompanySettings } from '../../shared/types'

export async function getCompanySettings(): Promise<CompanySettings> {
  const row = await queryOne<CompanySettings>('SELECT * FROM company_settings WHERE id = 1')
  if (!row) throw new Error('Company settings row is missing.')
  return row
}

const EDITABLE: (keyof CompanySettings)[] = [
  'name', 'legal_name', 'address', 'city', 'country', 'phone', 'phone_alt', 'email', 'website',
  'ntn', 'strn', 'logo_data_url', 'signature_data_url', 'bank_details', 'currency_symbol',
  'currency_code', 'default_tax_rate', 'tax_enabled_default', 'invoice_prefix',
  'invoice_next_number', 'invoice_pad', 'default_terms', 'default_notes', 'terms_url', 'terms_link_text'
]

export async function updateCompanySettings(patch: Partial<CompanySettings>): Promise<CompanySettings> {
  const sets: string[] = []
  const params: unknown[] = []

  for (const key of EDITABLE) {
    if (!(key in patch)) continue
    let value = patch[key] as unknown
    if (key === 'invoice_next_number') value = Math.max(1, Math.floor(Number(value) || 1))
    if (key === 'invoice_pad') value = Math.min(10, Math.max(0, Math.floor(Number(value) || 0)))
    if (key === 'default_tax_rate') value = Math.max(0, Number(value) || 0)
    params.push(value)
    sets.push(`${key} = $${params.length}`)
  }

  if (sets.length === 0) return getCompanySettings()
  await query(`UPDATE company_settings SET ${sets.join(', ')} WHERE id = 1`, params)
  return getCompanySettings()
}

/** Preview of the next invoice number without consuming it. */
export async function peekNextInvoiceNo(): Promise<string> {
  const s = await getCompanySettings()
  return formatInvoiceNo(s.invoice_prefix, s.invoice_next_number, s.invoice_pad)
}

export function formatInvoiceNo(prefix: string, n: number, pad: number): string {
  const body = pad > 0 ? String(n).padStart(pad, '0') : String(n)
  return `${prefix ?? ''}${body}`
}
