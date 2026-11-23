import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ConfirmDialog, Empty, Modal, Spinner, useDebounced, useToast } from '../components/ui'
import { formatMoney } from '@shared/calc'
import type { CompanySettings, Customer, CustomerInput } from '@shared/types'
import type { NavProps } from '../App'

const EMPTY: CustomerInput = {
  name: '',
  company: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  ntn: '',
  strn: '',
  notes: '',
  is_active: true
}

export default function Customers({ navigate }: NavProps): React.JSX.Element {
  const toast = useToast()
  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [showInactive, setShowInactive] = useState(false)
  const [company, setCompany] = useState<CompanySettings | null>(null)

  const [editing, setEditing] = useState<{ customer: Customer | null } | null>(null)
  const [deleting, setDeleting] = useState<Customer | null>(null)
  const [ledgers, setLedgers] = useState<Record<number, { invoiceCount: number; outstanding: number; totalBilled: number }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listCustomers(debounced, !showInactive)
      setRows(list)
      // Fetch balances for the visible page only.
      const entries = await Promise.all(
        list.slice(0, 60).map(async (c) => {
          try {
            const l = await api.customerLedger(c.id)
            return [c.id, l] as const
          } catch {
            return [c.id, { invoiceCount: 0, outstanding: 0, totalBilled: 0, totalPaid: 0 }] as const
          }
        })
      )
      setLedgers(Object.fromEntries(entries))
    } catch (err) {
      toast.error(err)
    } finally {
      setLoading(false)
    }
  }, [debounced, showInactive, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.getSettings().then(setCompany).catch(() => {})
  }, [])

  const sym = company?.currency_symbol ?? 'Rs.'

  const doDelete = async (): Promise<void> => {
    if (!deleting) return
    try {
      const r = await api.deleteCustomer(deleting.id)
      toast.success(
        r.deactivated
          ? `"${deleting.name}" has invoices, so it was deactivated instead of deleted.`
          : `Deleted "${deleting.name}".`
      )
      setDeleting(null)
      void load()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Customers</h1>
          <div className="sub">
            {rows.length} {rows.length === 1 ? 'customer' : 'customers'}
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn-primary" onClick={() => setEditing({ customer: null })}>
            ＋ Add Customer
          </button>
        </div>
      </div>

      <div className="content">
        <div className="toolbar">
          <div className="grow">
            <input
              placeholder="Search by name, company, phone or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span className="small">Show inactive</span>
          </label>
        </div>

        {loading && rows.length === 0 ? (
          <Spinner label="Loading customers…" />
        ) : rows.length === 0 ? (
          <div className="table-wrap">
            <Empty
              icon="☺"
              title={search ? 'No customers match that search' : 'No customers yet'}
              hint="Add customers here, or create them on the fly while making an invoice."
              action={
                <button className="btn-primary btn-sm" onClick={() => setEditing({ customer: null })}>
                  ＋ Add Customer
                </button>
              }
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>City</th>
                  <th className="num">Invoices</th>
                  <th className="num">Billed</th>
                  <th className="num">Outstanding</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const l = ledgers[c.id]
                  return (
                    <tr key={c.id}>
                      <td className="clickable strong" onClick={() => setEditing({ customer: c })}>
                        {c.name}
                        {!c.is_active ? <span className="badge cancelled" style={{ marginLeft: 6 }}>inactive</span> : null}
                      </td>
                      <td className="dim">{c.company || '—'}</td>
                      <td className="small">
                        {c.phone ? <div>{c.phone}</div> : null}
                        {c.email ? <div className="muted xsmall">{c.email}</div> : null}
                        {!c.phone && !c.email ? '—' : null}
                      </td>
                      <td className="small dim">{c.city || '—'}</td>
                      <td className="num">{l?.invoiceCount ?? '—'}</td>
                      <td className="num nowrap dim">{l ? formatMoney(l.totalBilled, sym, 0) : '—'}</td>
                      <td className="num nowrap">
                        {l && l.outstanding > 0 ? (
                          <span className="badge low">{formatMoney(l.outstanding, sym, 0)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          className="btn-ghost btn-xs"
                          title="New invoice for this customer"
                          onClick={() => navigate({ name: 'invoice-editor' })}
                        >
                          ＋
                        </button>
                        <button className="btn-ghost btn-xs" title="Edit" onClick={() => setEditing({ customer: c })}>
                          ✎
                        </button>
                        <button className="btn-ghost btn-xs" title="Delete" onClick={() => setDeleting(c)}>
                          🗑
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <CustomerEditor
          customer={editing.customer}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete customer"
          message={
            <>
              Delete <strong>{deleting.name}</strong>?
              <div className="small muted mt8">
                Customers with invoices are deactivated instead, so past invoices keep their details.
              </div>
            </>
          }
          onConfirm={() => void doDelete()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  )
}

export function CustomerEditor({
  customer,
  onClose,
  onSaved
}: {
  customer: Customer | null
  onClose: () => void
  onSaved: (c: Customer) => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<CustomerInput>(() =>
    customer
      ? {
          name: customer.name,
          company: customer.company,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          city: customer.city,
          ntn: customer.ntn,
          strn: customer.strn,
          notes: customer.notes,
          is_active: customer.is_active
        }
      : { ...EMPTY }
  )
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]): void =>
    setForm((f) => ({ ...f, [k]: v }))

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('Customer name is required.')
      return
    }
    setBusy(true)
    try {
      const saved = customer
        ? await api.updateCustomer(customer.id, form)
        : await api.createCustomer(form)
      toast.success(customer ? 'Customer updated.' : 'Customer added.')
      onSaved(saved)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={customer ? `Edit: ${customer.name}` : 'Add customer'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <span className="spinner" /> : null} {customer ? 'Save changes' : 'Add customer'}
          </button>
        </>
      }
    >
      <div className="row">
        <div className="field">
          <label>Contact name *</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Company / shop name</label>
          <input value={form.company} onChange={(e) => set('company', e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Phone</label>
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+92 3xx xxxxxxx" />
        </div>
        <div className="field">
          <label>Email</label>
          <input value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Address</label>
        <textarea value={form.address} onChange={(e) => set('address', e.target.value)} />
      </div>

      <div className="row">
        <div className="field">
          <label>City</label>
          <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Lahore" />
        </div>
        <div className="field">
          <label>NTN</label>
          <input value={form.ntn} onChange={(e) => set('ntn', e.target.value)} />
        </div>
        <div className="field">
          <label>STRN</label>
          <input value={form.strn} onChange={(e) => set('strn', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Notes</label>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      <label className="inline-check">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        <span>Active</span>
      </label>
    </Modal>
  )
}
