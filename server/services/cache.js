/**
 * Two-tier AI response cache.
 *
 * L1: in-process LRU (sub-ms, bounded, process-local).
 * L2: ai_cache table (survives restarts, shareable across nodes).
 *
 * Key design:
 *   hash = sha256(provider || userId || normalised(userMessage) || imageHash || contextFingerprint)
 *
 * `normalised(text)`:
 *   - lowercase
 *   - trim
 *   - collapse whitespace
 *   - strip trailing punctuation
 *
 * We deliberately ignore tiny whitespace/case differences so "Block my card",
 * "block my card!", and "  Block  my card" all hit the same cached answer.
 *
 * Stampede protection:
 *   If N identical requests arrive while the first is still in-flight,
 *   we deduplicate them to a single upstream call and serve the same promise
 *   to all N callers (pendingByKey map).
 */

import { createHash } from 'node:crypto'
import { getDB } from '../db/index.js'

const L1_MAX = 500
const DEFAULT_TTL_MS = 5 * 60 * 1000  // 5 min

// Responses that should NEVER be cached — they mutate state or depend on "now".
const VOLATILE_ACTIONS = new Set([
  'BLOCK_CARD', 'UNBLOCK_CARD', 'TRANSFER', 'PAYMENT_REQUEST',
  'ROUND_UP_SWEEP', 'GOAL_AUTOPILOT', 'SAVINGS_BOOST', 'SET_LIMIT',
])

class LRU {
  constructor(max) { this.max = max; this.map = new Map() }
  get(k) {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k)
    this.map.delete(k); this.map.set(k, v)   // refresh recency
    return v
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k)
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value)
    this.map.set(k, v)
  }
  delete(k) { this.map.delete(k) }
  clear() { this.map.clear() }
  get size() { return this.map.size }
}

const l1 = new LRU(L1_MAX)
const pendingByKey = new Map()    // key → Promise<response>
const stats = { l1Hits: 0, l2Hits: 0, misses: 0, writes: 0, stampedesDeduped: 0 }

function normaliseText(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '')
}

/**
 * Lightweight fingerprint of the financial context — just the bits that would
 * change the correct answer. We don't want cache misses every time a balance
 * moves by one cent; bucketing rounds the numbers.
 */
function contextFingerprint(ctx) {
  if (!ctx) return 'no-ctx'
  const parts = []
  if (ctx.cardBlocked != null) parts.push(`card:${ctx.cardBlocked ? 1 : 0}`)
  if (ctx.totalBalance != null) {
    // Bucket to the nearest €50 so small balance changes don't bust the cache.
    parts.push(`bal:${Math.round(Number(ctx.totalBalance) / 50) * 50}`)
  }
  if (ctx.intent) parts.push(`intent:${ctx.intent}`)
  if (ctx.emotionalTone) parts.push(`tone:${ctx.emotionalTone}`)
  if (ctx.accounts?.length) parts.push(`accs:${ctx.accounts.length}`)
  if (ctx.goals?.length) parts.push(`goals:${ctx.goals.length}`)
  return parts.join('|')
}

function hashImage(imageBase64) {
  if (!imageBase64) return 'no-img'
  // We don't hash the whole base64 — too slow. A prefix + length is unique enough
  // for cache keys; a genuinely different image would produce different bytes in
  // the first 512 chars of its base64 encoding.
  const head = imageBase64.slice(0, 512)
  return createHash('sha256').update(head).update(String(imageBase64.length)).digest('hex').slice(0, 16)
}

export function buildCacheKey({ provider, userId, userMessage, imageBase64, financialContext, sessionId }) {
  return createHash('sha256')
    .update(provider || '')
    .update('|')
    .update(userId || 'single-user')
    .update('|')
    .update(sessionId || '')
    .update('|')
    .update(normaliseText(userMessage))
    .update('|')
    .update(hashImage(imageBase64))
    .update('|')
    .update(contextFingerprint(financialContext))
    .digest('hex')
}

