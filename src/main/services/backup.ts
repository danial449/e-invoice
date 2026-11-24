import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { connect, disconnect, getActiveConfig, query } from '../db/pool'
import type { DbConfig } from '../../shared/types'

// ─────────────────────── Settings ───────────────────────

export interface BackupSettings {
  /** Folder the .dump files are written to. */
  folder: string
  /** Run a backup automatically while the app is open. */
  autoEnabled: boolean
  /** Hours between automatic backups (minimum 1). */
  autoEveryHours: number
  /** How many automatic backups to keep; older ones are pruned. 0 = keep all. */
  keepCount: number
  /** Optional override for the PostgreSQL `bin` folder holding pg_dump. */
  toolDir: string
  /** ISO timestamp of the last successful backup, automatic or manual. */
  lastRunAt: string | null
}

function defaultFolder(): string {
  return path.join(app.getPath('documents'), 'E-Invoice Backups')
}

export function defaultBackupSettings(): BackupSettings {
  return {
    folder: defaultFolder(),
    autoEnabled: false,
    autoEveryHours: 24,
    keepCount: 10,
    toolDir: '',
    lastRunAt: null
  }
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'backup.json')
}

export function getBackupSettings(): BackupSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<BackupSettings>
    const base = defaultBackupSettings()
    return {
      folder: typeof raw.folder === 'string' && raw.folder.trim() ? raw.folder : base.folder,
      autoEnabled: !!raw.autoEnabled,
      autoEveryHours: Math.max(1, Math.floor(Number(raw.autoEveryHours) || base.autoEveryHours)),
      keepCount: Math.max(0, Math.floor(Number(raw.keepCount) ?? base.keepCount)),
      toolDir: typeof raw.toolDir === 'string' ? raw.toolDir : '',
      lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : null
    }
  } catch {
    return defaultBackupSettings()
  }
}

export function saveBackupSettings(patch: Partial<BackupSettings>): BackupSettings {
  const next: BackupSettings = { ...getBackupSettings(), ...patch }
  next.autoEveryHours = Math.max(1, Math.floor(Number(next.autoEveryHours) || 24))
  next.keepCount = Math.max(0, Math.floor(Number(next.keepCount) || 0))
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
  return next
}

// ─────────────────────── Locating pg_dump / pg_restore ───────────────────────

export interface ToolStatus {
  ok: boolean
  /** Folder the tools were found in. */
  dir: string
  /** Major version of pg_dump, e.g. 17. */
  toolVersion: number
  /** Major version of the connected server, e.g. 17. */
  serverVersion: number
  message: string
}

const EXE = process.platform === 'win32' ? '.exe' : ''

function candidateDirs(override: string): string[] {
  const dirs: string[] = []
  if (override.trim()) dirs.push(override.trim())

  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], 'C:\\Program Files']
    const seen = new Set<string>()
    for (const root of roots) {
      if (!root) continue
      const base = path.join(root, 'PostgreSQL')
      if (seen.has(base) || !fs.existsSync(base)) continue
      seen.add(base)
      let entries: string[] = []
      try {
        entries = fs.readdirSync(base)
      } catch {
        continue
      }
      // Newest major version first, so the tool is never older than the server.
      const versions = entries
        .map((e) => ({ e, n: parseInt(e, 10) }))
        .filter((v) => Number.isFinite(v.n) && v.n > 0)
        .sort((a, b) => b.n - a.n)
      for (const v of versions) dirs.push(path.join(base, v.e, 'bin'))
    }
  } else {
    dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin')
  }

  return dirs
}

/** Run `<tool> --version` and return its major version, or 0 if it will not run. */
function probeVersion(exePath: string): Promise<number> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (n: number): void => {
      if (!done) {
        done = true
        resolve(n)
      }
    }
    try {
      const child = spawn(exePath, ['--version'], { windowsHide: true })
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('error', () => finish(0))
      child.on('close', () => {
        // "pg_dump (PostgreSQL) 17.2"
        const m = /(\d+)\.(\d+)/.exec(out)
        finish(m ? parseInt(m[1], 10) : 0)
      })
      setTimeout(() => {
        child.kill()
        finish(0)
      }, 8000)
    } catch {
      finish(0)
    }
  })
}

