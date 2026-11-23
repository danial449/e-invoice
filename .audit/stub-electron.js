// Minimal stand-in for the parts of Electron the services touch, so the real
// service code can be exercised from plain Node.
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const userData = path.join(os.tmpdir(), 'pbx-audit-userdata')
fs.mkdirSync(userData, { recursive: true })

const app = {
  getPath: (name) => (name === 'userData' ? userData : os.tmpdir()),
  getVersion: () => '1.0.0',
  isPackaged: false,
  whenReady: async () => {},
  on: () => {},
  quit: () => {}
}

class BrowserWindow {
  static getAllWindows() {
    return []
  }
  constructor() {
    this.webContents = { send: () => {}, on: () => {}, printToPDF: async () => Buffer.alloc(0) }
  }
  isDestroyed() {
    return true
  }
  loadURL() {}
  destroy() {}
}

module.exports = {
  app,
  BrowserWindow,
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined })
  },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
  ipcMain: { handle: () => {} },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) }
}
