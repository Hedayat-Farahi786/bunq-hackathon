/**
 * AI Provider Registry
 * Selects and routes to the correct AI backend based on:
 *  1. Explicit `provider` field in request body
 *  2. DEFAULT_AI_PROVIDER env var
 *  3. Auto-detection: first available provider
 */

import { callClaude,  isClaudeAvailable, MODEL_VISION as CLAUDE_VISION_MODEL } from './claude.js'
import { callGemini,  isGeminiAvailable  } from './gemini.js'
import { callOllama,  isOllamaAvailable, getOllamaModels } from './ollama.js'
import { SYSTEM_PROMPT } from '../prompts/financial.js'
import { IDENTIFY_SYSTEM_PROMPT } from '../prompts/identify.js'
import { RECEIPTS_SYSTEM_PROMPT } from '../prompts/receipts.js'

export const PROVIDERS = {
  claude: { call: callClaude, check: isClaudeAvailable, label: 'Claude (Anthropic)' },
  gemini: { call: callGemini, check: isGeminiAvailable, label: 'Gemini Flash (Google)' },
  ollama: { call: callOllama, check: isOllamaAvailable, label: 'Ollama (Local)' },
}

/**
 * Main dispatch function.
 * @param {object} params
 * @param {string} [params.provider] - 'claude' | 'gemini' | 'ollama' | 'auto'
 * @param {string} params.userMessage
 * @param {string|null} [params.imageBase64]
 * @returns {Promise<object>} Structured AI response
 */
export async function dispatchAI({ provider, userMessage, imageBase64, priorTurns = [] }) {
  const requested = provider || process.env.DEFAULT_AI_PROVIDER || 'claude'

  if (requested === 'auto') {
    return autoDispatch({ userMessage, imageBase64, priorTurns })
  }

  const p = PROVIDERS[requested]
  if (!p) {
    throw Object.assign(new Error(`Unknown provider: ${requested}`), { status: 400 })
  }

  try {
    const raw = await p.call({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      imageBase64: imageBase64 || null,
      priorTurns,
    })
    return normaliseFinancial(raw)
  } catch (err) {
    // On overload/unavailable, try the next available provider rather than failing hard
    if (err.retryable || err.status === 503 || err.status === 429) {
      console.warn(`[AI] ${requested} overloaded (${err.status}), falling back to auto-dispatch`)
      return autoDispatch({ userMessage, imageBase64: imageBase64 || null, priorTurns }, requested)
    }
    throw err
  }
}

function normaliseFinancial(raw) {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return {
      scene: { type: 'UNKNOWN', description: 'Could not parse response', confidence: 0.3 },
      status: { level: 'good', message: '' },
      risk:  { level: 'LOW', reason: '' },
      overlayHints: [],
      recommendedActions: [],
      voiceResponse: '',
      insight: '',
    }
  }
  return raw
}

async function autoDispatch(params, skipProvider = null) {
  const order = ['claude', 'gemini', 'ollama']
  for (const name of order) {
    if (name === skipProvider) continue
    const available = await PROVIDERS[name].check()
    if (!available) continue
    try {
      const raw = await PROVIDERS[name].call({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: params.userMessage,
        imageBase64: params.imageBase64 || null,
        priorTurns:  params.priorTurns || [],
      })
      return normaliseFinancial(raw)
    } catch (err) {
      // On overload, try next provider
      if (err.retryable || err.status === 503 || err.status === 429) {
        console.warn(`[AI] ${name} overloaded during auto-dispatch, trying next`)
        continue
      }
      throw err
    }
  }
  // All providers unavailable — return mock so the app still demos
  return getMockResponse(params.userMessage)
}

/**
 * Object-identification dispatch — uses a different system prompt that
 * asks the vision model to locate one purchasable product and estimate
 * its price. Prefers Claude (best vision), falls back to Gemini, then mock.
 */
