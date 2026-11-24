import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ConfirmDialog, Empty, Modal, Spinner, useToast } from '../components/ui'
import SignaturePad from '../components/SignaturePad'
import { formatInvoiceNoPreview } from '../lib/format'
import type { Brand, BrandInput } from '@shared/types'

const EMPTY: BrandInput = {
  name: '',
  legal_name: '',
  address: '',
  city: '',
  country: 'Pakistan',
  phone: '',
  phone_alt: '',
  email: '',
  website: '',
  ntn: '',
  strn: '',
  logo_data_url: '',
  signature_data_url: '',
  bank_details: '',
  default_terms: '',
  default_notes: '',
  terms_url: '',
  terms_link_text: '',
  invoice_prefix: 'INV-',
  invoice_next_number: 1,
  invoice_pad: 4,
  is_default: false,
  is_active: true,
  sort_order: 0
}

/**
 * The businesses you invoice as. Each carries its own letterhead, bank
 * details, terms link and invoice number sequence, so several brands can share
 * one product catalogue and one customer list.
 */
export default function Brands(): React.JSX.Element {
  const toast = useToast()
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [editing, setEditing] = useState<{ brand: Brand | null } | null>(null)
  const [deleting, setDeleting] = useState<Brand | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setBrands(await api.listBrands(false))
    } catch (err) {
      toast.error(err)
      setBrands([])
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  if (brands === null) return <Spinner label="Loading brands…" />
  const list = brands

  return (
    <>
      <div className="card">
        <h3 className="card-title">
          Brands <span className="count">{list.length}</span>
          <button className="btn-sm btn-primary ml-auto" onClick={() => setEditing({ brand: null })}>
            ＋ Add brand
          </button>
        </h3>

        <p className="small dim">
          Each brand is a business you invoice as — its own name, address, logo, signature, bank
          details, terms link and <strong>its own invoice number sequence</strong>. Products,
          customers and templates are shared across all of them.
        </p>

        {list.length === 0 ? (
          <Empty icon="◫" title="No brands yet" hint="Add one to start invoicing under it." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Contact</th>
                  <th>Numbering</th>
                  <th>Next</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} className={b.is_active ? '' : 'off'}>
                    <td className="clickable" onClick={() => setEditing({ brand: b })}>
                      <div className="strong">
                        {b.name}
                        {b.is_default ? <span className="badge ok" style={{ marginLeft: 6 }}>default</span> : null}
                        {!b.is_active ? <span className="badge cancelled" style={{ marginLeft: 6 }}>inactive</span> : null}
                      </div>
                      {b.legal_name || b.city ? (
                        <div className="xsmall muted">{[b.legal_name, b.city].filter(Boolean).join(' · ')}</div>
                      ) : null}
                    </td>
                    <td className="small dim">
                      {b.phone ? <div>{b.phone}</div> : null}
                      {b.email ? <div className="xsmall muted">{b.email}</div> : null}
                      {!b.phone && !b.email ? '—' : null}
                    </td>
                    <td className="small">
                      <code>{b.invoice_prefix || '(none)'}</code>
                      <span className="muted xsmall"> pad {b.invoice_pad}</span>
                    </td>
                    <td className="small nowrap tnum">
                      {formatInvoiceNoPreview(b.invoice_prefix, b.invoice_next_number, b.invoice_pad)}
                    </td>
                    <td className="actions nowrap">
                      {!b.is_default && b.is_active ? (
                        <button
                          className="btn-ghost btn-xs"
                          title="Make this the default brand for new invoices"
                          onClick={async () => {
                            try {
                              await api.setDefaultBrand(b.id)
                              await load()
                            } catch (err) {
                              toast.error(err)
                            }
                          }}
                        >
                          ★
                        </button>
                      ) : null}
                      <button
                        className="btn-ghost btn-xs"
                        title="Duplicate"
                        onClick={async () => {
                          try {
                            await api.duplicateBrand(b.id)
                            await load()
                            toast.success('Brand duplicated. Its numbering starts at 1.')
                          } catch (err) {
                            toast.error(err)
                          }
                        }}
                      >
                        ⧉
                      </button>
                      <button className="btn-ghost btn-xs" title="Edit" onClick={() => setEditing({ brand: b })}>
                        ✎
                      </button>
                      <button className="btn-ghost btn-xs" title="Remove" onClick={() => setDeleting(b)}>
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <BrandEditor
          brand={editing.brand}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Remove brand"
          message={
            <>
              Remove <strong>{deleting.name}</strong>?
              <div className="small muted mt8">
                If it has already issued invoices it is made inactive instead of deleted, so those
                invoices keep their letterhead. You cannot remove your only active brand.
              </div>
            </>
          }
          confirmLabel="Remove"
          onConfirm={async () => {
            const b = deleting
            setDeleting(null)
            try {
              const r = await api.deleteBrand(b.id)
              toast.success(r.deleted ? 'Brand deleted.' : 'Brand made inactive; its invoices are untouched.')
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

function BrandEditor({
  brand,
  onClose,
  onSaved
}: {
  brand: Brand | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<BrandInput>(() =>
    brand
      ? {
          name: brand.name,
          legal_name: brand.legal_name,
          address: brand.address,
          city: brand.city,
          country: brand.country,
          phone: brand.phone,
          phone_alt: brand.phone_alt,
          email: brand.email,
          website: brand.website,
          ntn: brand.ntn,
          strn: brand.strn,
          logo_data_url: brand.logo_data_url,
          signature_data_url: brand.signature_data_url,
          bank_details: brand.bank_details,
          default_terms: brand.default_terms,
          default_notes: brand.default_notes,
          terms_url: brand.terms_url,
          terms_link_text: brand.terms_link_text,
          invoice_prefix: brand.invoice_prefix,
          invoice_next_number: brand.invoice_next_number,
          invoice_pad: brand.invoice_pad,
          is_default: brand.is_default,
          is_active: brand.is_active,
          sort_order: brand.sort_order
        }
      : { ...EMPTY }
  )
  const [busy, setBusy] = useState(false)
  const [drawing, setDrawing] = useState(false)

  const set = <K extends keyof BrandInput>(k: K, v: BrandInput[K]): void =>
    setForm((f) => ({ ...f, [k]: v }))

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('Give the brand a name.')
      return
    }
    setBusy(true)
    try {
      if (brand) await api.updateBrand(brand.id, form)
      else await api.createBrand(form)
      toast.success(brand ? 'Brand saved.' : 'Brand added.')
      onSaved()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        title={brand ? `Edit ${brand.name}` : 'Add a brand'}
        onClose={onClose}
        size="wide"
        footer={
          <>
            <button onClick={onClose}>Cancel</button>
            <button className="btn-primary ml-auto" onClick={() => void save()} disabled={busy}>
              {busy ? <span className="spinner" /> : null} {brand ? 'Save brand' : 'Add brand'}
            </button>
          </>
        }
      >
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Trading name (shown on invoices)</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Packaging Box Pakistan" />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Legal / registered name</label>
            <input value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Address</label>
          <textarea value={form.address} onChange={(e) => set('address', e.target.value)} />
        </div>

        <div className="row">
          <div className="field">
            <label>City</label>
            <input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="field">
            <label>Country</label>
            <input value={form.country} onChange={(e) => set('country', e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="field">
            <label>WhatsApp / alternate</label>
            <input value={form.phone_alt} onChange={(e) => set('phone_alt', e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Email</label>
            <input value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="field">
            <label>Website</label>
            <input value={form.website} onChange={(e) => set('website', e.target.value)} />
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

        <div className="row">
          <div className="field">
            <label>Logo</label>
            <div className="flex gap8 wrap">
              <button
                className="btn-sm"
                onClick={async () => {
                  try {
                    const r = await api.pickImage()
                    if (r) set('logo_data_url', r.dataUrl)
                  } catch (err) {
                    toast.error(err)
                  }
                }}
              >
                Choose image…
              </button>
              {form.logo_data_url ? (
                <button className="btn-sm btn-danger" onClick={() => set('logo_data_url', '')}>
                  Remove
                </button>
              ) : null}
            </div>
            {form.logo_data_url ? (
              <img
                src={form.logo_data_url}
                alt=""
                style={{ maxWidth: 190, maxHeight: 70, marginTop: 10, background: '#fff', padding: 6, borderRadius: 4 }}
              />
            ) : (
              <div className="help mt8">Appears in the invoice header for this brand.</div>
            )}
          </div>

          <div className="field">
            <label>Signature</label>
            <div className="flex gap8 wrap">
              <button className="btn-sm btn-primary" onClick={() => setDrawing(true)}>
                ✎ Draw
              </button>
              <button
                className="btn-sm"
                onClick={async () => {
                  try {
                    const r = await api.pickImage()
                    if (r) set('signature_data_url', r.dataUrl)
                  } catch (err) {
                    toast.error(err)
                  }
                }}
              >
                Upload…
              </button>
              {form.signature_data_url ? (
                <button className="btn-sm btn-danger" onClick={() => set('signature_data_url', '')}>
                  Remove
                </button>
              ) : null}
            </div>
            {form.signature_data_url ? (
              <img
                src={form.signature_data_url}
                alt=""
                style={{ maxWidth: 190, maxHeight: 60, marginTop: 10, background: '#fff', padding: 6, borderRadius: 4 }}
              />
            ) : (
              <div className="help mt8">Printed above the signature line.</div>
            )}
          </div>
        </div>

        <div className="field">
          <label>Payment / bank details</label>
          <textarea
            value={form.bank_details}
            onChange={(e) => set('bank_details', e.target.value)}
            placeholder="Bank name, account title, account number / IBAN"
          />
        </div>

        <div className="row">
          <div className="field">
            <label>Default notes</label>
            <textarea value={form.default_notes} onChange={(e) => set('default_notes', e.target.value)} />
          </div>
          <div className="field">
            <label>Default terms &amp; conditions</label>
            <textarea
              value={form.default_terms}
              onChange={(e) => set('default_terms', e.target.value)}
              style={{ minHeight: 96 }}
            />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Terms &amp; conditions web address</label>
            <input
              value={form.terms_url}
              onChange={(e) => set('terms_url', e.target.value)}
              placeholder="https://yourbrand.pk/terms-and-conditions/"
            />
          </div>
          <div className="field">
            <label>Wording of the link</label>
            <input
              value={form.terms_link_text}
              onChange={(e) => set('terms_link_text', e.target.value)}
              placeholder="Terms & Conditions"
            />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <h3 className="card-title">
            Invoice numbering
            <span className="count">this brand counts on its own</span>
          </h3>
          <div className="row">
            <div className="field">
              <label>Prefix</label>
              <input
                value={form.invoice_prefix}
                onChange={(e) => set('invoice_prefix', e.target.value)}
                placeholder="INV-"
              />
            </div>
            <div className="field">
              <label>Next number</label>
              <input
                type="number"
                min={1}
                value={form.invoice_next_number}
                onChange={(e) => set('invoice_next_number', parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div className="field">
              <label>Zero padding</label>
              <input
                type="number"
                min={0}
                max={10}
                value={form.invoice_pad}
                onChange={(e) => set('invoice_pad', parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>
          <div className="banner info mb0">
            Next invoice under this brand will be{' '}
            <strong>{formatInvoiceNoPreview(form.invoice_prefix, form.invoice_next_number, form.invoice_pad)}</strong>
            . Give each brand a different prefix so their numbers never collide.
          </div>
        </div>

        <label className="inline-check mt16">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => set('is_default', e.target.checked)}
          />
          <span>Use this brand for new invoices</span>
        </label>

        <label className="inline-check">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
          />
          <span>Active — offer this brand when creating an invoice</span>
        </label>
      </Modal>

      {drawing ? (
        <SignaturePad
          initial={form.signature_data_url}
          onCancel={() => setDrawing(false)}
          onSave={(dataUrl) => {
            set('signature_data_url', dataUrl)
            setDrawing(false)
          }}
        />
      ) : null}
    </>
  )
}
