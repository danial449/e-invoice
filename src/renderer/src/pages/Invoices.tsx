import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ConfirmDialog, Empty, Spinner, useDebounced, useToast } from '../components/ui'
import { formatMoney } from '@shared/calc'
import type { CompanySettings, Invoice, InvoiceStatus } from '@shared/types'
import type { NavProps } from '../App'

const PAGE_SIZE = 50

export default function Invoices({ navigate }: NavProps): React.JSX.Element {
  const toast = useToast()
  const [rows, setRows] = useState<(Invoice & { customer_name: string | null })[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [company, setCompany] = useState<CompanySettings | null>(null)

  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState<Invoice | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listInvoices({
        search: debounced,
        status,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      })
      setRows(res.rows)
      setTotal(res.total)
    } catch (err) {
      toast.error(err)
    } finally {
      setLoading(false)
    }
  }, [debounced, status, dateFrom, dateTo, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.getSettings().then(setCompany).catch(() => {})
  }, [])

  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [debounced, status, dateFrom, dateTo])

  const sym = company?.currency_symbol ?? 'Rs.'
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const act = async (id: number, fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusyId(id)
    try {
      await fn()
      toast.success(ok)
      void load()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Invoices</h1>
          <div className="sub">
            {total} {total === 1 ? 'invoice' : 'invoices'}
          </div>
        </div>
        <div className="topbar-actions">
          {selected.size > 0 ? (
            <button
              onClick={async () => {
                try {
                  const r = await api.exportManyPdf([...selected])
                  if (r.saved > 0) toast.success(`Saved ${r.saved} PDF files to ${r.folder}.`)
                  if (r.errors.length) toast.warn(`${r.errors.length} failed to export.`)
                } catch (err) {
                  toast.error(err)
                }
              }}
            >
              ⇩ Export {selected.size} as PDF
            </button>
          ) : null}
          <button className="btn-primary" onClick={() => navigate({ name: 'invoice-editor' })}>
            ＋ New Invoice
          </button>
        </div>
      </div>

      <div className="content">
        <div className="toolbar">
          <div className="grow">
            <input
              placeholder="Search invoice number, customer or PO…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="partial">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
          {dateFrom || dateTo || status !== 'all' || search ? (
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setSearch('')
                setStatus('all')
                setDateFrom('')
                setDateTo('')
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        {loading && rows.length === 0 ? (
          <Spinner label="Loading invoices…" />
        ) : rows.length === 0 ? (
          <div className="table-wrap">
            <Empty
              icon="≣"
              title={search || status !== 'all' ? 'No invoices match these filters' : 'No invoices yet'}
              hint="Create an invoice by picking products and setting your own prices."
              action={
                <button className="btn-primary btn-sm" onClick={() => navigate({ name: 'invoice-editor' })}>
                  ＋ New Invoice
                </button>
              }
            />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input
                        type="checkbox"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                        }
                      />
                    </th>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th className="num">Total</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv) => {
                    const balance = Number(inv.total) - Number(inv.paid_amount)
                    return (
                      <tr key={inv.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(inv.id)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s)
                                if (n.has(inv.id)) n.delete(inv.id)
                                else n.add(inv.id)
                                return n
                              })
                            }
                          />
                        </td>
                        <td
                          className="clickable strong nowrap"
                          onClick={() => navigate({ name: 'invoice-editor', id: inv.id })}
                        >
                          {inv.invoice_no}
                        </td>
                        <td className="small nowrap">{inv.invoice_date}</td>
                        <td className="dim">
                          {inv.customer_name ?? String(inv.customer_snapshot?.name ?? 'Walk-in')}
                        </td>
                        <td className="num nowrap">{formatMoney(inv.total, sym, 0)}</td>
                        <td className="num nowrap">
                          {balance > 0.004 ? (
                            <span className="badge low">{formatMoney(balance, sym, 0)}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${inv.status}`}>{inv.status}</span>
                        </td>
                        <td className="actions nowrap">
                          {busyId === inv.id ? (
                            <span className="spinner" />
                          ) : (
                            <>
                              <button
                                className="btn-ghost btn-xs"
                                title="Save as PDF"
                                onClick={() =>
                                  void act(inv.id, () => api.savePdf(inv.id), 'PDF saved.')
                                }
                              >
                                ⇩
                              </button>
                              <button
                                className="btn-ghost btn-xs"
                                title="Print"
                                onClick={() => void act(inv.id, () => api.printInvoice(inv.id), 'Sent to printer.')}
                              >
                                ⎙
                              </button>
                              <button
                                className="btn-ghost btn-xs"
                                title="Duplicate"
                                onClick={() =>
                                  void act(inv.id, () => api.duplicateInvoice(inv.id), 'Duplicated as a new draft.')
                                }
                              >
                                ⧉
                              </button>
                              <button
                                className="btn-ghost btn-xs"
                                title="Edit"
                                onClick={() => navigate({ name: 'invoice-editor', id: inv.id })}
                              >
                                ✎
                              </button>
                              <button className="btn-ghost btn-xs" title="Delete" onClick={() => setDeleting(inv)}>
                                🗑
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {pages > 1 ? (
              <div className="pager">
                <button className="btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  ← Previous
                </button>
                <span>
                  Page {page + 1} of {pages}
                </span>
                <button className="btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {deleting ? (
        <ConfirmDialog
          title="Delete invoice"
          message={
            <>
              Delete invoice <strong>{deleting.invoice_no}</strong>?
              <div className="small muted mt8">
                Any stock this invoice consumed is returned to inventory. This cannot be undone.
              </div>
            </>
          }
          onConfirm={async () => {
            const id = deleting.id
            setDeleting(null)
            await act(id, () => api.deleteInvoice(id), 'Invoice deleted.')
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  )
}