export async function dispatchIdentify({ provider, userMessage, imageBase64 }) {
  if (!imageBase64) {
    throw Object.assign(new Error('imageBase64 is required for object identification'), { status: 400 })
  }

  const systemPrompt = IDENTIFY_SYSTEM_PROMPT
  const order = provider && provider !== 'auto'
    ? [provider, ...['gemini', 'claude'].filter(p => p !== provider)]
    : ['gemini', 'claude']

  for (const name of order) {
    const p = PROVIDERS[name]
    if (!p) continue
    const available = await p.check()
    if (!available) continue
    try {
      // Identify is vision-only product recognition — Haiku 4.5 is plenty.
      // Other providers ignore the `model` arg entirely.
      const callArgs = { systemPrompt, userMessage, imageBase64 }
      if (name === 'claude') callArgs.model = CLAUDE_VISION_MODEL
      const result = await p.call(callArgs)
      console.log(`[Identify:${name}] raw response:`, JSON.stringify(result).slice(0, 500))
      const normalised = normaliseIdentify(result)
      console.log(`[Identify:${name}] ${normalised.products.length} product(s) after normalisation`)
      return normalised
    } catch (err) {
      // Try the next provider on transient errors AND auth errors (bad key)
      const s = err.status
      const isAuth = s === 401 || s === 403
      const isOverload = err.retryable || s === 503 || s === 429
      if (isAuth || isOverload) {
        console.warn(`[Identify] ${name} failed (${s}) — ${err.message?.slice(0, 120)} — trying next provider`)
        continue
      }
      throw err
    }
  }

  // Mock fallback so the demo still works without keys
  return {
    products: [],
    sceneNote: 'No AI provider available — add an Anthropic or Gemini key in server/.env.',
  }
}

function normaliseIdentify(raw) {
  const empty = { products: [], sceneNote: 'No products detected.' }
  if (!raw || typeof raw !== 'object') return empty

  const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Number(n) || 0))

  // Accept either the new {products: [...]} shape or the legacy single-product shape
  let list = []
  if (Array.isArray(raw.products)) {
    list = raw.products
  } else if (raw.found && raw.name) {
    list = [raw]
  }

  const products = list
    .map(p => {
      if (!p || typeof p !== 'object') return null
      const b = p.bbox || {}
      const name = p.name || p.productName || null
      if (!name) return null
      const priceEst = Number(p.priceEstimate ?? p.price ?? 0) || 0
      const lo = Number(p.priceLow) || priceEst
      const hi = Number(p.priceHigh) || priceEst
      const bbox = {
        x: clamp(b.x),
        y: clamp(b.y),
        w: clamp(b.w, 1, 100),
        h: clamp(b.h, 1, 100),
      }
      // Normalise polygon — fall back to bbox corners if missing/malformed
      let polygon = null
      if (Array.isArray(p.polygon) && p.polygon.length >= 3) {
        const pts = p.polygon
          .map(pt => ({ x: clamp(pt?.x), y: clamp(pt?.y) }))
          .filter(pt => pt.x > 0 || pt.y > 0)
        if (pts.length >= 3) polygon = pts
      }
      if (!polygon) {
        polygon = [
          { x: bbox.x,          y: bbox.y },
          { x: bbox.x + bbox.w, y: bbox.y },
          { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
          { x: bbox.x,          y: bbox.y + bbox.h },
        ]
      }
      return {
        name,
        brand:    p.brand || null,
        category: p.category || 'Other',
        priceEstimate: priceEst,
        priceLow:  Math.min(lo, hi),
        priceHigh: Math.max(lo, hi),
        currency:  p.currency || 'EUR',
        confidence: Number(p.confidence) || 0.5,
        bbox,
        polygon,
        details: Array.isArray(p.details) ? p.details.slice(0, 4).map(String) : [],
      }
    })
    .filter(Boolean)
    .slice(0, 3)

  return {
    products,
    sceneNote: raw.sceneNote || raw.reasoning || (products.length ? '' : 'No products detected.'),
  }
}

/**
 * Receipts dispatch — multimodal call that returns a structured array of
 * receipts in the frame. One AI call total, regardless of how many receipts
 * are in the picture. Falls back across providers, then to a local mock.
 */
