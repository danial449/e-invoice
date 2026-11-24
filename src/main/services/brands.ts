import type { PoolClient } from 'pg'
import { query, queryOne, withTransaction } from '../db/pool'
import { getCompanySettings } from './settings'
import type { Brand, BrandInput, CompanySettings } from '../../shared/types'

/** The columns a caller may set, in the order the statements below use them. */
const FIELDS: (keyof BrandInput)[] = [
  'name', 'legal_name', 'address', 'city', 'country', 'phone', 'phone_alt', 'email', 'website',
  'ntn', 'strn', 'logo_data_url', 'signature_data_url', 'bank_details', 'default_terms',
  'default_notes', 'terms_url', 'terms_link_text', 'invoice_prefix', 'invoice_next_number',
  'invoice_pad', 'is_active', 'sort_order'
]

function clean(input: Partial<BrandInput>): BrandInput {
  const num = (v: unknown, fallback: number): number => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) ? n : fallback
  }
  const text = (v: unknown): string => String(v ?? '').trim()

  return {
    name: text(input.name),
    legal_name: text(input.legal_name),
    address: String(input.address ?? ''),
    city: text(input.city),
    country: text(input.country) || 'Pakistan',
    phone: text(input.phone),
    phone_alt: text(input.phone_alt),
    email: text(input.email),
    website: text(input.website),
    ntn: text(input.ntn),
    strn: text(input.strn),
    logo_data_url: String(input.logo_data_url ?? ''),
    signature_data_url: String(input.signature_data_url ?? ''),
    bank_details: String(input.bank_details ?? ''),
    default_terms: String(input.default_terms ?? ''),
    default_notes: String(input.default_notes ?? ''),
    terms_url: text(input.terms_url),
    terms_link_text: text(input.terms_link_text),
    invoice_prefix: String(input.invoice_prefix ?? 'INV-'),
    invoice_next_number: Math.max(1, num(input.invoice_next_number, 1)),
    invoice_pad: Math.min(10, Math.max(0, num(input.invoice_pad, 4))),
    is_default: input.is_default === true,
    is_active: input.is_active !== false,
    sort_order: num(input.sort_order, 0)
  }
}

export async function listBrands(activeOnly = false): Promise<Brand[]> {
  return query<Brand>(
    `SELECT * FROM brands ${activeOnly ? 'WHERE is_active' : ''}
     ORDER BY is_default DESC, sort_order, name`
  )
}

export async function getBrand(id: number): Promise<Brand | null> {
  return queryOne<Brand>('SELECT * FROM brands WHERE id = $1', [id])
}

/**
 * The brand to use when none was chosen. Falls back to any brand at all, so a
 * database that somehow lost its default still issues invoices.
 */
export async function getDefaultBrand(): Promise<Brand | null> {
  return queryOne<Brand>(
    'SELECT * FROM brands WHERE is_active ORDER BY is_default DESC, sort_order, id LIMIT 1'
  )
}

export async function createBrand(input: Partial<BrandInput>): Promise<Brand> {
  const b = clean(input)
  if (!b.name) throw new Error('Give the brand a name.')

  return withTransaction(async (client) => {
    const cols = FIELDS.join(', ')
    const params = FIELDS.map((f) => (b as Record<string, unknown>)[f])
    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(', ')
    const { rows } = await client.query<Brand>(
      `INSERT INTO brands (${cols}) VALUES (${placeholders}) RETURNING *`,
      params
    )
    const created = rows[0]

    // The very first brand is the default, whatever was asked for.
    const count = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM brands')
    if (b.is_default || count.rows[0].n === 1) {
      await client.query('UPDATE brands SET is_default = (id = $1)', [created.id])
      created.is_default = true
    }
    return created
  })
}

/**
 * Update only the fields actually supplied.
 *
 * This used to write every column from a normalised copy of the input, so a
 * caller sending just `{ name }` silently blanked the address, email, NTN,
 * bank details and the rest. A partial patch has to stay partial.
 */
