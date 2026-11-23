import { app, BrowserWindow, shell, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerIpc } from './ipc'
import { connect, loadDbConfig, disconnect } from './db/pool'
import { destroyRenderWindow } from './services/pdf'
import { startAutoBackup, stopAutoBackup } from './services/backup'

let mainWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

/**
 * Window / taskbar icon. The same relative path works in development and from
 * inside app.asar, because `resources/` ships with the bundle.
 */
function appIcon(): string | undefined {
  const file = path.join(__dirname, '../../resources/icon.png')
  return fs.existsSync(file) ? file : undefined
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'PackagingBox Invoice',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (process.argv.includes('--maximize')) mainWindow?.maximize()
  })

  // Any target="_blank" / external link opens in the real browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-app navigation away from the bundled UI.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    const allowed = devServer ? url.startsWith(devServer) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Invoice',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('nav', '/invoices/new')
        },
        {
          label: 'Products',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('nav', '/products')
        },
        {
          label: 'Import CSV',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('nav', '/import')
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('nav', '/settings')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open packagingbox.pk',
          click: () => shell.openExternal('https://packagingbox.pk/')
        },
        {
          label: 'About',
          click: () => mainWindow?.webContents.send('nav', '/settings')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// One instance only, so two copies never fight over invoice numbers.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    registerIpc()
    buildMenu()

    // Reconnect silently using the saved configuration; the UI shows the
    // connection screen if this fails.
    const saved = loadDbConfig()
    if (saved) {
      try {
        await connect(saved)
        console.log(
          `[startup] connected to ${saved.user}@${saved.host}:${saved.port}/${saved.database}`
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[startup] database connection failed: ${message}`)
      }
    } else {
      console.log('[startup] no saved connection found; showing the connect screen')
    }

    createWindow()
    startAutoBackup()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopAutoBackup()
    destroyRenderWindow()
    void disconnect()
  })
}