export function shouldCacheResponse(result) {
  if (!result) return false
  // Never cache a response that proposes a mutating action — the user might
  // hit "confirm" twice from a stale cached suggestion and double-transfer.
  const actions = result.recommendedActions || []
  if (actions.some(a => VOLATILE_ACTIONS.has(a?.type))) return false
  // Never cache high-risk scenes — they might need a fresh look.
  if (result.risk === 'HIGH' || result.risk === 'CRITICAL') return false
  return true
}

export async function cacheLookup(key) {
  // L1
  const l1Entry = l1.get(key)
  if (l1Entry && l1Entry.expiresAt > Date.now()) {
    stats.l1Hits++
    return { hit: true, tier: 'l1', response: l1Entry.response }
  }
  if (l1Entry) l1.delete(key)  // expired

  // L2
  try {
    const db = getDB()
    const row = await db.one(
      'SELECT response_json, expires_at FROM ai_cache WHERE cache_key = ?',
      [key],
    )
    if (row && row.expires_at > Date.now()) {
      stats.l2Hits++
      const response = JSON.parse(row.response_json)
      // Promote to L1 on hit
      l1.set(key, { response, expiresAt: row.expires_at })
      // Fire-and-forget hit counter
      db.exec('UPDATE ai_cache SET hit_count = hit_count + 1 WHERE cache_key = ?', [key]).catch(() => {})
      return { hit: true, tier: 'l2', response }
    }
  } catch (err) {
    // DB offline is not fatal — we just skip the cache.
    if (process.env.DEBUG_CACHE) console.warn('[cache] L2 lookup failed:', err.message)
  }

  stats.misses++
  return { hit: false }
}

export async function cacheWrite(key, userId, response, { ttlMs = DEFAULT_TTL_MS, provider = null } = {}) {
  const now = Date.now()
  const expiresAt = now + ttlMs
  l1.set(key, { response, expiresAt })
  stats.writes++
  try {
    const db = getDB()
    const json = JSON.stringify(response)
    // INSERT … ON CONFLICT … DO UPDATE — portable between SQLite and MariaDB
    // because our adapter rewrites ON CONFLICT for MariaDB.
    await db.exec(
      `INSERT INTO ai_cache (cache_key, user_id, response_json, provider, created_at, expires_at, hit_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(cache_key) DO UPDATE SET
         response_json = excluded.response_json,
         expires_at    = excluded.expires_at,
         hit_count     = 0`,
      [key, userId || 'single-user', json, provider, now, expiresAt],
    )
  } catch (err) {
    if (process.env.DEBUG_CACHE) console.warn('[cache] L2 write failed:', err.message)
  }
}

/**
 * Stampede-protected runner: if an identical key is already in flight,
 * await the existing promise instead of firing a second upstream call.
 */
export async function runWithDedup(key, fn) {
  if (pendingByKey.has(key)) {
    stats.stampedesDeduped++
    return pendingByKey.get(key)
  }
  const promise = (async () => {
    try {
      return await fn()
    } finally {
      pendingByKey.delete(key)
    }
  })()
  pendingByKey.set(key, promise)
  return promise
}

/**
 * Garbage-collect expired rows. Safe to call periodically.
 */
export async function pruneExpired() {
  try {
    const db = getDB()
    const { changes } = await db.exec('DELETE FROM ai_cache WHERE expires_at < ?', [Date.now()])
    return changes
  } catch { return 0 }
}

export function getCacheStats() {
  const total = stats.l1Hits + stats.l2Hits + stats.misses
  return {
    ...stats,
    l1Size: l1.size,
    l1Max: L1_MAX,
    total,
    hitRate: total > 0 ? Number(((stats.l1Hits + stats.l2Hits) / total).toFixed(4)) : 0,
  }
}

export function clearL1() { l1.clear() }
