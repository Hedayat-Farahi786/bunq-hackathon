import { Router } from 'express'
import { Agent as UndiciAgent } from 'undici'
import { dispatchAI, dispatchIdentify, dispatchReceipts, getProviderStatus } from '../providers/index.js'
import {
  buildCacheKey, cacheLookup, cacheWrite, runWithDedup, shouldCacheResponse,
} from '../services/cache.js'
import { recordConversation, buildMemoryBlock, getSessionTurns } from '../services/memory.js'
import { buildJudgment, judgmentToPromptBlock } from '../services/affordability.js'

export const aiRouter = Router()

const DEFAULT_USER = () => process.env.BUNQ_USER_ID || 'single-user'

// Undici keep-alive dispatcher for ElevenLabs.
//
// Node's global `fetch` is powered by undici; passing an `Agent` via the
// `dispatcher` option actually reuses the TCP+TLS connection across requests.
// (The old `https.Agent` was ignored by fetch — dead code.)
const elevenDispatcher = new UndiciAgent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 4,
  pipelining: 1,
})

// Verify ElevenLabs key on startup with a tiny TTS call.
let _elevenLabsVerified = false
if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
  const voice = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
  fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_22050_32`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '.', model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5' }),
  }).then(r => {
    _elevenLabsVerified = r.ok
    if (r.ok) console.log('[TTS] ElevenLabs verified ✓')
    else r.text().then(t => console.warn(`[TTS] ElevenLabs failed (${r.status}):`, t.slice(0, 100)))
  }).catch(e => { console.warn('[TTS] ElevenLabs verify error:', e.message); _elevenLabsVerified = false })
}

/**
 * POST /api/ai/analyse
 * Body: { provider?, userMessage, imageBase64?, financialContext? }
 */
aiRouter.post('/analyse', async (req, res, next) => {
  try {
    const { provider, userMessage, imageBase64, financialContext, sessionId } = req.body

    if (!userMessage && !imageBase64) {
      return res.status(400).json({ error: 'Either userMessage or imageBase64 is required' })
    }

    const effectiveProvider = provider || (imageBase64 ? 'claude' : 'gemini')
    const userId = DEFAULT_USER()
    const sid    = (typeof sessionId === 'string' && sessionId.trim()) ? sessionId.trim().slice(0, 64) : null
    const t0 = Date.now()

    // ── 0. Compute the deterministic financial judgment FIRST so it is
    //      injected into the prompt and also returned with the response.
    //      This is what stops Claude from inventing safe-to-spend numbers.
    const judgment = buildJudgment({
      financialContext,
      voiceText: userMessage,
      intent: financialContext?.intent,
    })

    // ── 1. Cache lookup (scoped to session so replies don't leak across tabs) ─
    //      Include the judgment verdict + requestedAmount in the key so the
    //      same voice text against different account state still re-runs.
    const cacheKey = buildCacheKey({
      provider: effectiveProvider, userId, userMessage, imageBase64, financialContext,
      sessionId: sid,
      judgmentSig: `${judgment.verdict}|${judgment.requestedAmount ?? 'none'}|${judgment.safeToSpend}`,
    })
    const cached = await cacheLookup(cacheKey)
    if (cached.hit) {
      recordConversation({
        userId, sessionId: sid, userMessage,
        emotionalTone: financialContext?.emotionalTone,
        intent: financialContext?.intent,
        result: cached.response,
        provider: effectiveProvider,
        latencyMs: Date.now() - t0,
        cacheHit: true,
      }).catch(err => {
        if (process.env.DEBUG_MEMORY) console.warn('[memory] cached conversation log failed:', err.message)
      })
      return res.json({
        ok: true,
        provider: effectiveProvider,
        cached: cached.tier,
        latencyMs: Date.now() - t0,
        result: { ...cached.response, judgment },
      })
    }

    // ── 2. Load prior turns for this session + long-term memory block ──
    //
    //   priorTurns → threaded into the provider's `messages` array (real
    //                multi-turn). Lets the user say "what about last week?"
    //                and have Aether understand the referent.
    //   memoryBlock → summaries of older conversations, learned traits, and
    //                merchant overrides. Injected as text in the enriched
    //                user message; covers stuff outside the current session.
    const priorTurns = await getSessionTurns(userId, sid, 12).catch(() => [])
    const memoryBlock = await buildMemoryBlock(
      userId, financialContext,
      { skipRecentConversations: priorTurns.length > 0 },
    ).catch(() => '')
    const judgmentBlock = judgmentToPromptBlock(judgment)
    const enrichedMessage = buildEnrichedMessage(
      userMessage, financialContext, memoryBlock, priorTurns.length, judgmentBlock,
    )

    // ── 3. Stampede-protected upstream call ─────────────────
    const result = await runWithDedup(cacheKey, () => dispatchAI({
      provider:    provider || undefined,
      userMessage: enrichedMessage,
      imageBase64: imageBase64 || null,
      priorTurns,
    }))

    const latencyMs = Date.now() - t0

    // ── 4. Cache-write (only for safe-to-replay responses) ──
    if (shouldCacheResponse(result)) {
      cacheWrite(cacheKey, userId, result, { provider: effectiveProvider }).catch(() => {})
    }

    // ── 5. Persist conversation (fire-and-forget) ───────────
    recordConversation({
      userId, sessionId: sid, userMessage,
      emotionalTone: financialContext?.emotionalTone,
      intent: financialContext?.intent,
      result,
      provider: effectiveProvider,
      latencyMs,
      cacheHit: false,
    }).catch(err => {
      if (process.env.DEBUG_MEMORY) console.warn('[memory] conversation log failed:', err.message)
    })

    res.json({
      ok: true,
      provider: effectiveProvider,
      cached: false,
      latencyMs,
      result: { ...result, judgment },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/ai/identify
 * Identify one purchasable product in an image + estimate its price.
 * Body: { provider?, imageBase64, hint? }
 */
aiRouter.post('/identify', async (req, res, next) => {
  try {
    const { provider, imageBase64, hint } = req.body

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' })
    }

    const userMessage = hint
      ? `Look at this image and list the products you see. Extra hint: "${hint}". Respond with the JSON schema from the system prompt.`
      : 'Look at this image and list up to 3 products you see. For each, give a name, category, EU retail price, and bounding box. Respond with the JSON schema from the system prompt.'

    const result = await dispatchIdentify({
      provider:    provider || undefined,
      userMessage,
      imageBase64,
    })

    res.json({ ok: true, result })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/ai/receipts
 * Multi-receipt analysis. ONE multimodal call.
 * Body: { provider?, imageBase64, voiceText? }
 * Returns: { receipts: [...], totalAcross, voiceResponse, insight }
 */
aiRouter.post('/receipts', async (req, res, next) => {
  try {
    const { provider, imageBase64, voiceText } = req.body || {}
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' })

    const t0 = Date.now()
    const result = await dispatchReceipts({
      provider: provider || undefined,
      imageBase64,
      voiceText: voiceText || '',
    })
    res.json({ ok: true, latencyMs: Date.now() - t0, result })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/ai/providers
 */
aiRouter.get('/providers', async (req, res, next) => {
  try {
    const status = await getProviderStatus()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/ai/speak
 * Converts text to speech with the lowest possible first-audio latency.
 *
 * Priority: ElevenLabs streaming (MP3) → Gemini TTS (full WAV). The ElevenLabs
 * stream endpoint returns audio chunks as they're generated, so the browser can
 * start playback within ~300ms instead of waiting for the full reply.
 *
 * Body: { text: string, voiceId?: string }
 */
aiRouter.post('/speak', async (req, res, next) => {
  try {
    const { text, voiceId } = req.body
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' })
    }

    // ── 1. ElevenLabs (preferred) ──────────────────────────────
    const elevenKey = process.env.ELEVENLABS_API_KEY
    if (elevenKey && elevenKey.trim() && !elevenKey.startsWith('sk_REPLACE')) {
      const voice  = voiceId || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMAL'
      const model  = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5'
      // MP3 at 22050Hz / 32kbps — small (= less to download) and decodes
      // in every browser without WebAudio juggling. ElevenLabs' streaming
      // endpoint emits frame-by-frame so the audio element can start playing
      // long before the file completes.
      const output = 'mp3_22050_32'
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream` +
                  `?optimize_streaming_latency=4&output_format=${output}`

      try {
        const t0 = Date.now()
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key':    elevenKey,
            'Content-Type':  'application/json',
            // Identity encoding — gzip would buffer frames and block streaming.
            'Accept-Encoding': 'identity',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability:         0.50,
              similarity_boost:  0.75,
              style:             0.45,
              use_speaker_boost: true,
            },
            // 'off' skips the text-normalisation pass entirely — the single
            // biggest latency reducer after latency=4. We normalise client-side.
            apply_text_normalization: 'off',
          }),
          signal: AbortSignal.timeout(20_000),
        })

        if (r.ok && r.body) {
          res.set('Content-Type', 'audio/mpeg')
          res.set('Cache-Control', 'no-store')
          res.set('X-Accel-Buffering', 'no')      // disable nginx buffering if present
          res.set('Transfer-Encoding', 'chunked')
          res.flushHeaders()                       // send headers NOW, don't wait for first body chunk
          const ttfb = Date.now() - t0
          console.log(`[TTS] EL TTFB: ${ttfb}ms (${output}, ${text.length}c)`)

          // Pump chunks manually instead of using Readable.fromWeb().pipe(res).
          // .pipe() wraps the web stream in a Node Readable with a 16kB buffer
          // that can delay small MP3 frames by hundreds of ms. Manual pump
          // writes each chunk to `res` the instant it arrives from undici,
          // which is what we want for low-latency streaming audio.
          ;(async () => {
            const reader = r.body.getReader()
            let firstChunkAt = null
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (!firstChunkAt) {
                  firstChunkAt = Date.now()
                  console.log(`[TTS] EL first-chunk: ${firstChunkAt - t0}ms`)
                }
                // Backpressure-aware write.
                if (!res.write(value)) {
                  await new Promise(resolve => res.once('drain', resolve))
                }
              }
            } catch (err) {
              console.warn('[TTS] stream error:', err.message)
            } finally {
              try { res.end() } catch {}
            }
          })()
          return
        }
        const errText = await r.text().catch(() => '')
        console.warn(`[TTS] ElevenLabs ${r.status}: ${errText.slice(0, 200)} — falling back to Gemini`)
      } catch (err) {
        console.warn('[TTS] ElevenLabs request failed, falling back:', err.message)
      }
    }

    // ── 2. Gemini TTS (fallback) ───────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey || geminiKey.startsWith('AIza_REPLACE')) {
      return res.status(503).json({ error: 'No TTS provider configured (set ELEVENLABS_API_KEY or GEMINI_API_KEY).' })
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            },
          },
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('[TTS] Gemini error:', err)
      return res.status(response.status).json({ error: 'TTS failed' })
    }

    const data = await response.json()
    const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (!b64) return res.status(500).json({ error: 'No audio in response' })

    const audio = Buffer.from(b64, 'base64')
    res.set('Content-Type', 'audio/wav')
    res.set('Content-Length', audio.length)
    res.send(audio)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/ai/tts-status — lets the frontend know which engine is live
 * without having to fire a real TTS request.
 */