export async function dispatchReceipts({ provider, imageBase64, voiceText }) {
  if (!imageBase64) {
    throw Object.assign(new Error('imageBase64 is required for receipts'), { status: 400 })
  }

  const userMessage = voiceText && voiceText.trim()
    ? `Voice context: "${voiceText.trim()}". Read every visible receipt in this image and return the JSON schema from the system prompt.`
    : 'Read every visible receipt in this image and return the JSON schema from the system prompt.'

  const order = provider && provider !== 'auto'
    ? [provider, ...['claude', 'gemini'].filter(p => p !== provider)]
    : ['claude', 'gemini']

  for (const name of order) {
    const p = PROVIDERS[name]
    if (!p) continue
    const available = await p.check()
    if (!available) continue
    try {
      const callArgs = { systemPrompt: RECEIPTS_SYSTEM_PROMPT, userMessage, imageBase64 }
      if (name === 'claude') callArgs.model = CLAUDE_VISION_MODEL
      const raw = await p.call(callArgs)
      return normaliseReceipts(raw)
    } catch (err) {
      const isAuth = err.status === 401 || err.status === 403
      const isOverload = err.retryable || err.status === 503 || err.status === 429
      if (isAuth || isOverload) {
        console.warn(`[Receipts] ${name} failed (${err.status}) — trying next`)
        continue
      }
      throw err
    }
  }

  return getMockReceiptsResponse()
}

function normaliseReceipts(raw) {
  const empty = { receipts: [], totalAcross: 0, voiceResponse: 'No receipts detected.', insight: '' }
  if (!raw || typeof raw !== 'object') return empty

  const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(n) || 0))
  const toNum = (n) => {
    const v = Number(n)
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
  }

  const list = Array.isArray(raw.receipts) ? raw.receipts : []
  const receipts = list
    .map((r, i) => {
      if (!r || typeof r !== 'object') return null
      const total = toNum(r.total)
      if (!total || total <= 0) return null
      const b = r.bbox || {}
      const items = Array.isArray(r.items)
        ? r.items
            .map(it => ({
              name:  String(it?.name || '').slice(0, 60),
              price: toNum(it?.price),
              qty:   Math.max(1, Number(it?.qty) || 1),
            }))
            .filter(it => it.name)
            .slice(0, 25)
        : []
      const splitRaw = r.splitSuggestion
      const splitSuggestion = (splitRaw && Number(splitRaw.numPeople) >= 2)
        ? {
            numPeople: Math.min(20, Math.max(2, Math.round(Number(splitRaw.numPeople)))),
            perPerson: toNum(splitRaw.perPerson) || toNum(total / Math.round(Number(splitRaw.numPeople))),
          }
        : null
      return {
        id:       `rcpt_${Date.now().toString(36)}_${i}`,
        merchant: String(r.merchant || 'Receipt').slice(0, 80),
        total,
        currency: (r.currency || 'EUR').toUpperCase().slice(0, 3),
        date:     r.date || null,
        items,
        category: ['Dining','Groceries','Transport','Shopping','Entertainment','Health','Travel','Bills','Other'].includes(r.category) ? r.category : 'Other',
        splitSuggestion,
        confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.7)),
        bbox: {
          x: clamp(b.x),
          y: clamp(b.y),
          w: clamp(b.w, 1, 100),
          h: clamp(b.h, 1, 100),
        },
      }
    })
    .filter(Boolean)
    .slice(0, 8)

  const totalAcross = receipts.reduce((s, r) => s + r.total, 0)
  const voiceResponse = String(raw.voiceResponse || '').slice(0, 240) ||
    (receipts.length === 0
      ? "I'm not seeing a receipt — try filling the frame with it."
      : receipts.length === 1
        ? `€${receipts[0].total.toFixed(2)} from ${receipts[0].merchant}.`
        : `${receipts.length} receipts — €${totalAcross.toFixed(2)} total.`)

  return {
    receipts,
    totalAcross: Math.round(totalAcross * 100) / 100,
    voiceResponse,
    insight: String(raw.insight || '').slice(0, 240),
  }
}

function getMockReceiptsResponse() {
  return {
    receipts: [
      {
        id:       'rcpt_mock_0',
        merchant: 'Loetje',
        total:    47.80,
        currency: 'EUR',
        date:     null,
        items:    [
          { name: 'Bitterballen', price: 7.50, qty: 1 },
          { name: 'Steak',        price: 24.00, qty: 1 },
          { name: 'Drinks',       price: 16.30, qty: 1 },
        ],
        category: 'Dining',
        splitSuggestion: { numPeople: 3, perPerson: 15.93 },
        confidence: 0.85,
        bbox:     { x: 10, y: 5, w: 80, h: 88 },
      },
    ],
    totalAcross: 47.80,
    voiceResponse: 'Demo mode: €47.80 from Loetje. Want to split — about €16 each?',
    insight: 'Add an Anthropic key to enable real receipt analysis.',
  }
}