let cachedTools: { dir: string; version: number } | null = null

/** Find a pg_dump/pg_restore pair, preferring the newest installed version. */
export async function findTools(force = false): Promise<{ dir: string; version: number } | null> {
  const override = getBackupSettings().toolDir
  if (!force && cachedTools && (!override || cachedTools.dir === override)) return cachedTools

  for (const dir of candidateDirs(override)) {
    const dump = path.join(dir, `pg_dump${EXE}`)
    const restore = path.join(dir, `pg_restore${EXE}`)
    if (!fs.existsSync(dump) || !fs.existsSync(restore)) continue
    const version = await probeVersion(dump)
    if (version > 0) {
      cachedTools = { dir, version }
      return cachedTools
    }
  }

  // Last resort: whatever is on PATH.
  const version = await probeVersion(`pg_dump${EXE}`)
  if (version > 0) {
    cachedTools = { dir: '', version }
    return cachedTools
  }

  cachedTools = null
  return null
}

async function serverMajorVersion(): Promise<number> {
  try {
    const rows = await query<{ n: string }>('SHOW server_version_num')
    return Math.floor(parseInt(rows[0]?.n ?? '0', 10) / 10_000)
  } catch {
    return 0
  }
}

export async function toolStatus(): Promise<ToolStatus> {
  const tools = await findTools(true)
  const serverVersion = await serverMajorVersion()

  if (!tools) {
    return {
      ok: false,
      dir: '',
      toolVersion: 0,
      serverVersion,
      message:
        'pg_dump was not found. It ships with PostgreSQL — set the path to your PostgreSQL "bin" folder below ' +
        '(for example C:\\Program Files\\PostgreSQL\\17\\bin).'
    }
  }

  if (serverVersion > 0 && tools.version < serverVersion) {
    return {
      ok: false,
      dir: tools.dir,
      toolVersion: tools.version,
      serverVersion,
      message:
        `pg_dump ${tools.version} is older than the PostgreSQL ${serverVersion} server and will refuse to run. ` +
        `Install PostgreSQL ${serverVersion} client tools, or point the path below at their "bin" folder.`
    }
  }

  return {
    ok: true,
    dir: tools.dir || 'system PATH',
    toolVersion: tools.version,
    serverVersion,
    message: `Using pg_dump ${tools.version}${serverVersion ? ` with PostgreSQL ${serverVersion}` : ''}.`
  }
}

// ─────────────────────── Running the tools ───────────────────────

type ProgressStage = 'start' | 'step' | 'done' | 'error'

function emit(stage: ProgressStage, message: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('backup:progress', { stage, message })
  }
}

function requireConfig(): DbConfig {
  const cfg = getActiveConfig()
  if (!cfg) throw new Error('Connect to the database first — Settings → Database.')
  return cfg
}

