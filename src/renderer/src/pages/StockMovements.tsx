import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Empty, Spinner, useToast } from '../components/ui'
import { formatQty, num } from '@shared/calc'
import type { StockMovement } from '@shared/types'
import type { NavProps } from '../App'

const KINDS: { value: string; label: string }[] = [
  { value: 'all', label: 'All movements' },
  { value: 'sale', label: 'Sales' },
  { value: 'purchase', label: 'Purchases' },
  { value: 'return', label: 'Returns' },
  { value: 'adjustment', label: 'Adjustments' },
  { value: 'import', label: 'CSV imports' },
  { value: 'opening', label: 'Opening stock' }
]

export default function StockMovements(_props: NavProps): React.JSX.Element {
  const toast = useToast()
  const [rows, setRows] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await api.listMovements(undefined, 500))
    } catch (err) {
      toast.error(err)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = rows.filter((m) => {
    if (kind !== 'all' && m.kind !== kind) return false
    if (search.trim()) {
      const t = search.trim().toLowerCase()
      return (
        (m.product_name ?? '').toLowerCase().includes(t) ||
        (m.reference ?? '').toLowerCase().includes(t) ||
        (m.note ?? '').toLowerCase().includes(t)
      )
    }
    return true
  })

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Stock History</h1>
          <div className="sub">Every change to inventory, newest first</div>
        </div>
        <div className="topbar-actions">
          <button onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" /> : '⟳'} Refresh
          </button>
        </div>
      </div>

      <div className="content">
        <div className="toolbar">
          <div className="grow">
            <input
              placeholder="Search product, invoice number or note…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>

        {loading && rows.length === 0 ? (
          <Spinner label="Loading stock history…" />
        ) : filtered.length === 0 ? (
          <div className="table-wrap">
            <Empty
              icon="⇅"
              title={rows.length === 0 ? 'No stock movements yet' : 'Nothing matches these filters'}
              hint="Movements are recorded when you import products, adjust stock or issue an invoice."
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="num">Change</th>
                  <th>Reference</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td className="small nowrap">{new Date(m.created_at).toLocaleString()}</td>
                    <td>{m.product_name ?? '—'}</td>
                    <td>
                      <span className="badge draft">{m.kind}</span>
                    </td>
                    <td
                      className="num nowrap strong"
                      style={{ color: num(m.change_qty) >= 0 ? 'var(--ok)' : 'var(--danger)' }}
                    >
                      {num(m.change_qty) >= 0 ? '+' : ''}
                      {formatQty(m.change_qty)}
                    </td>
                    <td className="small dim nowrap">{m.reference || '—'}</td>
                    <td className="small muted">{m.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