export async function updateBrand(id: number, input: Partial<BrandInput>): Promise<Brand> {
  const given = FIELDS.filter((f) => f in input)
  if (given.length === 0 && input.is_default !== true) return requireBrand(id)

  if ('name' in input && String(input.name ?? '').trim() === '') {
    throw new Error('Give the brand a name.')
  }

  // Normalise, then keep only what was asked for.
  const cleaned = clean({ ...(await requireBrand(id)), ...input }) as Record<string, unknown>

  return withTransaction(async (client) => {
    if (given.length > 0) {
      const sets = given.map((f, i) => `${f} = $${i + 1}`).join(', ')
      const params = [...given.map((f) => cleaned[f]), id]
      const { rows } = await client.query<Brand>(
        `UPDATE brands SET ${sets}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
        params
      )
      if (rows.length === 0) throw new Error('Brand not found.')
    }

    if (input.is_default === true) {
      await client.query('UPDATE brands SET is_default = (id = $1)', [id])
    }

    const { rows } = await client.query<Brand>('SELECT * FROM brands WHERE id = $1', [id])
    if (rows.length === 0) throw new Error('Brand not found.')
    return rows[0]
  })
}

async function requireBrand(id: number): Promise<Brand> {
  const b = await getBrand(id)
  if (!b) throw new Error('Brand not found.')
  return b
}

export async function setDefaultBrand(id: number): Promise<void> {
  await withTransaction(async (client) => {
    const found = await client.query('SELECT 1 FROM brands WHERE id = $1', [id])
    if (found.rowCount === 0) throw new Error('Brand not found.')
    await client.query('UPDATE brands SET is_default = (id = $1)', [id])
  })
}

export async function duplicateBrand(id: number, newName?: string): Promise<Brand> {
  const src = await getBrand(id)
  if (!src) throw new Error('Brand not found.')
  return createBrand({
    ...src,
    name: newName?.trim() || `${src.name} copy`,
    is_default: false,
    // A copy must not reuse the original's counter, or the two would collide.
    invoice_next_number: 1
  })
}

/**
 * Remove a brand. One that has issued invoices is deactivated instead, so its
 * invoices keep a brand to point at. The last remaining brand is never
 * removed - there must always be something to invoice as.
 */
export async function deleteBrand(id: number): Promise<{ deleted: boolean; deactivated: boolean }> {
  return withTransaction(async (client) => {
    // Counting every row, including ones already deactivated, let the last
    // usable brand be removed and left nothing to invoice as.
    const usable = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM brands WHERE is_active AND id <> $1',
      [id]
    )
    if (usable.rows[0].n === 0) {
      throw new Error('This is your only active brand. Add another before removing this one.')
    }

    const used = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM invoices WHERE brand_id = $1',
      [id]
    )
    const wasDefault = await client.query<{ is_default: boolean }>(
      'SELECT is_default FROM brands WHERE id = $1',
      [id]
    )
    if (wasDefault.rowCount === 0) throw new Error('Brand not found.')

    let result: { deleted: boolean; deactivated: boolean }
    if (used.rows[0].n > 0) {
      await client.query('UPDATE brands SET is_active = FALSE, updated_at = now() WHERE id = $1', [id])
      result = { deleted: false, deactivated: true }
    } else {
      await client.query('DELETE FROM brands WHERE id = $1', [id])
      result = { deleted: true, deactivated: false }
    }

    // Never leave the list without a default.
    if (wasDefault.rows[0].is_default) {
      await client.query(
        `UPDATE brands SET is_default = TRUE
         WHERE id = (SELECT id FROM brands WHERE is_active ORDER BY sort_order, id LIMIT 1)`
      )
    }
    return result
  })
}

/**
 * Everything the invoice renderer needs about the seller, assembled from the
 * brand where there is one and the app-wide settings otherwise. Currency and
 * tax are app-wide and always come from settings.
 */
export function brandToCompany(brand: Partial<Brand> | null, settings: CompanySettings): CompanySettings {
  if (!brand || !brand.name) return settings
  const pick = (v: unknown, fallback: string): string => {
    const s = String(v ?? '')
    return s.trim() === '' ? fallback : s
  }
  return {
    ...settings,
    name: pick(brand.name, settings.name),
    legal_name: pick(brand.legal_name, ''),
    address: pick(brand.address, ''),
    city: pick(brand.city, ''),
    country: pick(brand.country, ''),
    phone: pick(brand.phone, ''),
    phone_alt: pick(brand.phone_alt, ''),
    email: pick(brand.email, ''),
    website: pick(brand.website, ''),
    ntn: pick(brand.ntn, ''),
    strn: pick(brand.strn, ''),
    logo_data_url: pick(brand.logo_data_url, ''),
    signature_data_url: pick(brand.signature_data_url, ''),
    bank_details: pick(brand.bank_details, ''),
    terms_url: pick(brand.terms_url, ''),
    terms_link_text: pick(brand.terms_link_text, ''),
    default_terms: pick(brand.default_terms, settings.default_terms),
    default_notes: pick(brand.default_notes, settings.default_notes)
  }
}

/**
 * Resolve the seller for an invoice: the snapshot taken when it was saved
 * first, then the live brand, then the app-wide settings. The snapshot is what
 * keeps a reissued old invoice looking exactly as it did.
 */
export async function companyForInvoice(
  brandId: number | null | undefined,
  snapshot: Record<string, unknown> | undefined,
  settings: CompanySettings
): Promise<CompanySettings> {
  if (snapshot && typeof snapshot === 'object' && String(snapshot.name ?? '').trim() !== '') {
    return brandToCompany(snapshot as Partial<Brand>, settings)
  }
  if (brandId) {
    const brand = await getBrand(brandId)
    if (brand) return brandToCompany(brand, settings)
  }
  const fallback = await getDefaultBrand()
  return brandToCompany(fallback, settings)
}

/** Convenience for callers that only have an id. */
export async function companyForBrandId(brandId: number | null | undefined): Promise<CompanySettings> {
  const settings = await getCompanySettings()
  return companyForInvoice(brandId, undefined, settings)
}

/**
 * Take the next number for a brand, inside the caller's transaction. The brand
 * row is locked so two windows cannot take the same one, and numbers already
 * used are skipped.
 */
export async function nextNumberForBrand(client: PoolClient, brandId: number): Promise<string> {
  const { rows } = await client.query<{
    invoice_prefix: string
    invoice_next_number: number
    invoice_pad: number
  }>(
    'SELECT invoice_prefix, invoice_next_number, invoice_pad FROM brands WHERE id = $1 FOR UPDATE',
    [brandId]
  )
  if (rows.length === 0) throw new Error('Brand not found.')

  const { invoice_prefix, invoice_pad } = rows[0]
  let n = rows[0].invoice_next_number

  for (let guard = 0; guard < 10_000; guard++) {
    const body = invoice_pad > 0 ? String(n).padStart(invoice_pad, '0') : String(n)
    const candidate = `${invoice_prefix ?? ''}${body}`
    const clash = await client.query('SELECT 1 FROM invoices WHERE invoice_no = $1', [candidate])
    if (clash.rowCount === 0) {
      await client.query('UPDATE brands SET invoice_next_number = $1 WHERE id = $2', [n + 1, brandId])
      return candidate
    }
    n++
  }
  throw new Error('Could not allocate an invoice number for this brand.')
}

/** Preview of a brand's next number without consuming it. */
export async function peekNextNumber(brandId: number): Promise<string> {
  const b = await getBrand(brandId)
  if (!b) throw new Error('Brand not found.')
  const body = b.invoice_pad > 0 ? String(b.invoice_next_number).padStart(b.invoice_pad, '0') : String(b.invoice_next_number)
  return `${b.invoice_prefix ?? ''}${body}`
}
