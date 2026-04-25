/**
 * Memory API — client mirror for actionLog, learning from corrections,
 * and stats for the "observability" panel.
 */

import { Router } from 'express'
import {
  recordAction, findRecentActionByIdempotency, idempotencyKey,
  getActionLog, upsertTrait, upsertMerchant, merchantSlug,
  getRecentConversations, getMemoryStats,
} from '../services/memory.js'
import { getCacheStats, pruneExpired } from '../services/cache.js'

export const memoryRouter = Router()

const USER = () => process.env.BUNQ_USER_ID || 'single-user'

/**
 * POST /api/memory/actions
 * Body: { id, type, status, amount?, fromAccount?, toAccount?, description?, snapshot?, result?, error? }
 * Returns: { ok, idempotent? }
 */
memoryRouter.post('/actions', async (req, res, next) => {
  try {
    const userId = USER()
    const a = req.body || {}

    if (!a.type || !a.status) {
      return res.status(400).json({ error: 'type and status are required' })
    }

    // Idempotency check — don't double-log a transfer fired twice in 60s.
    let idem = a.idempotencyKey || null
    if (!idem && (a.status === 'executing' || a.status === 'completed')) {
      idem = idempotencyKey(a, 60_000)
      const existing = await findRecentActionByIdempotency(userId, idem)
      if (existing && existing.status === 'completed' && existing.id !== a.id) {
        return res.json({
          ok: true,
          idempotent: true,
          existing: { id: existing.id, ts: existing.ts, type: existing.type, status: existing.status },
        })
      }
    }

    await recordAction({
      userId,
      id: a.id,
      type: a.type,
      status: a.status,
      amount: a.amount,
      fromAccount: a.fromAccount,
      toAccount: a.toAccount || a.toIban || a.toContact,
      description: a.description,
      snapshot: a.snapshot,
      result: a.result,
      error: a.error,
      idempotencyKey: idem,
    })

    res.json({ ok: true })
  } catch (err) { next(err) }
})

/**
 * GET /api/memory/actions?limit=50
 */
memoryRouter.get('/actions', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500)
    const rows = await getActionLog(USER(), limit)
    res.json({ ok: true, actions: rows })
  } catch (err) { next(err) }
})

/**
 * POST /api/memory/traits
 * Body: { key, value, confidenceDelta? }
 * Used when the client infers something about the user (e.g. "prefers weekly sweeps").
 */
memoryRouter.post('/traits', async (req, res, next) => {
  try {
    const { key, value, confidenceDelta } = req.body || {}
    if (!key || value == null) {
      return res.status(400).json({ error: 'key and value are required' })
    }
    await upsertTrait(USER(), String(key), String(value), Number(confidenceDelta) || 0.1)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

/**
 * POST /api/memory/merchants
 * Body: { merchant, categoryOverride?, isRecurring?, avgAmount?, displayName? }
 * Called when the user corrects how a merchant was categorised.
 */
memoryRouter.post('/merchants', async (req, res, next) => {
  try {
    const b = req.body || {}
    const slug = merchantSlug(b.merchant || b.slug || '')
    if (!slug) return res.status(400).json({ error: 'merchant is required' })
    await upsertMerchant(USER(), {
      slug,
      displayName:        b.displayName || b.merchant,
      categoryOverride:   b.categoryOverride,
      isRecurring:        !!b.isRecurring,
      avgAmount:          b.avgAmount,
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

/**
 * POST /api/memory/learn
 * Body: {
 *   proposed:   { type, amount?, ... },   // what the AI suggested
 *   confirmed:  { type, amount?, ... },   // what the user actually did
 * }
 * Infers a trait from the diff.
 */
memoryRouter.post('/learn', async (req, res, next) => {
  try {
    const { proposed, confirmed } = req.body || {}
    if (!proposed || !confirmed) {
      return res.status(400).json({ error: 'proposed and confirmed are required' })
    }
    const traits = []
    const uid = USER()

    // Amount correction — did the user change the proposed amount significantly?
    if (proposed.amount != null && confirmed.amount != null) {
      const p = Number(proposed.amount), c = Number(confirmed.amount)
      if (p > 0 && Math.abs(c - p) / p > 0.15) {
        const direction = c < p ? 'smaller_than_suggested' : 'larger_than_suggested'
        const key = `amount_pref_${proposed.type?.toLowerCase() || 'action'}`
        await upsertTrait(uid, key, direction, 0.12)
        traits.push({ key, value: direction })
      }
    }

    // Type correction — user declined a card-freeze suggestion?
    if (proposed.type && confirmed.type && proposed.type !== confirmed.type) {
      const key = `prefers_over_${proposed.type.toLowerCase()}`
      await upsertTrait(uid, key, confirmed.type, 0.10)
      traits.push({ key, value: confirmed.type })
    }

    res.json({ ok: true, learnt: traits })
  } catch (err) { next(err) }
})

/**
 * GET /api/memory/conversations?limit=10
 */
memoryRouter.get('/conversations', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 50)
    const rows = await getRecentConversations(USER(), limit)
    res.json({ ok: true, conversations: rows })
  } catch (err) { next(err) }
})

/**
 * GET /api/memory/stats — for the observability / demo panel.
 */
memoryRouter.get('/stats', async (req, res, next) => {
  try {
    const [memory, cache] = await Promise.all([
      getMemoryStats(USER()),
      Promise.resolve(getCacheStats()),
    ])
    res.json({ ok: true, memory, cache })
  } catch (err) { next(err) }
})

/**
 * POST /api/memory/cache/prune — GC expired cache rows (scheduled or manual).
 */
memoryRouter.post('/cache/prune', async (req, res, next) => {
  try {
    const removed = await pruneExpired()
    res.json({ ok: true, removed })
  } catch (err) { next(err) }
})
