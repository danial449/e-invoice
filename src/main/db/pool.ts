import { Pool, types } from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL } from './schema'
import { seedDefaults } from './seed'
import type { DbConfig } from '../../shared/types'

// Postgres returns NUMERIC as string to preserve precision. For this app the
// magnitudes are small and money is rounded to 2dp, so parse to JS number and
// keep rounding explicit in the calculation layer.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)))
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))) // int8
// DATE -> keep as plain YYYY-MM-DD string, never shift by timezone.
types.setTypeParser(1082, (v) => v)

/**
 * Starting point for the connect screen. The password is deliberately blank —
 * it is typed by the user and, if they tick "Remember", stored in their own
 * user profile. Never commit a real password here.
 */
export const DEFAULT_DB_CONFIG: DbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'e-invoice',
  user: 'postgres',
  password: '',
  ssl: false
}

let pool: Pool | null = null
let activeConfig: DbConfig | null = null

function configPath(): string {
  return path.join(app.getPath('userData'), 'dbconfig.json')
}

export function loadDbConfig(): DbConfig | null {
  try {
    const p = configPath()
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<DbConfig>
    return { ...DEFAULT_DB_CONFIG, ...raw }
  } catch {
    return null
  }
}

export function saveDbConfig(cfg: DbConfig): void {
  const p = configPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8')
}

export function clearDbConfig(): void {
  try {
    fs.unlinkSync(configPath())
  } catch {
    /* already gone */
  }
}

function makePool(cfg: DbConfig, database?: string): Pool {
  const p = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: database ?? cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'E-Invoice'
  })

  // An idle client dropped by the server (restart, timeout, network blip)
  // emits 'error' on the pool. Without a listener that is an unhandled
  // EventEmitter error, which takes the whole main process down.
  p.on('error', (err) => {
    console.error('[db] idle client error:', err.message)
  })

  return p
}

/** Verify the server accepts these credentials, without touching the app database. */
export async function testConnection(cfg: DbConfig): Promise<{ serverVersion: string; databaseExists: boolean }> {
  const admin = makePool(cfg, 'postgres')
  try {
    const v = await admin.query<{ version: string }>('SELECT version() AS version')
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database])
    return {
      serverVersion: (v.rows[0]?.version ?? '').split(',')[0] ?? 'PostgreSQL',
      databaseExists: exists.rowCount! > 0
    }
  } finally {
    await admin.end().catch(() => {})
  }
}

async function ensureDatabaseExists(cfg: DbConfig): Promise<void> {
  const admin = makePool(cfg, 'postgres')
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database])
    if (exists.rowCount === 0) {
      // Identifier cannot be parameterised; quote it safely instead.
      const safe = '"' + cfg.database.replace(/"/g, '""') + '"'
      await admin.query(`CREATE DATABASE ${safe}`)
    }
  } finally {
    await admin.end().catch(() => {})
  }
}

/**
 * Connect, create the database if needed, apply the schema and seed defaults.
 *
 * The new connection is fully validated before the existing one is given up.
 * Tearing the old pool down first meant a single typo in the password left the
 * app with no connection at all, while the UI still believed it was connected.
 */
export async function connect(cfg: DbConfig): Promise<void> {
  // Credentials are checked here, against the always-present `postgres`
  // database, before anything touches the live pool.
  await ensureDatabaseExists(cfg)

  const p = makePool(cfg)
  try {
    // Fail fast if the new database is unreachable.
    const probe = await p.connect()
    probe.release()
    await p.query(SCHEMA_SQL)
  } catch (err) {
    await p.end().catch(() => {})
    throw err
  }

  // Only now is the previous connection safe to drop.
  await disconnect()
  pool = p
  activeConfig = cfg
  await seedDefaults(p)
}

export async function disconnect(): Promise<void> {
  if (pool) {
    const old = pool
    pool = null
    activeConfig = null
    await old.end().catch(() => {})
  }
}

export function isConnected(): boolean {
  return pool !== null
}

export function getActiveConfig(): DbConfig | null {
  return activeConfig
}

export function getPool(): Pool {
  if (!pool) throw new Error('Not connected to the database. Open Settings → Database to connect.')
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as never[])
  return res.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

/** Run a set of statements inside a single transaction. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
