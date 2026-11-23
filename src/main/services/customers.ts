import { query, queryOne } from '../db/pool'
import type { Customer, CustomerInput } from '../../shared/types'

export async function listCustomers(search = '', activeOnly = true): Promise<Customer[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (activeOnly) where.push('is_active = TRUE')
  if (search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`)
    where.push(
      `(lower(name) LIKE $${params.length} OR lower(company) LIKE $${params.length} OR phone LIKE $${params.length} OR lower(email) LIKE $${params.length})`
    )
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return query<Customer>(`SELECT * FROM customers ${whereSql} ORDER BY name LIMIT 500`, params)
}

export async function getCustomer(id: number): Promise<Customer | null> {
  return queryOne<Customer>('SELECT * FROM customers WHERE id = $1', [id])
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('Customer name is required.')
  const row = await queryOne<Customer>(
    `INSERT INTO customers (name, company, phone, email, address, city, ntn, strn, notes, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      name, input.company ?? '', input.phone ?? '', input.email ?? '', input.address ?? '',
      input.city ?? '', input.ntn ?? '', input.strn ?? '', input.notes ?? '', input.is_active !== false
    ]
  )
  return row!
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<Customer> {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('Customer name is required.')
  const row = await queryOne<Customer>(
    `UPDATE customers SET name=$1, company=$2, phone=$3, email=$4, address=$5, city=$6,
       ntn=$7, strn=$8, notes=$9, is_active=$10 WHERE id=$11 RETURNING *`,
    [
      name, input.company ?? '', input.phone ?? '', input.email ?? '', input.address ?? '',
      input.city ?? '', input.ntn ?? '', input.strn ?? '', input.notes ?? '', input.is_active !== false, id
    ]
  )
  if (!row) throw new Error('Customer not found.')
  return row
}

export async function deleteCustomer(id: number): Promise<{ deleted: boolean; deactivated: boolean }> {
  const used = await queryOne<{ n: number }>(
    'SELECT count(*)::int AS n FROM invoices WHERE customer_id = $1',
    [id]
  )
  if ((used?.n ?? 0) > 0) {
    await query('UPDATE customers SET is_active = FALSE WHERE id = $1', [id])
    return { deleted: false, deactivated: true }
  }
  await query('DELETE FROM customers WHERE id = $1', [id])
  return { deleted: true, deactivated: false }
}

/** Invoice count + money owed, shown on the customer list. */
export async function customerLedger(id: number): Promise<{
  invoiceCount: number
  totalBilled: number
  totalPaid: number
  outstanding: number
}> {
  const r = await queryOne<{
    invoice_count: number
    total_billed: number
    total_paid: number
  }>(
    `SELECT count(*)::int AS invoice_count,
            coalesce(sum(total),0)::numeric       AS total_billed,
            coalesce(sum(paid_amount),0)::numeric AS total_paid
     FROM invoices WHERE customer_id = $1 AND status <> 'cancelled'`,
    [id]
  )
  const billed = Number(r?.total_billed ?? 0)
  const paid = Number(r?.total_paid ?? 0)
  return {
    invoiceCount: r?.invoice_count ?? 0,
    totalBilled: billed,
    totalPaid: paid,
    outstanding: Math.round((billed - paid) * 100) / 100
  }
}
