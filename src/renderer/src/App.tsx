import React, { useCallback, useEffect, useState } from 'react'
import { api, DB_DISCONNECTED_EVENT } from './lib/api'
import type { DbStatus } from './lib/api'
import { Spinner, ToastProvider, useToast } from './components/ui'
import ConnectScreen from './pages/ConnectScreen'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import ImportCsv from './pages/ImportCsv'
import Customers from './pages/Customers'
import Invoices from './pages/Invoices'
import InvoiceEditor from './pages/InvoiceEditor'
import TemplateDesigner from './pages/TemplateDesigner'
import Reports from './pages/Reports'
import SettingsPage from './pages/Settings'
import StockMovements from './pages/StockMovements'

export type Route =
  | { name: 'dashboard' }
  | { name: 'products' }
  | { name: 'import' }
  | { name: 'customers' }
  | { name: 'invoices' }
  | { name: 'invoice-editor'; id?: number }
  | { name: 'templates' }
  | { name: 'reports' }
  | { name: 'movements' }
  | { name: 'settings'; tab?: 'company' | 'invoice' | 'database' | 'about' }

export interface NavProps {
  navigate: (r: Route) => void
  route: Route
}

const NAV_ITEMS: { label: string; icon: string; route: Route; group: string }[] = [
  { label: 'Dashboard', icon: '◳', route: { name: 'dashboard' }, group: 'Overview' },
  { label: 'Products', icon: '▦', route: { name: 'products' }, group: 'Inventory' },
  { label: 'Import CSV', icon: '⇪', route: { name: 'import' }, group: 'Inventory' },
  { label: 'Stock History', icon: '⇅', route: { name: 'movements' }, group: 'Inventory' },
  { label: 'New Invoice', icon: '＋', route: { name: 'invoice-editor' }, group: 'Billing' },
  { label: 'Invoices', icon: '≣', route: { name: 'invoices' }, group: 'Billing' },
  { label: 'Customers', icon: '☺', route: { name: 'customers' }, group: 'Billing' },
  { label: 'Invoice Templates', icon: '✎', route: { name: 'templates' }, group: 'Design' },
  { label: 'Reports', icon: '◴', route: { name: 'reports' }, group: 'Analysis' },
  { label: 'Settings', icon: '⚙', route: { name: 'settings' }, group: 'Analysis' }
]

function Shell(): React.JSX.Element {
  const toast = useToast()
  const [status, setStatus] = useState<DbStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [route, setRoute] = useState<Route>({ name: 'dashboard' })
  const [lowStock, setLowStock] = useState(0)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.dbStatus())
    } catch (err) {
      toast.error(err)
    } finally {
      setChecking(false)
    }
  }, [toast])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // If the backend loses its pool, stop pretending we are connected and show
  // the connect screen rather than a shell where every request fails.
  useEffect(() => {
    const onLost = (): void => void refreshStatus()
    window.addEventListener(DB_DISCONNECTED_EVENT, onLost)
    return () => window.removeEventListener(DB_DISCONNECTED_EVENT, onLost)
  }, [refreshStatus])

  // Menu-driven navigation from the main process.
  useEffect(() => {
    return window.api.onNavigate((r) => {
      if (r === '/invoices/new') setRoute({ name: 'invoice-editor' })
      else if (r === '/products') setRoute({ name: 'products' })
      else if (r === '/import') setRoute({ name: 'import' })
      else if (r === '/settings') setRoute({ name: 'settings' })
    })
  }, [])

  const connected = status?.connected === true

  // Keep the low-stock badge current.
  const refreshBadge = useCallback(async () => {
    if (!connected) return
    try {
      const d = await api.dashboard()
      setLowStock(d.lowStockCount + d.outOfStockCount)
    } catch {
      /* badge is cosmetic */
    }
  }, [connected])

  useEffect(() => {
    void refreshBadge()
  }, [refreshBadge, route])

  const navigate = useCallback((r: Route) => setRoute(r), [])

  if (checking) return <Spinner label="Starting up…" />

  if (!connected) {
    return <ConnectScreen status={status} onConnected={refreshStatus} />
  }

  const groups = Array.from(new Set(NAV_ITEMS.map((i) => i.group)))

  const isActive = (r: Route): boolean => {
    if (r.name === 'invoice-editor') return route.name === 'invoice-editor' && route.id === undefined
    return route.name === r.name
  }

  let page: React.JSX.Element
  switch (route.name) {
    case 'dashboard':
      page = <Dashboard navigate={navigate} route={route} />
      break
    case 'products':
      page = <Products navigate={navigate} route={route} />
      break
    case 'import':
      page = <ImportCsv navigate={navigate} route={route} />
      break
    case 'customers':
      page = <Customers navigate={navigate} route={route} />
      break
    case 'invoices':
      page = <Invoices navigate={navigate} route={route} />
      break
    case 'invoice-editor':
      page = <InvoiceEditor key={route.id ?? 'new'} invoiceId={route.id} navigate={navigate} route={route} />
      break
    case 'templates':
      page = <TemplateDesigner navigate={navigate} route={route} />
      break
    case 'reports':
      page = <Reports navigate={navigate} route={route} />
      break
    case 'movements':
      page = <StockMovements navigate={navigate} route={route} />
      break
    case 'settings':
      page = <SettingsPage navigate={navigate} route={route} onDbChange={refreshStatus} />
      break
    default:
      page = <Dashboard navigate={navigate} route={route} />
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">E-Invoice</div>
          <div className="brand-sub">Inventory &amp; Invoicing</div>
        </div>

        <nav className="nav">
          {groups.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-label">{g}</div>
              {NAV_ITEMS.filter((i) => i.group === g).map((item) => (
                <button
                  key={item.label}
                  className={`nav-item ${isActive(item.route) ? 'active' : ''}`}
                  onClick={() => navigate(item.route)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.route.name === 'products' && lowStock > 0 ? (
                    <span className="nav-badge" title="Products at or below reorder level">
                      {lowStock}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className={`db-dot ${connected ? 'on' : 'off'}`} />
          {status?.config.database ?? 'postgres'}
          <div className="xsmall" style={{ marginTop: 2 }}>
            {status?.config.host}:{status?.config.port}
          </div>
        </div>
      </aside>

      <div className="main">{page}</div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
