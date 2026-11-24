import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  Accordion, ColorField, ConfirmDialog, Modal, NumberField, SegmentedControl, Slider,
  Spinner, TextField, Toggle, useDebounced, useToast
} from '../components/ui'
import InvoicePreview from '../components/InvoicePreview'
import { TEMPLATE_PRESETS } from '@shared/templatePresets'
import type {
  Align, InvoiceTemplate, InvoiceWithItems, PageSize, TemplateColumn, TemplateConfig
} from '@shared/types'
import type { NavProps } from '../App'

const FONT_FAMILIES = [
  { label: 'Segoe UI (default Windows)', value: "'Segoe UI', Roboto, Arial, sans-serif" },
  { label: 'Inter / system sans', value: "'Inter', 'Segoe UI', Arial, sans-serif" },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman (serif)', value: '"Times New Roman", Times, serif' },
  { label: 'Cambria (serif)', value: 'Cambria, Georgia, serif' },
  { label: 'Consolas (monospace)', value: "'Consolas', 'Courier New', monospace" },
  { label: 'Courier New (monospace)', value: "'Courier New', Courier, monospace" }
]

const ALIGN_OPTS: { value: Align; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' }
]

/** A representative invoice so the designer always has something to show. */
function demoInvoice(): InvoiceWithItems {
  const mk = (
    name: string,
    description: string,
    uom: 'pcs' | 'pack',
    pack_size: number,
    qty: number,
    unit_price: number,
    sort_order: number,
    discount_pct = 0
  ): InvoiceWithItems['items'][number] => {
    const gross = qty * unit_price
    return {
      product_id: null,
      name,
      description,
      uom,
      pack_size,
      qty,
      unit_price,
      discount_pct,
      tax_rate: 18,
      line_total: Math.round((gross - gross * (discount_pct / 100)) * 100) / 100,
      sort_order
    }
  }

  const items = [
    mk('6x6x3 Inch Cake Box with Transparent Window', '6x6x3 inch · White Corrugated Board', 'pack', 50, 4, 3500, 0),
    mk('Kraft Pizza Box', '12 inch · Kraft Corrugated', 'pack', 100, 2, 7500, 1, 5),
    mk('Black Stand Up Pouch With Valve (26x13cm)', '26x13 cm · Foil Laminate', 'pcs', 1, 250, 100, 2),
    mk('Custom Printed Sticker Roll', 'Client artwork, 1000 pcs per roll', 'pcs', 1, 3, 2200, 3)
  ]

  const subtotal = items.reduce((a, b) => a + b.line_total, 0)

  return {
    id: 0,
    invoice_no: 'INV-0142',
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 12096e5).toISOString().slice(0, 10),
    customer_id: null,
    customer_snapshot: {
      name: 'Ahmed Raza',
      company: 'Sweet Crumbs Bakery',
      address: '24-C, Main Boulevard, Gulberg III',
      city: 'Lahore',
      phone: '+92 300 1234567',
      email: 'orders@sweetcrumbs.pk',
      ntn: '1234567-8',
      strn: '03-99-8877-001-55'
    },
    template_id: null,
    po_number: 'PO-2291',
    subtotal,
    discount_type: 'percent',
    discount_value: 5,
    discount_amount: 0,
    tax_enabled: true,
    tax_amount: 0,
    shipping: 1500,
    round_off: 0,
    total: 0,
    paid_amount: 20000,
    status: 'issued',
    stock_applied: true,
    notes: 'Custom printing approved against artwork rev. 3. Delivery within 7 working days.',
    terms:
      '1. Prices are quoted in PKR and valid for 15 days.\n' +
      '2. Courier charges are adjusted based on parcel size, weight and delivery location.\n' +
      '3. Custom printed orders require 50% advance payment.',
    items
  }
}

