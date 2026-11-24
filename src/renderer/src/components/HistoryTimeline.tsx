import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Empty, Spinner } from './ui'
import type { InvoiceEvent, InvoiceEventKind } from '@shared/types'

const ICON: Record<InvoiceEventKind, string> = {
  created: '✚',
  updated: '✎',
  status: '⇄',
  payment: '₨',
  payment_removed: '⊖',
  duplicated: '⧉',
  deleted: '✕'
}

const LABEL: Record<InvoiceEventKind, string> = {
  created: 'Created',
  updated: 'Edited',
  status: 'Status',
  payment: 'Payment',
  payment_removed: 'Payment removed',
  duplicated: 'Duplicated',
  deleted: 'Deleted'
}

/** "23-Nov-2026, 4:12 pm" — matching how dates read on the invoice itself. */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** How long ago, for the entries at the top where it is the useful reading. */
function ago(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`
  return ''
}

export default function HistoryTimeline({
  invoiceId,
  customerId,
  showInvoiceNo = false,
  limit,
  emptyText = 'Nothing has happened yet.'
}: {
  /** Show the trail for one invoice… */
  invoiceId?: number
  /** …or for every invoice belonging to one customer. */
  customerId?: number
  showInvoiceNo?: boolean
  limit?: number
  emptyText?: string
}): React.JSX.Element {
  const [events, setEvents] = useState<InvoiceEvent[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      if (invoiceId) setEvents(await api.invoiceHistory(invoiceId, limit))
      else if (customerId) setEvents(await api.customerHistory(customerId, limit))
      else setEvents([])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEvents([])
    }
  }, [invoiceId, customerId, limit])

  useEffect(() => {
    void load()
  }, [load])

  if (events === null) return <Spinner label="Loading history…" />
  if (error) return <div className="banner error">{error}</div>
  if (events.length === 0) {
    return <Empty icon="◴" title="No history yet" hint={emptyText} />
  }

  return (
    <ul className="timeline">
      {events.map((e) => {
        const relative = ago(e.created_at)
        return (
          <li key={e.id} className={`tl-item tl-${e.kind}`}>
            <span className="tl-dot" aria-hidden="true">
              {ICON[e.kind] ?? '•'}
            </span>
            <div className="tl-body">
              <div className="tl-head">
                <span className="tl-kind">{LABEL[e.kind] ?? e.kind}</span>
                {showInvoiceNo && e.invoice_no ? (
                  <span className="tl-ref">{e.invoice_no}</span>
                ) : null}
                <span className="tl-when" title={when(e.created_at)}>
                  {relative || when(e.created_at)}
                </span>
              </div>
              <div className="tl-summary">{e.summary}</div>
              {relative ? <div className="tl-exact">{when(e.created_at)}</div> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
