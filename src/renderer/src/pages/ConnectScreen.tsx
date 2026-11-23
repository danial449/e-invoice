import React, { useState } from 'react'
import { api } from '../lib/api'
import type { DbStatus } from '../lib/api'
import { useToast } from '../components/ui'
import type { DbConfig } from '@shared/types'

export default function ConnectScreen({
  status,
  onConnected
}: {
  status: DbStatus | null
  onConnected: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [cfg, setCfg] = useState<DbConfig>(() => ({
    host: status?.config.host ?? 'localhost',
    port: status?.config.port ?? 5432,
    database: status?.config.database ?? 'packagingbox_invoice',
    user: status?.config.user ?? 'postgres',
    // A saved password comes back masked, so always ask for it again here.
    password: '',
    ssl: status?.config.ssl ?? false
  }))
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const set = <K extends keyof DbConfig>(k: K, v: DbConfig[K]): void => setCfg((c) => ({ ...c, [k]: v }))

  const doTest = async (): Promise<void> => {
    setBusy(true)
    setTestResult(null)
    try {
      const r = await api.dbTest(cfg)
      setTestResult(
        `${r.serverVersion} — database "${cfg.database}" ${
          r.databaseExists ? 'found' : 'does not exist yet and will be created'
        }.`
      )
    } catch (err) {
      toast.error(err)
      setTestResult(null)
    } finally {
      setBusy(false)
    }
  }

  const doConnect = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.dbConnect(cfg, remember)
      toast.success('Connected. Tables and starter data are ready.')
      onConnected()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connect-wrap">
      <div className="connect-card">
        <h1>Connect to PostgreSQL</h1>
        <p className="lede">
          This app stores everything in a local PostgreSQL database. Enter the credentials for your
          server — the database and all tables are created automatically on first connect.
        </p>

        {status?.hasSavedConfig ? (
          <div className="banner warn">
            A saved connection exists but could not be opened. Check that the PostgreSQL service is
            running, then re-enter the password below.
          </div>
        ) : null}

        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Host</label>
            <input value={cfg.host} onChange={(e) => set('host', e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Port</label>
            <input
              type="number"
              value={cfg.port}
              onChange={(e) => set('port', parseInt(e.target.value, 10) || 5432)}
            />
          </div>
        </div>

        <div className="field">
          <label>Database name</label>
          <input value={cfg.database} onChange={(e) => set('database', e.target.value)} />
          <div className="help">Created automatically if it does not exist.</div>
        </div>

        <div className="row">
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
              onKeyDown={(e) => e.key === 'Enter' && !busy && void doConnect()}
              placeholder="postgres password"
            />
          </div>
        </div>

        <div className="field">
          <label className="inline-check">
            <input type="checkbox" checked={cfg.ssl} onChange={(e) => set('ssl', e.target.checked)} />
            <span>Use SSL (not needed for a local server)</span>
          </label>
        </div>

        <div className="field">
          <label className="inline-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember these details on this computer</span>
          </label>
          <div className="help">
            Saved to your Windows user profile so the app reconnects automatically next time. The
            password is stored in plain text in that file — leave this off on a shared machine.
          </div>
        </div>

        {testResult ? <div className="banner ok">{testResult}</div> : null}

        <div className="flex gap8 mt16">
          <button onClick={doTest} disabled={busy}>
            {busy ? <span className="spinner" /> : null} Test connection
          </button>
          <button className="btn-primary ml-auto" onClick={doConnect} disabled={busy}>
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}