export default function TemplateDesigner(_props: NavProps): React.JSX.Element {
  const toast = useToast()
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [config, setConfig] = useState<TemplateConfig | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<InvoiceTemplate | null>(null)
  const demo = useMemo(() => demoInvoice(), [])

  const load = useCallback(
    async (selectId?: number) => {
      setLoading(true)
      try {
        const list = await api.listTemplates()
        setTemplates(list)
        const pick = list.find((t) => t.id === selectId) ?? list.find((t) => t.is_default) ?? list[0]
        if (pick) {
          setActiveId(pick.id)
          setConfig(pick.config)
          setName(pick.name)
          setDirty(false)
        }
      } catch (err) {
        toast.error(err)
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    void load()
  }, [load])

  const selectTemplate = (t: InvoiceTemplate): void => {
    if (dirty && !window.confirm('Discard unsaved changes to this template?')) return
    setActiveId(t.id)
    setConfig(t.config)
    setName(t.name)
    setDirty(false)
  }

  /** Patch a nested section of the config. */
  const patch = useCallback(
    <K extends keyof TemplateConfig>(section: K, values: Partial<TemplateConfig[K]>): void => {
      setConfig((c) => (c ? { ...c, [section]: { ...c[section], ...values } } : c))
      setDirty(true)
    },
    []
  )

  const save = async (): Promise<void> => {
    if (!activeId || !config) return
    setSaving(true)
    try {
      const updated = await api.updateTemplate(activeId, { name: name.trim() || undefined, config })
      setTemplates((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
      setDirty(false)
      toast.success('Template saved.')
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !config) return <Spinner label="Loading templates…" />

  const active = templates.find((t) => t.id === activeId) ?? null

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Invoice Templates</h1>
          <div className="sub">
            {active?.name}
            {active?.is_default ? ' · default' : ''}
            {dirty ? ' · unsaved changes' : ''}
          </div>
        </div>
        <div className="topbar-actions">
          <button onClick={() => setCreating(true)}>＋ New</button>
          <button
            disabled={!activeId}
            onClick={async () => {
              if (!activeId) return
              try {
                const t = await api.duplicateTemplate(activeId)
                toast.success(`Created "${t.name}".`)
                await load(t.id)
              } catch (err) {
                toast.error(err)
              }
            }}
          >
            ⧉ Duplicate
          </button>
          <button
            disabled={!activeId || active?.is_default}
            onClick={async () => {
              if (!activeId) return
              try {
                await api.setDefaultTemplate(activeId)
                toast.success('Set as the default template.')
                await load(activeId)
              } catch (err) {
                toast.error(err)
              }
            }}
          >
            ★ Set default
          </button>
          <button className="btn-danger" disabled={!active} onClick={() => active && setDeleting(active)}>
            🗑
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <span className="spinner" /> : null} Save
          </button>
        </div>
      </div>

      <div className="designer-split">
        {/* ─────────── Controls ─────────── */}
        <div className="designer-pane">
          <div style={{ padding: '12px 15px', borderBottom: '1px solid var(--border)' }}>
            <div className="tpl-list">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className={`tpl-chip ${t.id === activeId ? 'active' : ''}`}
                  onClick={() => selectTemplate(t)}
                >
                  {t.is_default ? <span className="star">★</span> : null}
                  {t.name}
                </button>
              ))}
            </div>
            <div className="field mt8" style={{ marginBottom: 0 }}>
              <label>Template name</label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
              />
            </div>
          </div>

          {/* ── Page ── */}
          <Accordion title="Page & margins" icon="▭" defaultOpen>
            <div className="ctl">
              <label>Paper size</label>
              <select
                value={config.page.size}
                onChange={(e) => patch('page', { size: e.target.value as PageSize })}
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="Letter">Letter (8.5 × 11 in)</option>
                <option value="Legal">Legal (8.5 × 14 in)</option>
                <option value="A5">A5 (148 × 210 mm) — small receipts</option>
              </select>
            </div>
            <SegmentedControl
              label="Orientation"
              value={config.page.orientation}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' }
              ]}
              onChange={(v) => patch('page', { orientation: v })}
            />
            <NumberField label="Top margin" suffix="mm" value={config.page.marginTop} onChange={(v) => patch('page', { marginTop: v })} min={0} max={50} />
            <NumberField label="Bottom margin" suffix="mm" value={config.page.marginBottom} onChange={(v) => patch('page', { marginBottom: v })} min={0} max={50} />
            <NumberField label="Left margin" suffix="mm" value={config.page.marginLeft} onChange={(v) => patch('page', { marginLeft: v })} min={0} max={50} />
            <NumberField label="Right margin" suffix="mm" value={config.page.marginRight} onChange={(v) => patch('page', { marginRight: v })} min={0} max={50} />
            <ColorField label="Page background" value={config.page.background} onChange={(v) => patch('page', { background: v })} />
          </Accordion>

          {/* ── Typography ── */}
          <Accordion title="Fonts & text size" icon="A">
            <div className="ctl">
              <label>Font family</label>
              <select value={config.font.family} onChange={(e) => patch('font', { family: e.target.value })}>
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <div className="help">Only fonts installed on this computer will render in the PDF.</div>
            </div>
            <Slider label="Base text size" unit="pt" min={6} max={16} step={0.5} value={config.font.baseSize} onChange={(v) => patch('font', { baseSize: v })} />
            <Slider label="Company name size" unit="pt" min={8} max={40} step={0.5} value={config.font.titleSize} onChange={(v) => patch('font', { titleSize: v })} />
            <Slider label="Section heading size" unit="pt" min={7} max={22} step={0.5} value={config.font.headingSize} onChange={(v) => patch('font', { headingSize: v })} />
            <Slider label="Table header size" unit="pt" min={6} max={16} step={0.5} value={config.font.tableHeaderSize} onChange={(v) => patch('font', { tableHeaderSize: v })} />
            <Slider label="Table body size" unit="pt" min={6} max={16} step={0.5} value={config.font.tableBodySize} onChange={(v) => patch('font', { tableBodySize: v })} />
            <Slider label="Totals size" unit="pt" min={6} max={20} step={0.5} value={config.font.totalsSize} onChange={(v) => patch('font', { totalsSize: v })} />
            <Slider label="Footer size" unit="pt" min={5} max={14} step={0.5} value={config.font.footerSize} onChange={(v) => patch('font', { footerSize: v })} />
            <Slider label="Line height" min={1} max={2.2} step={0.05} value={config.font.lineHeight} onChange={(v) => patch('font', { lineHeight: v })} />
            <Slider label="Letter spacing" unit="px" min={-1} max={3} step={0.1} value={config.font.letterSpacing} onChange={(v) => patch('font', { letterSpacing: v })} />
            <ColorField label="Body text colour" value={config.font.color} onChange={(v) => patch('font', { color: v })} />
            <ColorField label="Secondary text colour" value={config.font.mutedColor} onChange={(v) => patch('font', { mutedColor: v })} />
          </Accordion>

          {/* ── Colours ── */}
          <Accordion title="Colours" icon="◐">
            <ColorField label="Accent colour" value={config.colors.accent} onChange={(v) => patch('colors', { accent: v })} />
            <ColorField label="Table header background" value={config.colors.tableHeaderBg} onChange={(v) => patch('colors', { tableHeaderBg: v })} />
            <ColorField label="Table header text" value={config.colors.tableHeaderText} onChange={(v) => patch('colors', { tableHeaderText: v })} />
            <ColorField label="Alternate row background" value={config.colors.rowAltBg} onChange={(v) => patch('colors', { rowAltBg: v })} />
            <ColorField label="Border colour" value={config.colors.border} onChange={(v) => patch('colors', { border: v })} />
            <ColorField label="Totals highlight" value={config.colors.totalsHighlight} onChange={(v) => patch('colors', { totalsHighlight: v })} />
          </Accordion>

          {/* ── Logo ── */}
          <Accordion title="Logo" icon="▣">
            <Toggle label="Show logo" checked={config.logo.enabled} onChange={(v) => patch('logo', { enabled: v })} />
            {config.logo.enabled ? (
              <>
                <div className="ctl">
                  <label>Logo image</label>
                  <div className="flex gap8">
                    <button
                      className="btn-sm"
                      onClick={async () => {
                        try {
                          const r = await api.pickImage()
                          if (r) {
                            patch('logo', { dataUrl: r.dataUrl })
                            toast.success(`Logo set from ${r.name}.`)
                          }
                        } catch (err) {
                          toast.error(err)
                        }
                      }}
                    >
                      Choose image…
                    </button>
                    {config.logo.dataUrl ? (
                      <button className="btn-sm btn-ghost" onClick={() => patch('logo', { dataUrl: '' })}>
                        Use company logo
                      </button>
                    ) : null}
                  </div>
                  <div className="help">
                    {config.logo.dataUrl
                      ? 'Using a logo specific to this template.'
                      : 'Using the logo from Settings → Company. Choose an image to override it here.'}
                  </div>
                  {config.logo.dataUrl ? (
                    <img
                      src={config.logo.dataUrl}
                      alt=""
                      style={{ maxWidth: '100%', maxHeight: 60, marginTop: 8, background: '#fff', padding: 4, borderRadius: 4 }}
                    />
                  ) : null}
                </div>
                <Slider label="Logo width" unit="px" min={40} max={400} value={config.logo.width} onChange={(v) => patch('logo', { width: v })} />
                <Slider label="Logo height (0 = auto)" unit="px" min={0} max={240} value={config.logo.height} onChange={(v) => patch('logo', { height: v })} />
                <Slider label="Logo opacity" min={0.1} max={1} step={0.05} value={config.logo.opacity} onChange={(v) => patch('logo', { opacity: v })} />
                <Slider label="Space below logo" unit="px" min={0} max={40} value={config.logo.marginBottom} onChange={(v) => patch('logo', { marginBottom: v })} />
                <SegmentedControl label="Logo alignment" value={config.logo.align} options={ALIGN_OPTS} onChange={(v) => patch('logo', { align: v })} />
                <div className="ctl">
                  <label>Logo position</label>
                  <select
                    value={config.logo.position}
                    onChange={(e) => patch('logo', { position: e.target.value as typeof config.logo.position })}
                  >
                    <option value="header-left">Header, left side</option>
                    <option value="header-center">Header, centre of left block</option>
                    <option value="header-right">Header, right side (above the title)</option>
                    <option value="above-title">Full width, above everything</option>
                  </select>
                </div>
              </>
            ) : null}
          </Accordion>

          {/* ── Header ── */}
          <Accordion title="Header" icon="▀">
            <Toggle label="Show header band" checked={config.header.enabled} onChange={(v) => patch('header', { enabled: v })} />
            {config.header.enabled ? (
              <>
                <Toggle label="Repeat header on every page" checked={config.header.showOnAllPages} onChange={(v) => patch('header', { showOnAllPages: v })} help="Multi-page invoices only." />
                <TextField label="Header title" value={config.header.title} onChange={(v) => patch('header', { title: v })} help="Placeholders: {{company_name}}, {{company_legal_name}}" />
                <TextField label="Header subtitle" value={config.header.subtitle} onChange={(v) => patch('header', { subtitle: v })} help="Placeholders: {{company_address}}, {{company_city}}" />
                <Toggle label="Show company name block" checked={config.header.showCompanyBlock} onChange={(v) => patch('header', { showCompanyBlock: v })} />
                <Toggle label="Show phone / email / website" checked={config.header.showContactBlock} onChange={(v) => patch('header', { showContactBlock: v })} />
                <SegmentedControl label="Header alignment" value={config.header.align} options={ALIGN_OPTS} onChange={(v) => patch('header', { align: v })} />
                <ColorField label="Header background" value={config.header.background} onChange={(v) => patch('header', { background: v })} />
                <ColorField label="Header text colour" value={config.header.textColor} onChange={(v) => patch('header', { textColor: v })} />
                <Slider label="Header padding" unit="px" min={0} max={40} value={config.header.paddingY} onChange={(v) => patch('header', { paddingY: v })} />
                <Toggle label="Line under header" checked={config.header.borderBottom} onChange={(v) => patch('header', { borderBottom: v })} />
                {config.header.borderBottom ? (
                  <Slider label="Line thickness" unit="px" min={1} max={8} value={config.header.borderBottomWidth} onChange={(v) => patch('header', { borderBottomWidth: v })} />
                ) : null}
              </>
            ) : null}
          </Accordion>

          {/* ── Document title ── */}
          <Accordion title="Document title" icon="T">
            <Toggle label='Show the big "INVOICE" title' checked={config.docTitle.enabled} onChange={(v) => patch('docTitle', { enabled: v })} />
            {config.docTitle.enabled ? (
              <>
                <TextField label="Title text" value={config.docTitle.text} onChange={(v) => patch('docTitle', { text: v })} help="e.g. INVOICE, TAX INVOICE, QUOTATION, DELIVERY NOTE" />
                <Slider label="Title size" unit="pt" min={10} max={48} step={0.5} value={config.docTitle.size} onChange={(v) => patch('docTitle', { size: v })} />
                <SegmentedControl label="Title alignment" value={config.docTitle.align} options={ALIGN_OPTS} onChange={(v) => patch('docTitle', { align: v })} />
                <ColorField label="Title colour" value={config.docTitle.color} onChange={(v) => patch('docTitle', { color: v })} />
                <Slider label="Title letter spacing" unit="px" min={0} max={10} step={0.5} value={config.docTitle.letterSpacing} onChange={(v) => patch('docTitle', { letterSpacing: v })} />
                <Toggle label="Force UPPERCASE" checked={config.docTitle.uppercase} onChange={(v) => patch('docTitle', { uppercase: v })} />
              </>
            ) : null}
          </Accordion>

          {/* ── Bill to ── */}
          <Accordion title="Customer & invoice details" icon="☺">
            <Toggle label='Show "Bill To" block' checked={config.parties.showBillTo} onChange={(v) => patch('parties', { showBillTo: v })} />
            {config.parties.showBillTo ? (
              <TextField label="Bill To label" value={config.parties.billToLabel} onChange={(v) => patch('parties', { billToLabel: v })} />
            ) : null}
            <Toggle label='Show "Ship To" block' checked={config.parties.showShipTo} onChange={(v) => patch('parties', { showShipTo: v })} />
            {config.parties.showShipTo ? (
              <TextField label="Ship To label" value={config.parties.shipToLabel} onChange={(v) => patch('parties', { shipToLabel: v })} />
            ) : null}
            <Toggle label="Show invoice number & dates" checked={config.parties.showMeta} onChange={(v) => patch('parties', { showMeta: v })} />
            <Toggle label="Show P.O. number" checked={config.parties.showPoNumber} onChange={(v) => patch('parties', { showPoNumber: v })} />
            <Toggle label="Show customer NTN / STRN" checked={config.parties.showCustomerTaxIds} onChange={(v) => patch('parties', { showCustomerTaxIds: v })} help="Turn on for tax invoices to registered businesses." />
          </Accordion>

          {/* ── Table ── */}
          <Accordion title="Items table" icon="▦">
            <div className="ctl">
              <label>Columns — tick to show, drag order with the arrows</label>
              <ColumnEditor
                columns={config.table.columns}
                onChange={(columns) => patch('table', { columns })}
              />
              <div className="help">
                Widths are percentages of the table. They are normalised automatically, so they do
                not have to add up to exactly 100.
              </div>
            </div>
            <Toggle label="Shade alternate rows" checked={config.table.zebra} onChange={(v) => patch('table', { zebra: v })} />
            <div className="ctl">
              <label>Grid lines</label>
              <select
                value={config.table.borders}
                onChange={(e) => patch('table', { borders: e.target.value as 'all' | 'horizontal' | 'none' })}
              >
                <option value="all">Full grid</option>
                <option value="horizontal">Horizontal lines only</option>
                <option value="none">No lines</option>
              </select>
            </div>
            {config.table.borders !== 'none' ? (
              <Slider label="Line thickness" unit="px" min={0.5} max={4} step={0.5} value={config.table.borderWidth} onChange={(v) => patch('table', { borderWidth: v })} />
            ) : null}
            <Slider label="Row height (vertical padding)" unit="px" min={1} max={20} value={config.table.cellPaddingY} onChange={(v) => patch('table', { cellPaddingY: v })} />
            <Slider label="Cell side padding" unit="px" min={1} max={20} value={config.table.cellPaddingX} onChange={(v) => patch('table', { cellPaddingX: v })} />
            <Toggle label="UPPERCASE column headings" checked={config.table.headerUppercase} onChange={(v) => patch('table', { headerUppercase: v })} />
            <Toggle label="Bold column headings" checked={config.table.headerBold} onChange={(v) => patch('table', { headerBold: v })} />
            <Slider label="Pad short invoices to N rows" min={0} max={25} value={config.table.minRows} onChange={(v) => patch('table', { minRows: v })} />
          </Accordion>

          {/* ── Totals ── */}
          <Accordion title="Totals" icon="Σ">
            <SegmentedControl
              label="Totals position"
              value={config.totals.align}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' }
              ]}
              onChange={(v) => patch('totals', { align: v })}
            />
            <Slider label="Totals block width" unit="%" min={25} max={100} value={config.totals.width} onChange={(v) => patch('totals', { width: v })} />
            <Toggle label="Show subtotal" checked={config.totals.showSubtotal} onChange={(v) => patch('totals', { showSubtotal: v })} />
            <Toggle label="Show discount" checked={config.totals.showDiscount} onChange={(v) => patch('totals', { showDiscount: v })} />
            <Toggle label="Show sales tax" checked={config.totals.showTax} onChange={(v) => patch('totals', { showTax: v })} />
            <Toggle label="Show delivery / courier" checked={config.totals.showShipping} onChange={(v) => patch('totals', { showShipping: v })} />
            <Toggle label="Show round off" checked={config.totals.showRoundOff} onChange={(v) => patch('totals', { showRoundOff: v })} />
            <Toggle label="Show amount paid" checked={config.totals.showPaid} onChange={(v) => patch('totals', { showPaid: v })} />
            <Toggle label="Show balance due" checked={config.totals.showBalance} onChange={(v) => patch('totals', { showBalance: v })} />
            <Toggle label="Show amount in words" checked={config.totals.showAmountInWords} onChange={(v) => patch('totals', { showAmountInWords: v })} help="Uses crore / lakh / thousand." />
            <Toggle label="Bold the grand total" checked={config.totals.boldGrandTotal} onChange={(v) => patch('totals', { boldGrandTotal: v })} />
            <Toggle
              label="Show payment status band"
              checked={config.totals.showPaymentSummary !== false}
              onChange={(v) => patch('totals', { showPaymentSummary: v })}
              help="Prints PAID IN FULL / PARTIALLY PAID / UNPAID with the method and date."
            />
            {config.totals.showPaymentSummary !== false ? (
              <>
                <ColorField
                  label="Paid in full colour"
                  value={config.totals.paidColor ?? '#15803d'}
                  onChange={(v) => patch('totals', { paidColor: v })}
                />
                <ColorField
                  label="Partially paid colour"
                  value={config.totals.partialColor ?? '#b45309'}
                  onChange={(v) => patch('totals', { partialColor: v })}
                />
                <ColorField
                  label="Unpaid colour"
                  value={config.totals.unpaidColor ?? '#b91c1c'}
                  onChange={(v) => patch('totals', { unpaidColor: v })}
                />
                <Slider
                  label="Band background tint"
                  value={config.totals.paymentTint ?? 8}
                  min={0}
                  max={40}
                  unit="%"
                  onChange={(v) => patch('totals', { paymentTint: v })}
                />
              </>
            ) : null}
            <Slider
              label="Space below the totals"
              value={config.totals.spaceAfter ?? 14}
              min={0}
              max={80}
              unit="px"
              onChange={(v) => patch('totals', { spaceAfter: v })}
            />
            <ColorField label="Grand total background" value={config.totals.grandTotalBg} onChange={(v) => patch('totals', { grandTotalBg: v })} />
          </Accordion>

          {/* ── Blocks ── */}
          <Accordion title="Notes, terms & signature" icon="✎">
            <Toggle label="Show notes" checked={config.blocks.showNotes} onChange={(v) => patch('blocks', { showNotes: v })} />
            {config.blocks.showNotes ? <TextField label="Notes heading" value={config.blocks.notesLabel} onChange={(v) => patch('blocks', { notesLabel: v })} /> : null}
            <Toggle label="Show terms & conditions" checked={config.blocks.showTerms} onChange={(v) => patch('blocks', { showTerms: v })} />
            {config.blocks.showTerms ? <TextField label="Terms heading" value={config.blocks.termsLabel} onChange={(v) => patch('blocks', { termsLabel: v })} /> : null}
            <Toggle label="Show payment / bank details" checked={config.blocks.showBankDetails} onChange={(v) => patch('blocks', { showBankDetails: v })} help="Text comes from Settings → Company." />
            {config.blocks.showBankDetails ? <TextField label="Payment heading" value={config.blocks.bankLabel} onChange={(v) => patch('blocks', { bankLabel: v })} /> : null}
            <Toggle label="Show signature area" checked={config.blocks.showSignature} onChange={(v) => patch('blocks', { showSignature: v })} />
            {config.blocks.showSignature ? (
              <>
                <TextField label="Signature label" value={config.blocks.signatureLabel} onChange={(v) => patch('blocks', { signatureLabel: v })} />
                <Slider label="Signature width" unit="px" min={80} max={300} value={config.blocks.signatureWidth} onChange={(v) => patch('blocks', { signatureWidth: v })} />
              </>
            ) : null}
            <Toggle label="Show thank-you line" checked={config.blocks.showThankYou} onChange={(v) => patch('blocks', { showThankYou: v })} />
            {config.blocks.showThankYou ? <TextField label="Thank-you text" value={config.blocks.thankYouText} onChange={(v) => patch('blocks', { thankYouText: v })} /> : null}
          </Accordion>

          {/* ── Footer ── */}
          <Accordion title="Footer" icon="▄">
            <Toggle label="Show footer" checked={config.footer.enabled} onChange={(v) => patch('footer', { enabled: v })} />
            {config.footer.enabled ? (
              <>
                <Toggle
                  label="Pin the footer to the bottom of the page"
                  checked={config.footer.stickToBottom !== false}
                  onChange={(v) => patch('footer', { stickToBottom: v })}
                  help="On by default. The footer sits at the foot of the page rather than directly under the content. On a multi-page invoice that means the bottom of every page."
                />
                {config.footer.stickToBottom === false ? (
                  <Toggle label="Repeat footer on every page" checked={config.footer.showOnAllPages} onChange={(v) => patch('footer', { showOnAllPages: v })} />
                ) : null}
                <TextField
                  label="Footer text"
                  value={config.footer.text}
                  onChange={(v) => patch('footer', { text: v })}
                  help="Placeholders: {{company_name}} {{company_phone}} {{company_email}} {{company_website}} {{company_ntn}} {{year}}"
                />
                <SegmentedControl label="Footer alignment" value={config.footer.align} options={ALIGN_OPTS} onChange={(v) => patch('footer', { align: v })} />
                <ColorField label="Footer background" value={config.footer.background} onChange={(v) => patch('footer', { background: v })} />
                <ColorField label="Footer text colour" value={config.footer.textColor} onChange={(v) => patch('footer', { textColor: v })} />
                <Slider label="Footer padding" unit="px" min={0} max={30} value={config.footer.paddingY} onChange={(v) => patch('footer', { paddingY: v })} />
                <Toggle label="Line above footer" checked={config.footer.borderTop} onChange={(v) => patch('footer', { borderTop: v })} />
                <Toggle label="Show page numbers" checked={config.footer.showPageNumbers} onChange={(v) => patch('footer', { showPageNumbers: v })} />
                {config.footer.showPageNumbers ? (
                  <TextField
                    label="Page number format"
                    value={config.footer.pageNumberFormat}
                    onChange={(v) => patch('footer', { pageNumberFormat: v })}
                    help="Use {{page}} and {{pages}}. In the PDF these are placed in the bottom margin by the printer."
                  />
                ) : null}
              </>
            ) : null}
          </Accordion>

          {/* ── Stamp ── */}
          <Accordion title="Stamp" icon="◉">
            <Toggle
              label="Stamp the invoice"
              checked={config.stamp?.enabled === true}
              onChange={(v) => patch('stamp', { enabled: v })}
              help="A rubber stamp pressed onto the page - PAID, CANCELLED and so on - rather than a full-page watermark."
            />
            {config.stamp?.enabled ? (
              <>
                <div className="ctl">
                  <label>Which stamp</label>
                  <select
                    value={config.stamp.design}
                    onChange={(e) => patch('stamp', { design: e.target.value as never })}
                  >
                    <option value="auto">Automatic - follows the invoice status</option>
                    <option value="paid">PAID</option>
                    <option value="partial">PART PAID</option>
                    <option value="unpaid">UNPAID</option>
                    <option value="cancelled">CANCELLED</option>
                    <option value="draft">DRAFT</option>
                    <option value="original">ORIGINAL</option>
                    <option value="duplicate">DUPLICATE</option>
                    <option value="received">RECEIVED</option>
                    <option value="custom">My own image</option>
                  </select>
                  <div className="help">
                    {config.stamp.design === 'auto'
                      ? 'Paid invoices get PAID, part-paid get PART PAID, unpaid get UNPAID, and cancelled get CANCELLED.'
                      : config.stamp.design === 'custom'
                        ? 'Upload a scan of your own stamp below. A PNG with a transparent background looks best.'
                        : 'This stamp is used on every invoice with this template, whatever its status.'}
                  </div>
                </div>

                {config.stamp.design === 'custom' ? (
                  <div className="ctl">
                    <label>Stamp image</label>
                    <div className="flex gap8 items-center">
                      {config.stamp.imageDataUrl ? (
                        <img
                          src={config.stamp.imageDataUrl}
                          alt=""
                          style={{ height: 46, background: '#fff', borderRadius: 4, padding: 2 }}
                        />
                      ) : null}
                      <button
                        className="btn-sm"
                        onClick={async () => {
                          try {
                            const r = await api.pickImage()
                            if (r) patch('stamp', { imageDataUrl: r.dataUrl })
                          } catch (err) {
                            toast.error(err)
                          }
                        }}
                      >
                        Choose image…
                      </button>
                      {config.stamp.imageDataUrl ? (
                        <button className="btn-sm" onClick={() => patch('stamp', { imageDataUrl: '' })}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <>
                    <ColorField
                      label="Ink colour"
                      value={config.stamp.color}
                      onChange={(v) => patch('stamp', { color: v })}
                    />
                    <div className="help" style={{ marginTop: -6 }}>
                      Leave it black to use the colour that suits each design - green for PAID,
                      amber for PART PAID, red for UNPAID.
                    </div>
                  </>
                )}

                <div className="ctl">
                  <label>Position</label>
                  <select
                    value={config.stamp.position}
                    onChange={(e) => patch('stamp', { position: e.target.value as never })}
                  >
                    <option value="top-left">Top left</option>
                    <option value="top-right">Top right</option>
                    <option value="middle-left">Middle left</option>
                    <option value="middle-right">Middle right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-right">Bottom right</option>
                    <option value="center">Centre</option>
                  </select>
                </div>

                <Slider label="Size" value={config.stamp.width} min={60} max={400} unit="px" onChange={(v) => patch('stamp', { width: v })} />
                <Slider label="Rotation" value={config.stamp.rotation} min={-45} max={45} unit="deg" onChange={(v) => patch('stamp', { rotation: v })} />
                <Slider label="Opacity" value={Math.round(config.stamp.opacity * 100)} min={10} max={100} unit="%" onChange={(v) => patch('stamp', { opacity: v / 100 })} />
                <Slider label="Nudge across" value={config.stamp.offsetX} min={-120} max={120} unit="px" onChange={(v) => patch('stamp', { offsetX: v })} />
                <Slider label="Nudge down" value={config.stamp.offsetY} min={-120} max={120} unit="px" onChange={(v) => patch('stamp', { offsetY: v })} />
                <Toggle
                  label="Hide the stamp on drafts"
                  checked={config.stamp.hideOnDraft !== false}
                  onChange={(v) => patch('stamp', { hideOnDraft: v })}
                  help="Only applies to the automatic stamp."
                />
              </>
            ) : null}
          </Accordion>

          {/* ── Watermark ── */}
          <Accordion title="Watermark" icon="◍">
            <Toggle label="Enable watermark" checked={config.watermark.enabled} onChange={(v) => patch('watermark', { enabled: v })} />
            {config.watermark.enabled ? (
              <>
                <SegmentedControl
                  label="Watermark type"
                  value={config.watermark.type}
                  options={[
                    { value: 'text', label: 'Text' },
                    { value: 'image', label: 'Image' }
                  ]}
                  onChange={(v) => patch('watermark', { type: v })}
                />
                {config.watermark.type === 'text' ? (
                  <>
                    <TextField label="Watermark text" value={config.watermark.text} onChange={(v) => patch('watermark', { text: v })} />
                    <Toggle
                      label="Use the invoice status instead"
                      checked={config.watermark.useStatusText}
                      onChange={(v) => patch('watermark', { useStatusText: v })}
                      help="Stamps DRAFT, PAID or CANCELLED automatically on those invoices."
                    />
                    <Slider label="Text size" unit="px" min={20} max={200} value={config.watermark.fontSize} onChange={(v) => patch('watermark', { fontSize: v })} />
                    <ColorField label="Text colour" value={config.watermark.color} onChange={(v) => patch('watermark', { color: v })} />
                  </>
                ) : (
                  <>
                    <div className="ctl">
                      <label>Watermark image</label>
                      <div className="flex gap8">
                        <button
                          className="btn-sm"
                          onClick={async () => {
                            try {
                              const r = await api.pickImage()
                              if (r) patch('watermark', { imageDataUrl: r.dataUrl })
                            } catch (err) {
                              toast.error(err)
                            }
                          }}
                        >
                          Choose image…
                        </button>
                        {config.watermark.imageDataUrl ? (
                          <button className="btn-sm btn-ghost" onClick={() => patch('watermark', { imageDataUrl: '' })}>
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <Slider label="Image width" unit="px" min={80} max={900} value={config.watermark.width} onChange={(v) => patch('watermark', { width: v })} />
                  </>
                )}
                <Slider label="Opacity" min={0.01} max={0.6} step={0.01} value={config.watermark.opacity} onChange={(v) => patch('watermark', { opacity: v })} />
                <Slider label="Rotation" unit="°" min={-90} max={90} value={config.watermark.rotation} onChange={(v) => patch('watermark', { rotation: v })} />
                <div className="ctl">
                  <label>Position</label>
                  <select
                    value={config.watermark.position}
                    onChange={(e) => patch('watermark', { position: e.target.value as typeof config.watermark.position })}
                  >
                    <option value="center">Centre of the page</option>
                    <option value="top">Upper area</option>
                    <option value="bottom">Lower area</option>
                    <option value="diagonal">Centre, diagonal</option>
                  </select>
                </div>
                <Toggle label="Tile across the whole page" checked={config.watermark.repeat} onChange={(v) => patch('watermark', { repeat: v })} />
              </>
            ) : null}
          </Accordion>

          {/* ── Reset ── */}
          <Accordion title="Reset & presets" icon="⟲">
            <div className="ctl">
              <label>Replace this template&apos;s design with a built-in preset</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const p = TEMPLATE_PRESETS.find((x) => x.name === e.target.value)
                  if (p) {
                    setConfig(JSON.parse(JSON.stringify(p.config)) as TemplateConfig)
                    setDirty(true)
                    toast.warn(`Loaded "${p.name}" settings — press Save to keep them.`)
                  }
                  e.target.value = ''
                }}
              >
                <option value="">Choose a preset…</option>
                {TEMPLATE_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="help">This only changes the design; the template name is kept.</div>
            </div>
            <button
              className="btn-sm mt8"
              onClick={async () => {
                try {
                  const n = await api.restorePresets()
                  toast.success(n > 0 ? `Added ${n} missing preset template(s).` : 'All presets are already present.')
                  await load(activeId ?? undefined)
                } catch (err) {
                  toast.error(err)
                }
              }}
            >
              Restore missing preset templates
            </button>
          </Accordion>
        </div>

        {/* ─────────── Preview ─────────── */}
        <div className="preview-pane" style={{ borderLeft: 'none' }}>
          <div className="preview-head">
            <span className="small dim">Live preview — sample invoice</span>
            <span className="xsmall muted">
              {config.page.size} {config.page.orientation}
            </span>
            {dirty ? <span className="xsmall" style={{ color: 'var(--warn)' }}>unsaved</span> : null}
          </div>
          <InvoicePreview invoice={demo} config={config} debounceMs={220} />
        </div>
      </div>

      {creating ? (
        <NewTemplateDialog
          onClose={() => setCreating(false)}
          onCreated={async (t) => {
            setCreating(false)
            await load(t.id)
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete template"
          message={
            <>
              Delete the template <strong>{deleting.name}</strong>?
              <div className="small muted mt8">
                Invoices that used it will fall back to the default template. At least one template
                must remain.
              </div>
            </>
          }
          onConfirm={async () => {
            const id = deleting.id
            setDeleting(null)
            try {
              await api.deleteTemplate(id)
              toast.success('Template deleted.')
              await load()
            } catch (err) {
              toast.error(err)
            }
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  )
}

// ─────────────────────── Column editor ───────────────────────

function ColumnEditor({
  columns,
  onChange
}: {
  columns: TemplateColumn[]
  onChange: (c: TemplateColumn[]) => void
}): React.JSX.Element {
  const update = (i: number, patch: Partial<TemplateColumn>): void =>
    onChange(columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  const move = (i: number, dir: -1 | 1): void => {
    const to = i + dir
    if (to < 0 || to >= columns.length) return
    const n = [...columns]
    ;[n[i], n[to]] = [n[to], n[i]]
    onChange(n)
  }

  return (
    <div className="col-list">
      {columns.map((c, i) => (
        <div key={c.key} className={`col-row ${c.enabled ? '' : 'off'}`}>
          <input
            type="checkbox"
            checked={c.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            title="Show this column"
          />
          <div className="cr-label">
            <input value={c.label} onChange={(e) => update(i, { label: e.target.value })} title="Column heading" />
          </div>
          <div className="cr-w">
            <input
              type="number"
              min={2}
              max={80}
              value={c.width}
              onChange={(e) => update(i, { width: parseFloat(e.target.value) || 0 })}
              title="Width %"
            />
          </div>
          <div className="cr-a">
            <select value={c.align} onChange={(e) => update(i, { align: e.target.value as Align })} title="Alignment">
              <option value="left">L</option>
              <option value="center">C</option>
              <option value="right">R</option>
            </select>
          </div>
          <div className="cr-move">
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
              ▲
            </button>
            <button onClick={() => move(i, 1)} disabled={i === columns.length - 1} title="Move down">
              ▼
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────── New template ───────────────────────

function NewTemplateDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (t: InvoiceTemplate) => void
}): React.JSX.Element {
  const toast = useToast()
  const [name, setName] = useState('')
  const [preset, setPreset] = useState(TEMPLATE_PRESETS[0].name)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Give the template a name.')
      return
    }
    setBusy(true)
    try {
      const p = TEMPLATE_PRESETS.find((x) => x.name === preset) ?? TEMPLATE_PRESETS[0]
      const t = await api.createTemplate(name.trim(), p.config)
      toast.success(`Template "${t.name}" created.`)
      onCreated(t)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New invoice template"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void create()} disabled={busy}>
            Create
          </button>
        </>
      }
    >
      <div className="field">
        <label>Template name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Wholesale Tax Invoice"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && !busy && void create()}
        />
      </div>
      <div className="field">
        <label>Start from</label>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {TEMPLATE_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="help">You can change every detail afterwards.</div>
      </div>
    </Modal>
  )
}