aiRouter.get('/tts-status', (req, res) => {
  const el = process.env.ELEVENLABS_API_KEY
  const ge = process.env.GEMINI_API_KEY
  res.json({
    elevenlabs: _elevenLabsVerified,
    gemini:     !!(ge && !ge.startsWith('AIza_REPLACE')),
    voiceId:    process.env.ELEVENLABS_VOICE_ID || null,
    modelId:    process.env.ELEVENLABS_MODEL_ID || null,
  })
})

/**
 * POST /api/ai/transcribe — server-side audio transcription via Gemini.
 * Body: { audioBase64: string, mimeType?: string }
 */
aiRouter.post('/transcribe', async (req, res) => {
  const { audioBase64, mimeType, text } = req.body
  // Legacy passthrough
  if (!audioBase64) return res.json({ ok: true, text: text || '', source: 'passthrough' })

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) return res.status(503).json({ error: 'No AI provider for transcription' })

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: mimeType || 'audio/webm', data: audioBase64 } },
              { text: 'Transcribe this audio exactly. Return ONLY the spoken text, nothing else.' }
            ]
          }],
          generationConfig: { maxOutputTokens: 256, temperature: 0 }
        }),
        signal: AbortSignal.timeout(10_000),
      }
    )
    const data = await r.json()
    const transcribed = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
    res.json({ ok: true, text: transcribed, source: 'gemini' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────
// Context builder — turns financial state into rich AI context
// ─────────────────────────────────────────────────────────────

function buildEnrichedMessage(voiceText, ctx, memoryBlock = '', priorTurnsCount = 0, judgmentBlock = '') {
  if (!ctx) return voiceText || 'Analyse the current scene.'

  const lines = []

  // ── Persistent memory (conversations, traits, merchant overrides) ──
  if (memoryBlock && memoryBlock.trim()) {
    lines.push(memoryBlock.trim())
    lines.push('')
  }

  // ── Authoritative financial judgment (deterministic, server-computed) ──
  // Goes near the top so Claude reads it BEFORE inventing affordability claims.
  if (judgmentBlock && judgmentBlock.trim()) {
    lines.push(judgmentBlock.trim())
    lines.push('')
  }

  // ── Intent hint (the client's best guess at what the user wants) ──
  if (ctx.intent) {
    lines.push(`INTENT: ${ctx.intent}`)
    if (ctx.intent === 'IDENTIFY_FOLLOWUP' && ctx.identifiedProduct) {
      const p = ctx.identifiedProduct
      lines.push('VISION PIPELINE ALREADY IDENTIFIED:')
      lines.push(`  Product: ${[p.brand, p.name].filter(Boolean).join(' ') || p.name}`)
      lines.push(`  Category: ${p.category || 'Other'}`)
      lines.push(`  Price estimate: €${p.priceEstimate}${p.priceLow && p.priceHigh ? ` (range €${p.priceLow}–€${p.priceHigh})` : ''}`)
      lines.push('Use THIS product. Do not re-describe the image.')
    }
    lines.push('')
  }

  // ── Voice / intent ──────────────────────────────────────────
  if (voiceText) {
    const tone = ctx.emotionalTone || 'neutral'
    lines.push(`USER REQUEST (emotional tone: ${tone}):`)
    lines.push(`"${voiceText}"`)
    lines.push('')
  } else {
    lines.push('No voice input — perform a proactive camera scene analysis.')
    lines.push('')
  }

  // ── Identity ────────────────────────────────────────────────
  lines.push('═══ USER FINANCIAL PROFILE ═══')
  if (ctx.user?.name) lines.push(`Name: ${ctx.user.name}`)
  if (ctx.totalBalance != null) {
    lines.push(`Total balance: €${Number(ctx.totalBalance).toFixed(2)}`)
  }
  if (ctx.cardBlocked) lines.push('⚠️  Card status: FROZEN (temporarily blocked)')

  // ── Accounts ────────────────────────────────────────────────
  if (ctx.accounts?.length) {
    lines.push('')
    lines.push('Accounts:')
    ctx.accounts.forEach(a => {
      lines.push(`  • ${a.label}: €${Number(a.balance).toFixed(2)} (${a.currency || 'EUR'})`)
    })
  }

  // ── Goals ───────────────────────────────────────────────────
  if (ctx.goals?.length) {
    lines.push('')
    lines.push('Savings goals:')
    ctx.goals.forEach(g => {
      const pct = Math.round((g.current / g.target) * 100)
      const remaining = (g.target - g.current).toFixed(2)
      lines.push(`  • ${g.icon || ''} ${g.name}: €${g.current} / €${g.target} (${pct}% — €${remaining} to go)`)
      if (g.deadline) lines.push(`    Deadline: ${g.deadline}`)
    })
  }

  // ── Spending patterns ───────────────────────────────────────
  if (ctx.spendingPatterns) {
    const sp = ctx.spendingPatterns
    lines.push('')
    lines.push('Spending patterns:')
    if (sp.weekly) {
      const wTrend = sp.weekly.trend > 0 ? `↑ ${sp.weekly.trend}% above avg` : sp.weekly.trend < 0 ? `↓ ${Math.abs(sp.weekly.trend)}% below avg` : 'on track'
      lines.push(`  This week: €${sp.weekly.current} (avg €${sp.weekly.avg}/week — ${wTrend})`)
    }
    if (sp.monthly) {
      const mTrend = sp.monthly.trend > 0 ? `↑ ${sp.monthly.trend}% above avg` : sp.monthly.trend < 0 ? `↓ ${Math.abs(sp.monthly.trend)}% below avg` : 'on track'
      lines.push(`  This month: €${sp.monthly.current} (avg €${sp.monthly.avg}/month — ${mTrend})`)
    }
    if (sp.categories?.length) {
      lines.push('  Category breakdown:')
      sp.categories.slice(0, 6).forEach(c => {
        lines.push(`    - ${c.name}: €${c.amount} (${c.pct}% of total)`)
      })
    }
  }

  // ── Recent transactions ─────────────────────────────────────
  if (ctx.transactions?.length) {
    lines.push('')
    lines.push('Recent transactions (last 10):')
    ctx.transactions.slice(0, 10).forEach(tx => {
      const sign = tx.amount > 0 ? '+' : ''
      const date = new Date(tx.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      lines.push(`  ${date}  ${tx.merchant || tx.description || 'Payment'}  ${sign}€${Math.abs(tx.amount).toFixed(2)}`)
    })
  }

  lines.push('')
  lines.push('═══ END PROFILE ═══')
  lines.push('')
  lines.push('Now analyse the camera scene and/or voice request above.')
  lines.push('Produce the JSON response as specified. Be specific with amounts — use the actual numbers from this profile.')

  return lines.join('\n')
}
