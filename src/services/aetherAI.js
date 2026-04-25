/**
 * Aether AI Service — Frontend Layer
 *
 * This module calls the secure Express backend at /api/ai/*.
 * NO API keys live here — they stay in server/.env and never reach the browser.
 *
 * Supported providers (configured server-side):
 *   claude  — Anthropic claude-sonnet-4-6 (best quality + vision)
 *   gemini  — Google gemini-2.0-flash-lite (cheapest, vision capable)
 *   ollama  — Local Ollama instance (free, privacy-first, optional vision)
 *   auto    — Backend tries claude → gemini → ollama → mock
 */

import { apiClient } from './apiClient.js'

// Which provider the user has selected in Settings UI
// Falls back to whatever DEFAULT_AI_PROVIDER is set on the backend
let selectedProvider = localStorage.getItem('aether_provider') || 'auto'

// ── Session identity ──────────────────────────────────────
// A session groups consecutive turns the user treats as "one conversation".
// The server replays turns with the same sessionId as a real messages[]
// history so Aether can handle references like "what about last week?"
// without losing context between requests.
//
// Stored in sessionStorage (per-tab, cleared on tab close). The user can
// start a fresh thread by calling aetherAI.newSession().
const SESSION_KEY = 'aether_session_id'
function loadSession() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const fresh = (crypto?.randomUUID?.() ||
                   `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
    sessionStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    return `sess_${Date.now()}`
  }
}
let sessionId = typeof window !== 'undefined' ? loadSession() : null

export const aetherAI = {

  // ── Provider management ────────────────────────────────────

  getSelectedProvider: () => selectedProvider,

  setProvider: (provider) => {
    selectedProvider = provider
    localStorage.setItem('aether_provider', provider)
  },

  // ── Session management ────────────────────────────────────

  getSessionId: () => sessionId,

  /** Start a fresh conversation thread — next request begins a new session. */
  newSession: () => {
    sessionId = (crypto?.randomUUID?.() ||
                 `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
    try { sessionStorage.setItem(SESSION_KEY, sessionId) } catch {}
    return sessionId
  },

  /** Fetch live status of all configured providers from backend */
  getProviderStatus: () => apiClient.get('/ai/providers'),

  // ── Core AI analysis ───────────────────────────────────────

  /**
   * Analyse a camera frame + voice input against financial context.
   * All heavy lifting happens on the backend.
   */
  analyzeScene: async ({ imageBase64, voiceText, financialContext }) => {
    try {
      const { result } = await apiClient.post('/ai/analyse', {
        provider:         selectedProvider === 'auto' ? undefined : selectedProvider,
        userMessage:      voiceText || 'Analyse the current scene.',
        imageBase64:      imageBase64 || null,
        financialContext: financialContext || null,
        sessionId,
      })
      return result
    } catch (err) {
      console.warn('[Aether AI] Backend unavailable, using local fallback:', err.message)
      return localFallback(voiceText)
    }
  },

  /**
   * Analyse an image that may contain ONE OR MORE receipts. Single multimodal
   * call. Returns { receipts: [...], totalAcross, voiceResponse, insight }.
   *
   * Each receipt entry has: { id, merchant, total, currency, date, items[],
   * category, splitSuggestion?, confidence, bbox } — the bbox lets us crop
   * the right image slice when uploading the per-receipt attachment.
   */
  analyzeReceipts: async ({ imageBase64, voiceText }) => {
    if (!imageBase64) throw new Error('imageBase64 required')
    try {
      const { result } = await apiClient.post('/ai/receipts', {
        provider:    selectedProvider === 'auto' ? undefined : selectedProvider,
        imageBase64,
        voiceText:   voiceText || '',
      })
      return result
    } catch (err) {
      console.warn('[Aether AI] receipts failed:', err.message)
      return {
        receipts:      [],
        totalAcross:   0,
        voiceResponse: err.message || 'Could not reach receipts service.',
        insight:       '',
      }
    }
  },

  /**
   * Identify up to 3 products in the frame + estimate prices.
   * Returns { products: [ { name, brand, category, priceEstimate, priceLow, priceHigh, bbox, details, confidence } ], sceneNote }.
   */
  identifyProducts: async ({ imageBase64, hint }) => {
    if (!imageBase64) throw new Error('imageBase64 required')
    try {
      const { result } = await apiClient.post('/ai/identify', {
        provider: selectedProvider === 'auto' ? undefined : selectedProvider,
        imageBase64,
        hint: hint || null,
      })
      return result
    } catch (err) {
      console.warn('[Aether AI] identify failed:', err.message)
      return {
        products: [],
        sceneNote: err.message || 'Could not reach identification service.',
      }
    }
  },

  // ── Voice utilities (client-side, no server needed) ────────

  detectEmotionalTone: (text = '') => {
    const t = text.toLowerCase()
    if (t.match(/excited|amazing|love|want|need|got to|must have/)) return 'excited'
    if (t.match(/worried|nervous|anxious|can't afford|tight|scared/)) return 'anxious'
    if (t.match(/angry|frustrated|stupid|hate|ridiculous/))           return 'frustrated'
    if (t.match(/not sure|maybe|think|should i|unsure|hmm/))          return 'uncertain'
    return 'neutral'
  },

  /** Placeholder — real transcription handled by Web Speech API in VoiceInput.jsx */
  transcribeVoice: async () => ({ text: '', tone: 'neutral' }),
}

// ── Local fallback when backend is unreachable ────────────────
// Keeps the demo runnable even when the server isn't started.

function localFallback(voiceText = '') {
  const lower = voiceText.toLowerCase()

  if (lower.match(/receipt|split|bill|dinner/)) {
    return {
      scene: { type: 'RECEIPT', description: 'Receipt detected (offline fallback)', confidence: 0.7 },
      risk:  { level: 'LOW', reason: 'Normal dining expense' },
      overlayHints: [
        { label: 'Split it', value: 'Offline mode', type: 'info', x: 50, y: 40 },
      ],
      recommendedActions: [],
      voiceResponse: 'Backend offline. Start the server with `npm run server` to enable full AI.',
      insight: 'Run `npm run server` to connect real AI analysis.',
    }
  }

  if (lower.match(/shop|buy|expensive|purchase/)) {
    return {
      scene: { type: 'SHOPPING', description: 'Shopping detected (offline fallback)', confidence: 0.6 },
      risk:  { level: 'MEDIUM', reason: 'Backend offline — analysis limited' },
      overlayHints: [
        { label: 'Offline', value: 'Start server', type: 'info', x: 50, y: 30 },
      ],
      recommendedActions: [],
      voiceResponse: 'I\'m in offline mode. Start the backend server to get full financial AI intelligence.',
      insight: 'Run `npm run server` for live AI-powered analysis.',
    }
  }

  return {
    scene: { type: 'UNKNOWN', description: 'Offline mode', confidence: 0.1 },
    risk:  { level: 'LOW', reason: 'No backend connection' },
    overlayHints: [{ label: 'Offline', value: 'Start server', type: 'info', x: 50, y: 20 }],
    recommendedActions: [],
    voiceResponse: 'Backend not connected. Run `npm run server` in the project folder.',
    insight: 'Full AI requires the backend server to be running.',
  }
}
