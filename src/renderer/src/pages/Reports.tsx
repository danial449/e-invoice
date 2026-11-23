import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Empty, Spinner, useToast } from '../components/ui'
import { formatMoney, formatQty } from '@shared/calc'
import type { CompanySettings } from '@shared/types'
import type { NavProps } from '../App'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfMonth(): string {
  const d = new Date()
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

type Report = Awaited<ReturnType<typeof api.salesReport>>

export default function Reports(_props: NavProps): React.JSX.Element {
  const toast = useToast()
  const [from, setFrom] = useState(startOfMonth())
  const [to, setTo] = useState(isoDate(new Date()))
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState<CompanySettings | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.salesReport(from, to))
    } catch (err) {
      toast.error(err)
    } finally {
      setLoading(false)
    }
  }, [from, to, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.getSettings().then(setCompany).catch(() => {})
  }, [])

  const sym = company?.currency_symbol ?? 'Rs.'
  const money = (n: number): string => formatMoney(n, sym, 0)

  const preset = (days: number): void => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - days)
    setFrom(isoDate(start))
    setTo(isoDate(end))
  }

  const maxDay = Math.max(1, ...(data?.byDay ?? []).map((d) => d.total))

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Reports</h1>
          <div className="sub">
            {from} to {to}
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn-sm" onClick={() => preset(7)}>
            7 days
          </button>
          <button className="btn-sm" onClick={() => preset(30)}>
            30 days
          </button>
          <button className="btn-sm" onClick={() => setFrom(startOfMonth())}>
            This month
          </button>
          <button className="btn-sm" onClick={() => preset(365)}>
            1 year
          </button>
        </div>
      </div>

      <div className="content">
        <div className="toolbar">
          <div>
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-primary" style={{ alignSelf: 'flex-end' }} onClick={() => void load()}>
            Apply
          </button>
        </div>

        {loading && !data ? (
          <Spinner label="Building report…" />
        ) : !data || data.summary.invoices === 0 ? (
          <div className="table-wrap">
            <Empty
              icon="◴"
              title="No invoices in this period"
              hint="Pick a wider date range, or create some invoices first."
            />
          </div>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Invoices</div>
                <div className="stat-value">{data.summary.invoices}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Subtotal</div>
                <div className="stat-value">{money(data.summary.subtotal)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Discounts given</div>
                <div className="stat-value">{money(data.summary.discount)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Sales tax</div>
                <div className="stat-value">{money(data.summary.tax)}</div>
              </div>
              <div className="stat accent">
                <div className="stat-label">Total billed</div>
                <div className="stat-value">{money(data.summary.total)}</div>
                <div className="stat-foot">{money(data.summary.paid)} received</div>
              </div>
            </div>

            {data.byDay.length > 1 ? (
              <div className="card">
                <h3 className="card-title">Daily sales</h3>
                <div className="chart-bars">
                  {data.byDay.map((d) => (
                    <div
                      key={d.day}
                      className="chart-bar"
                      style={{ height: `${Math.max(2, (d.total / maxDay) * 100)}%` }}
                      title={`${d.day}: ${money(d.total)}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="card" style={{ flex: 1 }}>
                <h3 className="card-title">
                  By customer <span className="count">{data.byCustomer.length}</span>
                </h3>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="num">Invoices</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCustomer.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="num">{c.invoices}</td>
                        <td className="num nowrap">{money(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card" style={{ flex: 1 }}>
                <h3 className="card-title">
                  By product <span className="count">{data.byProduct.length}</span>
                </h3>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Pieces</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProduct.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num">{formatQty(p.qty)}</td>
                        <td className="num nowrap">{money(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
