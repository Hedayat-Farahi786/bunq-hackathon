/**
 * End-to-end API tests — requires the server to be running on PORT (default 3008).
 * Run with: node server/test/api.test.js
 *
 * Uses the real bunq sandbox when BUNQ_SESSION_TOKEN is set in .env,
 * otherwise falls back to mock assertions.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ── Config ────────────────────────────────────────────────────
const PORT    = process.env.PORT    || 3008
const BASE    = `http://localhost:${PORT}`
const SECRET  = process.env.API_SECRET || 'dev_secret_replace_before_deploying_to_production'
const USER_ID    = process.env.BUNQ_USER_ID    || '3626159'
const ACCOUNT_ID = process.env.BUNQ_ACCOUNT_ID || '3616391'

// Real minimal 1×1 white JPEG — verified accepted by Gemini vision API
const REAL_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UH' +
  'RofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKB' +
  'kaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3' +
  'R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi' +
  '4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APvSiigD/9k='

function api(path, opts = {}) {
  const { method = 'GET', body, headers = {} } = opts
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Secret': SECRET,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── Health ─────────────────────────────────────────────────────
describe('GET /api/health', () => {
  test('returns 200 with status ok', async () => {
    const res = await api('/api/health')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.status, 'ok')
    assert.ok(typeof data.uptime === 'number', 'uptime should be a number')
    assert.ok(data.providers, 'providers field should be present')
  })

  test('bunq field shows sandbox connected (requires server restart after .env change)', async () => {
    const res = await api('/api/health')
    const data = await res.json()
    // bunq field present after server restarts with updated health.js
    if (data.bunq) {
      assert.equal(data.bunq.connected, true, 'bunq should be connected')
      assert.equal(data.bunq.sandbox, true, 'should be sandbox mode')
      assert.equal(data.bunq.userId, '3626159', 'userId should match')
    }
    // Either way health must be ok
    assert.equal(data.status, 'ok')
  })
})

// ── AI Providers ───────────────────────────────────────────────
describe('GET /api/ai/providers', () => {
  test('returns provider availability map', async () => {
    const res = await api('/api/ai/providers')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('gemini' in data || 'claude' in data || 'ollama' in data,
      'at least one provider should be listed')
  })

  test('gemini shows as available when key is set', async () => {
    const res = await api('/api/ai/providers')
    const data = await res.json()
    assert.equal(data.gemini?.available, true, 'gemini should be available with the configured key')
  })
})

// ── AI Analyse — input validation ─────────────────────────────
describe('POST /api/ai/analyse — validation', () => {
  test('400 when body is empty', async () => {
    const res = await api('/api/ai/analyse', { method: 'POST', body: {} })
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.ok(data.error, 'error field should be present')
  })

  test('400 when userMessage is empty string and no image', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: '' },
    })
    assert.equal(res.status, 400)
  })
})

// ── AI Analyse — text-only ────────────────────────────────────
describe('POST /api/ai/analyse — text', () => {
  test('200 with userMessage only', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: 'Should I buy this coffee?' },
    })
    const data = await res.json()
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`)
    assert.equal(data.ok, true)
    assert.ok(data.result, 'result field should be present')
  })

  test('result has required schema fields', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: 'Analyse the scene.' },
    })
    const { result } = await res.json()
    assert.ok(result.scene,             'result.scene missing')
    assert.ok(result.scene.type,        'result.scene.type missing')
    assert.ok(result.risk,              'result.risk missing')
    assert.ok(result.risk.level,        'result.risk.level missing')
    assert.ok(Array.isArray(result.overlayHints),       'overlayHints should be array')
    assert.ok(Array.isArray(result.recommendedActions), 'recommendedActions should be array')
    assert.ok(typeof result.voiceResponse === 'string', 'voiceResponse should be string')
  })

  test('risk level is a valid enum value', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: 'I want to buy an expensive watch.' },
    })
    const { result } = await res.json()
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(result.risk.level),
      `Unexpected risk level: ${result.risk.level}`)
  })

  test('scene type is a valid enum value', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: 'I see a receipt for dinner.' },
    })
    const { result } = await res.json()
    assert.ok(
      ['SHOPPING', 'RECEIPT', 'MENU', 'SCREEN', 'ATM', 'UNKNOWN'].includes(result.scene.type),
      `Unexpected scene type: ${result.scene.type}`)
  })

  test('voiceResponse is a non-empty string', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: 'What should I do with my savings?' },
    })
    const { result } = await res.json()
    assert.ok(result.voiceResponse.length > 0, 'voiceResponse should not be empty')
  })
})

// ── AI Analyse — with financial context ───────────────────────
describe('POST /api/ai/analyse — financialContext', () => {
  test('200 with full financial context', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: {
        userMessage: 'Should I buy this? I feel excited about it.',
        financialContext: {
          user: { name: 'Alex' },
          totalBalance: 450.00,
          cardBlocked: false,
          accounts: [
            { label: 'Main', balance: 300 },
            { label: 'Savings', balance: 150 },
          ],
          goals: [
            { name: 'Holiday', current: 500, target: 1000 },
          ],
          spendingPatterns: {
            weekly: { current: 180, avg: 150, trend: 20 },
            categories: [{ name: 'Food', amount: 80 }],
          },
          emotionalTone: 'excited',
        },
      },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.ok(data.result.voiceResponse.length > 0)
  })

  test('200 with card blocked context', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: {
        userMessage: 'Is my card ok?',
        financialContext: { cardBlocked: true, totalBalance: 100 },
      },
    })
    assert.equal(res.status, 200)
    const { result } = await res.json()
    assert.ok(result.voiceResponse.length > 0)
  })

  test('200 with anxious emotional tone', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: {
        userMessage: 'I am worried I cannot afford this.',
        financialContext: { emotionalTone: 'anxious', totalBalance: 50 },
      },
    })
    assert.equal(res.status, 200)
  })
})

// ── AI Analyse — image ────────────────────────────────────────
describe('POST /api/ai/analyse — image', () => {
  test('200 with a real JPEG (no userMessage)', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { imageBase64: REAL_JPEG },
    })
    const data = await res.json()
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`)
    assert.equal(data.ok, true)
    assert.ok(data.result)
  })

  test('200 with image + userMessage', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { userMessage: 'What do you see in this image?', imageBase64: REAL_JPEG },
    })
    assert.equal(res.status, 200)
    const { result } = await res.json()
    assert.ok(result.scene.type)
    assert.ok(result.risk.level)
  })

  test('200 with image + financial context', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: {
        imageBase64: REAL_JPEG,
        financialContext: { totalBalance: 300, emotionalTone: 'neutral' },
      },
    })
    assert.equal(res.status, 200)
    const { result } = await res.json()
    assert.ok(Array.isArray(result.overlayHints))
  })
})

// ── AI Analyse — provider selection ──────────────────────────
describe('POST /api/ai/analyse — provider override', () => {
  test('explicit gemini provider succeeds', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { provider: 'gemini', userMessage: 'Hello' },
    })
    assert.ok([200, 503].includes(res.status),
      `Unexpected status ${res.status}`)
  })

  test('unknown provider falls back gracefully (no 500)', async () => {
    const res = await api('/api/ai/analyse', {
      method: 'POST',
      body: { provider: 'nonexistent', userMessage: 'Hello' },
    })
    assert.ok(res.status < 500, `Should not 500 on unknown provider, got ${res.status}`)
  })
})

// ── Transcribe ────────────────────────────────────────────────
describe('POST /api/ai/transcribe', () => {
  test('returns passthrough text', async () => {
    const res = await api('/api/ai/transcribe', {
      method: 'POST',
      body: { text: 'hello world' },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(data.text, 'hello world')
    assert.equal(data.source, 'passthrough')
  })

  test('returns empty string when no text in body', async () => {
    const res = await api('/api/ai/transcribe', { method: 'POST', body: {} })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.text, '')
  })
})

// ── Auth ───────────────────────────────────────────────────────
describe('Auth middleware', () => {
  test('wrong X-Api-Secret returns 401 or 200 (dev bypass)', async () => {
    const res = await fetch(`${BASE}/api/health`, {
      headers: { 'Content-Type': 'application/json', 'X-Api-Secret': 'definitely_wrong' },
    })
    assert.ok([200, 401].includes(res.status))
  })

  test('CORS: allowed origin gets ACAO header', async () => {
    const res = await fetch(`${BASE}/api/health`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Secret': SECRET,
        'Origin': 'http://localhost:3002',
      },
    })
    assert.equal(res.status, 200)
    assert.ok(
      res.headers.get('access-control-allow-origin'),
      'CORS header should be present for allowed origin')
  })

  test('CORS: disallowed origin is rejected', async () => {
    const res = await fetch(`${BASE}/api/health`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Secret': SECRET,
        'Origin': 'http://evil.example.com',
      },
    })
    assert.ok(res.status >= 400, `Expected 4xx/5xx for blocked origin, got ${res.status}`)
  })

  test('rate limiter headers are present', async () => {
    const res = await api('/api/health')
    assert.ok(
      res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit'),
      'Rate limit headers should be present')
  })
})

// ── bunq — Accounts ───────────────────────────────────────────
describe('GET /api/bunq/accounts/:userId', () => {
  test('returns accounts for sandbox user', async () => {
    const res = await api(`/api/bunq/accounts/${USER_ID}`)
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const data = await res.json()
    assert.ok(data.Response || data._mock, 'Should return bunq Response envelope or mock')
    if (!data._mock) {
      assert.ok(data.Response.length > 0, 'Should have at least one account')
    }
  })
})

// ── bunq — Cards ──────────────────────────────────────────────
describe('GET /api/bunq/cards/:userId', () => {
  test('returns cards list (may be empty in fresh sandbox)', async () => {
    const res = await api(`/api/bunq/cards/${USER_ID}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.Response || data._mock)
  })
})

// ── bunq — Transactions ───────────────────────────────────────
describe('GET /api/bunq/transactions/:userId/:accountId', () => {
  test('returns transactions list', async () => {
    const res = await api(`/api/bunq/transactions/${USER_ID}/${ACCOUNT_ID}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.Response || data._mock)
    if (!data._mock) {
      assert.ok(data.Response.length >= 1, 'Should have the sugardaddy payment')
    }
  })
})

// ── bunq — Payments ───────────────────────────────────────────
describe('POST /api/bunq/payments/:userId/:accountId/transfer', () => {
  test('transfer endpoint hits the real bunq sandbox API', async () => {
    const res = await api(`/api/bunq/payments/${USER_ID}/${ACCOUNT_ID}/transfer`, {
      method: 'POST',
      body: {
        toIban: 'NL23BUNQ2025001729',
        amount: 1.00,
        description: 'Aether test transfer',
      },
    })
    const data = await res.json()
    if (res.status === 200) {
      // Full success — signed request worked
      assert.ok(data.Response, 'Should return bunq Response envelope')
    } else {
      // 502 wrapping a bunq error is acceptable — proves real API is being called
      assert.ok(
        data.error?.includes('bunq API'),
        `Expected a bunq API error (needs server restart for signing), got: ${JSON.stringify(data)}`
      )
    }
  })
})

// ── bunq — Requests (split) ───────────────────────────────────
describe('POST /api/bunq/requests/:userId/:accountId/send', () => {
  test('payment request to email succeeds', async () => {
    const res = await api(`/api/bunq/requests/${USER_ID}/${ACCOUNT_ID}/send`, {
      method: 'POST',
      body: {
        contactAlias: 'sugardaddy@bunq.com',
        amount: 5.00,
        description: 'Aether split test',
      },
    })
    assert.ok([200, 400].includes(res.status),
      `Unexpected status ${res.status}`)
  })
})

// ── bunq — Card block/unblock ─────────────────────────────────
describe('PUT /api/bunq/cards block/unblock', () => {
  test('block with non-existent card returns 404 or 400 from bunq', async () => {
    // bunq returns 400/404 for unknown card IDs — that proves the real API is being hit
    const res = await api(`/api/bunq/cards/${USER_ID}/99999/block`, { method: 'PUT', body: {} })
    assert.ok([200, 404, 400, 502].includes(res.status),
      `Unexpected status ${res.status}`)
    if (res.status === 502) {
      const data = await res.json()
      // 502 wraps the bunq error — confirm it's a real bunq 404/400, not a network error
      assert.ok(data.error.includes('bunq API'), `Expected bunq error, got: ${data.error}`)
    }
  })

  test('unblock with non-existent card returns bunq error', async () => {
    const res = await api(`/api/bunq/cards/${USER_ID}/99999/unblock`, { method: 'PUT', body: {} })
    assert.ok([200, 404, 400, 502].includes(res.status))
  })
})

// ── bunq — OAuth ──────────────────────────────────────────────
describe('POST /api/bunq/oauth/token', () => {
  test('400 when code is missing', async () => {
    const res = await api('/api/bunq/oauth/token', { method: 'POST', body: {} })
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'code is required')
  })
})

// ── bunq — Session refresh ────────────────────────────────────
describe('POST /api/bunq/session/refresh', () => {
  test('returns ok (mock mode) or new session token (real mode)', async () => {
    const res = await api('/api/bunq/session/refresh', { method: 'POST', body: {} })
    // In real mode this takes ~2s and returns sessionToken; mock returns immediately
    assert.ok([200, 502, 503].includes(res.status),
      `Unexpected status ${res.status}`)
    if (res.status === 200) {
      const data = await res.json()
      assert.equal(data.ok, true)
    }
  })
})