export async function getProviderStatus() {
  const [claudeOk, geminiOk, ollamaOk] = await Promise.all([
    isClaudeAvailable(),
    isGeminiAvailable(),
    isOllamaAvailable(),
  ])

  const ollamaModels = ollamaOk ? await getOllamaModels() : []

  return {
    claude: {
      available:   claudeOk,
      label:       'Claude (Anthropic)',
      model:       'claude-sonnet-4-6',          // /analyse — reasoning + judgment
      visionModel: 'claude-haiku-4-5',           // /identify — vision-only
      configured:  claudeOk,
    },
    gemini: {
      available:   geminiOk,
      label:       'Gemini Flash (Google)',
      model:       'gemini-2.5-flash-lite',
      configured:  geminiOk,
    },
    ollama: {
      available:   ollamaOk,
      label:       'Ollama (Local)',
      model:       process.env.OLLAMA_MODEL || 'llama3.2',
      url:         process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      models:      ollamaModels,
      configured:  true, // no key needed
    },
    default: process.env.DEFAULT_AI_PROVIDER || 'claude',
  }
}

// Fallback mock when no provider is configured (allows demo without any keys)
function getMockResponse(userMessage = '') {
  const lower = userMessage.toLowerCase()
  if (lower.includes('receipt') || lower.includes('split')) {
    return {
      scene: { type: 'RECEIPT', description: 'Receipt detected — €127.40 for 4 people', confidence: 0.9 },
      risk: { level: 'LOW', reason: 'Normal dining — splitting is smart' },
      overlayHints: [
        { label: 'Total', value: '€127.40', type: 'info', x: 50, y: 30 },
        { label: 'Per person', value: '€31.85', type: 'protect', x: 50, y: 55 },
      ],
      recommendedActions: [{ type: 'PAYMENT_REQUEST', label: 'Split €127.40 (4 people)', urgency: 'MEDIUM', params: { amount: 127.40, perPerson: 31.85, description: 'Dinner split' } }],
      voiceResponse: 'Demo mode: I see a receipt for €127.40. That\'s €31.85 per person. Connect an AI provider to get real analysis.',
      insight: 'Add your API key in Settings to enable real AI analysis.',
    }
  }
  if (lower.includes('shop') || lower.includes('buy') || lower.includes('expensive')) {
    return {
      scene: { type: 'SHOPPING', description: 'Shopping scenario detected', confidence: 0.8 },
      risk: { level: 'HIGH', reason: 'Demo: potential impulse purchase detected' },
      overlayHints: [
        { label: 'Budget alert', value: '+34%', type: 'warning', x: 35, y: 30 },
        { label: 'Goal impact', value: '-9 days', type: 'warning', x: 65, y: 45 },
      ],
      recommendedActions: [
        { type: 'BLOCK_CARD', label: 'Block card temporarily', urgency: 'HIGH', params: { accountId: 'acc_001' } },
        { type: 'SAVINGS_BOOST', label: 'Move €47 to Japan fund', urgency: 'MEDIUM', params: { fromAccount: 'acc_001', toAccount: 'acc_004', amount: 47, goalId: 'goal_001', goalLabel: 'Trip to Japan' } },
      ],
      voiceResponse: 'Demo mode: High-risk shopping detected. Connect an AI provider for real financial intelligence.',
      insight: 'Add your API key in Settings to enable real AI analysis.',
    }
  }
  return {
    scene: { type: 'UNKNOWN', description: 'Demo mode — no AI provider connected', confidence: 0.1 },
    risk: { level: 'LOW', reason: 'No analysis performed' },
    overlayHints: [{ label: 'Demo mode', value: 'Add API key', type: 'info', x: 50, y: 20 }],
    recommendedActions: [],
    voiceResponse: 'I\'m running in demo mode. Go to Settings and add your Anthropic, Gemini, or start Ollama to enable real AI.',
    insight: 'Connect an AI provider in Settings to unlock full Aether intelligence.',
  }
}
