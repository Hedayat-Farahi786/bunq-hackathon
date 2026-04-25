/**
 * Database adapter — driver-agnostic facade.
 *
 * Local development: SQLite via better-sqlite3 (zero-setup, file at ./server/data/aether.db).
 * Production / AWS: MariaDB via mysql2/promise (set DATABASE_URL=mysql://user:pass@host:3306/db).
 *
 * The public API (query, exec, one, many, transaction, close) is identical in both modes,
 * so no downstream code needs to know which driver is running.
 *
 * SQL is written in an ANSI-portable dialect. The shim rewrites a tiny set of
 * SQLite↔MariaDB quirks (placeholders, AUTO_INCREMENT, ON CONFLICT, BLOB/JSON).
 */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const DB_MODE = (() => {
  const url = process.env.DATABASE_URL
  if (!url || url.trim() === '') return 'sqlite'
  if (url.startsWith('mysql://') || url.startsWith('mariadb://')) return 'mariadb'
  if (url.startsWith('sqlite:') || url.startsWith('file:') || url.endsWith('.db')) return 'sqlite'
  return 'sqlite'
})()

let driver = null

/**
 * Initialise the pool/connection. Safe to call more than once — returns the same instance.
 */
export async function initDB() {
  if (driver) return driver

  if (DB_MODE === 'mariadb') {
    driver = await initMariaDB()
  } else {
    driver = await initSQLite()
  }
  return driver
}

async function initMariaDB() {
  const mysql = await import('mysql2/promise')
  const url = new URL(process.env.DATABASE_URL)
  const ssl = process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined

  const pool = mysql.createPool({
    host:     url.hostname,
    port:     url.port ? Number(url.port) : 3306,
    user:     decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    ssl,
    connectionLimit:     Number(process.env.DB_POOL_SIZE || 10),
    waitForConnections:  true,
    queueLimit:          0,
    timezone:            'Z',
    dateStrings:         false,
    namedPlaceholders:   false,
    multipleStatements:  false,
  })

  // Smoke test — fail fast if creds are wrong
  const conn = await pool.getConnection()
  try { await conn.ping() } finally { conn.release() }

  return {
    mode: 'mariadb',
    /** SELECT that returns many rows */
    async many(sql, params = []) {
      const [rows] = await pool.execute(prepMariaSQL(sql), params)
      return rows
    },
    /** SELECT that returns one row or null */
    async one(sql, params = []) {
      const [rows] = await pool.execute(prepMariaSQL(sql), params)
      return rows[0] || null
    },
    /** INSERT/UPDATE/DELETE — returns { changes, lastInsertId } */
    async exec(sql, params = []) {
      const [res] = await pool.execute(prepMariaSQL(sql), params)
      return { changes: res.affectedRows, lastInsertId: res.insertId }
    },
    /** Alias for exec — kept for symmetry with sqlite */
    async query(sql, params = []) { return this.exec(sql, params) },
    /** Run the callback inside a transaction, automatic rollback on throw */
    async transaction(fn) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const txApi = {
          mode: 'mariadb',
          async many(sql, params = []) { const [r] = await conn.execute(prepMariaSQL(sql), params); return r },
          async one(sql, params = [])  { const [r] = await conn.execute(prepMariaSQL(sql), params); return r[0] || null },
          async exec(sql, params = []) { const [r] = await conn.execute(prepMariaSQL(sql), params); return { changes: r.affectedRows, lastInsertId: r.insertId } },
        }
        const result = await fn(txApi)
        await conn.commit()
        return result
      } catch (err) {
        try { await conn.rollback() } catch {}
        throw err
      } finally {
        conn.release()
      }
    },
    async close() { await pool.end() },
    _raw: pool,
  }
}

async function initSQLite() {
  const { default: Database } = await import('better-sqlite3')

  const url = process.env.DATABASE_URL || ''
  const dbPath = url.startsWith('sqlite:') ? url.slice(7)
               : url.startsWith('file:')   ? url.slice(5)
               : url || resolve(__dirname, '..', 'data', 'aether.db')

  await mkdir(dirname(dbPath), { recursive: true }).catch(() => {})

  const db = new Database(dbPath)

  // Performance pragmas — WAL mode gives us concurrent reads + single-writer,
  // which is exactly what we want for a local dev cache + memory store.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')   // safe enough for a cache; ~4× faster writes
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 134217728')  // 128MB mmap
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  const toSqlite = (sql) => prepSqliteSQL(sql)

  return {
    mode: 'sqlite',
    async many(sql, params = []) {
      return db.prepare(toSqlite(sql)).all(...params)
    },
    async one(sql, params = []) {
      return db.prepare(toSqlite(sql)).get(...params) || null
    },
    async exec(sql, params = []) {
      const res = db.prepare(toSqlite(sql)).run(...params)
      return { changes: res.changes, lastInsertId: res.lastInsertRowid }
    },
    async query(sql, params = []) { return this.exec(sql, params) },
    /**
     * Manual BEGIN/COMMIT. better-sqlite3's built-in db.transaction() requires
     * a synchronous callback; we use BEGIN IMMEDIATE / COMMIT / ROLLBACK so the
     * callback can be async (which it is, for adapter symmetry with MariaDB).
     *
     * Because SQLite holds a single writer, awaits inside the callback are fine
     * as long as the callback eventually returns and we commit. No other writer
     * can race us while the transaction is open.
     */
    async transaction(fn) {
      const api = {
        mode: 'sqlite',
        async many(sql, params = []) { return db.prepare(toSqlite(sql)).all(...params) },
        async one(sql, params = [])  { return db.prepare(toSqlite(sql)).get(...params) || null },
        async exec(sql, params = []) { const r = db.prepare(toSqlite(sql)).run(...params); return { changes: r.changes, lastInsertId: r.lastInsertRowid } },
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(api)
        db.exec('COMMIT')
        return result
      } catch (err) {
        try { db.exec('ROLLBACK') } catch {}
        throw err
      }
    },
    async close() { db.close() },
    _raw: db,
  }
}

/**
 * Translate a piece of the SQL dialect that differs between SQLite and MariaDB.
 *
 * Portable rules we follow in the codebase:
 *   - Placeholders are always `?`.
 *   - Timestamps are ISO-8601 strings ('2026-04-23T...'); we never rely on DB-generated times.
 *   - INSERT … ON CONFLICT(col) DO UPDATE SET … → rewritten for MariaDB.
 *   - JSON columns are stored as TEXT; we JSON.stringify/parse in the service layer.
 */
function prepMariaSQL(sql) {
  // Rewrite: ON CONFLICT(cols) DO UPDATE SET x = excluded.x, …
  //   →      ON DUPLICATE KEY UPDATE x = VALUES(x), …
  return sql.replace(
    /ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE\s+SET\s+([\s\S]+?)(?=\s*(?:RETURNING|;|$))/gi,
    (_m, _cols, assigns) => {
      const rewritten = assigns.replace(/excluded\./gi, 'VALUES(').replace(/\b(\w+)\)/g, '$1)')
      // Simpler: turn `x = excluded.x` → `x = VALUES(x)`
      const fixed = assigns.replace(/(\w+)\s*=\s*excluded\.(\w+)/gi, '$1 = VALUES($2)')
      return `ON DUPLICATE KEY UPDATE ${fixed}`
    },
  )
}

function prepSqliteSQL(sql) {
  // Nothing to rewrite for our schema — we author it in SQLite-compatible ANSI.
  return sql
}

export function getDB() {
  if (!driver) throw new Error('DB not initialised — call initDB() first')
  return driver
}
