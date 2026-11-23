import { query, queryOne, withTransaction } from '../db/pool'
import { normalizeConfig, TEMPLATE_PRESETS } from '../../shared/templatePresets'
import type { InvoiceTemplate, TemplateConfig } from '../../shared/types'

interface TemplateRow {
  id: number
  name: string
  base: string
  is_default: boolean
  config: unknown
  created_at: string
  updated_at: string
}

function hydrate(row: TemplateRow): InvoiceTemplate {
  return { ...row, config: normalizeConfig(row.config) }
}

export async function listTemplates(): Promise<InvoiceTemplate[]> {
  const rows = await query<TemplateRow>(
    'SELECT * FROM invoice_templates ORDER BY is_default DESC, name'
  )
  return rows.map(hydrate)
}

export async function getTemplate(id: number): Promise<InvoiceTemplate | null> {
  const row = await queryOne<TemplateRow>('SELECT * FROM invoice_templates WHERE id = $1', [id])
  return row ? hydrate(row) : null
}

export async function getDefaultTemplate(): Promise<InvoiceTemplate> {
  const row =
    (await queryOne<TemplateRow>('SELECT * FROM invoice_templates WHERE is_default = TRUE LIMIT 1')) ??
    (await queryOne<TemplateRow>('SELECT * FROM invoice_templates ORDER BY id LIMIT 1'))
  if (row) return hydrate(row)

  // No templates at all (database wiped) - recreate the first preset.
  const preset = TEMPLATE_PRESETS[0]
  const created = await queryOne<TemplateRow>(
    'INSERT INTO invoice_templates (name, base, is_default, config) VALUES ($1,$2,TRUE,$3::jsonb) RETURNING *',
    [preset.name, 'classic', JSON.stringify(preset.config)]
  )
  return hydrate(created!)
}

export async function createTemplate(
  name: string,
  config: TemplateConfig,
  base = 'custom'
): Promise<InvoiceTemplate> {
  const clean = (name ?? '').trim()
  if (!clean) throw new Error('Template name is required.')
  const row = await queryOne<TemplateRow>(
    'INSERT INTO invoice_templates (name, base, is_default, config) VALUES ($1,$2,FALSE,$3::jsonb) RETURNING *',
    [clean, base, JSON.stringify(normalizeConfig(config))]
  )
  return hydrate(row!)
}

export async function updateTemplate(
  id: number,
  patch: { name?: string; config?: TemplateConfig }
): Promise<InvoiceTemplate> {
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) throw new Error('Template name cannot be empty.')
    params.push(clean)
    sets.push(`name = $${params.length}`)
  }
  if (patch.config !== undefined) {
    params.push(JSON.stringify(normalizeConfig(patch.config)))
    sets.push(`config = $${params.length}::jsonb`)
  }
  if (sets.length === 0) {
    const current = await getTemplate(id)
    if (!current) throw new Error('Template not found.')
    return current
  }

  params.push(id)
  const row = await queryOne<TemplateRow>(
    `UPDATE invoice_templates SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params
  )
  if (!row) throw new Error('Template not found.')
  return hydrate(row)
}

export async function duplicateTemplate(id: number, newName?: string): Promise<InvoiceTemplate> {
  const src = await getTemplate(id)
  if (!src) throw new Error('Template not found.')
  return createTemplate(newName?.trim() || `${src.name} (copy)`, src.config, src.base)
}

export async function setDefaultTemplate(id: number): Promise<void> {
  await withTransaction(async (client) => {
    const found = await client.query('SELECT 1 FROM invoice_templates WHERE id = $1', [id])
    if (found.rowCount === 0) throw new Error('Template not found.')
    await client.query('UPDATE invoice_templates SET is_default = FALSE WHERE is_default = TRUE')
    await client.query('UPDATE invoice_templates SET is_default = TRUE WHERE id = $1', [id])
  })
}

export async function deleteTemplate(id: number): Promise<void> {
  const count = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM invoice_templates')
  if ((count?.n ?? 0) <= 1) throw new Error('At least one template must remain.')

  await withTransaction(async (client) => {
    const row = await client.query<{ is_default: boolean }>(
      'SELECT is_default FROM invoice_templates WHERE id = $1',
      [id]
    )
    if (row.rowCount === 0) throw new Error('Template not found.')
    await client.query('DELETE FROM invoice_templates WHERE id = $1', [id])
    if (row.rows[0].is_default) {
      await client.query(
        'UPDATE invoice_templates SET is_default = TRUE WHERE id = (SELECT id FROM invoice_templates ORDER BY id LIMIT 1)'
      )
    }
  })
}

/** Add any preset that is not already present, by name. */
export async function restorePresets(): Promise<number> {
  let added = 0
  for (const preset of TEMPLATE_PRESETS) {
    const exists = await queryOne<{ id: number }>(
      'SELECT id FROM invoice_templates WHERE lower(name) = lower($1)',
      [preset.name]
    )
    if (exists) continue
    await query(
      'INSERT INTO invoice_templates (name, base, is_default, config) VALUES ($1,$2,FALSE,$3::jsonb)',
      [preset.name, preset.name.toLowerCase().replace(/\s+/g, '-'), JSON.stringify(preset.config)]
    )
    added++
  }
  return added
}
