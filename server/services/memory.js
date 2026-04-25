/**
 * Aether memory store.
 *
 * This is the persistent brain: every conversation, every action, every learned
 * preference lives here. The AI route reads from it to build richer prompts,
 * and the client writes to it as the user takes actions.
 *
 * Single-user today (user_id defaults to BUNQ_USER_ID), schema-ready for multi-user.
 */

import { randomUUID, createHash } from 'node:crypto'
import { getDB } from '../db/index.js'

const DEFAULT_USER = () => process.env.BUNQ_USER_ID || 'single-user'

// ─── Conversations ─────────────────────────────────────────────

export async function recordConversation({
  userId, sessionId, userMessage, emotionalTone, intent,
  result, provider, latencyMs, cacheHit = false,
  tokensIn = null, tokensOut = null,
}) {
  const db = getDB()
  const id = randomUUID()
  const uid = userId || DEFAULT_USER()
  const ts = Date.now()

  // `result.scene` and `result.risk` are objects in the provider response —
  // SQLite can only bind scalars, so flatten them to short strings here.
  const sceneText = scalariseScene(result?.scene)
  const riskLevel = typeof result?.risk === 'object'
    ? (result?.risk?.level || null)
    : (result?.risk || null)

  await db.exec(
    `INSERT INTO conversations
       (id, user_id, ts, voice_text, emotional_tone, scene, risk, voice_response, insight,
        provider, latency_ms, cache_hit, tokens_in, tokens_out, intent, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, uid, ts,
      truncate(userMessage, 2000),
      emotionalTone || null,
      truncate(sceneText, 500),
      riskLevel,
      truncate(result?.voiceResponse, 1000),
      truncate(result?.insight, 1000),
      provider || null,
      latencyMs != null ? Math.round(latencyMs) : null,
      cacheHit ? 1 : 0,
      tokensIn, tokensOut,
      intent || null,
      sessionId || null,
    ],
  )

  // Mirror the recommended actions — lets us measure accept rate later.
  if (Array.isArray(result?.recommendedActions) && result.recommendedActions.length) {
    for (const action of result.recommendedActions) {
      await db.exec(
        `INSERT INTO conversation_actions (id, conversation_id, user_id, action_type, action_json, accepted, ts)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [randomUUID(), id, uid, action.type || 'UNKNOWN', JSON.stringify(action), ts],
      )
    }
  }

  return { id, ts }
}

/**
 * Fetch the N most recent conversations for memory injection.
 * Returns newest first; we reverse in the caller if we want chronological order.
 */
export async function getRecentConversations(userId, limit = 5) {
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  return db.many(
    `SELECT id, ts, voice_text, emotional_tone, voice_response, risk, intent
       FROM conversations
      WHERE user_id = ?
      ORDER BY ts DESC
      LIMIT ?`,
    [uid, Math.min(Math.max(1, limit), 50)],
  )
}

/**
 * Fetch the N most recent turns for a SINGLE session, in chronological order
 * (oldest → newest). These are replayed into the provider's `messages` array
 * so Claude/Gemini see real conversation threading instead of a summary block.
 *
 * Cap at 12 turns — beyond that the prompt starts to bloat and the older turns
 * rarely matter. The persistent "memory block" still covers earlier stuff.
 */
export async function getSessionTurns(userId, sessionId, limit = 12) {
  if (!sessionId) return []
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  const rows = await db.many(
    `SELECT voice_text, voice_response, ts
       FROM conversations
      WHERE user_id = ? AND session_id = ?
      ORDER BY ts DESC
      LIMIT ?`,
    [uid, sessionId, Math.min(Math.max(1, limit), 30)],
  )
  return rows.reverse()
}

// ─── Action log ────────────────────────────────────────────────

/**
 * Idempotency: a hash of (type, amount, from, to) that's stable for 60s.
 * If a second identical action arrives within the window we can refuse it.
 */
export function idempotencyKey(action, windowMs = 60_000) {
  const bucket = Math.floor(Date.now() / windowMs)
  return createHash('sha256')
    .update(String(action.type || ''))
    .update('|').update(String(action.amount ?? ''))
    .update('|').update(String(action.fromAccount ?? ''))
    .update('|').update(String(action.toAccount ?? action.toIban ?? action.toContact ?? ''))
    .update('|').update(String(bucket))
    .digest('hex')
    .slice(0, 32)
}

export async function recordAction({
  userId, id, type, status, amount, fromAccount, toAccount,
  description, snapshot, result, error, idempotencyKey: idem,
}) {
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  const ts = Date.now()
  await db.exec(
    `INSERT INTO action_log
       (id, user_id, ts, type, status, amount, from_account, to_account,
        description, snapshot_json, result_json, error, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status        = excluded.status,
       result_json   = excluded.result_json,
       error         = excluded.error`,
    [
      id || randomUUID(), uid, ts,
      type, status || 'executing',
      amount != null ? Number(amount) : null,
      fromAccount || null,
      toAccount || null,
      truncate(description, 500),
      snapshot ? JSON.stringify(snapshot) : null,
      result ? JSON.stringify(result) : null,
      truncate(error, 500),
      idem || null,
    ],
  )
}

