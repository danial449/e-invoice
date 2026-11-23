import { query, queryOne } from '../db/pool'
import type { DashboardStats, Invoice, Product } from '../../shared/types'

export async function getDashboardStats(): Promise<DashboardStats> {
  const counts = await queryOne<{
    product_count: number
    active_product_count: number
    low_stock: number
    out_of_stock: number
    stock_value: number
  }>(
    `SELECT
       count(*)::int AS product_count,
       count(*) FILTER (WHERE is_active)::int AS active_product_count,
       count(*) FILTER (WHERE is_active AND stock_qty > 0 AND reorder_level > 0 AND stock_qty <= reorder_level)::int AS low_stock,
       count(*) FILTER (WHERE is_active AND stock_qty <= 0)::int AS out_of_stock,
       coalesce(sum(stock_qty * CASE WHEN cost_price > 0 THEN cost_price ELSE unit_price END), 0)::numeric AS stock_value
     FROM products`
  )

  const customerCount = await queryOne<{ n: number }>(
    'SELECT count(*)::int AS n FROM customers WHERE is_active = TRUE'
  )

  const invStats = await queryOne<{
    invoice_count: number
    revenue_total: number
    revenue_month: number
    outstanding: number
  }>(
    `SELECT
       count(*)::int AS invoice_count,
       coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS revenue_total,
       coalesce(sum(total) FILTER (
         WHERE status <> 'cancelled'
           AND invoice_date >= date_trunc('month', CURRENT_DATE)
           AND invoice_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
       ), 0)::numeric AS revenue_month,
       coalesce(sum(total - paid_amount) FILTER (WHERE status IN ('issued','partial')), 0)::numeric AS outstanding
     FROM invoices`
  )

  const recentInvoices = await query<Invoice>(
    `SELECT i.*, c.name AS customer_name
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
     ORDER BY i.created_at DESC, i.id DESC LIMIT 8`
  )

  const lowStockProducts = await query<Product>(
    `SELECT p.*, c.name AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = TRUE
       AND (p.stock_qty <= 0 OR (p.reorder_level > 0 AND p.stock_qty <= p.reorder_level))
     ORDER BY p.stock_qty ASC, p.name
     LIMIT 10`
  )

  const topProducts = await query<{ name: string; qty: number; revenue: number }>(
    `SELECT ii.name,
            sum(ii.qty * CASE WHEN ii.uom = 'pack' THEN ii.pack_size ELSE 1 END)::numeric AS qty,
            sum(ii.line_total)::numeric AS revenue
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.status <> 'cancelled'
     GROUP BY ii.name
     ORDER BY revenue DESC
     LIMIT 8`
  )

  const monthlyRevenue = await query<{ month: string; revenue: number }>(
    `SELECT to_char(date_trunc('month', invoice_date), 'Mon YYYY') AS month,
            sum(total)::numeric AS revenue
     FROM invoices
     WHERE status <> 'cancelled'
       AND invoice_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
     GROUP BY date_trunc('month', invoice_date)
     ORDER BY date_trunc('month', invoice_date)`
  )

  return {
    productCount: counts?.product_count ?? 0,
    activeProductCount: counts?.active_product_count ?? 0,
    customerCount: customerCount?.n ?? 0,
    invoiceCount: invStats?.invoice_count ?? 0,
    lowStockCount: counts?.low_stock ?? 0,
    outOfStockCount: counts?.out_of_stock ?? 0,
    stockValue: Number(counts?.stock_value ?? 0),
    revenueThisMonth: Number(invStats?.revenue_month ?? 0),
    revenueTotal: Number(invStats?.revenue_total ?? 0),
    outstanding: Number(invStats?.outstanding ?? 0),
    recentInvoices,
    lowStockProducts,
    topProducts: topProducts.map((t) => ({
      name: t.name,
      qty: Number(t.qty),
      revenue: Number(t.revenue)
    })),
    monthlyRevenue: monthlyRevenue.map((m) => ({ month: m.month, revenue: Number(m.revenue) }))
  }
}

/** Sales report over a date range, grouped for the Reports screen. */
export async function getSalesReport(from: string, to: string): Promise<{
  summary: { invoices: number; subtotal: number; discount: number; tax: number; total: number; paid: number }
  byCustomer: { name: string; invoices: number; total: number }[]
  byProduct: { name: string; qty: number; total: number }[]
  byDay: { day: string; total: number }[]
}> {
  const summary = await queryOne<{
    invoices: number
    subtotal: number
    discount: number
    tax: number
    total: number
    paid: number
  }>(
    `SELECT count(*)::int AS invoices,
            coalesce(sum(subtotal),0)::numeric        AS subtotal,
            coalesce(sum(discount_amount),0)::numeric AS discount,
            coalesce(sum(tax_amount),0)::numeric      AS tax,
            coalesce(sum(total),0)::numeric           AS total,
            coalesce(sum(paid_amount),0)::numeric     AS paid
     FROM invoices
     WHERE status <> 'cancelled' AND invoice_date BETWEEN $1 AND $2`,
    [from, to]
  )

  const byCustomer = await query<{ name: string; invoices: number; total: number }>(
    `SELECT coalesce(c.name, i.customer_snapshot->>'name', 'Walk-in') AS name,
            count(*)::int AS invoices,
            sum(i.total)::numeric AS total
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.status <> 'cancelled' AND i.invoice_date BETWEEN $1 AND $2
     GROUP BY 1 ORDER BY total DESC LIMIT 50`,
    [from, to]
  )

  const byProduct = await query<{ name: string; qty: number; total: number }>(
    `SELECT ii.name,
            sum(ii.qty * CASE WHEN ii.uom = 'pack' THEN ii.pack_size ELSE 1 END)::numeric AS qty,
            sum(ii.line_total)::numeric AS total
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.status <> 'cancelled' AND i.invoice_date BETWEEN $1 AND $2
     GROUP BY ii.name ORDER BY total DESC LIMIT 100`,
    [from, to]
  )

  const byDay = await query<{ day: string; total: number }>(
    `SELECT to_char(invoice_date, 'YYYY-MM-DD') AS day, sum(total)::numeric AS total
     FROM invoices
     WHERE status <> 'cancelled' AND invoice_date BETWEEN $1 AND $2
     GROUP BY invoice_date ORDER BY invoice_date`,
    [from, to]
  )

  return {
    summary: {
      invoices: summary?.invoices ?? 0,
      subtotal: Number(summary?.subtotal ?? 0),
      discount: Number(summary?.discount ?? 0),
      tax: Number(summary?.tax ?? 0),
      total: Number(summary?.total ?? 0),
      paid: Number(summary?.paid ?? 0)
    },
    byCustomer: byCustomer.map((r) => ({ ...r, total: Number(r.total) })),
    byProduct: byProduct.map((r) => ({ ...r, qty: Number(r.qty), total: Number(r.total) })),
    byDay: byDay.map((r) => ({ ...r, total: Number(r.total) }))
  }
}
