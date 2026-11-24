import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { BackupFile, BackupSettings, BackupToolStatus, DbStatus } from '../lib/api'
import { ConfirmDialog, NumberField, Spinner, Toggle, useToast } from '../components/ui'
import { formatInvoiceNoPreview } from '../lib/format'
import type { CompanySettings, DbConfig } from '@shared/types'
import type { NavProps } from '../App'

interface Props extends NavProps {
  onDbChange: () => void
}

type Tab = 'company' | 'invoice' | 'database' | 'about'

export default function SettingsPage({ onDbChange }: Props): React.JSX.Element {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('company')
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const loadSettings = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setSettings(await api.getSettings())
      setLoadError('')
      setDirty(false)
    } catch (err) {
      // Usually "not connected". Never trap the user on a spinner — the
      // Database tab is the only place they can fix that, so send them there.
      setSettings(null)
      setLoadError(err instanceof Error ? err.message : String(err))
      setTab('database')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]): void => {
    setSettings((s) => (s ? { ...s, [k]: v } : s))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    try {
      setSettings(await api.updateSettings(settings))
      setDirty(false)
      toast.success('Settings saved.')
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="Loading settings…" />

  const TABS: { id: Tab; label: string }[] = [
    { id: 'company', label: 'Company' },
    { id: 'invoice', label: 'Invoice defaults' },
    { id: 'database', label: 'Database' },
    { id: 'about', label: 'About' }
  ]

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Settings</h1>
          <div className="sub">{dirty ? 'Unsaved changes' : 'All changes saved'}</div>
        </div>
        <div className="topbar-actions">
          {tab === 'company' || tab === 'invoice' ? (
            <button className="btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <span className="spinner" /> : null} Save
            </button>
          ) : null}
        </div>
      </div>

      <div className="content">
        <div className="tpl-list" style={{ marginBottom: 18 }}>
          {TABS.map((t) => (
            <button key={t.id} className={`tpl-chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {loadError && !settings ? (
          <div className="banner error" style={{ marginBottom: 14 }}>
            Company settings could not be loaded — {loadError}
            {tab === 'company' || tab === 'invoice' ? (
              <>
                {' '}
                Fix the connection under <strong>Database</strong>, then come back to this tab.
              </>
            ) : null}
          </div>
        ) : null}

        {/* ─────────── Company ─────────── */}
        {tab === 'company' && settings ? (
          <>
            <div className="card">
              <h3 className="card-title">Business details</h3>
              <div className="row">
                <div className="field" style={{ flex: 2 }}>
                  <label>Trading name (shown on invoices)</label>
                  <input value={settings.name} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div className="field" style={{ flex: 2 }}>
                  <label>Legal / registered name</label>
                  <input
                    value={settings.legal_name}
                    onChange={(e) => set('legal_name', e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="field">
                <label>Address</label>
                <textarea value={settings.address} onChange={(e) => set('address', e.target.value)} />
              </div>

              <div className="row">
                <div className="field">
                  <label>City</label>
                  <input value={settings.city} onChange={(e) => set('city', e.target.value)} />
                </div>
                <div className="field">
                  <label>Country</label>
                  <input value={settings.country} onChange={(e) => set('country', e.target.value)} />
                </div>
                <div className="field">
                  <label>Website</label>
                  <input value={settings.website} onChange={(e) => set('website', e.target.value)} />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>Phone</label>
                  <input value={settings.phone} onChange={(e) => set('phone', e.target.value)} />
                </div>
                <div className="field">
                  <label>WhatsApp / alternate phone</label>
                  <input value={settings.phone_alt} onChange={(e) => set('phone_alt', e.target.value)} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input value={settings.email} onChange={(e) => set('email', e.target.value)} />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>NTN</label>
                  <input value={settings.ntn} onChange={(e) => set('ntn', e.target.value)} placeholder="1234567-8" />
                </div>
                <div className="field">
                  <label>STRN</label>
                  <input value={settings.strn} onChange={(e) => set('strn', e.target.value)} />
                </div>
              </div>
              <div className="help">
                NTN and STRN appear in the invoice header when the header contact block is enabled.
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Logo &amp; signature</h3>
              <div className="row">
                <div className="field">
                  <label>Company logo</label>
                  <div className="flex gap8">
                    <button
                      className="btn-sm"
                      onClick={async () => {
                        try {
                          const r = await api.pickImage()
                          if (r) {
                            set('logo_data_url', r.dataUrl)
                            toast.success(`Logo set from ${r.name}.`)
                          }
                        } catch (err) {
                          toast.error(err)
                        }
                      }}
                    >
                      Choose image…
                    </button>
                    {settings.logo_data_url ? (
                      <button className="btn-sm btn-danger" onClick={() => set('logo_data_url', '')}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {settings.logo_data_url ? (
                    <img
                      src={settings.logo_data_url}
                      alt=""
                      style={{ maxWidth: 220, maxHeight: 90, marginTop: 10, background: '#fff', padding: 6, borderRadius: 4 }}
                    />
                  ) : (
                    <div className="help mt8">
                      No logo set. PNG with a transparent background works best.
                    </div>
                  )}
                </div>

                <div className="field">
                  <label>Signature image</label>
                  <div className="flex gap8">
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
                      Choose image…
                    </button>
                    {settings.signature_data_url ? (
                      <button className="btn-sm btn-danger" onClick={() => set('signature_data_url', '')}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {settings.signature_data_url ? (
                    <img
                      src={settings.signature_data_url}
                      alt=""
                      style={{ maxWidth: 220, maxHeight: 70, marginTop: 10, background: '#fff', padding: 6, borderRadius: 4 }}
                    />
                  ) : (
                    <div className="help mt8">Optional. Appears above the signature line.</div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {/* ─────────── Invoice defaults ─────────── */}
        {tab === 'invoice' && settings ? (
          <>
            <div className="card">
              <h3 className="card-title">Numbering</h3>
              <div className="row">
                <div className="field">
                  <label>Prefix</label>
                  <input
                    value={settings.invoice_prefix}
                    onChange={(e) => set('invoice_prefix', e.target.value)}
                    placeholder="INV-"
                  />
                </div>
                <div className="field">
                  <label>Next number</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.invoice_next_number}
                    onChange={(e) => set('invoice_next_number', parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <div className="field">
                  <label>Zero padding</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={settings.invoice_pad}
                    onChange={(e) => set('invoice_pad', parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>
              <div className="banner info">
                Next invoice will be numbered{' '}
                <strong>
                  {formatInvoiceNoPreview(
                    settings.invoice_prefix,
                    settings.invoice_next_number,
                    settings.invoice_pad
                  )}
                </strong>
                . Numbers already used are skipped automatically.
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Currency &amp; tax</h3>
              <div className="row">
                <div className="field">
                  <label>Currency symbol</label>
                  <input
                    value={settings.currency_symbol}
                    onChange={(e) => set('currency_symbol', e.target.value)}
                    placeholder="Rs."
                  />
                </div>
                <div className="field">
                  <label>Currency code</label>
                  <input value={settings.currency_code} onChange={(e) => set('currency_code', e.target.value)} />
                </div>
                <div className="field">
                  <label>Default tax rate (%)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={settings.default_tax_rate}
                    onChange={(e) => set('default_tax_rate', parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={settings.tax_enabled_default}
                  onChange={(e) => set('tax_enabled_default', e.target.checked)}
                />
                <span>Turn sales tax on by default for new invoices</span>
              </label>
              <div className="help">
                Your website does not display GST, so this is off by default. Turn it on if you issue
                tax invoices.
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Default text on new invoices</h3>
              <div className="field">
                <label>Payment / bank details</label>
                <textarea
                  value={settings.bank_details}
                  onChange={(e) => set('bank_details', e.target.value)}
                  placeholder="Bank name, account title, account number / IBAN"
                />
              </div>
              <div className="row">
                <div className="field">
                  <label>Default notes</label>
                  <textarea
                    value={settings.default_notes}
                    onChange={(e) => set('default_notes', e.target.value)}
                    style={{ minHeight: 120 }}
                  />
                  <div className="help">A short line at the bottom of every new invoice.</div>
                </div>
                <div className="field">
                  <label>Default terms &amp; conditions</label>
                  <textarea
                    value={settings.default_terms}
                    onChange={(e) => set('default_terms', e.target.value)}
                    style={{ minHeight: 120 }}
                  />
                  <div className="help">One per line. Printed as the summary on each invoice.</div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">
                Link to your full terms
                <span className="count">printed under the terms on every invoice</span>
              </h3>
              <div className="row">
                <div className="field" style={{ flex: 2 }}>
                  <label>Web address</label>
                  <input
                    value={settings.terms_url ?? ''}
                    onChange={(e) => set('terms_url', e.target.value)}
                    placeholder="https://packagingbox.pk/terms-and-conditions/"
                  />
                  <div className="help">Leave empty to print no link at all.</div>
                </div>
                <div className="field">
                  <label>Wording shown</label>
                  <input
                    value={settings.terms_link_text ?? ''}
                    onChange={(e) => set('terms_link_text', e.target.value)}
                    placeholder="Terms & Conditions"
                  />
                  <div className="help">Defaults to &ldquo;Terms &amp; Conditions&rdquo;.</div>
                </div>
              </div>

              {settings.terms_url?.trim() ? (
                <div className="preview-strip">
                  <span className="preview-strip-label">On the invoice</span>
                  <span className="preview-strip-body">
                    Full terms &amp; conditions:{' '}
                    <a
                      href={settings.terms_url}
                      onClick={(e) => {
                        e.preventDefault()
                        void api.openExternal(settings.terms_url).catch(() => {})
                      }}
                    >
                      {settings.terms_link_text?.trim() || 'Terms & Conditions'}
                    </a>
                  </span>
                </div>
              ) : (
                <div className="banner info mb0">
                  No link is printed while the address is empty. The terms above are still shown.
                </div>
              )}

              <p className="small muted mb0 mt8">
                The wording is printed as the link rather than the bare address, and stays clickable
                in the PDF. The terms above are the summary; this page is the authority.
              </p>
            </div>
          </>
        ) : null}

        {/* ─────────── Database ─────────── */}
        {tab === 'database' ? (
          <DatabaseTab onDbChange={onDbChange} onReconnected={() => void loadSettings()} />
        ) : null}

        {/* ─────────── About ─────────── */}
        {tab === 'about' ? <AboutTab /> : null}
      </div>
    </>
  )
}

// ─────────────────────── Database tab ───────────────────────

function DatabaseTab({
  onDbChange,
  onReconnected
}: {
  onDbChange: () => void
  onReconnected: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [status, setStatus] = useState<DbStatus | null>(null)
  const [cfg, setCfg] = useState<DbConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.dbStatus()
        setStatus(s)
        setCfg({ ...s.config, password: '' })
      } catch (err) {
        toast.error(err)
      }
    })()
  }, [toast])

  if (!status || !cfg) return <Spinner />

  const set = <K extends keyof DbConfig>(k: K, v: DbConfig[K]): void => setCfg((c) => (c ? { ...c, [k]: v } : c))

  return (
    <>
      <div className="card">
        <h3 className="card-title">Connection</h3>
        <div className={`banner ${status.connected ? 'ok' : 'error'}`}>
          {status.connected ? 'Connected' : 'Not connected'} — {status.config.user}@{status.config.host}:
          {status.config.port}/{status.config.database}
        </div>

        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Host</label>
            <input value={cfg.host} onChange={(e) => set('host', e.target.value)} />
          </div>
          <div className="field">
            <label>Port</label>
            <input
              type="number"
              value={cfg.port}
              onChange={(e) => set('port', parseInt(e.target.value, 10) || 5432)}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Database</label>
            <input value={cfg.database} onChange={(e) => set('database', e.target.value)} />
          </div>
          <div className="field">
            <label>User</label>
            <input value={cfg.user} onChange={(e) => set('user', e.target.value)} />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={cfg.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder="Re-enter to reconnect"
            />
          </div>
        </div>

        <div className="flex gap8 mt8">
          <button
            disabled={busy}
            onClick={async () => {
              if (!cfg.password) {
                toast.error('Enter the database password to test the connection.')
                return
              }
              setBusy(true)
              try {
                const r = await api.dbTest(cfg)
                toast.success(`${r.serverVersion} — database ${r.databaseExists ? 'exists' : 'will be created'}.`)
              } catch (err) {
                toast.error(err)
              } finally {
                setBusy(false)
              }
            }}
          >
            Test
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              if (!cfg.password) {
                toast.error('Enter the database password before reconnecting.')
                return
              }
              setBusy(true)
              try {
                await api.dbConnect(cfg, true)
                toast.success('Reconnected.')
                onDbChange()
                setStatus(await api.dbStatus())
                onReconnected()
              } catch (err) {
                toast.error(err)
              } finally {
                setBusy(false)
              }
            }}
          >
            Reconnect &amp; save
          </button>
          <button className="btn-danger ml-auto" onClick={() => setConfirmForget(true)}>
            Forget saved connection
          </button>
        </div>
      </div>

      <BackupPanel connected={status.connected} database={status.config.database} onDbChange={onDbChange} />

      {confirmForget ? (
        <ConfirmDialog
          title="Forget saved connection"
          message={
            <>
              This clears the stored connection details and disconnects. Your data is{' '}
              <strong>not</strong> deleted — you will just be asked for the credentials again next
              time.
            </>
          }
          confirmLabel="Forget"
          onConfirm={async () => {
            setConfirmForget(false)
            try {
              await api.dbForget()
              toast.success('Saved connection cleared.')
              onDbChange()
            } catch (err) {
              toast.error(err)
            }
          }}
          onCancel={() => setConfirmForget(false)}
        />
      ) : null}
    </>
  )
}

// ─────────────────────── Backup & restore ───────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function BackupPanel({
  connected,
  database,
  onDbChange
}: {
  connected: boolean
  database: string
  onDbChange: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [tools, setTools] = useState<BackupToolStatus | null>(null)
  const [files, setFiles] = useState<BackupFile[]>([])
  const [busy, setBusy] = useState<'' | 'backup' | 'restore'>('')
  const [progress, setProgress] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<{ file: string; name: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BackupFile | null>(null)

  const reloadFiles = useCallback(async (): Promise<void> => {
    try {
      setFiles(await api.listBackups())
    } catch {
      setFiles([])
    }
  }, [])

  const reloadTools = useCallback(async (): Promise<void> => {
    if (!connected) return
    try {
      setTools(await api.backupToolStatus())
    } catch (err) {
      setTools({
        ok: false,
        dir: '',
        toolVersion: 0,
        serverVersion: 0,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }, [connected])

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await api.backupSettings())
      } catch (err) {
        toast.error(err)
      }
      await reloadFiles()
      await reloadTools()
    })()
  }, [toast, reloadFiles, reloadTools])

  // Live progress lines from pg_dump / pg_restore.
  useEffect(() => window.api.onBackupProgress((p) => setProgress(p.message)), [])

  const patch = async (p: Partial<BackupSettings>): Promise<void> => {
    try {
      const next = await api.saveBackupSettings(p)
      setSettings(next)
      if (p.folder !== undefined) await reloadFiles()
      if (p.toolDir !== undefined) await reloadTools()
    } catch (err) {
      toast.error(err)
    }
  }

  const backupNow = async (): Promise<void> => {
    setBusy('backup')
    setProgress('')
    try {
      const r = await api.runBackup()
      toast.success(`Backed up to ${r.name} (${formatBytes(r.size)}).`)
      setSettings(await api.backupSettings())
      await reloadFiles()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy('')
      setProgress('')
    }
  }

  const doRestore = async (file: string): Promise<void> => {
    setRestoreTarget(null)
    setBusy('restore')
    setProgress('')
    try {
      const r = await api.restoreBackup(file)
      toast.success('Restored. Your previous data was saved alongside it as a pre-restore backup.')
      if (r.safetyCopy) console.log('[backup] safety copy:', r.safetyCopy)
      await reloadFiles()
      onDbChange()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy('')
      setProgress('')
    }
  }

  if (!settings) return <div className="card"><Spinner /></div>

  const running = busy !== ''

  return (
    <>
      <div className="card">
        <h3 className="card-title">Backup &amp; restore</h3>
        <p className="small dim">
          Everything — products, customers, invoices and templates — lives in the PostgreSQL
          database <strong>{database}</strong>. A backup is a single <code>.dump</code> file you can
          copy to a USB drive or cloud folder.
        </p>

        {tools && !tools.ok ? <div className="banner error">{tools.message}</div> : null}
        {tools?.ok ? <div className="banner ok">{tools.message}</div> : null}

        <div className="row">
          <div className="field" style={{ flex: 3 }}>
            <label>Backup folder</label>
            <input value={settings.folder} readOnly />
          </div>
          <div className="field" style={{ flex: 0, alignSelf: 'flex-end' }}>
            <button
              disabled={running}
              onClick={async () => {
                const folder = await api.pickBackupFolder()
                if (folder) await patch({ folder })
              }}
            >
              Change…
            </button>
          </div>
          <div className="field" style={{ flex: 0, alignSelf: 'flex-end' }}>
            <button disabled={running} onClick={() => void api.revealBackup().catch(toast.error)}>
              Open folder
            </button>
          </div>
        </div>

        <div className="flex gap8 mt8 items-center">
          <button className="btn-primary" disabled={running || !connected} onClick={() => void backupNow()}>
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
          <button
            disabled={running || !connected}
            onClick={async () => {
              const file = await api.pickBackupFile()
              if (file) setRestoreTarget({ file, name: file.split(/[\\/]/).pop() ?? file })
            }}
          >
            Restore from file…
          </button>
          <span className="small muted">
            {settings.lastRunAt ? `Last backup ${formatWhen(settings.lastRunAt)}` : 'No backup yet'}
          </span>
        </div>

        {running && progress ? (
          <p className="small dim mt8 mb0" style={{ wordBreak: 'break-word' }}>
            {progress}
          </p>
        ) : null}

        {!connected ? (
          <p className="small muted mt8 mb0">Connect to the database to back up or restore.</p>
        ) : null}
      </div>

      <div className="card">
        <h3 className="card-title">Automatic backups</h3>
        <Toggle
          label="Back up automatically while the app is open"
          checked={settings.autoEnabled}
          onChange={(v) => void patch({ autoEnabled: v })}
          help="Checked every 15 minutes; a backup runs once the interval below has passed."
        />
        <NumberField
          label="Run every"
          suffix="hours"
          min={1}
          max={720}
          value={settings.autoEveryHours}
          onChange={(v) => void patch({ autoEveryHours: v })}
        />
        <NumberField
          label="Keep the newest"
          suffix="automatic backups"
          min={0}
          max={365}
          value={settings.keepCount}
          onChange={(v) => void patch({ keepCount: v })}
        />
        <p className="small muted mb0">
          Only automatic backups are pruned. Ones you make yourself, and the safety copies taken
          before a restore, are always kept.
        </p>
      </div>

      <div className="card">
        <h3 className="card-title">Saved backups</h3>
        {files.length === 0 ? (
          <p className="small muted mb0">No backups in this folder yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Created</th>
                  <th className="right">Size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.file}>
                    <td style={{ wordBreak: 'break-all' }}>
                      {f.name} {f.auto ? <span className="badge">auto</span> : null}
                    </td>
                    <td className="nowrap">{formatWhen(f.createdAt)}</td>
                    <td className="right tnum">{formatBytes(f.size)}</td>
                    <td className="nowrap right">
                      <button
                        className="btn-xs"
                        disabled={running || !connected}
                        onClick={() => setRestoreTarget({ file: f.file, name: f.name })}
                      >
                        Restore
                      </button>{' '}
                      <button
                        className="btn-xs"
                        disabled={running}
                        onClick={() => void api.revealBackup(f.file).catch(toast.error)}
                      >
                        Show
                      </button>{' '}
                      <button className="btn-xs btn-danger" disabled={running} onClick={() => setDeleteTarget(f)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="mt8">
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            pg_dump location
          </summary>
          <div className="row mt8">
            <div className="field" style={{ flex: 3 }}>
              <label>PostgreSQL bin folder</label>
              <input
                value={settings.toolDir}
                onChange={(e) => setSettings({ ...settings, toolDir: e.target.value })}
                onBlur={() => void patch({ toolDir: settings.toolDir })}
                placeholder="Detected automatically — set only if backups fail"
              />
            </div>
            <div className="field" style={{ flex: 0, alignSelf: 'flex-end' }}>
              <button
                disabled={running}
                onClick={async () => {
                  const dir = await api.pickToolDir()
                  if (dir) await patch({ toolDir: dir })
                }}
              >
                Browse…
              </button>
            </div>
            <div className="field" style={{ flex: 0, alignSelf: 'flex-end' }}>
              <button disabled={running} onClick={() => void reloadTools()}>
                Re-check
              </button>
            </div>
          </div>
        </details>
      </div>

      {restoreTarget ? (
        <ConfirmDialog
          title="Restore this backup?"
          message={
            <>
              This replaces <strong>everything</strong> currently in <strong>{database}</strong> with
              the contents of <strong>{restoreTarget.name}</strong>. Invoices, products and customers
              created since that backup will be gone.
              <br />
              <br />
              A safety copy of your current data is taken first, so this can be undone by restoring
              the <code>pre-restore</code> file.
            </>
          }
          confirmLabel="Replace my data"
          onConfirm={() => void doRestore(restoreTarget.file)}
          onCancel={() => setRestoreTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete this backup file?"
          message={
            <>
              <strong>{deleteTarget.name}</strong> will be deleted from disk. Your live data is not
              affected.
            </>
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            const target = deleteTarget
            setDeleteTarget(null)
            try {
              await api.deleteBackup(target.file)
              await reloadFiles()
              toast.success('Backup deleted.')
            } catch (err) {
              toast.error(err)
            }
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
  )
}

// ─────────────────────── About tab ───────────────────────

function AboutTab(): React.JSX.Element {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.appInfo>> | null>(null)

  useEffect(() => {
    void api.appInfo().then(setInfo).catch(() => {})
  }, [])

  return (
    <div className="card">
      <h3 className="card-title">About</h3>
      <table className="data">
        <tbody>
          <tr>
            <td className="dim">Application</td>
            <td>PackagingBox Invoice {info?.version ?? ''}</td>
          </tr>
          <tr>
            <td className="dim">Electron</td>
            <td>{info?.electron ?? '—'}</td>
          </tr>
          <tr>
            <td className="dim">Chromium</td>
            <td>{info?.chrome ?? '—'}</td>
          </tr>
          <tr>
            <td className="dim">Node</td>
            <td>{info?.node ?? '—'}</td>
          </tr>
          <tr>
            <td className="dim">Settings folder</td>
            <td className="small" style={{ wordBreak: 'break-all' }}>
              {info?.userData ?? '—'}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="help mt16">
        Built for Packaging Box Pakistan. Product catalogue, categories and company details are
        pre-filled from packagingbox.pk.
      </div>
    </div>
  )
}