export async function findRecentActionByIdempotency(userId, idem, windowMs = 60_000) {
  const db = getDB()
  return db.one(
    `SELECT id, ts, type, status, result_json
       FROM action_log
      WHERE user_id = ? AND idempotency_key = ? AND ts > ?
      ORDER BY ts DESC LIMIT 1`,
    [userId || DEFAULT_USER(), idem, Date.now() - windowMs],
  )
}

/**
 * Sweep abandoned "executing" rows. A page refresh or network drop mid-flow
 * can leave the client unable to send the completed/failed transition, which
 * otherwise shows a permanent "Sending…" toast on every subsequent app load.
 *
 * Any executing row older than `staleMs` (default 30s — real bunq calls
 * complete well under that) gets marked as `failed` with an explanatory note.
 */
export async function sweepStaleExecuting({ staleMs = 30_000 } = {}) {
  const db = getDB()
  const cutoff = Date.now() - staleMs
  const { changes } = await db.exec(
    `UPDATE action_log
        SET status = ?, error = ?
      WHERE status = ? AND ts < ?`,
    ['failed', 'Interrupted — app reloaded before action finished', 'executing', cutoff],
  )
  return changes || 0
}

export async function getActionLog(userId, limit = 50) {
  const db = getDB()
  const rows = await db.many(
    `SELECT id, ts, type, status, amount, from_account, to_account, description,
            result_json, error
       FROM action_log
      WHERE user_id = ?
      ORDER BY ts DESC
      LIMIT ?`,
    [userId || DEFAULT_USER(), Math.min(Math.max(1, limit), 500)],
  )
  return rows.map(r => ({
    ...r,
    result: r.result_json ? safeJSON(r.result_json) : null,
    result_json: undefined,
  }))
}

// ─── User traits (learning) ────────────────────────────────────

/**
 * Upsert a trait. Weighted moving-average-style confidence: if we see the same
 * signal again, confidence climbs; if we see a contradicting one, it erodes.
 */
export async function upsertTrait(userId, key, value, confidenceDelta = 0.1) {
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  const now = Date.now()
  const existing = await db.one(
    'SELECT trait_value, confidence FROM user_traits WHERE user_id = ? AND trait_key = ?',
    [uid, key],
  )
  let nextValue = String(value)
  let nextConf = clamp(0.5 + confidenceDelta, 0.05, 0.99)
  if (existing) {
    if (existing.trait_value === nextValue) {
      nextConf = clamp(existing.confidence + confidenceDelta, 0.05, 0.99)
    } else {
      // Contradicting signal — if the new one is confident enough, replace.
      const erosion = existing.confidence - Math.abs(confidenceDelta)
      if (erosion < 0.25) {
        nextConf = clamp(0.5 + confidenceDelta, 0.05, 0.99)
      } else {
        nextValue = existing.trait_value
        nextConf = erosion
      }
    }
  }
  await db.exec(
    `INSERT INTO user_traits (user_id, trait_key, trait_value, confidence, last_seen, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, trait_key) DO UPDATE SET
       trait_value = excluded.trait_value,
       confidence  = excluded.confidence,
       last_seen   = excluded.last_seen,
       updated_at  = excluded.updated_at`,
    [uid, key, nextValue, nextConf, now, now],
  )
}

export async function getTopTraits(userId, limit = 8) {
  const db = getDB()
  return db.many(
    `SELECT trait_key, trait_value, confidence
       FROM user_traits
      WHERE user_id = ? AND confidence >= 0.35
      ORDER BY confidence DESC, last_seen DESC
      LIMIT ?`,
    [userId || DEFAULT_USER(), Math.min(Math.max(1, limit), 50)],
  )
}

// ─── Merchant memory ───────────────────────────────────────────

export async function upsertMerchant(userId, { slug, displayName, categoryOverride, isRecurring, avgAmount }) {
  if (!slug) return
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  const now = Date.now()
  await db.exec(
    `INSERT INTO merchant_memory
       (user_id, merchant_slug, display_name, category_override, is_recurring, avg_amount, seen_count, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, merchant_slug) DO UPDATE SET
       display_name      = COALESCE(excluded.display_name, display_name),
       category_override = COALESCE(excluded.category_override, category_override),
       is_recurring      = CASE WHEN excluded.is_recurring = 1 THEN 1 ELSE is_recurring END,
       avg_amount        = COALESCE(excluded.avg_amount, avg_amount),
       seen_count        = seen_count + 1,
       last_seen         = excluded.last_seen`,
    [
      uid, slug,
      displayName || null,
      categoryOverride || null,
      isRecurring ? 1 : 0,
      avgAmount != null ? Number(avgAmount) : null,
      now,
    ],
  )
}

