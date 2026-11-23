import { contextBridge, ipcRenderer } from 'electron'

/**
 * Every call goes through a fixed channel list; the renderer cannot invoke
 * arbitrary IPC names.
 */
const CHANNELS = [
  'db:status', 'db:test', 'db:connect', 'db:disconnect', 'db:forget',

  'products:list', 'products:get', 'products:search', 'products:create', 'products:update',
  'products:delete', 'products:bulkDelete', 'products:adjustStock', 'products:movements',

  'categories:list', 'categories:create', 'categories:update', 'categories:delete',

  'customers:list', 'customers:get', 'customers:create', 'customers:update',
  'customers:delete', 'customers:ledger',

  'invoices:list', 'invoices:get', 'invoices:save', 'invoices:setStatus', 'invoices:delete',
  'invoices:duplicate', 'invoices:nextNo', 'invoices:payments', 'invoices:addPayment',
  'invoices:deletePayment', 'invoices:html', 'invoices:previewHtml',

  'templates:list', 'templates:get', 'templates:default', 'templates:create', 'templates:update',
  'templates:duplicate', 'templates:setDefault', 'templates:delete', 'templates:restorePresets',

  'settings:get', 'settings:update',

  'reports:dashboard', 'reports:sales',

  'csv:pick', 'csv:preview', 'csv:import', 'csv:saveSample', 'csv:exportProducts',

  'pdf:save', 'pdf:exportMany', 'pdf:print',

  'image:pick',

  'backup:settings', 'backup:saveSettings', 'backup:toolStatus', 'backup:list', 'backup:run',
  'backup:restore', 'backup:delete', 'backup:reveal', 'backup:pickFolder', 'backup:pickToolDir',
  'backup:pickFile',

  'app:info', 'app:openExternal', 'app:reload'
] as const

export type Channel = (typeof CHANNELS)[number]

const api = {
  invoke: (channel: Channel, ...args: unknown[]): Promise<unknown> => {
    if (!CHANNELS.includes(channel)) {
      return Promise.resolve({ ok: false, error: `Unknown channel: ${channel}` })
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  /** Main-process menu navigation requests. */
  onNavigate: (cb: (route: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, route: string): void => cb(route)
    ipcRenderer.on('nav', listener)
    return () => ipcRenderer.removeListener('nav', listener)
  },

  /** Progress lines emitted while a backup or restore runs. */
  onBackupProgress: (
    cb: (p: { stage: 'start' | 'step' | 'done' | 'error'; message: string }) => void
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      p: { stage: 'start' | 'step' | 'done' | 'error'; message: string }
    ): void => cb(p)
    ipcRenderer.on('backup:progress', listener)
    return () => ipcRenderer.removeListener('backup:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api
