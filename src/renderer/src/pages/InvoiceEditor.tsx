import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { CustomerEditor } from './Customers'
import { Modal, Spinner, useDebounced, useToast } from '../components/ui'
import InvoicePreview from '../components/InvoicePreview'
import { computeTotals, formatMoney, formatQty, lineNet, num, round2 } from '@shared/calc'
import type {
  CompanySettings, Customer, Invoice, InvoiceItem, InvoiceStatus, InvoiceTemplate,
  InvoiceWithItems, Payment, Product, Uom
} from '@shared/types'
import type { NavProps, Route } from '../App'

interface EditorProps extends NavProps {
  invoiceId?: number
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function blankItem(): InvoiceItem {
  return {
    product_id: null,
    name: '',
    description: '',
    uom: 'pcs',
    pack_size: 1,
    qty: 1,
    unit_price: 0,
    discount_pct: 0,
    tax_rate: 0,
    line_total: 0,
    sort_order: 0
  }
}

export default function InvoiceEditor({ invoiceId, navigate }: EditorProps): React.JSX.Element {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [savedInvoice, setSavedInvoice] = useState<InvoiceWithItems | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])

  // ── Form state ──
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [poNumber, setPoNumber] = useState('')
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([blankItem()])
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount')
  const [discountValue, setDiscountValue] = useState(0)
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [shipping, setShipping] = useState(0)
  const [roundOff, setRoundOff] = useState(0)
  const [status, setStatus] = useState<InvoiceStatus>('draft')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')

  const [addingCustomer, setAddingCustomer] = useState(false)
  const [payingOpen, setPayingOpen] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Preview visibility is a per-user habit, so remember it. Storage can throw
  // in a locked-down profile, so every access is guarded.
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    try {
      return localStorage.getItem('invoice.showPreview') !== '0'
    } catch {
      return true
    }
  })
  const [fullPreview, setFullPreview] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem('invoice.showPreview', showPreview ? '1' : '0')
    } catch {
      /* preference is a nicety, not a requirement */
    }
  }, [showPreview])

  // ── Load ──
  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const [co, tpl, cust] = await Promise.all([
          api.getSettings(),
          api.listTemplates(),
          api.listCustomers('', true)
        ])
        setCompany(co)
        setTemplates(tpl)
        setCustomers(cust)

        if (invoiceId) {
          const inv = await api.getInvoice(invoiceId)
          if (!inv) throw new Error('Invoice not found.')
          setSavedInvoice(inv)
          setInvoiceNo(inv.invoice_no)
          setInvoiceDate(inv.invoice_date)
          setDueDate(inv.due_date ?? '')
          setCustomerId(inv.customer_id)
          setPoNumber(inv.po_number)
          setTemplateId(inv.template_id ?? tpl.find((t) => t.is_default)?.id ?? tpl[0]?.id ?? null)
          setItems(inv.items.length ? inv.items : [blankItem()])
          setDiscountType(inv.discount_type)
          setDiscountValue(num(inv.discount_value))
          setTaxEnabled(inv.tax_enabled)
          setShipping(num(inv.shipping))
          setRoundOff(num(inv.round_off))
          setStatus(inv.status)
          setNotes(inv.notes)
          setTerms(inv.terms)
          setPayments(await api.listPayments(invoiceId))
        } else {
          setInvoiceNo(await api.nextInvoiceNo())
          setTemplateId(tpl.find((t) => t.is_default)?.id ?? tpl[0]?.id ?? null)
          setTaxEnabled(co.tax_enabled_default)
          setNotes(co.default_notes)
          setTerms(co.default_terms)
        }
      } catch (err) {
        toast.error(err)
      } finally {
        setLoading(false)
      }
    })()
    // Intentionally keyed on invoiceId only; `toast` is stable per provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  const markDirty = (): void => setDirty(true)

  // ── Line helpers ──
  const updateItem = useCallback((index: number, patch: Partial<InvoiceItem>): void => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        const next = { ...it, ...patch }
        next.line_total = lineNet(next)
        return next
      })
    )
    markDirty()
  }, [])

  const addItem = (): void => {
    setItems((p) => [...p, blankItem()])
    markDirty()
  }

  const removeItem = (index: number): void => {
    setItems((p) => (p.length === 1 ? [blankItem()] : p.filter((_, i) => i !== index)))
    markDirty()
  }

  const moveItem = (index: number, dir: -1 | 1): void => {
    setItems((p) => {
      const to = index + dir
      if (to < 0 || to >= p.length) return p
      const n = [...p]
      ;[n[index], n[to]] = [n[to], n[index]]
      return n
    })
    markDirty()
  }

  /** Fill a line from a catalogue product, defaulting to its pack pricing. */
  const applyProduct = (index: number, p: Product): void => {
    const usePack = p.pack_size > 1
    updateItem(index, {
      product_id: p.id,
      name: p.name,
      description: p.size_text ? `${p.size_text}${p.material ? ` · ${p.material}` : ''}` : p.description,
      uom: usePack ? 'pack' : 'pcs',
      pack_size: p.pack_size,
      unit_price: usePack ? num(p.pack_price) : num(p.unit_price),
      tax_rate: num(p.tax_rate) || num(company?.default_tax_rate) || 0,
      qty: 1
    })
  }

  /** Switching pcs <-> pack re-prices the line from the product's pricing. */
  const changeUom = async (index: number, uom: Uom): Promise<void> => {
    const it = items[index]
    const size = Math.max(1, num(it.pack_size, 1))
    let price = num(it.unit_price)

    if (it.product_id) {
      try {
        const p = await api.getProduct(it.product_id)
        if (p) price = uom === 'pack' ? num(p.pack_price) : num(p.unit_price)
      } catch {
        price = uom === 'pack' ? round2(price * size) : round2(price / size)
      }
    } else {
      price = uom === 'pack' ? round2(price * size) : round2(price / size)
    }
    updateItem(index, { uom, unit_price: price })
  }

  // ── Totals ──
  const draft: InvoiceWithItems = useMemo(
    () => ({
      id: savedInvoice?.id ?? 0,
      invoice_no: invoiceNo || 'DRAFT',
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      customer_id: customerId,
      customer_snapshot: customers.find((c) => c.id === customerId) ?? {},
      template_id: templateId,
      po_number: poNumber,
      subtotal: 0,
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount: 0,
      tax_enabled: taxEnabled,
      tax_amount: 0,
      shipping,
      round_off: roundOff,
      total: 0,
      paid_amount: savedInvoice ? num(savedInvoice.paid_amount) : 0,
      status,
      stock_applied: savedInvoice?.stock_applied ?? false,
      notes,
      terms,
      items: items.filter((i) => i.name.trim() !== '')
    }),
    [
      savedInvoice, invoiceNo, invoiceDate, dueDate, customerId, customers, templateId, poNumber,
      discountType, discountValue, taxEnabled, shipping, roundOff, status, notes, terms, items
    ]
  )

  const totals = useMemo(() => computeTotals(draft), [draft])
  const sym = company?.currency_symbol ?? 'Rs.'

  /** What the total would be with no rounding applied. */
  const preRoundTotal = round2(totals.total - totals.roundOff)

  /** Set the round-off so the final total lands on a multiple of `step`. */
  const roundTotalTo = useCallback(
    (step: number): void => {
      const target = Math.round(preRoundTotal / step) * step
      setRoundOff(round2(target - preRoundTotal))
      markDirty()
    },
    // markDirty is stable; preRoundTotal is recomputed each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preRoundTotal]
  )

  // ── Save ──
  const save = async (newStatus?: InvoiceStatus): Promise<InvoiceWithItems | null> => {
    const usable = items.filter((i) => i.name.trim() !== '')
    if (usable.length === 0) {
      toast.error('Add at least one line item.')
      return null
    }
    setSaving(true)
    try {
      const saved = await api.saveInvoice({
        id: savedInvoice?.id,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        customer_id: customerId,
        customer_snapshot: {},
        template_id: templateId,
        po_number: poNumber,
        discount_type: discountType,
        discount_value: discountValue,
        tax_enabled: taxEnabled,
        shipping,
        round_off: roundOff,
        paid_amount: savedInvoice ? num(savedInvoice.paid_amount) : 0,
        status: newStatus ?? status,
        stock_applied: false,
        notes,
        terms,
        items: usable
      })
      setSavedInvoice(saved)
      setInvoiceNo(saved.invoice_no)
      setStatus(saved.status)
      setItems(saved.items.length ? saved.items : [blankItem()])
      setDirty(false)
      toast.success(`Invoice ${saved.invoice_no} saved.`)
      return saved
    } catch (err) {
      toast.error(err)
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveAndPdf = async (): Promise<void> => {
    const saved = (await save(status === 'draft' ? 'issued' : status)) ?? savedInvoice
    if (!saved) return
    try {
      const r = await api.savePdf(saved.id, templateId)
      if (r.saved) toast.success('PDF saved.')
    } catch (err) {
      toast.error(err)
    }
  }

  const saveAndPrint = async (): Promise<void> => {
    const saved = (await save(status === 'draft' ? 'issued' : status)) ?? savedInvoice
    if (!saved) return
    try {
      await api.printInvoice(saved.id, templateId)
    } catch (err) {
      toast.error(err)
    }
  }

  if (loading) return <Spinner label="Loading invoice…" />

  const activeTemplate = templates.find((t) => t.id === templateId) ?? null

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{savedInvoice ? `Invoice ${invoiceNo}` : 'New Invoice'}</h1>
          <div className="sub">
            {savedInvoice ? (
              <>
                <span className={`badge ${status}`}>{status}</span>
                {dirty ? <span className="muted"> · unsaved changes</span> : null}
              </>
            ) : (
              <>Next number: {invoiceNo}</>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <select
            value={templateId ?? ''}
            onChange={(e) => {
              setTemplateId(e.target.value ? parseInt(e.target.value, 10) : null)
              markDirty()
            }}
            style={{ width: 'auto' }}
            title="Invoice template"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_default ? ' ★' : ''}
              </option>
            ))}
          </select>
          <button onClick={() => navigate({ name: 'templates' } as Route)} title="Design templates">
            ✎
          </button>
          <button
            onClick={() => setFullPreview(true)}
            title="See the whole invoice at full size, exactly as it will print"
          >
            ⛶ Preview
          </button>
          <button
            onClick={() => setShowPreview((v) => !v)}
            title={
              showPreview
                ? 'Hide the side preview to get a wider form'
                : 'Show the side preview again'
            }
            aria-label={showPreview ? 'Hide side preview' : 'Show side preview'}
          >
            {showPreview ? '◧' : '◨'}
          </button>
          <button onClick={() => void saveAndPrint()} disabled={saving} title="Save and print">
            ⎙ Print
          </button>
          <button onClick={() => void saveAndPdf()} disabled={saving} title="Save as a PDF file">
            ⇩ PDF
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <span className="spinner" /> : null} Save
          </button>
        </div>
      </div>

      <div className="editor-split">
        {/* ─────────── Left: the form ─────────── */}
        <div className="editor-pane">
          <div className="card">
            <div className="row">
              <div className="field" style={{ flex: 2 }}>
                <label>Customer</label>
                <div className="flex gap8">
                  <select
                    value={customerId ?? ''}
                    onChange={(e) => {
                      setCustomerId(e.target.value ? parseInt(e.target.value, 10) : null)
                      markDirty()
                    }}
                  >
                    <option value="">Walk-in customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company ? `${c.company} — ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn-sm" onClick={() => setAddingCustomer(true)} title="Add a new customer">
                    ＋
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Invoice date</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => {
                    setInvoiceDate(e.target.value)
                    markDirty()
                  }}
                />
              </div>
              <div className="field">
                <label>Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value)
                    markDirty()
                  }}
                />
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>P.O. / reference number</label>
                <input
                  value={poNumber}
                  onChange={(e) => {
                    setPoNumber(e.target.value)
                    markDirty()
                  }}
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <label>Status</label>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as InvoiceStatus)
                    markDirty()
                  }}
                >
                  <option value="draft">Draft (no stock deducted)</option>
                  <option value="issued">Issued (deducts stock)</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partially paid</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="help">
              Drafts keep a temporary number and do not touch inventory. Issuing an invoice assigns
              the next real number and deducts stock.
            </div>
          </div>

          {/* ── Line items ── */}
          <div className="card">
            <h3 className="card-title">
              Items <span className="count">{items.filter((i) => i.name.trim()).length} lines</span>
              <label className="inline-check ml-auto">
                <input
                  type="checkbox"
                  checked={taxEnabled}
                  onChange={(e) => {
                    setTaxEnabled(e.target.checked)
                    markDirty()
                  }}
                />
                <span className="small">Apply sales tax</span>
              </label>
            </h3>

            <table className="lines">
              <thead>
                <tr>
                  <th style={{ width: 22 }} />
                  <th>Product / description</th>
                  <th style={{ width: 78 }}>Unit</th>
                  <th style={{ width: 64 }}>Qty</th>
                  <th style={{ width: 92 }}>Rate</th>
                  <th style={{ width: 56 }}>Disc%</th>
                  {taxEnabled ? <th style={{ width: 56 }}>Tax%</th> : null}
                  <th style={{ width: 92 }} className="right">
                    Amount
                  </th>
                  <th style={{ width: 28 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td className="line-drag">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <button
                          className="btn-xs btn-ghost"
                          style={{ padding: '0 2px', fontSize: 8 }}
                          onClick={() => moveItem(i, -1)}
                          disabled={i === 0}
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          className="btn-xs btn-ghost"
                          style={{ padding: '0 2px', fontSize: 8 }}
                          onClick={() => moveItem(i, 1)}
                          disabled={i === items.length - 1}
                          title="Move down"
                        >
                          ▼
                        </button>
                      </div>
                    </td>
                    <td>
                      <ProductPicker
                        value={item.name}
                        onNameChange={(v) => updateItem(i, { name: v, product_id: null })}
                        onPick={(p) => applyProduct(i, p)}
                      />
                      <input
                        style={{ marginTop: 3 }}
                        placeholder="Extra detail (optional)"
                        value={item.description}
                        onChange={(e) => updateItem(i, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <select value={item.uom} onChange={(e) => void changeUom(i, e.target.value as Uom)}>
                        <option value="pcs">Pieces</option>
                        <option value="pack">Pack</option>
                      </select>
                      {item.uom === 'pack' ? (
                        <input
                          style={{ marginTop: 3 }}
                          type="number"
                          min={1}
                          step={1}
                          value={item.pack_size}
                          onChange={(e) =>
                            updateItem(i, { pack_size: Math.max(1, parseInt(e.target.value, 10) || 1) })
                          }
                          title="Pieces per pack"
                        />
                      ) : null}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.001"
                        value={item.qty}
                        onChange={(e) => updateItem(i, { qty: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={item.unit_price}
                        onChange={(e) => updateItem(i, { unit_price: parseFloat(e.target.value) || 0 })}
                        title="Your own price for this line"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        value={item.discount_pct}
                        onChange={(e) => updateItem(i, { discount_pct: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    {taxEnabled ? (
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={item.tax_rate}
                          onChange={(e) => updateItem(i, { tax_rate: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                    ) : null}
                    <td className="line-total">{formatMoney(item.line_total, sym)}</td>
                    <td style={{ paddingTop: 9 }}>
                      <button className="btn-ghost btn-xs" onClick={() => removeItem(i)} title="Remove line">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex gap8 mt8">
              <button className="btn-sm" onClick={addItem}>
                ＋ Add line
              </button>
              {taxEnabled && company ? (
                <button
                  className="btn-sm btn-ghost"
                  onClick={() => {
                    setItems((p) =>
                      p.map((it) => ({ ...it, tax_rate: num(company.default_tax_rate) }))
                    )
                    markDirty()
                  }}
                >
                  Set all tax to {formatQty(num(company.default_tax_rate))}%
                </button>
              ) : null}
            </div>
          </div>

          {/* ── Totals ── */}
          <div className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="field">
                  <label>Discount on the whole invoice</label>
                  <div className="flex gap8">
                    <select
                      value={discountType}
                      onChange={(e) => {
                        setDiscountType(e.target.value as 'amount' | 'percent')
                        markDirty()
                      }}
                      style={{ flex: '0 0 110px' }}
                    >
                      <option value="amount">{sym} amount</option>
                      <option value="percent">Percent</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={discountValue}
                      onChange={(e) => {
                        setDiscountValue(parseFloat(e.target.value) || 0)
                        markDirty()
                      }}
                    />
                  </div>
                </div>
                <div className="row">
                  <div className="field">
                    <label>Delivery / courier</label>
                    <input
                      type="number"
                      step="0.01"
                      value={shipping}
                      onChange={(e) => {
                        setShipping(parseFloat(e.target.value) || 0)
                        markDirty()
                      }}
                    />
                  </div>
                </div>

                {/* Round off: the arithmetic is spelled out, and the buttons do
                    it for you, because "round off" means nothing on its own. */}
                <div className="field">
                  <label>
                    Round off <span className="muted">— trim the total to a neat figure</span>
                  </label>
                  <div className="roundoff-row">
                    <input
                      type="number"
                      step="0.01"
                      value={roundOff}
                      onChange={(e) => {
                        setRoundOff(parseFloat(e.target.value) || 0)
                        markDirty()
                      }}
                    />
                    <button type="button" className="btn-xs" onClick={() => roundTotalTo(1)}>
                      Whole
                    </button>
                    <button type="button" className="btn-xs" onClick={() => roundTotalTo(10)}>
                      To 10
                    </button>
                    <button type="button" className="btn-xs" onClick={() => roundTotalTo(100)}>
                      To 100
                    </button>
                    <button
                      type="button"
                      className="btn-xs"
                      onClick={() => {
                        setRoundOff(0)
                        markDirty()
                      }}
                    >
                      None
                    </button>
                  </div>
                  <div className="help">
                    {totals.roundOff === 0 ? (
                      <>Total stays exactly {formatMoney(preRoundTotal, sym)}.</>
                    ) : (
                      <>
                        {formatMoney(preRoundTotal, sym)} {totals.roundOff > 0 ? '+' : '−'}{' '}
                        {formatMoney(Math.abs(totals.roundOff), sym)} ={' '}
                        <strong>{formatMoney(totals.total, sym)}</strong>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div className="totals-box">
                  <div className="tr">
                    <span className="dim">Subtotal</span>
                    <span className="tv">{formatMoney(totals.subtotal, sym)}</span>
                  </div>
                  {totals.discountAmount > 0 ? (
                    <div className="tr">
                      <span className="dim">Discount</span>
                      <span className="tv">− {formatMoney(totals.discountAmount, sym)}</span>
                    </div>
                  ) : null}
                  {taxEnabled ? (
                    <div className="tr">
                      <span className="dim">Sales tax</span>
                      <span className="tv">{formatMoney(totals.taxAmount, sym)}</span>
                    </div>
                  ) : null}
                  {totals.shipping !== 0 ? (
                    <div className="tr">
                      <span className="dim">Delivery</span>
                      <span className="tv">{formatMoney(totals.shipping, sym)}</span>
                    </div>
                  ) : null}
                  {totals.roundOff !== 0 ? (
                    <div className="tr">
                      <span className="dim">Round off</span>
                      <span className="tv">{formatMoney(totals.roundOff, sym)}</span>
                    </div>
                  ) : null}
                  <div className="tr grand">
                    <span>Total</span>
                    <span className="tv">{formatMoney(totals.total, sym)}</span>
                  </div>
                  {savedInvoice && num(savedInvoice.paid_amount) > 0 ? (
                    <>
                      <div className="tr">
                        <span className="dim">Paid</span>
                        <span className="tv">{formatMoney(savedInvoice.paid_amount, sym)}</span>
                      </div>
                      <div className="tr">
                        <span className="dim">Balance</span>
                        <span className="tv strong">
                          {formatMoney(num(totals.total) - num(savedInvoice.paid_amount), sym)}
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* ── Payments ── */}
          {savedInvoice ? (
            <div className="card">
              <h3 className="card-title">
                Payments <span className="count">{payments.length}</span>
                <button className="btn-sm ml-auto" onClick={() => setPayingOpen(true)}>
                  ＋ Record payment
                </button>
              </h3>
              {payments.length === 0 ? (
                <div className="small muted">No payments recorded yet.</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Note</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="small nowrap">{p.paid_on}</td>
                        <td className="small">{p.method}</td>
                        <td className="small muted">{p.note || '—'}</td>
                        <td className="num nowrap">{formatMoney(p.amount, sym)}</td>
                        <td className="actions">
                          <button
                            className="btn-ghost btn-xs"
                            title="Delete payment"
                            onClick={async () => {
                              try {
                                await api.deletePayment(p.id)
                                const inv = await api.getInvoice(savedInvoice.id)
                                if (inv) {
                                  setSavedInvoice(inv)
                                  setStatus(inv.status)
                                }
                                setPayments(await api.listPayments(savedInvoice.id))
                                toast.success('Payment removed.')
                              } catch (err) {
                                toast.error(err)
                              }
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {/* ── Notes & terms ── */}
          <div className="card">
            <div className="row">
              <div className="field">
                <label>Notes (shown on the invoice)</label>
                <textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value)
                    markDirty()
                  }}
                />
              </div>
              <div className="field">
                <label>Terms &amp; conditions</label>
                <textarea
                  value={terms}
                  onChange={(e) => {
                    setTerms(e.target.value)
                    markDirty()
                  }}
                  style={{ minHeight: 100 }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ─────────── Right: live preview ─────────── */}
        {showPreview ? (
        <div className="preview-pane">
          <div className="preview-head">
            <span className="small dim">Live preview</span>
            <span className="xsmall muted">{activeTemplate?.name ?? ''}</span>
            <button
              className="btn-ghost btn-xs ml-auto"
              onClick={() => navigate({ name: 'templates' } as Route)}
              title="Change fonts, logo, watermark, header and footer"
            >
              Customise ✎
            </button>
          </div>
          <InvoicePreview invoice={draft} config={activeTemplate?.config ?? null} debounceMs={400} />
        </div>
        ) : null}
      </div>

      {fullPreview ? (
        <Modal
          title={`Preview — ${invoiceNo}${activeTemplate ? ` · ${activeTemplate.name}` : ''}`}
          onClose={() => setFullPreview(false)}
          size="wide"
          className="preview-modal"
        >
          <div className="full-preview">
            <InvoicePreview invoice={draft} config={activeTemplate?.config ?? null} debounceMs={150} />
          </div>
          <p className="small muted mt8 mb0">
            This is exactly what Print and Save PDF produce. Close this to keep editing.
          </p>
        </Modal>
      ) : null}

      {addingCustomer ? (
        <CustomerEditor
          customer={null}
          onClose={() => setAddingCustomer(false)}
          onSaved={async (c) => {
            setAddingCustomer(false)
            setCustomers(await api.listCustomers('', true))
            setCustomerId(c.id)
            markDirty()
          }}
        />
      ) : null}

      {payingOpen && savedInvoice ? (
        <PaymentDialog
          invoice={savedInvoice}
          currencySymbol={sym}
          onClose={() => setPayingOpen(false)}
          onSaved={async (inv) => {
            setPayingOpen(false)
            setSavedInvoice(inv)
            setStatus(inv.status)
            setPayments(await api.listPayments(inv.id))
          }}
        />
      ) : null}
    </>
  )
}

// ─────────────────────── Product picker ───────────────────────

function ProductPicker({
  value,
  onNameChange,
  onPick
}: {
  value: string
  onNameChange: (v: string) => void
  onPick: (p: Product) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Product[]>([])
  const [highlight, setHighlight] = useState(0)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 220)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || debounced.trim().length < 1) {
      setResults([])
      return
    }
    let cancelled = false
    void api
      .searchProducts(debounced, 20)
      .then((r) => {
        if (!cancelled) {
          setResults(r)
          setHighlight(0)
        }
      })
      .catch(() => setResults([]))
    return () => {
      cancelled = true
    }
  }, [debounced, open])

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const choose = (p: Product): void => {
    onPick(p)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="search-pop" ref={boxRef}>
      <input
        value={value}
        placeholder="Type to search products, or write any custom item…"
        onChange={(e) => {
          onNameChange(e.target.value)
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQuery(value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(results[highlight])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && results.length > 0 ? (
        <div className="search-results">
          {results.map((p, i) => (
            <div
              key={p.id}
              className={`search-item ${i === highlight ? 'active' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
            >
              <div className="si-name">{p.name}</div>
              <div className="si-meta">
                {p.sku ? <span>{p.sku}</span> : null}
                <span>Rs. {formatQty(p.unit_price)}/pc</span>
                {p.pack_size > 1 ? (
                  <span>
                    Rs. {formatQty(p.pack_price)}/pack of {p.pack_size}
                  </span>
                ) : null}
                <span style={{ color: num(p.stock_qty) <= 0 ? 'var(--danger)' : undefined }}>
                  stock {formatQty(p.stock_qty)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────── Payment dialog ───────────────────────

function PaymentDialog({
  invoice,
  currencySymbol,
  onClose,
  onSaved
}: {
  invoice: Invoice
  currencySymbol: string
  onClose: () => void
  onSaved: (inv: InvoiceWithItems) => void
}): React.JSX.Element {
  const toast = useToast()
  const balance = round2(num(invoice.total) - num(invoice.paid_amount))
  const [amount, setAmount] = useState(String(balance > 0 ? balance : ''))
  const [method, setMethod] = useState('cash')
  const [paidOn, setPaidOn] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const inv = await api.addPayment({
        invoiceId: invoice.id,
        amount: num(amount),
        method,
        paidOn,
        note
      })
      toast.success('Payment recorded.')
      onSaved(inv)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Record payment"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            Record
          </button>
        </>
      }
    >
      <div className="banner info">
        Balance due: <strong>{formatMoney(balance, currencySymbol)}</strong>
      </div>
      <div className="field">
        <label>Amount received</label>
        <input
          type="number"
          step="0.01"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </div>
      <div className="row">
        <div className="field">
          <label>Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank transfer">Bank transfer</option>
            <option value="easypaisa">Easypaisa</option>
            <option value="jazzcash">JazzCash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transaction ID, cheque no…" />
      </div>
    </Modal>
  )
}
