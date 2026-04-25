/**
 * Simple forward-only migrator.
 * Reads every .sql in ./migrations in filename order and applies any not yet
 * recorded in schema_migrations. Idempotent — safe to call on every boot.
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDB } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function runMigrations() {
  const db = await initDB()

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `)

  const applied = new Set(
    (await db.many('SELECT name FROM schema_migrations')).map(r => r.name),
  )

  const dir = join(__dirname, 'migrations')
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(dir, file), 'utf8')
    const statements = splitStatements(sql)

    await db.transaction(async (tx) => {
      for (const stmt of statements) {
        if (!stmt.trim()) continue
        await tx.exec(stmt)
      }
      await tx.exec(
        'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
        [file, Date.now()],
      )
    })
    console.log(`[db] ✓ migration applied: ${file}`)
  }

  return { applied: files.length - applied.size + files.filter(f => applied.has(f)).length }
}

/**
 * Split a .sql file into individual statements.
 * Handles line comments ("-- …") and strips them, then splits on ";" at statement boundary.
 * We deliberately keep the grammar simple — our migration SQL never contains
 * stored procs, triggers, or embedded semicolons inside strings.
 */
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter(line => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(Boolean)
}