/** Spawn a pg tool, passing the password through the environment, never the command line. */
function runTool(exe: string, args: string[], cfg: DbConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PGPASSWORD: cfg.password,
        PGCLIENTENCODING: 'UTF8'
      }
    })

    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      const line = text.trim().split('\n').pop()
      if (line) emit('step', line.slice(0, 300))
    })

    child.on('error', (err) =>
      reject(new Error(`Could not run ${path.basename(exe)}: ${err.message}`))
    )

    child.on('close', (code) => {
      if (code === 0) return resolve()
      const detail = stderr.trim().split('\n').slice(-4).join(' ').slice(0, 500)
      reject(new Error(`${path.basename(exe)} exited with code ${code}. ${detail}`))
    })
  })
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(
    d.getSeconds()
  )}`
}

export interface BackupFile {
  file: string
  name: string
  size: number
  createdAt: string
  auto: boolean
}

export async function listBackups(): Promise<BackupFile[]> {
  const { folder } = getBackupSettings()
  let names: string[] = []
  try {
    names = await fsp.readdir(folder)
  } catch {
    return []
  }

  const out: BackupFile[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.dump')) continue
    const file = path.join(folder, name)
    try {
      const st = await fsp.stat(file)
      if (!st.isFile()) continue
      out.push({
        file,
        name,
        size: st.size,
        createdAt: st.mtime.toISOString(),
        auto: name.includes('-auto-')
      })
    } catch {
      /* skip unreadable entries */
    }
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Delete the oldest automatic backups beyond `keepCount`. Manual ones are never pruned. */
async function prune(): Promise<number> {
  const { keepCount } = getBackupSettings()
  if (keepCount <= 0) return 0
  const autos = (await listBackups()).filter((b) => b.auto)
  const doomed = autos.slice(keepCount)
  let n = 0
  for (const b of doomed) {
    try {
      await fsp.unlink(b.file)
      n++
    } catch {
      /* leave it */
    }
  }
  return n
}

export interface BackupResult {
  file: string
  name: string
  size: number
  durationMs: number
  pruned: number
}

export async function runBackup(opts: { auto?: boolean; label?: string } = {}): Promise<BackupResult> {
  const cfg = requireConfig()
  const status = await toolStatus()
  if (!status.ok) throw new Error(status.message)

  const tools = await findTools()
  if (!tools) throw new Error(status.message)

  const settings = getBackupSettings()
  await fsp.mkdir(settings.folder, { recursive: true })

  const kind = opts.label ?? (opts.auto ? 'auto' : 'manual')
  const name = `${cfg.database}-${kind}-${stamp()}.dump`
  const file = path.join(settings.folder, name)
  const partial = `${file}.part`

  emit('start', `Backing up ${cfg.database}…`)
  const began = Date.now()

  const exe = path.join(tools.dir, `pg_dump${EXE}`)
  try {
    await runTool(
      exe,
      [
        '-h', cfg.host,
        '-p', String(cfg.port),
        '-U', cfg.user,
        '-d', cfg.database,
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
        '--file', partial
      ],
      cfg
    )
  } catch (err) {
    await fsp.unlink(partial).catch(() => {})
    emit('error', err instanceof Error ? err.message : String(err))
    throw err
  }

  // Only name it a real backup once pg_dump has finished cleanly, so a crash
  // mid-dump can never leave a truncated file that looks restorable.
  await fsp.rename(partial, file)

  const st = await fsp.stat(file)
  saveBackupSettings({ lastRunAt: new Date().toISOString() })
  const pruned = await prune()

  const durationMs = Date.now() - began
  emit('done', `Saved ${name} (${(st.size / 1024).toFixed(0)} KB).`)
  return { file, name, size: st.size, durationMs, pruned }
}

// ─────────────────────── Restore ───────────────────────

/** Custom-format dumps begin with the magic bytes "PGDMP". */
async function assertRestorable(file: string): Promise<void> {
  let fh: fsp.FileHandle | null = null
  try {
    fh = await fsp.open(file, 'r')
    const buf = Buffer.alloc(5)
    const { bytesRead } = await fh.read(buf, 0, 5, 0)
    if (bytesRead < 5 || buf.toString('latin1') !== 'PGDMP') {
      throw new Error(
        `${path.basename(file)} is not a PostgreSQL custom-format backup. ` +
          'Choose a .dump file created by this app or by pg_dump -F c.'
      )
    }
  } finally {
    await fh?.close().catch(() => {})
  }
}

export interface RestoreResult {
  restored: string
  safetyCopy: string | null
}

/**
 * Replace the live database with the contents of a backup.
 *
 * The current data is dumped first, so a restore of the wrong file is still
 * recoverable. The database is then dropped and recreated, because restoring
 * over live tables leaves whatever the backup did not contain behind.
 */
export async function restoreBackup(file: string): Promise<RestoreResult> {
  const cfg = requireConfig()
  await assertRestorable(file)

  const status = await toolStatus()
  if (!status.ok) throw new Error(status.message)
  const tools = await findTools()
  if (!tools) throw new Error(status.message)

  // 1. Safety copy of what is about to be replaced.
  let safetyCopy: string | null = null
  emit('start', 'Taking a safety copy of the current data…')
  try {
    const safety = await runBackup({ label: 'pre-restore' })
    safetyCopy = safety.file
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit('error', `Safety copy failed: ${message}`)
    throw new Error(`Refusing to restore — the safety copy of your current data failed. ${message}`)
  }

  // 2. Drop and recreate, so nothing from the old database survives.
  emit('step', 'Recreating the database…')
  const { Pool } = await import('pg')
  const admin = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: 'postgres',
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
    application_name: 'E-Invoice (restore)'
  })

  const quoted = '"' + cfg.database.replace(/"/g, '""') + '"'
  try {
    await disconnect() // release our own pool before dropping
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [cfg.database]
    )
    await admin.query(`DROP DATABASE IF EXISTS ${quoted}`)
    await admin.query(`CREATE DATABASE ${quoted}`)
  } catch (err) {
    await admin.end().catch(() => {})
    await connect(cfg).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    emit('error', message)
    throw new Error(`Could not recreate the database: ${message}`)
  }
  await admin.end().catch(() => {})

  // 3. Load the backup.
  emit('step', `Restoring ${path.basename(file)}…`)
  const exe = path.join(tools.dir, `pg_restore${EXE}`)
  try {
    await runTool(
      exe,
      [
        '-h', cfg.host,
        '-p', String(cfg.port),
        '-U', cfg.user,
        '-d', cfg.database,
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        file
      ],
      cfg
    )
  } catch (err) {
    await connect(cfg).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    emit('error', message)
    throw new Error(
      `${message}\n\nYour previous data was saved to ${safetyCopy} before the restore started.`
    )
  }

  // 4. Reconnect; the schema pass is idempotent and seeding skips non-empty tables.
  emit('step', 'Reconnecting…')
  await connect(cfg)

  emit('done', `Restored from ${path.basename(file)}.`)
  return { restored: file, safetyCopy }
}

export async function deleteBackup(file: string): Promise<void> {
  const { folder } = getBackupSettings()
  const resolved = path.resolve(file)
  // Only ever delete inside the configured backup folder.
  const rel = path.relative(path.resolve(folder), resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('That file is outside the backup folder, so it was not deleted.')
  }
  await fsp.unlink(resolved)
}

export async function revealBackup(file?: string): Promise<void> {
  const { folder } = getBackupSettings()
  if (file && fs.existsSync(file)) {
    shell.showItemInFolder(path.resolve(file))
    return
  }
  await fsp.mkdir(folder, { recursive: true })
  await shell.openPath(folder)
}

export async function pickBackupFolder(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a folder for backups',
    defaultPath: getBackupSettings().folder,
    properties: ['openDirectory', 'createDirectory']
  })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
}

export async function pickToolDir(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose the PostgreSQL "bin" folder',
    properties: ['openDirectory']
  })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
}

export async function pickBackupFile(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a backup to restore',
    defaultPath: getBackupSettings().folder,
    filters: [{ name: 'PostgreSQL backup', extensions: ['dump', 'backup'] }],
    properties: ['openFile']
  })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
}

// ─────────────────────── Automatic backups ───────────────────────

let timer: NodeJS.Timeout | null = null
let running = false

/** True when enough time has passed since the last successful backup. */
function isDue(s: BackupSettings): boolean {
  if (!s.autoEnabled) return false
  if (!s.lastRunAt) return true
  const last = Date.parse(s.lastRunAt)
  if (!Number.isFinite(last)) return true
  return Date.now() - last >= s.autoEveryHours * 3_600_000
}

async function tick(): Promise<void> {
  if (running) return
  const s = getBackupSettings()
  if (!isDue(s) || !getActiveConfig()) return
  running = true
  try {
    const r = await runBackup({ auto: true })
    console.log(`[backup] automatic backup written: ${r.name}`)
  } catch (err) {
    console.error('[backup] automatic backup failed:', err)
  } finally {
    running = false
  }
}

/** Check every 15 minutes whether an automatic backup is due. */
export function startAutoBackup(): void {
  stopAutoBackup()
  timer = setInterval(() => void tick(), 15 * 60_000)
  // Give the app a moment to finish connecting before the first check.
  setTimeout(() => void tick(), 30_000)
}

export function stopAutoBackup(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
