import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Empty, Spinner, useToast } from '../components/ui'
import { formatMoney, formatQty } from '@shared/calc'
import type { CompanySettings, DashboardStats } from '@shared/types'
import type { NavProps } from '../App'

export default function Dashboard({ navigate }: NavProps): React.JSX.Element {
  const toast = useToast()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, c] = await Promise.all([api.dashboard(), api.getSettings()])
      setStats(s)
      setCompany(c)
    } catch (err) {
      toast.error(err)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const sym = company?.currency_symbol ?? 'Rs.'
  const money = (n: number): string => formatMoney(n, sym, 0)

  if (loading && !stats) return <Spinner label="Loading dashboard…" />

  const maxRevenue = Math.max(1, ...(stats?.monthlyRevenue ?? []).map((m) => m.revenue))

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">{company?.name ?? 'Packaging Box Pakistan'}</div>
        </div>
        <div className="topbar-actions">
          <button onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" /> : '⟳'} Refresh
          </button>
          <button className="btn-primary" onClick={() => navigate({ name: 'invoice-editor' })}>
            ＋ New Invoice
          </button>
        </div>
      </div>

      <div className="content">
        {stats && stats.productCount === 0 ? (
          <div className="banner info">
            No products yet. Start by importing your product list from a CSV file —{' '}
            <button className="btn-xs" onClick={() => navigate({ name: 'import' })}>
              Import CSV
            </button>
          </div>
        ) : null}

        <div className="stat-grid">
          <div className="stat accent">
            <div className="stat-label">Revenue this month</div>
            <div className="stat-value">{money(stats?.revenueThisMonth ?? 0)}</div>
            <div className="stat-foot">{money(stats?.revenueTotal ?? 0)} all time</div>
          </div>
          <div className="stat">
            <div className="stat-label">Invoices</div>
            <div className="stat-value">{stats?.invoiceCount ?? 0}</div>
            <div className="stat-foot">{stats?.customerCount ?? 0} customers</div>
          </div>
          <div className="stat warn">
            <div className="stat-label">Outstanding</div>
            <div className="stat-value">{money(stats?.outstanding ?? 0)}</div>
            <div className="stat-foot">unpaid &amp; partial invoices</div>
          </div>
          <div className="stat">
            <div className="stat-label">Products</div>
            <div className="stat-value">{stats?.activeProductCount ?? 0}</div>
            <div className="stat-foot">{money(stats?.stockValue ?? 0)} stock value</div>
          </div>
          <div className={stats && stats.outOfStockCount > 0 ? 'stat danger' : 'stat'}>
            <div className="stat-label">Stock alerts</div>
            <div className="stat-value">{(stats?.lowStockCount ?? 0) + (stats?.outOfStockCount ?? 0)}</div>
            <div className="stat-foot">
              {stats?.outOfStockCount ?? 0} out · {stats?.lowStockCount ?? 0} low
            </div>
          </div>
        </div>

        {stats && stats.monthlyRevenue.length > 0 ? (
          <div className="card">
            <h3 className="card-title">Revenue, last 12 months</h3>
            <div className="chart-bars">
              {stats.monthlyRevenue.map((m) => (
                <div
                  key={m.month}
                  className="chart-bar"
                  style={{ height: `${Math.max(2, (m.revenue / maxRevenue) * 100)}%` }}
                  title={`${m.month}: ${money(m.revenue)}`}
                />
              ))}
            </div>
            <div className="chart-labels">
              {stats.monthlyRevenue.map((m) => (
                <span key={m.month}>{m.month.split(' ')[0]}</span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: 1 }}>
            <h3 className="card-title">
              Recent invoices
              <button
                className="btn-ghost btn-xs ml-auto"
                onClick={() => navigate({ name: 'invoices' })}
              >
                View all →
              </button>
            </h3>
            {stats && stats.recentInvoices.length > 0 ? (
              <table className="data">
                <tbody>
                  {stats.recentInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="clickable"
                      onClick={() => navigate({ name: 'invoice-editor', id: inv.id })}
                    >
                      <td className="nowrap strong">{inv.invoice_no}</td>
                      <td className="dim">
                        {(inv as { customer_name?: string | null }).customer_name ??
                          String(inv.customer_snapshot?.name ?? 'Walk-in')}
                      </td>
                      <td className="num nowrap">{money(inv.total)}</td>
                      <td>
                        <span className={`badge ${inv.status}`}>{inv.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty
                icon="≣"
                title="No invoices yet"
                hint="Create your first invoice to see it here."
                action={
                  <button className="btn-primary btn-sm" onClick={() => navigate({ name: 'invoice-editor' })}>
                    ＋ New Invoice
                  </button>
                }
              />
            )}
          </div>

          <div className="card" style={{ flex: 1 }}>
            <h3 className="card-title">
              Needs restocking
              <button className="btn-ghost btn-xs ml-auto" onClick={() => navigate({ name: 'products' })}>
                Products →
              </button>
            </h3>
            {stats && stats.lowStockProducts.length > 0 ? (
              <table className="data">
                <tbody>
                  {stats.lowStockProducts.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate({ name: 'products' })}>
                      <td>
                        <div className="strong">{p.name}</div>
                        <div className="xsmall muted">{p.category_name ?? 'Uncategorised'}</div>
                      </td>
                      <td className="num nowrap">
                        <span className={`badge ${p.stock_qty <= 0 ? 'out' : 'low'}`}>
                          {formatQty(p.stock_qty)} {p.unit}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty icon="✓" title="Stock levels look healthy" hint="Nothing is at or below its reorder level." />
            )}
          </div>
        </div>

        {stats && stats.topProducts.length > 0 ? (
          <div className="card">
            <h3 className="card-title">Best sellers</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Pieces sold</th>
                  <th className="num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {stats.topProducts.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="num">{formatQty(t.qty)}</td>
                    <td className="num">{money(t.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  )
}
