import React, { useState } from 'react'
import { api } from '../lib/api'
import type { CsvPreview } from '../lib/api'
import { Spinner, useToast } from '../components/ui'
import type { CsvField, CsvMapping, ImportResult } from '@shared/types'
import type { NavProps } from '../App'

const FIELD_LABELS: { value: CsvField; label: string }[] = [
  { value: 'ignore', label: '— Do not import —' },
  { value: 'sku', label: 'SKU / product code' },
  { value: 'name', label: 'Product name *' },
  { value: 'description', label: 'Description' },
  { value: 'category', label: 'Category (A > B for nesting)' },
  { value: 'size_text', label: 'Size / dimensions' },
  { value: 'material', label: 'Material' },
  { value: 'color', label: 'Colour' },
  { value: 'unit', label: 'Unit name (pcs, kg…)' },
  { value: 'pack_size', label: 'Pieces per pack' },
  { value: 'unit_price', label: 'Price per piece' },
  { value: 'pack_price', label: 'Price per pack' },
  { value: 'cost_price', label: 'Cost price' },
  { value: 'tax_rate', label: 'Tax rate %' },
  { value: 'stock_qty', label: 'Stock quantity' },
  { value: 'reorder_level', label: 'Reorder level' }
]

export default function ImportCsv({ navigate }: NavProps): React.JSX.Element {
  const toast = useToast()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<CsvMapping>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const [matchBy, setMatchBy] = useState<'sku' | 'name'>('sku')
  const [onDuplicate, setOnDuplicate] = useState<'update' | 'skip'>('update')
  const [createCategories, setCreateCategories] = useState(true)
  const [derivePrices, setDerivePrices] = useState(true)
  const [defaultPackSize, setDefaultPackSize] = useState(1)
  const [unknownStock, setUnknownStock] =
    useState<'unlimited' | 'unlimited-if-zero' | 'zero'>('unlimited')
  const [variableParents, setVariableParents] = useState<'skip' | 'import'>('skip')
  const [nameVariationsFromAttributes, setNameVariationsFromAttributes] = useState(true)

  const pickFile = async (): Promise<void> => {
    try {
      const p = await api.pickCsv()
      if (!p) return
      setBusy(true)
      const pv = await api.previewCsv(p)
      setFilePath(p)
      setPreview(pv)
      setMapping(pv.suggestedMapping as CsvMapping)
      setResult(null)
      setStep(2)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const runImport = async (): Promise<void> => {
    if (!filePath) return
    setBusy(true)
    try {
      const r = await api.importCsv(filePath, {
        mapping,
        matchBy,
        onDuplicate,
        createCategories,
        derivePrices,
        defaultPackSize,
        unknownStock,
        variableParents,
        nameVariationsFromAttributes
      })
      setResult(r)
      setStep(4)
      const extra = r.unlimitedStock ? `, ${r.unlimitedStock} with unlimited stock` : ''
      toast.success(
        `Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped${extra}.`
      )
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const mappedFields = new Set(Object.values(mapping).filter((f) => f !== 'ignore'))
  const canImport = mappedFields.has('name') || mappedFields.has('sku')
  const hasUnitPrice = mappedFields.has('unit_price')
  const hasPackPrice = mappedFields.has('pack_price')
  const hasPackSize = mappedFields.has('pack_size')

  // A WooCommerce export is recognisable by its Type / Parent columns or its
  // numbered attribute pairs.
  const isWooCommerce =
    mappedFields.has('wc_type') ||
    mappedFields.has('wc_parent') ||
    (preview?.headers ?? []).some((h) => /^attribute\s*\d+\s*name$/i.test(h.trim()))

  const steps = [
    { n: 1, label: 'Choose file' },
    { n: 2, label: 'Map columns' },
    { n: 3, label: 'Options' },
    { n: 4, label: 'Done' }
  ]

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Import products from CSV</h1>
          <div className="sub">Bulk-load your product list and prices</div>
        </div>
        <div className="topbar-actions">
          <button
            onClick={async () => {
              try {
                const r = await api.saveSampleCsv()
                if (r.saved) toast.success('Sample CSV saved.')
              } catch (err) {
                toast.error(err)
              }
            }}
          >
            ⇩ Download sample CSV
          </button>
          <button onClick={() => navigate({ name: 'products' })}>▦ Products</button>
        </div>
      </div>

      <div className="content">
        <div className="steps">
          {steps.map((s) => (
            <div key={s.n} className={`step ${step === s.n ? 'active' : step > s.n ? 'done' : ''}`}>
              <span className="step-n">{step > s.n ? '✓' : s.n}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Step 1 ── */}
        {step === 1 ? (
          <div className="card">
            <h3 className="card-title">Choose your CSV file</h3>
            <p className="small dim">
              The first row must be a header row. Column names are matched automatically — you can
              correct anything on the next screen. Prices can include symbols and separators
              (<span className="tnum">Rs. 3,500</span> reads as <span className="tnum">3500</span>).
            </p>
            <div className="flex gap8 mt16">
              <button className="btn-primary" onClick={() => void pickFile()} disabled={busy}>
                {busy ? <span className="spinner" /> : '📂'} Choose CSV file…
              </button>
            </div>
            <div className="help mt16">
              Not sure about the format? Download the sample CSV above — it is filled with real
              products from your catalogue and shows every column the importer understands.
            </div>
          </div>
        ) : null}

        {/* ── Step 2 ── */}
        {step === 2 && preview ? (
          <>
            <div className="card">
              <h3 className="card-title">
                Match your columns
                <span className="count">
                  {preview.totalRows} rows · {preview.headers.length} columns
                </span>
              </h3>
              {!canImport ? (
                <div className="banner warn">
                  Map at least <strong>Product name</strong> or <strong>SKU</strong> to continue.
                </div>
              ) : null}
              <table className="map-table">
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>CSV column</th>
                    <th style={{ width: '32%' }}>Import as</th>
                    <th>Sample values</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h) => {
                    const samples = preview.rows
                      .map((r) => String(r[h] ?? '').trim())
                      .filter(Boolean)
                      .slice(0, 3)
                    const current = mapping[h] ?? 'ignore'
                    return (
                      <tr key={h}>
                        <td className="strong">{h}</td>
                        <td>
                          <select
                            value={current}
                            onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as CsvField }))}
                          >
                            {FIELD_LABELS.map((f) => (
                              <option
                                key={f.value}
                                value={f.value}
                                disabled={
                                  f.value !== 'ignore' && f.value !== current && mappedFields.has(f.value)
                                }
                              >
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="sample-vals">{samples.join('  ·  ') || <em>empty</em>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3 className="card-title">File preview — first {preview.rows.length} rows</h3>
              <div className="scroll-x">
                <table className="pre-table">
                  <thead>
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        {preview.headers.map((h) => (
                          <td key={h}>{String(r[h] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap8">
              <button onClick={() => setStep(1)}>← Back</button>
              <button className="btn-primary ml-auto" disabled={!canImport} onClick={() => setStep(3)}>
                Continue →
              </button>
            </div>
          </>
        ) : null}

        {/* ── Step 3 ── */}
        {step === 3 && preview ? (
          <>
            <div className="card">
              <h3 className="card-title">Import options</h3>

              <div className="row">
                <div className="field">
                  <label>Match existing products by</label>
                  <select value={matchBy} onChange={(e) => setMatchBy(e.target.value as typeof matchBy)}>
                    <option value="sku">SKU / product code</option>
                    <option value="name">Product name</option>
                  </select>
                  <div className="help">
                    {matchBy === 'sku' && !mappedFields.has('sku')
                      ? 'No SKU column is mapped, so everything will be treated as new. Switch to name matching to update existing products.'
                      : 'Used to decide whether a row is an update or a new product.'}
                  </div>
                </div>
                <div className="field">
                  <label>When a product already exists</label>
                  <select
                    value={onDuplicate}
                    onChange={(e) => setOnDuplicate(e.target.value as typeof onDuplicate)}
                  >
                    <option value="update">Update it with the values in this file</option>
                    <option value="skip">Leave it unchanged</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={createCategories}
                    onChange={(e) => setCreateCategories(e.target.checked)}
                  />
                  <span>Create categories that do not exist yet</span>
                </label>
                <div className="help">
                  Supports nesting with <code>&gt;</code>, for example{' '}
                  <code>Bakery Packaging &gt; Cake Boxes</code>.
                </div>
              </div>

              <div className="field">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={derivePrices}
                    onChange={(e) => setDerivePrices(e.target.checked)}
                  />
                  <span>Calculate the missing price from the pack size</span>
                </label>
                <div className="help">
                  {hasUnitPrice && hasPackPrice
                    ? 'Both price columns are mapped, so both are used as given.'
                    : hasPackPrice
                      ? 'Your file has pack prices — per-piece price will be calculated as pack price ÷ pack size.'
                      : hasUnitPrice
                        ? 'Your file has per-piece prices — pack price will be calculated as price × pack size.'
                        : 'No price column is mapped yet.'}
                </div>
              </div>

              {!hasPackSize ? (
                <div className="field" style={{ maxWidth: 260 }}>
                  <label>Default pieces per pack</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={defaultPackSize}
                    onChange={(e) => setDefaultPackSize(parseInt(e.target.value, 10) || 1)}
                  />
                  <div className="help">
                    No pack-size column is mapped. Every imported product gets this pack size. Use
                    1 if your prices are already per piece.
                  </div>
                </div>
              ) : null}

              <div className="field">
                <label>When the file gives no stock figure</label>
                <select
                  value={unknownStock}
                  onChange={(e) => setUnknownStock(e.target.value as typeof unknownStock)}
                  style={{ maxWidth: 340 }}
                >
                  <option value="unlimited">Mark the product unlimited (recommended)</option>
                  <option value="unlimited-if-zero">Mark unlimited when blank or zero</option>
                  <option value="zero">Set the stock to 0</option>
                </select>
                <div className="help">
                  WooCommerce leaves <em>Stock</em> blank when stock management is off, which means
                  always available rather than none left. An unlimited product is never deducted by
                  an invoice and never reported as low or out of stock.
                  {unknownStock === 'unlimited'
                    ? ' A row marked out of stock is still imported as 0.'
                    : unknownStock === 'unlimited-if-zero'
                      ? ' Zero and blank are both treated as "not counted", even on rows marked out of stock.'
                      : ' Nothing is marked unlimited; every product keeps a counted quantity.'}
                </div>
              </div>

              {isWooCommerce ? (
                <>
                  <div className="field">
                    <label>Variable products</label>
                    <select
                      value={variableParents}
                      onChange={(e) => setVariableParents(e.target.value as typeof variableParents)}
                      style={{ maxWidth: 340 }}
                    >
                      <option value="skip">Import the variations only (recommended)</option>
                      <option value="import">Import the parent product as well</option>
                    </select>
                    <div className="help">
                      In WooCommerce a variable product is a container — its variations hold the
                      real SKU, price and stock. A parent whose variations are not in this file is
                      always imported, so nothing is lost.
                    </div>
                  </div>

                  <div className="field">
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={nameVariationsFromAttributes}
                        onChange={(e) => setNameVariationsFromAttributes(e.target.checked)}
                      />
                      <span>Add attribute values to variation names</span>
                    </label>
                    <div className="help">
                      Turns three identically named variations into{' '}
                      <code>Cake Box - Red</code>, <code>Cake Box - Blue</code> and{' '}
                      <code>Cake Box - Gold</code> so you can tell them apart when invoicing.
                    </div>
                  </div>
                </>
              ) : null}

              <div className="banner info mt16">
                Ready to import <strong>{preview.totalRows}</strong> rows from{' '}
                <code>{filePath?.split(/[\\/]/).pop()}</code>.
              </div>
            </div>

            <div className="flex gap8">
              <button onClick={() => setStep(2)} disabled={busy}>
                ← Back
              </button>
              <button className="btn-primary ml-auto" onClick={() => void runImport()} disabled={busy}>
                {busy ? <span className="spinner" /> : '⇪'} Import {preview.totalRows} rows
              </button>
            </div>
            {busy ? <Spinner label="Importing… this can take a moment for large files." /> : null}
          </>
        ) : null}

        {/* ── Step 4 ── */}
        {step === 4 && result ? (
          <>
            <div className="card">
              <h3 className="card-title">Import complete</h3>
              <div className="stat-grid">
                <div className="stat accent">
                  <div className="stat-label">New products</div>
                  <div className="stat-value">{result.inserted}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Updated</div>
                  <div className="stat-value">{result.updated}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Skipped</div>
                  <div className="stat-value">{result.skipped}</div>
                </div>
                <div className={result.errors.length ? 'stat danger' : 'stat'}>
                  <div className="stat-label">Errors</div>
                  <div className="stat-value">{result.errors.length}</div>
                </div>
              </div>

              {result.unlimitedStock ? (
                <p className="small dim mb0 mt8">
                  <strong>{result.unlimitedStock}</strong>{' '}
                  {result.unlimitedStock === 1 ? 'product was' : 'products were'} brought in with{' '}
                  <strong>unlimited stock</strong>, because the file gave no quantity for them.
                  Invoices will not deduct stock for these. You can change any of them on the
                  product itself.
                </p>
              ) : null}

              {result.woocommerce?.detected ? (
                <div className="banner info mt16">
                  Recognised as a <strong>WooCommerce export</strong>: {result.woocommerce.simple}{' '}
                  simple, {result.woocommerce.variations} variations,{' '}
                  {result.woocommerce.variableParents} variable parents
                  {result.woocommerce.parentsSkipped > 0 ? (
                    <>
                      {' '}
                      (of which {result.woocommerce.parentsSkipped} skipped because their variations
                      were imported instead)
                    </>
                  ) : null}
                  {result.woocommerce.other > 0 ? `, ${result.woocommerce.other} grouped/external` : ''}.
                </div>
              ) : null}

              {result.errors.length > 0 ? (
                <>
                  <div className="banner warn">
                    {result.errors.length} rows could not be imported. Everything else was saved.
                  </div>
                  <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th style={{ width: 80 }}>Row</th>
                          <th>Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.map((e, i) => (
                          <tr key={i}>
                            <td className="num">{e.row}</td>
                            <td className="small">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex gap8">
              <button
                onClick={() => {
                  setStep(1)
                  setPreview(null)
                  setFilePath(null)
                  setResult(null)
                }}
              >
                Import another file
              </button>
              <button className="btn-primary ml-auto" onClick={() => navigate({ name: 'products' })}>
                View products →
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