export async function getMerchantMemory(userId, slugs = null) {
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  if (!slugs || !slugs.length) {
    return db.many(
      `SELECT merchant_slug, display_name, category_override, is_recurring, avg_amount
         FROM merchant_memory
        WHERE user_id = ?
        ORDER BY seen_count DESC, last_seen DESC
        LIMIT 50`,
      [uid],
    )
  }
  // Portable IN-list: we build placeholders manually.
  const placeholders = slugs.map(() => '?').join(',')
  return db.many(
    `SELECT merchant_slug, display_name, category_override, is_recurring, avg_amount
       FROM merchant_memory
      WHERE user_id = ? AND merchant_slug IN (${placeholders})`,
    [uid, ...slugs],
  )
}

// ─── Prompt-injectable memory block ────────────────────────────

/**
 * Build a compact, prompt-ready memory block. Capped at ~800 tokens worth
 * of text (rough heuristic: ~4 chars/token).
 *
 * `opts.skipRecentConversations` — set true when the caller is ALSO replaying
 * the current session's turns into the provider's `messages` array. Otherwise
 * the model sees the same content twice (wasted tokens + prompt confusion).
 */
export async function buildMemoryBlock(userId, ctx, opts = {}) {
  const { skipRecentConversations = false } = opts
  const [recent, traits, merchantRows] = await Promise.all([
    skipRecentConversations ? Promise.resolve([]) : getRecentConversations(userId, 5),
    getTopTraits(userId, 6),
    merchantSlugsFromContext(ctx).then(slugs => slugs.length ? getMerchantMemory(userId, slugs) : []),
  ])

  const lines = []

  if (recent.length) {
    lines.push('EARLIER CONVERSATIONS (oldest → newest):')
    for (const r of recent.slice().reverse()) {
      const when = timeAgo(Date.now() - Number(r.ts))
      const said = r.voice_text ? `"${truncate(r.voice_text, 90)}"` : '(scene scan)'
      const replied = r.voice_response ? `→ ${truncate(r.voice_response, 110)}` : ''
      const tone = r.emotional_tone ? ` [${r.emotional_tone}]` : ''
      lines.push(`  ${when}${tone} ${said} ${replied}`)
    }
    lines.push('')
  }

  if (traits.length) {
    lines.push('LEARNED USER PREFERENCES (trust = confidence):')
    for (const t of traits) {
      lines.push(`  • ${t.trait_key} = ${t.trait_value}   (trust ${(t.confidence * 100).toFixed(0)}%)`)
    }
    lines.push('')
  }

  if (merchantRows.length) {
    lines.push('MERCHANT MEMORY (user corrections):')
    for (const m of merchantRows) {
      const bits = []
      if (m.category_override) bits.push(`cat=${m.category_override}`)
      if (m.is_recurring) bits.push('recurring')
      if (m.avg_amount) bits.push(`avg=€${Number(m.avg_amount).toFixed(2)}`)
      lines.push(`  • ${m.display_name || m.merchant_slug}: ${bits.join(', ')}`)
    }
    lines.push('')
  }

  if (!lines.length) return ''
  return ['═══ AETHER MEMORY (from persistent store) ═══', ...lines, '═══ END MEMORY ═══'].join('\n')
}

async function merchantSlugsFromContext(ctx) {
  if (!ctx?.transactions?.length) return []
  const slugs = new Set()
  for (const tx of ctx.transactions.slice(0, 10)) {
    const s = merchantSlug(tx.merchant || tx.description || '')
    if (s) slugs.add(s)
    if (slugs.size >= 8) break
  }
  return [...slugs]
}

export function merchantSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ─── Stats ─────────────────────────────────────────────────────

export async function getMemoryStats(userId) {
  const db = getDB()
  const uid = userId || DEFAULT_USER()
  const [conv, acts, traits, merchants, cache] = await Promise.all([
    db.one('SELECT COUNT(*) AS n, MAX(ts) AS last FROM conversations WHERE user_id = ?', [uid]),
    db.one('SELECT COUNT(*) AS n, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) AS ok FROM action_log WHERE user_id = ?', ['completed', uid]),
    db.one('SELECT COUNT(*) AS n FROM user_traits WHERE user_id = ?', [uid]),
    db.one('SELECT COUNT(*) AS n FROM merchant_memory WHERE user_id = ?', [uid]),
    db.one('SELECT COUNT(*) AS n, SUM(hit_count) AS hits FROM ai_cache WHERE user_id = ?', [uid]),
  ])
  return {
    conversations: Number(conv?.n || 0),
    lastConversationTs: conv?.last ? Number(conv.last) : null,
    actions: Number(acts?.n || 0),
    actionsCompleted: Number(acts?.ok || 0),
    traits: Number(traits?.n || 0),
    merchants: Number(merchants?.n || 0),
    cacheEntries: Number(cache?.n || 0),
    cacheTotalHits: Number(cache?.hits || 0),
  }
}

// ─── Utilities ─────────────────────────────────────────────────

function truncate(s, n) {
  if (s == null) return null
  const str = String(s)
  return str.length <= n ? str : str.slice(0, n - 1) + '…'
}
function scalariseScene(scene) {
  if (!scene) return null
  if (typeof scene === 'string') return scene
  return scene.summary || scene.description || scene.type || null
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }
function safeJSON(s) { try { return JSON.parse(s) } catch { return null } }
function timeAgo(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
